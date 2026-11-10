// src/repositories/dynamo.ticket.repository.ts
// TICKETING: all DynamoDB access for the Ticket / TicketCounter tables.
// Same conventions as dynamo.jobcardflow.repository.ts (raw DynamoDB client, Amplify table and
// index names, sparse lease column instead of locks).
import 'dotenv/config';
import {
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { dynamoClient } from '../services/dynamo.service';
import { INDEX, table } from '../helper/ticket/ticket.config';

export type Row = Record<string, any>;
export type TicketStatus = 'SUBMITTED' | 'OPEN' | 'CLOSED' | 'FAILED';

const isConditionFailed = (e: any) => e?.name === 'ConditionalCheckFailedException';

export async function getTicket(id: string): Promise<Row | null> {
  const res = await dynamoClient.send(
    new GetItemCommand({ TableName: table('ticket'), Key: marshall({ id }), ConsistentRead: true })
  );
  return res.Item ? unmarshall(res.Item) : null;
}

/**
 * Tickets in one status, oldest first (ticketsByStatusAndSubmittedAt). `max` caps how many are
 * returned; omit it to read the whole partition (used for OPEN, which is the working set).
 */
export async function listTicketsByStatus(status: TicketStatus, max?: number): Promise<Row[]> {
  const rows: Row[] = [];
  let startKey: Record<string, any> | undefined;
  do {
    const res = await dynamoClient.send(
      new QueryCommand({
        TableName: table('ticket'),
        IndexName: INDEX.ticketsByStatus,
        KeyConditionExpression: '#s = :s',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: marshall({ ':s': status }),
        ScanIndexForward: true,
        Limit: max ? max - rows.length : undefined,
        ExclusiveStartKey: startKey,
      })
    );
    rows.push(...(res.Items ?? []).map((i) => unmarshall(i)));
    startKey = res.LastEvaluatedKey;
  } while (startKey && (!max || rows.length < max));
  return rows;
}

async function updateById(
  id: string,
  set: Row,
  remove: string[] = [],
  condition?: { expression: string; values?: Row; names?: Record<string, string> }
) {
  const names: Record<string, string> = { ...(condition?.names ?? {}) };
  const values: Row = { ...(condition?.values ?? {}) };
  const sets: string[] = [];
  Object.entries(set).forEach(([k, v], i) => {
    if (v === undefined) return;
    names[`#s${i}`] = k;
    values[`:s${i}`] = v;
    sets.push(`#s${i} = :s${i}`);
  });
  const removes = remove.map((k, i) => {
    names[`#r${i}`] = k;
    return `#r${i}`;
  });
  const expr = [
    sets.length ? `SET ${sets.join(', ')}` : '',
    removes.length ? `REMOVE ${removes.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (!expr) return;
  await dynamoClient.send(
    new UpdateItemCommand({
      TableName: table('ticket'),
      Key: marshall({ id }),
      UpdateExpression: expr,
      ExpressionAttributeNames: names,
      ...(Object.keys(values).length
        ? { ExpressionAttributeValues: marshall(values, { removeUndefinedValues: true }) }
        : {}),
      ConditionExpression: condition?.expression ?? 'attribute_exists(id)',
    })
  );
}

/** Updates fields on a ticket that must already exist. `lockedUntil` and friends can be removed too. */
export const updateTicket = (id: string, set: Row, remove: string[] = []) =>
  updateById(id, { ...set, updatedAt: new Date().toISOString() }, remove);

/**
 * Takes a short lease on a ticket so two runs (or two servers) never work on the same one.
 * Succeeds only if the ticket is still in `expectStatus` and no live lease exists. The lease is
 * also how failed attempts back off: setting `lockedUntil` in the future delays the next try.
 */
export async function claimTicket(
  id: string,
  expectStatus: TicketStatus,
  nowMs: number,
  leaseMs: number
): Promise<boolean> {
  try {
    await updateById(id, { lockedUntil: nowMs + leaseMs }, [], {
      expression:
        'attribute_exists(id) AND #status = :expected AND (attribute_not_exists(lockedUntil) OR lockedUntil < :now)',
      names: { '#status': 'status' },
      values: { ':expected': expectStatus, ':now': nowMs },
    });
    return true;
  } catch (e) {
    if (isConditionFailed(e)) return false;
    throw e;
  }
}

/** Atomic next number from the TicketCounter row (same technique as nextCertificateNumber). */
export async function nextTicketNumber(): Promise<number> {
  const now = new Date().toISOString();
  const res = await dynamoClient.send(
    new UpdateItemCommand({
      TableName: table('counter'),
      Key: marshall({ id: 'TKT' }),
      UpdateExpression:
        'SET counterKey = :k, updatedAt = :now, createdAt = if_not_exists(createdAt, :now) ADD lastNumber :one',
      ExpressionAttributeValues: marshall({ ':k': 'TKT', ':now': now, ':one': 1 }),
      ReturnValues: 'UPDATED_NEW',
    })
  );
  return Number(unmarshall(res.Attributes ?? {}).lastNumber);
}

/**
 * Stores the allocated number only if the ticket has none yet. Returns false when another run got
 * there first, so a ticket can never end up with two numbers.
 */
export async function setTicketNumberOnce(id: string, ticketNumber: string): Promise<boolean> {
  try {
    await updateById(id, { ticketNumber, updatedAt: new Date().toISOString() }, [], {
      expression: 'attribute_exists(id) AND attribute_not_exists(ticketNumber)',
    });
    return true;
  } catch (e) {
    if (isConditionFailed(e)) return false;
    throw e;
  }
}

/** Remembers a comment id the system posted, so it is never treated as a user update. */
export async function addBotCommentId(id: string, commentId: string) {
  await dynamoClient.send(
    new UpdateItemCommand({
      TableName: table('ticket'),
      Key: marshall({ id }),
      UpdateExpression:
        'SET botCommentIds = list_append(if_not_exists(botCommentIds, :empty), :new), updatedAt = :now',
      ExpressionAttributeValues: marshall({
        ':empty': [],
        ':new': [commentId],
        ':now': new Date().toISOString(),
      }),
      ConditionExpression: 'attribute_exists(id)',
    })
  );
}

/** Everyone in the ClickUpMember table. A handful of rows, so a Scan is fine here (no index needed). */
export async function listMembers(): Promise<Row[]> {
  const rows: Row[] = [];
  let startKey: Record<string, any> | undefined;
  do {
    const res = await dynamoClient.send(
      new ScanCommand({ TableName: table('member'), ExclusiveStartKey: startKey })
    );
    rows.push(...(res.Items ?? []).map((i) => unmarshall(i)));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return rows;
}

/** Adds or updates one person (id = ClickUp user id). Written the way Amplify writes its own rows. */
export async function putMember(person: {
  id: string;
  name: string;
  email?: string | null;
  avatarUrl?: string | null;
  isActive: boolean;
}) {
  const now = new Date().toISOString();
  await dynamoClient.send(
    new UpdateItemCommand({
      TableName: table('member'),
      Key: marshall({ id: person.id }),
      UpdateExpression:
        'SET #n = :n, email = :e, avatarUrl = :av, isActive = :a, updatedAt = :now, createdAt = if_not_exists(createdAt, :now), #tn = :t',
      // DynamoDB rejects attribute names that start with an underscore inside an expression, so
      // __typename must go through a #placeholder (a bare __typename is a ValidationException).
      ExpressionAttributeNames: { '#n': 'name', '#tn': '__typename' },
      ExpressionAttributeValues: marshall({
        ':n': person.name,
        ':e': person.email ?? null,
        ':av': person.avatarUrl ?? null,
        ':a': person.isActive,
        ':now': now,
        ':t': 'ClickUpMember',
      }),
    })
  );
}

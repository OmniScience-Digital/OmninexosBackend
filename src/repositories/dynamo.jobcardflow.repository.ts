// src/repositories/dynamo.jobcardflow.repository.ts
import 'dotenv/config';
import {
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { dynamoClient } from '../services/dynamo.service';
import { INDEX, table } from '../helper/jobcard/jobcard.config';
import { telegramGroupRowId, type GroupEvent } from '../helper/telegram/telegram.update';

export type Row = Record<string, any>;
const isConditionFailed = (e: any) => e?.name === 'ConditionalCheckFailedException';

async function getById(tableName: string, id: string): Promise<Row | null> {
  const res = await dynamoClient.send(
    new GetItemCommand({ TableName: tableName, Key: marshall({ id }) })
  );
  return res.Item ? unmarshall(res.Item) : null;
}

async function queryAll(
  tableName: string,
  indexName: string,
  keyName: string,
  keyValue: string,
  opts: { newestFirst?: boolean; limit?: number } = {}
): Promise<Row[]> {
  const rows: Row[] = [];
  let startKey: Record<string, any> | undefined;
  do {
    const res = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: indexName,
        KeyConditionExpression: '#k = :v',
        ExpressionAttributeNames: { '#k': keyName },
        ExpressionAttributeValues: marshall({ ':v': keyValue }),
        ScanIndexForward: !opts.newestFirst,
        Limit: opts.limit,
        ExclusiveStartKey: startKey,
      })
    );
    rows.push(...(res.Items ?? []).map((i) => unmarshall(i)));
    startKey = opts.limit ? undefined : res.LastEvaluatedKey;
  } while (startKey);
  return rows;
}

/** Query with a `>=` range on the sort key. Same GSI, one extra condition. */
async function queryAllWithRange(
  tableName: string,
  indexName: string,
  keyName: string,
  keyValue: string,
  rangeName: string,
  rangeFrom: string,
  opts: { newestFirst?: boolean; limit?: number } = {}
): Promise<Row[]> {
  const rows: Row[] = [];
  let startKey: Record<string, any> | undefined;
  do {
    const res = await dynamoClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: indexName,
        KeyConditionExpression: '#k = :v AND #r >= :from',
        ExpressionAttributeNames: { '#k': keyName, '#r': rangeName },
        ExpressionAttributeValues: marshall({ ':v': keyValue, ':from': rangeFrom }),
        ScanIndexForward: !opts.newestFirst,
        Limit: opts.limit,
        ExclusiveStartKey: startKey,
      })
    );
    rows.push(...(res.Items ?? []).map((i) => unmarshall(i)));
    startKey = opts.limit ? undefined : res.LastEvaluatedKey;
  } while (startKey);
  return rows;
}

async function updateById(
  tableName: string,
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
      TableName: tableName,
      Key: marshall({ id }),
      UpdateExpression: expr,
      ExpressionAttributeNames: names,
      ...(Object.keys(values).length
        ? { ExpressionAttributeValues: marshall(values, { removeUndefinedValues: true }) }
        : {}),
      ...(condition ? { ConditionExpression: condition.expression } : {}),
    })
  );
}

// ---------- job cards, scales, work items ----------
export const getJobCard = (id: string) => getById(table('jobCard'), id);
export const getScale = (id: string) => getById(table('scale'), id);
export const getModule = (id: string) => getById(table('module'), id);
export const listModules = (jobCardId: string) =>
  queryAll(table('module'), INDEX.modulesByJobCard, 'jobCardId', jobCardId);

// ---------- time tracking ----------
export const listTimeEntries = (jobCardId: string) =>
  queryAll(table('timeEntry'), INDEX.timeEntriesByJobCard, 'jobCardId', jobCardId);

export const closeTimeEntry = (id: string, endedAt: string, minutes: number, endReason: string) =>
  updateById(table('timeEntry'), id, {
    endedAt,
    minutes,
    endReason,
    updatedAt: new Date().toISOString(),
  });

/**
 * Job cards that still owe the wrap-up messages. Found through the sparse
 * `jobCardsByWrapUpPendingAndClosedAt` GSI — only cards with wrapUpPending
 * set appear here, so this is a small bounded query, not a table scan.
 */
export const listJobCardsAwaitingWrapUp = (): Promise<Row[]> =>
  queryAll(table('jobCard'), INDEX.jobCardsByWrapUpPending, 'wrapUpPending', 'PENDING');

export const setJobCardFields = (jobCardId: string, set: Row, remove: string[] = []) =>
  updateById(table('jobCard'), jobCardId, set, remove, { expression: 'attribute_exists(id)' });

export const setJobCardTotal = (jobCardId: string, totalMinutes: number) =>
  updateById(
    table('jobCard'),
    jobCardId,
    { totalMinutes, updatedAt: new Date().toISOString() },
    [],
    { expression: 'attribute_exists(id)' }
  );

// ---------- submissions (results) ----------
export const listSubmissionsByDeliveryState = (state: 'PENDING' | 'FAILED' | 'SENT', limit = 100) =>
  queryAll(table('submission'), INDEX.submissionsByDeliveryState, 'deliveryState', state, {
    limit,
  });

/**
 * FAILED submissions still within the retry window. Uses the sort key
 * (submittedAt) on the deliveryState GSI so that old FAILED rows which are
 * past the retry age no longer fill the page — this keeps requeue bounded
 * and correct as FAILED rows accumulate.
 */
export const listFailedSubmissionsSince = (sinceIso: string, limit = 100) =>
  queryAllWithRange(
    table('submission'),
    INDEX.submissionsByDeliveryState,
    'deliveryState',
    'FAILED',
    'submittedAt',
    sinceIso,
    { limit }
  );

export const listPendingSubmissions = (limit = 100) =>
  listSubmissionsByDeliveryState('PENDING', limit);

export const getSubmission = (id: string) => getById(table('submission'), id);

export const listSubmissionsByModule = (moduleId: string) =>
  queryAll(table('submission'), INDEX.submissionsByModule, 'moduleId', moduleId, {
    newestFirst: true,
  });

export async function claimSubmission(
  id: string,
  nowMs: number,
  leaseMs: number
): Promise<boolean> {
  try {
    await updateById(table('submission'), id, { lockedUntil: nowMs + leaseMs }, [], {
      expression:
        'attribute_exists(id) AND (attribute_not_exists(lockedUntil) OR lockedUntil < :now)',
      values: { ':now': nowMs },
    });
    return true;
  } catch (e) {
    if (isConditionFailed(e)) return false;
    throw e;
  }
}

export const updateSubmission = (id: string, set: Row, remove: string[] = []) =>
  updateById(table('submission'), id, { ...set, updatedAt: new Date().toISOString() }, remove);

// ---------- Telegram groups ----------
export const getTelegramGroup = (id: string) => getById(table('telegramGroup'), id);

export async function upsertTelegramGroup(event: GroupEvent, nowIso = new Date().toISOString()) {
  const id = telegramGroupRowId(event.chatId);
  const names: Record<string, string> = {
    '#c': 'chatId',
    '#u': 'updatedAt',
    '#ct': 'createdAt',
    '#ad': 'addedAt',
  };
  const values: Row = { ':c': event.chatId, ':now': nowIso };
  const sets = [
    '#c = :c',
    '#u = :now',
    '#ct = if_not_exists(#ct, :now)',
    '#ad = if_not_exists(#ad, :now)',
  ];
  if (event.groupName) {
    names['#n'] = 'groupName';
    values[':n'] = event.groupName;
    sets.push('#n = :n');
  }
  if (event.active !== undefined) {
    names['#a'] = 'active';
    values[':a'] = event.active;
    sets.push('#a = :a');
  }
  await dynamoClient.send(
    new UpdateItemCommand({
      TableName: table('telegramGroup'),
      Key: marshall({ id }),
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: marshall(values),
    })
  );
  return id;
}

// ---------- certificates ----------
export const listCertificatesByScale = (scaleId: string) =>
  queryAll(table('certificate'), INDEX.certificatesByScale, 'scaleId', scaleId);

export async function reserveCertificate(row: Row): Promise<boolean> {
  try {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: table('certificate'),
        Item: marshall(row, { removeUndefinedValues: true }),
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );
    return true;
  } catch (e) {
    if (isConditionFailed(e)) return false;
    throw e;
  }
}

export const updateCertificate = (id: string, set: Row) =>
  updateById(table('certificate'), id, { ...set, updatedAt: new Date().toISOString() });

export async function nextCertificateNumber(): Promise<number> {
  const now = new Date().toISOString();
  const res = await dynamoClient.send(
    new UpdateItemCommand({
      TableName: table('certificateCounter'),
      Key: marshall({ id: 'CRT' }),
      UpdateExpression:
        'SET counterKey = :k, updatedAt = :now, createdAt = if_not_exists(createdAt, :now) ADD lastNumber :one',
      ExpressionAttributeValues: marshall({ ':k': 'CRT', ':now': now, ':one': 1 }),
      ReturnValues: 'UPDATED_NEW',
    })
  );
  return Number(unmarshall(res.Attributes ?? {}).lastNumber);
}

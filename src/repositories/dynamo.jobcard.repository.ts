// src/repositories/dynamo.jobcard.repository.ts
import 'dotenv/config';
import { PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { dynamoClient } from '../services/dynamo.service';
import { buildJobCardItem } from '../helper/jobcard/jobcard.helper';

/** Job cards are only written once JOBCARD_TABLE (the Amplify JobCard table name) is configured. */
export const jobCardsEnabled = (): boolean => Boolean(process.env.JOBCARD_TABLE);

const isConditionFailed = (err: any) => err?.name === 'ConditionalCheckFailedException';

/**
 * Opens the job card for an accepted quote. Safe to call any number of times:
 *  - the row id is derived from the quote number, so a second call can never create a duplicate;
 *  - if the row already exists but has no ClickUp task id yet and one is now known, it is filled in.
 * Existing rows are never otherwise modified (status, time and totals belong to the app).
 */
export async function ensureJobCardForQuote(
  quote: { quoteNumber: string; quoteId?: string; customerName?: string; title?: string },
  clickupTaskId?: string
): Promise<'created' | 'updated' | 'exists'> {
  const table = process.env.JOBCARD_TABLE;
  if (!table) throw new Error('JOBCARD_TABLE is not set');

  const now = new Date().toISOString();
  const item = buildJobCardItem(quote, clickupTaskId, now);

  try {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: table,
        Item: marshall(item, { removeUndefinedValues: true }),
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );
    return 'created';
  } catch (err: any) {
    if (!isConditionFailed(err)) throw err;
  }

  if (!clickupTaskId) return 'exists';
  try {
    await dynamoClient.send(
      new UpdateItemCommand({
        TableName: table,
        Key: marshall({ id: item.id }),
        UpdateExpression: 'SET clickupTaskId = :t, updatedAt = :u',
        ConditionExpression:
          'attribute_exists(id) AND (attribute_not_exists(clickupTaskId) OR clickupTaskId = :empty)',
        ExpressionAttributeValues: marshall({ ':t': clickupTaskId, ':u': now, ':empty': '' }),
      })
    );
    return 'updated';
  } catch (err: any) {
    if (isConditionFailed(err)) return 'exists';
    throw err;
  }
}

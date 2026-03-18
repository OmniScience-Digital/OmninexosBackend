import 'dotenv/config';
import { QueryCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { dynamoClient } from '../services/dynamo.service';
import logger from '../utils/logger';

const QUOTE_TABLE = process.env.XERO_QUOTE_TABLE!;

export async function getQuoteByNumber(quoteNumber: string) {
  const params = {
    TableName: QUOTE_TABLE,
    IndexName: 'quotesByQuoteNumber', // ✅ use your new GSI
    KeyConditionExpression: 'quoteNumber = :qnum',
    ExpressionAttributeValues: marshall({ ':qnum': quoteNumber }),
  };

  const result = await dynamoClient.send(new QueryCommand(params));
  return result.Items && result.Items.length > 0 ? unmarshall(result.Items[0]) : null;
}

// Correct way if quoteId is an attribute, not PK
export async function getQuoteById(quoteId: string) {
  const params = {
    TableName: QUOTE_TABLE,
    IndexName: 'quotesByQuoteId', // ✅ correct GSI name from your table
    KeyConditionExpression: 'quoteId = :qid',
    ExpressionAttributeValues: marshall({ ':qid': quoteId }),
  };

  const result = await dynamoClient.send(new QueryCommand(params));
  return result.Items && result.Items.length > 0 ? unmarshall(result.Items[0]) : null;
}

export const createQuote = async (quoteItem: any) => {
  await dynamoClient.send(
    new PutItemCommand({
      TableName: QUOTE_TABLE,
      Item: marshall(quoteItem),
    })
  );
  return quoteItem;
};

export const updateQuote = async (pkId: string, updates: any) => {
  if (!pkId) throw new Error('id (PK) is required for update');

  const updateExpressions: string[] = [];
  const values: any = {};
  const names: any = {};

  for (const key in updates) {
    if (updates[key] !== undefined && updates[key] !== null) {
      updateExpressions.push(`#${key} = :${key}`);
      values[`:${key}`] = updates[key];
      names[`#${key}`] = key;
    }
  }

  updateExpressions.push('#updatedAt = :updatedAt');
  values[':updatedAt'] = new Date().toISOString();
  names['#updatedAt'] = 'updatedAt';

  const params = {
    TableName: QUOTE_TABLE,
    Key: { id: { S: pkId } }, // ✅ use actual PK
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: marshall(values, { removeUndefinedValues: true }),
    ReturnValues: 'ALL_NEW' as const,
  };

  const result = await dynamoClient.send(new UpdateItemCommand(params));
  return result.Attributes ? unmarshall(result.Attributes) : null;
};

import 'dotenv/config';
import { UpdateItemCommand, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { dynamoClient } from '../services/dynamo.service';
import logger from '../utils/logger';

const CONFIG_TABLE = process.env.XERO_CONFIG_TABLE!;

export const getXeroConfig = async (tenantId: string) => {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: CONFIG_TABLE,
      IndexName: 'xeroConfigsByTenantId',
      KeyConditionExpression: 'tenantId = :tid',
      ExpressionAttributeValues: marshall({ ':tid': tenantId }),
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null; // no record found
  }

  // Return the first matched item
  return unmarshall(result.Items[0]);
};

export const updateXeroConfig = async (
  tenantId: string,
  updates: {
    quotesLastSyncUTC?: string;
    purchasesLastSyncUTC?: string;
    refreshTokenEncrypted?: string;
  }
) => {
  // --- Query by secondary index to check existence ---
  const existingQuery = await dynamoClient.send(
    new QueryCommand({
      TableName: CONFIG_TABLE,
      IndexName: 'xeroConfigsByTenantId',
      KeyConditionExpression: 'tenantId = :tid',
      ExpressionAttributeValues: marshall({ ':tid': tenantId }),
    })
  );

  // Old epoch date for initial creation
  const oldEpoch = new Date('1963-01-01T00:00:00.000Z').toISOString();

  // --- Insert if missing ---
  if (existingQuery.Count === 0) {
    logger.info('No existing record, creating one...');
    const now = new Date().toISOString();
    const newItem: any = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      tenantId,
      quotesLastSyncUTC: oldEpoch,
      purchasesLastSyncUTC: oldEpoch,
      refreshTokenEncrypted: updates.refreshTokenEncrypted || '',
      createdAt: now,
      updatedAt: now,
    };
    await dynamoClient.send(
      new PutItemCommand({ TableName: CONFIG_TABLE, Item: marshall(newItem) })
    );
    return newItem;
  }

  // --- Otherwise, update existing ---
  const existingItem = unmarshall(existingQuery.Items![0]);
  const updateExpressions: string[] = [];
  const values: any = {};

  if (updates.quotesLastSyncUTC) {
    updateExpressions.push('quotesLastSyncUTC = :quotes');
    values[':quotes'] = updates.quotesLastSyncUTC;
  }

  if (updates.purchasesLastSyncUTC) {
    updateExpressions.push('purchasesLastSyncUTC = :purchases');
    values[':purchases'] = updates.purchasesLastSyncUTC;
  }

  if (updates.refreshTokenEncrypted) {
    updateExpressions.push('refreshTokenEncrypted = :token');
    values[':token'] = updates.refreshTokenEncrypted;
  }

  // Always update updatedAt on every update
  updateExpressions.push('updatedAt = :updated');
  values[':updated'] = new Date().toISOString();

  if (updateExpressions.length === 0) {
    throw new Error('No fields provided to update');
  }

  const params = {
    TableName: CONFIG_TABLE,
    Key: marshall({ id: existingItem.id }),
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeValues: marshall(values),
    ReturnValues: 'ALL_NEW' as const,
  };

  const result = await dynamoClient.send(new UpdateItemCommand(params));
  return result.Attributes ? unmarshall(result.Attributes) : null;
};

import "dotenv/config";
import { UpdateItemCommand, PutItemCommand, QueryCommand, ConditionalCheckFailedException, } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../services/dynamo.service.js";
import logger from "../utils/logger.js";
const CONFIG_TABLE = process.env.XERO_CONFIG_TABLE;
export const getXeroConfig = async (tenantId) => {
    const result = await dynamoClient.send(new QueryCommand({
        TableName: CONFIG_TABLE,
        IndexName: "xeroConfigsByTenantId",
        KeyConditionExpression: "tenantId = :tid",
        ExpressionAttributeValues: marshall({ ":tid": tenantId }),
    }));
    if (!result.Items || result.Items.length === 0) {
        return null; // no record found
    }
    // Return the first matched item
    return unmarshall(result.Items[0]);
};
/**
 * Thrown when a conditional (compare-and-swap) update loses a race — i.e.
 * someone else already changed refreshTokenEncrypted since we read it.
 * Callers should re-read the config and retry rather than treat this as fatal.
 */
export class XeroConfigConditionFailedError extends Error {
    constructor() {
        super("Xero config was modified by another process before this update could apply");
        this.name = "XeroConfigConditionFailedError";
    }
}
/**
 * Distributed lock for the Xero refresh-token redemption, stored on the same
 * xeroConfig record in DynamoDB rather than in Redis.
 *
 * Why DynamoDB and not Redis: dev/test/prod each run their own local Redis, so a
 * Redis-based lock only ever protects processes on the *same* Redis instance. All
 * environments share this one DynamoDB table/record per tenantId, so this lock
 * actually coordinates across dev, test, and prod when they point at the same
 * Xero tenant - which is exactly the scenario that was silently corrupting the
 * refresh token before (two environments redeeming the same single-use refresh
 * token at once, with neither aware of the other).
 *
 * Returns true if the lock was acquired, false if someone else currently holds it.
 */
export async function acquireXeroLock(tenantId, lockValue, ttlMs) {
    const config = await getXeroConfig(tenantId);
    if (!config)
        throw new Error("No Xero config found in Database");
    const now = Date.now();
    const expiresAt = now + ttlMs;
    try {
        await dynamoClient.send(new UpdateItemCommand({
            TableName: CONFIG_TABLE,
            Key: marshall({ id: config.id }),
            UpdateExpression: "SET lockOwner = :owner, lockExpiresAt = :expires",
            // Free to acquire if no one holds it, or the previous holder's lock expired
            // (e.g. it crashed before releasing).
            ConditionExpression: "attribute_not_exists(lockExpiresAt) OR lockExpiresAt < :now",
            ExpressionAttributeValues: marshall({
                ":owner": lockValue,
                ":expires": expiresAt,
                ":now": now,
            }),
        }));
        return true;
    }
    catch (err) {
        if (err instanceof ConditionalCheckFailedException) {
            return false;
        }
        throw err;
    }
}
/** Releases the lock only if the caller still owns it (avoids clobbering a
 * lock that already expired and was re-acquired by someone else). */
export async function releaseXeroLock(tenantId, lockValue) {
    const config = await getXeroConfig(tenantId);
    if (!config)
        return;
    try {
        await dynamoClient.send(new UpdateItemCommand({
            TableName: CONFIG_TABLE,
            Key: marshall({ id: config.id }),
            UpdateExpression: "REMOVE lockOwner, lockExpiresAt",
            ConditionExpression: "lockOwner = :owner",
            ExpressionAttributeValues: marshall({ ":owner": lockValue }),
        }));
    }
    catch (err) {
        if (err instanceof ConditionalCheckFailedException) {
            logger.warn(`[XeroConfig] Lock already released/expired/reacquired for tenant ${tenantId} - ignoring.`);
            return;
        }
        throw err;
    }
}
export const updateXeroConfig = async (tenantId, updates, 
// If provided, the write only applies when refreshTokenEncrypted in the DB
// still equals this value at write time (compare-and-swap). Pass the value
// you originally read before calling Xero. Throws XeroConfigConditionFailedError
// if someone else already rotated it out from under you.
expectedCurrentRefreshTokenEncrypted) => {
    // --- Query by secondary index to check existence ---
    const existingQuery = await dynamoClient.send(new QueryCommand({
        TableName: CONFIG_TABLE,
        IndexName: "xeroConfigsByTenantId",
        KeyConditionExpression: "tenantId = :tid",
        ExpressionAttributeValues: marshall({ ":tid": tenantId }),
    }));
    // Old epoch date for initial creation
    const oldEpoch = new Date("1963-01-01T00:00:00.000Z").toISOString();
    // --- Insert if missing ---
    if (existingQuery.Count === 0) {
        logger.info("No existing record, creating one...");
        const now = new Date().toISOString();
        const newItem = {
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            tenantId,
            quotesLastSyncUTC: oldEpoch,
            purchasesLastSyncUTC: oldEpoch,
            refreshTokenEncrypted: updates.refreshTokenEncrypted || "",
            createdAt: now,
            updatedAt: now,
        };
        await dynamoClient.send(new PutItemCommand({ TableName: CONFIG_TABLE, Item: marshall(newItem) }));
        return newItem;
    }
    // --- Otherwise, update existing ---
    const existingItem = unmarshall(existingQuery.Items[0]);
    const updateExpressions = [];
    const values = {};
    if (updates.quotesLastSyncUTC) {
        updateExpressions.push("quotesLastSyncUTC = :quotes");
        values[":quotes"] = updates.quotesLastSyncUTC;
    }
    if (updates.purchasesLastSyncUTC) {
        updateExpressions.push("purchasesLastSyncUTC = :purchases");
        values[":purchases"] = updates.purchasesLastSyncUTC;
    }
    if (updates.refreshTokenEncrypted) {
        updateExpressions.push("refreshTokenEncrypted = :token");
        values[":token"] = updates.refreshTokenEncrypted;
    }
    // Always update updatedAt on every update
    updateExpressions.push("updatedAt = :updated");
    values[":updated"] = new Date().toISOString();
    if (updateExpressions.length === 0) {
        throw new Error("No fields provided to update");
    }
    // --- Compare-and-swap guard ---
    // Only relevant when this update is rotating the refresh token: make sure
    // nobody else has already changed it since we read it.
    let conditionExpression;
    if (expectedCurrentRefreshTokenEncrypted !== undefined) {
        conditionExpression = "refreshTokenEncrypted = :expectedToken";
        values[":expectedToken"] = expectedCurrentRefreshTokenEncrypted;
    }
    const params = {
        TableName: CONFIG_TABLE,
        Key: marshall({ id: existingItem.id }),
        UpdateExpression: `SET ${updateExpressions.join(", ")}`,
        ExpressionAttributeValues: marshall(values),
        ...(conditionExpression ? { ConditionExpression: conditionExpression } : {}),
        ReturnValues: "ALL_NEW",
    };
    try {
        const result = await dynamoClient.send(new UpdateItemCommand(params));
        return result.Attributes ? unmarshall(result.Attributes) : null;
    }
    catch (err) {
        if (err instanceof ConditionalCheckFailedException) {
            logger.warn(`[XeroConfig] Conditional update lost a race for tenant ${tenantId} — refreshTokenEncrypted changed since it was read.`);
            throw new XeroConfigConditionFailedError();
        }
        throw err;
    }
};

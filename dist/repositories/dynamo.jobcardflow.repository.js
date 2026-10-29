// src/repositories/dynamo.jobcardflow.repository.ts
import "dotenv/config";
import { GetItemCommand, PutItemCommand, QueryCommand, UpdateItemCommand, } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../services/dynamo.service.js";
import { INDEX, table } from "../helper/jobcard/jobcard.config.js";
import { telegramGroupRowId } from "../helper/telegram/telegram.update.js";
const isConditionFailed = (e) => e?.name === "ConditionalCheckFailedException";
async function getById(tableName, id) {
    const res = await dynamoClient.send(new GetItemCommand({ TableName: tableName, Key: marshall({ id }) }));
    return res.Item ? unmarshall(res.Item) : null;
}
async function queryAll(tableName, indexName, keyName, keyValue, opts = {}) {
    const rows = [];
    let startKey;
    do {
        const res = await dynamoClient.send(new QueryCommand({
            TableName: tableName,
            IndexName: indexName,
            KeyConditionExpression: "#k = :v",
            ExpressionAttributeNames: { "#k": keyName },
            ExpressionAttributeValues: marshall({ ":v": keyValue }),
            ScanIndexForward: !opts.newestFirst,
            Limit: opts.limit,
            ExclusiveStartKey: startKey,
        }));
        rows.push(...(res.Items ?? []).map((i) => unmarshall(i)));
        startKey = opts.limit ? undefined : res.LastEvaluatedKey;
    } while (startKey);
    return rows;
}
async function updateById(tableName, id, set, remove = [], condition) {
    const names = { ...(condition?.names ?? {}) };
    const values = { ...(condition?.values ?? {}) };
    const sets = [];
    Object.entries(set).forEach(([k, v], i) => {
        if (v === undefined)
            return;
        names[`#s${i}`] = k;
        values[`:s${i}`] = v;
        sets.push(`#s${i} = :s${i}`);
    });
    const removes = remove.map((k, i) => {
        names[`#r${i}`] = k;
        return `#r${i}`;
    });
    const expr = [
        sets.length ? `SET ${sets.join(", ")}` : "",
        removes.length ? `REMOVE ${removes.join(", ")}` : "",
    ]
        .filter(Boolean)
        .join(" ");
    if (!expr)
        return;
    await dynamoClient.send(new UpdateItemCommand({
        TableName: tableName,
        Key: marshall({ id }),
        UpdateExpression: expr,
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length
            ? { ExpressionAttributeValues: marshall(values, { removeUndefinedValues: true }) }
            : {}),
        ...(condition ? { ConditionExpression: condition.expression } : {}),
    }));
}
// ---------- job cards, scales, work items ----------
export const getJobCard = (id) => getById(table("jobCard"), id);
export const getScale = (id) => getById(table("scale"), id);
export const getModule = (id) => getById(table("module"), id);
export const listModules = (jobCardId) => queryAll(table("module"), INDEX.modulesByJobCard, "jobCardId", jobCardId);
// ---------- time tracking ----------
export const listTimeEntries = (jobCardId) => queryAll(table("timeEntry"), INDEX.timeEntriesByJobCard, "jobCardId", jobCardId);
export const closeTimeEntry = (id, endedAt, minutes, endReason) => updateById(table("timeEntry"), id, {
    endedAt,
    minutes,
    endReason,
    updatedAt: new Date().toISOString(),
});
/**
 * Job cards that still owe the wrap-up messages. Found through the sparse
 * `jobCardsByWrapUpPendingAndClosedAt` GSI: only cards with wrapUpPending
 * set appear here, so this is a small bounded query, not a table scan.
 */
export const listJobCardsAwaitingWrapUp = () => queryAll(table("jobCard"), INDEX.jobCardsByWrapUpPending, "wrapUpPending", "PENDING");
export const setJobCardFields = (jobCardId, set, remove = []) => updateById(table("jobCard"), jobCardId, set, remove, { expression: "attribute_exists(id)" });
export const setJobCardTotal = (jobCardId, totalMinutes) => updateById(table("jobCard"), jobCardId, { totalMinutes, updatedAt: new Date().toISOString() }, [], { expression: "attribute_exists(id)" });
// ---------- submissions (results) ----------
export const listSubmissionsByDeliveryState = (state, limit = 100) => queryAll(table("submission"), INDEX.submissionsByDeliveryState, "deliveryState", state, {
    limit,
});
export const listPendingSubmissions = (limit = 100) => listSubmissionsByDeliveryState("PENDING", limit);
export const listSubmissionsByModule = (moduleId) => queryAll(table("submission"), INDEX.submissionsByModule, "moduleId", moduleId, {
    newestFirst: true,
});
export async function claimSubmission(id, nowMs, leaseMs) {
    try {
        await updateById(table("submission"), id, { lockedUntil: nowMs + leaseMs }, [], {
            expression: "attribute_exists(id) AND (attribute_not_exists(lockedUntil) OR lockedUntil < :now)",
            values: { ":now": nowMs },
        });
        return true;
    }
    catch (e) {
        if (isConditionFailed(e))
            return false;
        throw e;
    }
}
export const updateSubmission = (id, set, remove = []) => updateById(table("submission"), id, { ...set, updatedAt: new Date().toISOString() }, remove);
// ---------- Telegram groups ----------
export const getTelegramGroup = (id) => getById(table("telegramGroup"), id);
export async function upsertTelegramGroup(event, nowIso = new Date().toISOString()) {
    const id = telegramGroupRowId(event.chatId);
    const names = {
        "#c": "chatId",
        "#u": "updatedAt",
        "#ct": "createdAt",
        "#ad": "addedAt",
    };
    const values = { ":c": event.chatId, ":now": nowIso };
    const sets = [
        "#c = :c",
        "#u = :now",
        "#ct = if_not_exists(#ct, :now)",
        "#ad = if_not_exists(#ad, :now)",
    ];
    if (event.groupName) {
        names["#n"] = "groupName";
        values[":n"] = event.groupName;
        sets.push("#n = :n");
    }
    if (event.active !== undefined) {
        names["#a"] = "active";
        values[":a"] = event.active;
        sets.push("#a = :a");
    }
    await dynamoClient.send(new UpdateItemCommand({
        TableName: table("telegramGroup"),
        Key: marshall({ id }),
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: marshall(values),
    }));
    return id;
}
// ---------- certificates ----------
export const listCertificatesByScale = (scaleId) => queryAll(table("certificate"), INDEX.certificatesByScale, "scaleId", scaleId);
export async function reserveCertificate(row) {
    try {
        await dynamoClient.send(new PutItemCommand({
            TableName: table("certificate"),
            Item: marshall(row, { removeUndefinedValues: true }),
            ConditionExpression: "attribute_not_exists(id)",
        }));
        return true;
    }
    catch (e) {
        if (isConditionFailed(e))
            return false;
        throw e;
    }
}
export const updateCertificate = (id, set) => updateById(table("certificate"), id, { ...set, updatedAt: new Date().toISOString() });
export async function nextCertificateNumber() {
    const now = new Date().toISOString();
    const res = await dynamoClient.send(new UpdateItemCommand({
        TableName: table("certificateCounter"),
        Key: marshall({ id: "CRT" }),
        UpdateExpression: "SET counterKey = :k, updatedAt = :now, createdAt = if_not_exists(createdAt, :now) ADD lastNumber :one",
        ExpressionAttributeValues: marshall({ ":k": "CRT", ":now": now, ":one": 1 }),
        ReturnValues: "UPDATED_NEW",
    }));
    return Number(unmarshall(res.Attributes ?? {}).lastNumber);
}

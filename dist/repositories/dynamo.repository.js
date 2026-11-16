import "dotenv/config";
import { QueryCommand, ScanCommand, PutItemCommand, TransactWriteItemsCommand, } from "@aws-sdk/client-dynamodb";
import { createHash } from "crypto";
import { dynamoClient } from "../services/dynamo.service.js";
const CATEGORY_TABLE = process.env.CATEGORY_TABLE;
const SUBCATEGORY_TABLE = process.env.SUBCATEGORY_TABLE;
const COMPONENTS_TABLE = process.env.COMPONENTS_TABLE;
const HISTORY_TABLE = process.env.HISTORY_TABLE;
function normalizeKey(key) {
    return (key
        .trim()
        .toLowerCase()
        // Keep letters, numbers, dots, and spaces - remove everything else
        .replace(/[^a-zA-Z0-9.\s]/g, " ")
        // Collapse multiple spaces into single space
        .replace(/\s+/g, " ")
        .trim());
}
// ─────────────────────────────────────────────────────────────────────────────
// Lookups. Names are matched on their normalised form so an item that exists is
// always found, even if it is stored with different casing/punctuation (e.g.
// "M8-Bolt" is the same item as "m8 bolt"). An exact index lookup is tried first
// (fast path); only if that misses do we compare normalised names.
// ─────────────────────────────────────────────────────────────────────────────
async function queryAll(input) {
    const items = [];
    let startKey;
    do {
        const res = await dynamoClient.send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }));
        items.push(...(res.Items ?? []));
        startKey = res.LastEvaluatedKey;
    } while (startKey);
    return items;
}
async function scanAll(tableName) {
    const items = [];
    let startKey;
    do {
        const res = await dynamoClient.send(new ScanCommand({ TableName: tableName, ExclusiveStartKey: startKey }));
        items.push(...(res.Items ?? []));
        startKey = res.LastEvaluatedKey;
    } while (startKey);
    return items;
}
async function findCategory(name) {
    const exact = await queryAll({
        TableName: CATEGORY_TABLE,
        IndexName: "categoriesByCategoryName",
        KeyConditionExpression: "#name = :nameVal",
        ExpressionAttributeNames: { "#name": "categoryName" },
        ExpressionAttributeValues: { ":nameVal": { S: name } },
    });
    if (exact.length > 0)
        return exact[0];
    const all = await scanAll(CATEGORY_TABLE);
    return all.find((i) => i.categoryName?.S && normalizeKey(i.categoryName.S) === name);
}
async function findSubcategory(categoryId, name) {
    const exact = await queryAll({
        TableName: SUBCATEGORY_TABLE,
        IndexName: "subCategoriesByCategoryIdAndSubcategoryName",
        KeyConditionExpression: "categoryId = :cid AND subcategoryName = :subName",
        ExpressionAttributeValues: { ":cid": { S: categoryId }, ":subName": { S: name } },
    });
    if (exact.length > 0)
        return exact[0];
    const inCategory = await queryAll({
        TableName: SUBCATEGORY_TABLE,
        IndexName: "subCategoriesByCategoryIdAndSubcategoryName",
        KeyConditionExpression: "categoryId = :cid",
        ExpressionAttributeValues: { ":cid": { S: categoryId } },
    });
    return inCategory.find((i) => i.subcategoryName?.S && normalizeKey(i.subcategoryName.S) === name);
}
async function findComponent(subcategoryId, key) {
    const exact = await queryAll({
        TableName: COMPONENTS_TABLE,
        IndexName: "componentsBySubcategoryIdAndComponentId",
        KeyConditionExpression: "subcategoryId = :sid AND componentId = :cid",
        ExpressionAttributeValues: { ":sid": { S: subcategoryId }, ":cid": { S: key } },
    });
    if (exact.length > 0)
        return exact[0];
    const inSubcategory = await queryAll({
        TableName: COMPONENTS_TABLE,
        IndexName: "componentsBySubcategoryIdAndComponentId",
        KeyConditionExpression: "subcategoryId = :sid",
        ExpressionAttributeValues: { ":sid": { S: subcategoryId } },
    });
    return inSubcategory.find((i) => i.componentId?.S && normalizeKey(i.componentId.S) === key);
}
// Id of the history row for one line of one ClickUp stock task. Deterministic so
// it doubles as the idempotency key (see updateComponents). Without a task id
// (should not happen) it falls back to a unique id, i.e. the old behaviour.
function lineHistoryId(taskId, category, subCategory, componentKey) {
    if (!taskId)
        return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const hash = createHash("sha1")
        .update(`${category}|${subCategory}|${componentKey}`)
        .digest("hex")
        .slice(0, 16);
    return `stock-${taskId}-${hash}`;
}
// A transaction was cancelled because the history row (item index 1) already
// exists, i.e. this line was applied by an earlier delivery of the same webhook.
function isAlreadyApplied(err) {
    return (err?.name === "TransactionCanceledException" &&
        err.CancellationReasons?.[1]?.Code === "ConditionalCheckFailed");
}
export async function updateComponents(payload) {
    // taskId must be pulled out here, otherwise it would be treated as a category
    const { username, timestamp, taskId, ...categories } = payload;
    const now = new Date().toISOString();
    for (const rawCategoryName of Object.keys(categories)) {
        const categoryName = normalizeKey(rawCategoryName); // normalize category
        const subCategories = categories[rawCategoryName];
        // 1. Find or create Category
        let categoryId;
        const foundCategory = await findCategory(categoryName);
        if (foundCategory) {
            categoryId = foundCategory.id.S;
        }
        else {
            categoryId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
            try {
                await dynamoClient.send(new PutItemCommand({
                    TableName: CATEGORY_TABLE,
                    Item: {
                        id: { S: categoryId },
                        categoryName: { S: categoryName },
                        createdAt: { S: now },
                        updatedAt: { S: now },
                    },
                    ConditionExpression: "attribute_not_exists(categoryName)", // prevent duplicate
                }));
            }
            catch (err) {
                // Someone else inserted it concurrently, query again
                const retry = await dynamoClient.send(new QueryCommand({
                    TableName: CATEGORY_TABLE,
                    IndexName: "categoriesByCategoryName",
                    KeyConditionExpression: "#name = :nameVal",
                    ExpressionAttributeNames: { "#name": "categoryName" },
                    ExpressionAttributeValues: { ":nameVal": { S: categoryName } },
                }));
                categoryId = retry.Items[0].id.S;
            }
        }
        // 2. Loop through SubCategories
        for (const rawSubName of Object.keys(subCategories)) {
            const subName = normalizeKey(rawSubName); // normalize subcategory
            const { isWithdrawal, subComponents } = subCategories[rawSubName];
            // Find or create SubCategory
            let subcategoryId;
            const foundSubcategory = await findSubcategory(categoryId, subName);
            if (foundSubcategory) {
                subcategoryId = foundSubcategory.id.S;
            }
            else {
                subcategoryId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
                try {
                    await dynamoClient.send(new PutItemCommand({
                        TableName: SUBCATEGORY_TABLE,
                        Item: {
                            id: { S: subcategoryId },
                            categoryId: { S: categoryId },
                            subcategoryName: { S: subName },
                            createdAt: { S: now },
                            updatedAt: { S: now },
                        },
                        ConditionExpression: "attribute_not_exists(subcategoryName) AND attribute_not_exists(categoryId)",
                    }));
                }
                catch (err) {
                    // Someone else inserted it concurrently, query again
                    const retry = await dynamoClient.send(new QueryCommand({
                        TableName: SUBCATEGORY_TABLE,
                        IndexName: "subCategoriesByCategoryIdAndSubcategoryName",
                        KeyConditionExpression: "categoryId = :cid AND subcategoryName = :subName",
                        ExpressionAttributeValues: {
                            ":cid": { S: categoryId },
                            ":subName": { S: subName },
                        },
                    }));
                    subcategoryId = retry.Items[0].id.S;
                }
            }
            // 3. Loop through components (subComponents)
            for (const rawKey of Object.keys(subComponents)) {
                const componentKey = normalizeKey(rawKey);
                const { value } = subComponents[rawKey];
                // Reject bad quantities up front. NaN would be written as the DynamoDB
                // number "NaN" (ValidationException), and Component.currentStock is an
                // Int in the GraphQL schema, so a decimal breaks the app's list query.
                if (!Number.isInteger(value)) {
                    throw new Error(`Invalid quantity "${value}" for "${rawKey}" (${rawCategoryName} / ${rawSubName}); expected a whole number`);
                }
                const foundComponent = await findComponent(subcategoryId, componentKey);
                // Deterministic per ClickUp task + line. It is the idempotency key: the
                // history row below is written with attribute_not_exists(id) in the same
                // transaction as the stock change, so a retried/duplicate webhook can never
                // apply the same line twice, and a failure part-way through a task can be
                // safely retried (lines already applied are skipped).
                const historyRowId = lineHistoryId(taskId, rawCategoryName, rawSubName, componentKey);
                const putHistory = (entityId, historyEntry) => ({
                    Put: {
                        TableName: HISTORY_TABLE,
                        Item: {
                            id: { S: historyRowId },
                            entityType: { S: "COMPONENT" },
                            entityId: { S: entityId },
                            action: { S: "STOCK_UPDATE" },
                            timestamp: { S: now },
                            details: { S: historyEntry },
                            createdAt: { S: now },
                            updatedAt: { S: now },
                        },
                        ConditionExpression: "attribute_not_exists(id)",
                    },
                });
                // Applies +/- value to an existing component atomically with its history.
                const applyToExisting = async (existing) => {
                    const currentStock = Number(existing.currentStock?.N ?? 0);
                    const delta = isWithdrawal ? -value : value;
                    const historyEntry = `${username} @ ${timestamp}, ${isWithdrawal ? "withdrew" : "intake"}: ${componentKey}, before: ${currentStock}, after: ${currentStock + delta}\n`;
                    try {
                        await dynamoClient.send(new TransactWriteItemsCommand({
                            TransactItems: [
                                {
                                    Update: {
                                        TableName: COMPONENTS_TABLE,
                                        Key: { id: { S: existing.id.S } },
                                        // ADD is atomic, so concurrent submissions cannot lose updates
                                        UpdateExpression: "SET updatedAt = :upd ADD currentStock :delta",
                                        ConditionExpression: "attribute_exists(id)",
                                        ExpressionAttributeValues: {
                                            ":upd": { S: now },
                                            ":delta": { N: String(delta) },
                                        },
                                    },
                                },
                                putHistory(existing.id.S, historyEntry),
                            ],
                        }));
                    }
                    catch (err) {
                        if (isAlreadyApplied(err)) {
                            console.warn(`[stock] Line already applied, skipping: ${historyRowId}`);
                            return;
                        }
                        throw err;
                    }
                };
                if (foundComponent) {
                    // --- Update existing component ---
                    await applyToExisting(foundComponent);
                    continue;
                }
                // --- Component does not exist ---
                if (isWithdrawal) {
                    // Never invent stock from a withdrawal. The mobile app blocks this; this
                    // is the safety net. Skip (don't throw) so ClickUp doesn't retry forever.
                    console.error(`[stock] Withdrawal for unknown component "${componentKey}" (${rawCategoryName} / ${rawSubName}) ignored`);
                    continue;
                }
                // --- Create new component (atomic with its history) ---
                const newComponentId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
                try {
                    await dynamoClient.send(new TransactWriteItemsCommand({
                        TransactItems: [
                            {
                                Put: {
                                    TableName: COMPONENTS_TABLE,
                                    Item: {
                                        id: { S: newComponentId },
                                        subcategoryId: { S: subcategoryId },
                                        componentId: { S: componentKey },
                                        // The app shows componentName (falls back to "Unnamed Component")
                                        componentName: { S: rawKey.trim() },
                                        currentStock: { N: value.toString() },
                                        createdAt: { S: now },
                                        updatedAt: { S: now },
                                    },
                                    ConditionExpression: "attribute_not_exists(id)",
                                },
                            },
                            putHistory(newComponentId, `${username} @ ${timestamp}, intake: ${componentKey}, before: 0, after: ${value}\n`),
                        ],
                    }));
                }
                catch (err) {
                    if (isAlreadyApplied(err)) {
                        console.warn(`[stock] Line already applied, skipping: ${historyRowId}`);
                        continue;
                    }
                    // Log the REAL failure instead of masking it behind the retry below.
                    console.error(`[stock] Creating component "${componentKey}" failed, checking for a concurrent insert:`, err);
                    // --- Race condition: another process created the component ---
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    const retried = await findComponent(subcategoryId, componentKey);
                    if (!retried) {
                        throw new Error(`Component creation failed for "${componentKey}": ${err?.message ?? err}`);
                    }
                    await applyToExisting(retried);
                }
            }
        }
    }
}

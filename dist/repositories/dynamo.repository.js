import "dotenv/config";
import { QueryCommand, PutItemCommand, UpdateItemCommand, } from "@aws-sdk/client-dynamodb";
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
export async function updateComponents(payload) {
    const { username, timestamp, ...categories } = payload;
    const now = new Date().toISOString();
    for (const rawCategoryName of Object.keys(categories)) {
        const categoryName = normalizeKey(rawCategoryName); // normalize category
        const subCategories = categories[rawCategoryName];
        // 1. Find or create Category
        let categoryId;
        const catQuery = await dynamoClient.send(new QueryCommand({
            TableName: CATEGORY_TABLE,
            IndexName: "categoriesByCategoryName",
            KeyConditionExpression: "#name = :nameVal",
            ExpressionAttributeNames: { "#name": "categoryName" },
            ExpressionAttributeValues: { ":nameVal": { S: categoryName } },
        }));
        if (catQuery.Items && catQuery.Items.length > 0) {
            categoryId = catQuery.Items[0].id.S;
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
            const subQuery = await dynamoClient.send(new QueryCommand({
                TableName: SUBCATEGORY_TABLE,
                IndexName: "subCategoriesByCategoryIdAndSubcategoryName",
                KeyConditionExpression: "categoryId = :cid AND subcategoryName = :subName",
                ExpressionAttributeValues: {
                    ":cid": { S: categoryId },
                    ":subName": { S: subName },
                },
            }));
            if (subQuery.Items && subQuery.Items.length > 0) {
                subcategoryId = subQuery.Items[0].id.S;
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
                const compQuery = await dynamoClient.send(new QueryCommand({
                    TableName: COMPONENTS_TABLE,
                    IndexName: "componentsBySubcategoryIdAndComponentId",
                    KeyConditionExpression: "subcategoryId = :sid AND componentId = :cid",
                    ExpressionAttributeValues: {
                        ":sid": { S: subcategoryId },
                        ":cid": { S: componentKey },
                    },
                }));
                if (compQuery.Items && compQuery.Items.length > 0) {
                    // --- Update existing component ---
                    const existing = compQuery.Items[0];
                    const currentStock = Number(existing.currentStock.N);
                    const newStock = isWithdrawal ? currentStock - value : currentStock + value;
                    await dynamoClient.send(new UpdateItemCommand({
                        TableName: COMPONENTS_TABLE,
                        Key: { id: { S: existing.id.S } },
                        UpdateExpression: "SET currentStock = :val, updatedAt = :upd",
                        ExpressionAttributeValues: {
                            ":val": { N: newStock.toString() },
                            ":upd": { S: now },
                        },
                    }));
                    // --- Log history ---
                    const historyEntry = `${username} @ ${timestamp}, ${isWithdrawal ? "withdrew" : "intake"}: ${componentKey}, before: ${currentStock}, after: ${newStock}`;
                    await dynamoClient.send(new PutItemCommand({
                        TableName: HISTORY_TABLE,
                        Item: {
                            id: { S: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}` },
                            entityType: { S: "COMPONENT" },
                            entityId: { S: existing.id.S },
                            action: { S: "STOCK_UPDATE" },
                            timestamp: { S: timestamp },
                            details: { S: historyEntry },
                        },
                    }));
                }
                else {
                    // --- Create new component with race-condition handling ---
                    const newComponentId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
                    try {
                        await dynamoClient.send(new PutItemCommand({
                            TableName: COMPONENTS_TABLE,
                            Item: {
                                id: { S: newComponentId },
                                subcategoryId: { S: subcategoryId },
                                componentId: { S: componentKey },
                                currentStock: { N: value.toString() },
                                createdAt: { S: now },
                                updatedAt: { S: now },
                            },
                            ConditionExpression: "attribute_not_exists(componentId) AND attribute_not_exists(subcategoryId)",
                        }));
                        // Log history
                        const historyEntry = `${username} @ ${timestamp}, intake: ${componentKey}, before: 0, after: ${value}`;
                        await dynamoClient.send(new PutItemCommand({
                            TableName: HISTORY_TABLE,
                            Item: {
                                id: { S: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}` },
                                entityType: { S: "COMPONENT" },
                                entityId: { S: newComponentId },
                                action: { S: "STOCK_UPDATE" },
                                timestamp: { S: timestamp },
                                details: { S: historyEntry },
                            },
                        }));
                    }
                    catch (err) {
                        // --- Race condition: another process created the component ---
                        await new Promise((resolve) => setTimeout(resolve, 50));
                        const retry = await dynamoClient.send(new QueryCommand({
                            TableName: COMPONENTS_TABLE,
                            IndexName: "componentsBySubcategoryIdAndComponentId",
                            KeyConditionExpression: "subcategoryId = :sid AND componentId = :cid",
                            ExpressionAttributeValues: {
                                ":sid": { S: subcategoryId },
                                ":cid": { S: componentKey },
                            },
                        }));
                        if (!retry.Items || retry.Items.length === 0) {
                            throw new Error(`Component creation failed and item not found in retry: ${componentKey}`);
                        }
                        const existing = retry.Items[0];
                        const currentStock = Number(existing.currentStock.N);
                        const newStock = isWithdrawal ? currentStock - value : currentStock + value;
                        // Update the existing item
                        await dynamoClient.send(new UpdateItemCommand({
                            TableName: COMPONENTS_TABLE,
                            Key: { id: { S: existing.id.S } },
                            UpdateExpression: "SET currentStock = :val, updatedAt = :upd",
                            ExpressionAttributeValues: {
                                ":val": { N: newStock.toString() },
                                ":upd": { S: now },
                            },
                        }));
                        // Log history for the update
                        const historyEntry = `${username} @ ${timestamp}, ${isWithdrawal ? "withdrew" : "intake"}: ${componentKey}, before: ${currentStock}, after: ${newStock}`;
                        await dynamoClient.send(new PutItemCommand({
                            TableName: HISTORY_TABLE,
                            Item: {
                                id: { S: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}` },
                                entityType: { S: "COMPONENT" },
                                entityId: { S: existing.id.S },
                                action: { S: "STOCK_UPDATE" },
                                timestamp: { S: timestamp },
                                details: { S: historyEntry },
                            },
                        }));
                    }
                }
            }
        }
    }
}

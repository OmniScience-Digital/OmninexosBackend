import 'dotenv/config';
import { DynamoDBClient, QueryCommand, PutItemCommand, UpdateItemCommand, } from '@aws-sdk/client-dynamodb';
const CATEGORY_TABLE = process.env.CATEGORY_TABLE;
const SUBCATEGORY_TABLE = process.env.SUBCATEGORY_TABLE;
const SUBCOMPONENTS_TABLE = process.env.SUBCOMPONENTS_TABLE;
const dynamoClient = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
export async function updateComponents(payload) {
    const { username, ...categories } = payload;
    const now = new Date().toISOString();
    for (const categoryName of Object.keys(categories)) {
        const subCategories = categories[categoryName];
        // 1. Find or create Category
        let categoryId;
        const catQuery = await dynamoClient.send(new QueryCommand({
            TableName: CATEGORY_TABLE,
            IndexName: 'categoriesByCategoryName',
            KeyConditionExpression: '#name = :nameVal',
            ExpressionAttributeNames: { '#name': 'categoryName' },
            ExpressionAttributeValues: { ':nameVal': { S: categoryName } },
        }));
        if (catQuery.Items && catQuery.Items.length > 0) {
            categoryId = catQuery.Items[0].id.S;
        }
        else {
            categoryId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
            await dynamoClient.send(new PutItemCommand({
                TableName: CATEGORY_TABLE,
                Item: {
                    id: { S: categoryId },
                    categoryName: { S: categoryName },
                    createdAt: { S: now },
                    updatedAt: { S: now },
                },
            }));
        }
        // 2. Loop through SubCategories
        for (const subName of Object.keys(subCategories)) {
            const { isWithdrawal, subComponents } = subCategories[subName];
            // Find or create SubCategory
            let subcategoryId;
            const subQuery = await dynamoClient.send(new QueryCommand({
                TableName: SUBCATEGORY_TABLE,
                IndexName: 'subCategoriesByCategoryIdAndSubcategoryName',
                KeyConditionExpression: 'categoryId = :cid AND subcategoryName = :subName',
                ExpressionAttributeValues: {
                    ':cid': { S: categoryId },
                    ':subName': { S: subName },
                },
            }));
            if (subQuery.Items && subQuery.Items.length > 0) {
                subcategoryId = subQuery.Items[0].id.S;
            }
            else {
                subcategoryId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
                await dynamoClient.send(new PutItemCommand({
                    TableName: SUBCATEGORY_TABLE,
                    Item: {
                        id: { S: subcategoryId },
                        categoryId: { S: categoryId },
                        subcategoryName: { S: subName },
                        createdAt: { S: now },
                        updatedAt: { S: now },
                    },
                }));
            }
            // 3. Loop through components (subComponents)
            for (const componentKey of Object.keys(subComponents)) {
                const { value } = subComponents[componentKey];
                const compQuery = await dynamoClient.send(new QueryCommand({
                    TableName: SUBCOMPONENTS_TABLE,
                    IndexName: 'componentsBySubcategoryIdAndComponentId',
                    KeyConditionExpression: 'subcategoryId = :sid AND componentId = :cid',
                    ExpressionAttributeValues: {
                        ':sid': { S: subcategoryId },
                        ':cid': { S: componentKey },
                    },
                }));
                if (compQuery.Items && compQuery.Items.length > 0) {
                    // Update currentStock
                    const existing = compQuery.Items[0];
                    const currentStock = Number(existing.currentStock.N);
                    const newStock = isWithdrawal ? currentStock - value : currentStock + value;
                    await dynamoClient.send(new UpdateItemCommand({
                        TableName: SUBCOMPONENTS_TABLE,
                        Key: { id: { S: existing.id.S } },
                        UpdateExpression: 'SET currentStock = :val, updatedAt = :upd',
                        ExpressionAttributeValues: {
                            ':val': { N: newStock.toString() },
                            ':upd': { S: now },
                        },
                    }));
                }
                else {
                    // Create component
                    const componentId = componentKey; // use key as componentId
                    await dynamoClient.send(new PutItemCommand({
                        TableName: SUBCOMPONENTS_TABLE,
                        Item: {
                            id: { S: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}` },
                            subcategoryId: { S: subcategoryId },
                            componentId: { S: componentId },
                            currentStock: { N: value.toString() },
                            createdAt: { S: now },
                            updatedAt: { S: now },
                        },
                    }));
                }
            }
        }
    }
}

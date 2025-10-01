import 'dotenv/config';
import { DynamoDBClient, QueryCommand, UpdateItemCommand, PutItemCommand, } from '@aws-sdk/client-dynamodb';
const COMPONENTS_TABLE = process.env.COMPONENT_TABLE;
const SUBCOMPONENTS_TABLE = process.env.SUBCOMPONENTS_TABLE;
const clickupclient = new DynamoDBClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
export async function updateComponents(payload) {
    const { username, ...components } = payload;
    const now = new Date().toISOString();
    for (const componentName of Object.keys(components)) {
        const subComponents = components[componentName];
        // 1. Find or create component
        let componentId;
        const queryRes = await clickupclient.send(new QueryCommand({
            TableName: COMPONENTS_TABLE,
            IndexName: 'componentsByName',
            KeyConditionExpression: '#n = :nameVal',
            ExpressionAttributeNames: { '#n': 'name' },
            ExpressionAttributeValues: { ':nameVal': { S: componentName } },
        }));
        if (queryRes.Items && queryRes.Items.length > 0) {
            componentId = queryRes.Items[0].id.S;
        }
        else {
            componentId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
            await clickupclient.send(new PutItemCommand({
                TableName: COMPONENTS_TABLE,
                Item: {
                    id: { S: componentId },
                    name: { S: componentName },
                    createdAt: { S: now },
                    updatedAt: { S: now },
                },
            }));
        }
        // 2. Loop through subcomponents
        for (const subName of Object.keys(subComponents)) {
            const { value, isWithdrawal } = subComponents[subName];
            const subQuery = await clickupclient.send(new QueryCommand({
                TableName: SUBCOMPONENTS_TABLE,
                IndexName: 'byComponentAndKey',
                KeyConditionExpression: 'componentId = :cid AND #k = :keyVal',
                ExpressionAttributeNames: { '#k': 'key' },
                ExpressionAttributeValues: {
                    ':cid': { S: componentId },
                    ':keyVal': { S: subName },
                },
            }));
            if (subQuery.Items && subQuery.Items.length > 0) {
                const sub = subQuery.Items[0];
                const currentValue = Number(sub.value.N);
                const newValue = isWithdrawal ? currentValue - value : currentValue + value;
                await clickupclient.send(new UpdateItemCommand({
                    TableName: SUBCOMPONENTS_TABLE,
                    Key: { id: { S: sub.id.S } },
                    UpdateExpression: 'SET #v = :val, #updatedAt = :upd',
                    ExpressionAttributeNames: { '#v': 'value', '#updatedAt': 'updatedAt' },
                    ExpressionAttributeValues: { ':val': { N: newValue.toString() }, ':upd': { S: now } },
                }));
            }
            else {
                const subId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
                await clickupclient.send(new PutItemCommand({
                    TableName: SUBCOMPONENTS_TABLE,
                    Item: {
                        id: { S: subId },
                        componentId: { S: componentId },
                        key: { S: subName },
                        value: { N: (isWithdrawal ? -value : value).toString() },
                        createdAt: { S: now },
                        updatedAt: { S: now },
                    },
                }));
            }
        }
    }
}

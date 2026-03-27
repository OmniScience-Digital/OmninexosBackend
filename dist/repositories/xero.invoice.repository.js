import "dotenv/config";
import { QueryCommand, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../services/dynamo.service.js";
const INVOICE_TABLE = process.env.XERO_INVOICE_TABLE;
export const createInvoice = async (quoteItem) => {
    await dynamoClient.send(new PutItemCommand({
        TableName: INVOICE_TABLE,
        Item: marshall(quoteItem),
    }));
    return quoteItem;
};
export async function getInvByXeroInvoiceId(xeroInvoiceId) {
    const params = {
        TableName: INVOICE_TABLE,
        IndexName: "invoicesByInvoiceId", // use invoiceId GSI
        KeyConditionExpression: "invoiceId = :invId",
        ExpressionAttributeValues: marshall({ ":invId": xeroInvoiceId }),
    };
    const result = await dynamoClient.send(new QueryCommand(params));
    return result.Items && result.Items.length > 0 ? unmarshall(result.Items[0]) : null;
}
export async function getInvByXeroInvoiceNumber(xeroInvoicenumb) {
    const params = {
        TableName: INVOICE_TABLE,
        IndexName: "invoicesByInvoiceNumber", // use xeroInvoicenumb GSI
        KeyConditionExpression: "invoiceNumber = :invNum",
        ExpressionAttributeValues: marshall({ ":invNum": xeroInvoicenumb }),
    };
    const result = await dynamoClient.send(new QueryCommand(params));
    return result.Items && result.Items.length > 0 ? unmarshall(result.Items[0]) : null;
}
export const updateInvoice = async (pkId, updates) => {
    if (!pkId)
        throw new Error("id (PK) is required for update");
    const updateExpressions = [];
    const values = {};
    const names = {};
    for (const key in updates) {
        if (updates[key] !== undefined && updates[key] !== null) {
            updateExpressions.push(`#${key} = :${key}`);
            values[`:${key}`] = updates[key];
            names[`#${key}`] = key;
        }
    }
    updateExpressions.push("#updatedAt = :updatedAt");
    values[":updatedAt"] = new Date().toISOString();
    names["#updatedAt"] = "updatedAt";
    const params = {
        TableName: INVOICE_TABLE,
        Key: { id: { S: pkId } }, // PK
        UpdateExpression: `SET ${updateExpressions.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: marshall(values, { removeUndefinedValues: true }),
        ReturnValues: "ALL_NEW",
    };
    const result = await dynamoClient.send(new UpdateItemCommand(params));
    return result.Attributes ? unmarshall(result.Attributes) : null;
};

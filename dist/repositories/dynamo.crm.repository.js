import "dotenv/config";
import { ScanCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { dynamoClient } from "../services/dynamo.service.js";
import logger from "../utils/logger.js";
const COMPLIANCE_TABLE = process.env.COMPLIANCE_TABLE;
const COMPLIANCE_ADDITIONALS = process.env.COMPLIANCE_ADDITIONALS;
const CUSTOMER_TABLE = process.env.CUSTOMER_TABLE;
export const getCompliance = async () => {
    try {
        const params = {
            TableName: COMPLIANCE_TABLE,
        };
        const data = await dynamoClient.send(new ScanCommand(params));
        return data.Items;
    }
    catch (error) {
        console.log("Error in getCustomerRelations", error);
    }
};
export const getComplianceAdditionals = async () => {
    try {
        const params = {
            TableName: COMPLIANCE_ADDITIONALS,
        };
        const data = await dynamoClient.send(new ScanCommand(params));
        return data.Items;
    }
    catch (error) {
        console.log("Error in getCustomerRelations", error);
    }
};
export const getCustomerSites = async () => {
    try {
        const params = {
            TableName: CUSTOMER_TABLE,
        };
        const data = await dynamoClient.send(new ScanCommand(params));
        return data.Items;
    }
    catch (error) {
        console.log("Error in getCustomerRelations", error);
    }
};
export async function updateComplianceRating({ complianceId, complianceRating, complianceRating30Days, }) {
    const now = new Date().toISOString();
    const updateParams = {
        TableName: COMPLIANCE_TABLE,
        Key: {
            id: { S: complianceId }
        },
        UpdateExpression: "SET complianceRating = :rating, complianceRating30Days = :rating30, updatedAt = :updatedAt",
        ExpressionAttributeValues: {
            ":rating": { S: complianceRating.toString() },
            ":rating30": { S: complianceRating30Days.toString() },
            ":updatedAt": { S: now }
        }
    };
    try {
        await dynamoClient.send(new UpdateItemCommand(updateParams));
        logger.info(`Updated compliance ${complianceId} with rating ${complianceRating}%, 30-day: ${complianceRating30Days}%`);
    }
    catch (error) {
        logger.error(`Failed to update compliance ${complianceId}:`, error);
        throw error;
    }
}

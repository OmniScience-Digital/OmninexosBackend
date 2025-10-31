import "dotenv/config";
import { ScanCommand, QueryCommand, PutItemCommand, DeleteItemCommand, } from "@aws-sdk/client-dynamodb";
import logger from "../utils/logger.js";
import { dynamoClient } from "../services/dynamo.service.js";
const FLEET_TABLE = process.env.FLEET_TABLE;
const TASK_TABLE = process.env.TASK_TABLE;
export const getddFleetvehicles = async () => {
    try {
        const params = {
            TableName: FLEET_TABLE,
        };
        const data = await dynamoClient.send(new ScanCommand(params));
        return data.Items;
    }
    catch (error) {
        console.log("Error in f", error);
    }
};
export const getddFleetTasks = async () => {
    try {
        const params = {
            TableName: TASK_TABLE,
        };
        const data = await dynamoClient.send(new ScanCommand(params));
        return data.Items;
    }
    catch (error) {
        console.log("Error in f", error);
    }
};
export async function insertTaskService({ taskType, vehicleReg, clickupTaskId, }) {
    const now = new Date().toISOString();
    const item = {
        __typename: { S: "TaskTable" },
        id: { S: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}` },
        taskType: { S: taskType },
        vehicleReg: { S: vehicleReg },
        clickupTaskId: { S: clickupTaskId },
        createdAt: { S: now },
        updatedAt: { S: now },
    };
    // --- DynamoDB insert ---
    await dynamoClient.send(new PutItemCommand({ TableName: TASK_TABLE, Item: item }));
    logger.info(`Task created for vehicle ${vehicleReg} (taskType: ${taskType})`);
}
export async function deleteTaskByClickupId(clickupTaskId) {
    try {
        const queryCommand = new QueryCommand({
            TableName: TASK_TABLE,
            IndexName: "taskTablesByClickupTaskId",
            KeyConditionExpression: "clickupTaskId = :clickupId",
            ExpressionAttributeValues: {
                ":clickupId": { S: clickupTaskId },
            },
        });
        const result = await dynamoClient.send(queryCommand);
        if (!result.Items || result.Items.length === 0) {
            console.log(`No task found with clickupTaskId: ${clickupTaskId}`);
            return null;
        }
        if (result.Items.length > 1) {
            console.warn(`Multiple tasks found with clickupTaskId: ${clickupTaskId}, deleting all`);
        }
        for (const item of result.Items) {
            const id = item.id?.S;
            if (!id) {
                console.warn("Item missing id.S, skipping delete:", item);
                continue;
            }
            const deleteCommand = new DeleteItemCommand({
                TableName: TASK_TABLE,
                Key: { id: { S: id } },
            });
            await dynamoClient.send(deleteCommand);
            console.log(`Deleted task with clickupTaskId: ${clickupTaskId}, id: ${id}`);
        }
        return result.Items.length;
    }
    catch (error) {
        console.error("Error deleting task by clickupTaskId:", error);
        throw error;
    }
}

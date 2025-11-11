import 'dotenv/config';
import { DeleteItemCommand, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import logger from '../utils/logger.js';
import { dynamoClient } from '../services/dynamo.service.js';
const EMPLOYEE_TASK_TABLE = process.env.EMPLOYEE_TASKTABLE;
export async function insertEmployeeTaskService({ employeeId, employeeName, taskType, documentType, documentIdentifier, clickupTaskId, }) {
    const now = new Date().toISOString();
    const item = {
        __typename: { S: 'EmployeeTaskTable' },
        id: { S: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}` },
        employeeId: { S: employeeId },
        createdAt: { S: now },
        updatedAt: { S: now },
    };
    if (employeeName)
        item.employeeName = { S: employeeName };
    if (taskType)
        item.taskType = { S: taskType };
    if (documentType)
        item.documentType = { S: documentType };
    if (documentIdentifier)
        item.documentIdentifier = { S: documentIdentifier };
    if (clickupTaskId)
        item.clickupTaskId = { S: clickupTaskId };
    await dynamoClient.send(new PutItemCommand({ TableName: EMPLOYEE_TASK_TABLE, Item: item }));
    logger.info(`Employee task created for ${employeeId} (${taskType ?? 'N/A'}) document: ${documentType ?? 'N/A'}`);
}
export async function deleteEmployeeTask({ employeeId, documentIdentifier, }) {
    try {
        const queryCommand = new QueryCommand({
            TableName: EMPLOYEE_TASK_TABLE,
            IndexName: 'employeeId', // uses secondary index on employeeId + documentIdentifier
            KeyConditionExpression: 'employeeId = :empId AND documentIdentifier = :docId',
            ExpressionAttributeValues: {
                ':empId': { S: employeeId },
                ':docId': { S: documentIdentifier },
            },
        });
        const result = await dynamoClient.send(queryCommand);
        if (!result.Items || result.Items.length === 0) {
            logger.warn(`No employee task found for employeeId: ${employeeId}, documentIdentifier: ${documentIdentifier}`);
            return null;
        }
        for (const item of result.Items) {
            const id = item.id?.S;
            if (!id) {
                logger.warn('Skipping delete — missing id.S:', item);
                continue;
            }
            await dynamoClient.send(new DeleteItemCommand({
                TableName: EMPLOYEE_TASK_TABLE,
                Key: { id: { S: id } },
            }));
            logger.info(`Deleted employee task — employeeId: ${employeeId}, id: ${id}`);
        }
        return result.Items.length;
    }
    catch (error) {
        logger.error('Error deleting employee task:', error);
        throw error;
    }
}

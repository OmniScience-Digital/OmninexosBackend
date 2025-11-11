import 'dotenv/config';
import { DynamoDBClient, ScanCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { dynamoClient } from '../services/dynamo.service';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });

const EMPLOYEE_TABLE = process.env.EMPLOYEE_TABLE!;
const MEDICAL_TABLE = process.env.MEDICAL_TABLE!;
const TRAINING_TABLE = process.env.TRAINING_TABLE!;
const ADDITIONAL_TABLE = process.env.ADDITIONAL_TABLE!;
const EMPLOYEE_TASKTABLE = process.env.EMPLOYEE_TASKTABLE!;

export async function fetchAllEmployeesWithRelations() {
  try {
    // 1. Fetch all employees
    const employeesData = await client.send(new ScanCommand({ TableName: EMPLOYEE_TABLE }));

    const employees = employeesData.Items || [];
    const employeesWithRelations = [];

    for (const emp of employees) {
      const employeeId = emp.employeeId?.S;
      if (!employeeId) continue;

      const [medicalCerts, trainingCerts, additionalCerts] = await Promise.all([
        client.send(
          new QueryCommand({
            TableName: MEDICAL_TABLE,
            IndexName: 'employeeMedicalCertificatesByEmployeeIdAndExpiryDate',
            KeyConditionExpression: 'employeeId = :id',
            ExpressionAttributeValues: {
              ':id': { S: employeeId },
            },
          })
        ),
        client.send(
          new QueryCommand({
            TableName: TRAINING_TABLE,
            IndexName: 'employeeTrainingCertificatesByEmployeeIdAndExpiryDate',
            KeyConditionExpression: 'employeeId = :id',
            ExpressionAttributeValues: {
              ':id': { S: employeeId },
            },
          })
        ),
        client.send(
          new QueryCommand({
            TableName: ADDITIONAL_TABLE,
            IndexName: 'employeeAdditionalCertificatesByEmployeeIdAndExpiryDate',
            KeyConditionExpression: 'employeeId = :id',
            ExpressionAttributeValues: {
              ':id': { S: employeeId },
            },
          })
        ),
      ]);

      employeesWithRelations.push({
        employee: emp,
        medicalCertificates: medicalCerts.Items || [],
        trainingCertificates: trainingCerts.Items || [],
        additionalCertificates: additionalCerts.Items || [],
      });
    }

    return employeesWithRelations;
  } catch (err) {
    console.error('Error fetching employees:', err);
    throw err;
  }
}

export const getddHrdTasks = async () => {
  try {
    const params = {
      TableName: EMPLOYEE_TASKTABLE,
    };

    const data = await dynamoClient.send(new ScanCommand(params));

    return data.Items;
  } catch (error: any) {
    console.log('Error in f', error);
  }
};

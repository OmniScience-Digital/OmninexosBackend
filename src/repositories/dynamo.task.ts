import 'dotenv/config';
import { ScanCommand } from '@aws-sdk/client-dynamodb';
import { dynamoClient } from '../services/dynamo.service';

const FLEET_TABLE = process.env.FLEET_TABLE!;
const TASK_TABLE = process.env.TASK_TABLE!;

export const getddFleetvehicles = async () => {
  try {
    const params = {
      TableName: FLEET_TABLE,
    };

    const data = await dynamoClient.send(new ScanCommand(params));

    return data.Items;
  } catch (error: any) {
    console.log('Error in f', error);
  }
};

export const getddFleetTasks = async () => {
  try {
    const params = {
      TableName: TASK_TABLE,
    };

    const data = await dynamoClient.send(new ScanCommand(params));

    return data.Items;
  } catch (error: any) {
    console.log('Error in f', error);
  }
};

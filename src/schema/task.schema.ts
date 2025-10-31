import { object, string, TypeOf } from 'zod';

//creating reusable schema first
const ddbStringSchema = object({ S: string() });

// Also export the single item type if needed

export const dynamoDBTaskSchema = object({
  __typename: ddbStringSchema,
  id: ddbStringSchema,
  createdAt: ddbStringSchema,
  updatedAt: ddbStringSchema,
  vehicleReg: ddbStringSchema,
  clickupTaskId: ddbStringSchema,
  taskType: ddbStringSchema,
});

export type DynamoDbTaskItem = TypeOf<typeof dynamoDBTaskSchema>;

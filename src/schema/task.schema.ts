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

export const dynamoDBEmployeeTaskSchema = object({
  __typename: ddbStringSchema,
  id: ddbStringSchema,
  createdAt: ddbStringSchema,
  updatedAt: ddbStringSchema,
  employeeId: ddbStringSchema,
  employeeName: ddbStringSchema.optional(),
  taskType: ddbStringSchema.optional(),
  documentType: ddbStringSchema.optional(),
  documentIdentifier: ddbStringSchema.optional(),
  clickupTaskId: ddbStringSchema.optional(),
});

export type DynamoDbTaskItem = TypeOf<typeof dynamoDBTaskSchema>;
export type DynamoDbEmployeeTaskItem = TypeOf<typeof dynamoDBEmployeeTaskSchema>;

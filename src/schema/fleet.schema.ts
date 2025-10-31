import { object, string, boolean, array, TypeOf, unknown, ZodTypeAny, z } from 'zod';

//creating reusable schema first

const ddbStringSchema = object({ S: string() });
const ddbBooleanSchema = object({ BOOL: boolean() });
const ddbArraySchema = <T extends ZodTypeAny>(schema: T) => object({ L: array(schema) });
const ddbNumberSchema = object({ N: string() }).transform((val) => Number(val.N));

// Also export the single item type if needed

export const dynamoDBFleetSchema = object({
  __typename: ddbStringSchema,
  createdAt: ddbStringSchema,
  updatedAt: ddbStringSchema,
  id: ddbStringSchema,
  currentkm: ddbNumberSchema,
  servicePlanStatus: ddbBooleanSchema,
  serviceplankm: ddbNumberSchema,
  fleetNumber: ddbStringSchema,
  breakandLuxTest: ddbArraySchema(z.any()).optional(),
  vehicleVin: ddbStringSchema,
  lastServicedate: ddbStringSchema,
  liscenseDiscExpirey: ddbStringSchema,
  breakandLuxExpirey: ddbStringSchema,
  vehicleReg: ddbStringSchema,
  history: ddbStringSchema,
  fleetIndex: ddbStringSchema,
  transmitionType: ddbStringSchema,
  pdpRequirement: ddbBooleanSchema,
  lastServicekm: ddbNumberSchema,
  codeRequirement: ddbStringSchema,
  lastRotationdate: ddbStringSchema,
  vehicleModel: ddbStringSchema,
  currentDriver: ddbStringSchema,
  ownershipStatus: ddbStringSchema,
  vehicleMake: ddbStringSchema,
});

export type DynamoDbFleetItem = TypeOf<typeof dynamoDBFleetSchema>;

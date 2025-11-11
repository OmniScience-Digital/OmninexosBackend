import { object, string, boolean, array } from 'zod';
// Reusable DynamoDB primitive schemas that handle NULL values
const ddbStringSchema = object({
    S: string().optional(),
})
    .or(object({
    NULL: boolean().optional(),
}))
    .optional();
const ddbBooleanSchema = object({
    BOOL: boolean(),
})
    .or(object({
    NULL: boolean().optional(),
}))
    .optional();
// Certificates schema
const ddbCertificateSchema = object({
    id: ddbStringSchema,
    employeeId: ddbStringSchema,
    certificateType: ddbStringSchema.optional(),
    attachment: ddbStringSchema.optional(),
    createdAt: ddbStringSchema,
    updatedAt: ddbStringSchema.optional(),
    expiryDate: ddbStringSchema.optional(),
    __typename: ddbStringSchema.optional(),
    certificateName: ddbStringSchema.optional(),
});
// Employee nested object schema with all fields optional
const ddbEmployeeSchema = object({
    __typename: ddbStringSchema,
    id: ddbStringSchema,
    employeeId: ddbStringSchema,
    firstName: ddbStringSchema,
    lastName: ddbStringSchema.optional(),
    employeeNumber: ddbStringSchema,
    createdAt: ddbStringSchema,
    updatedAt: ddbStringSchema,
    passportExpiry: ddbStringSchema.optional(),
    driversLicenseExpiry: ddbStringSchema.optional(),
    authorizedDriver: ddbBooleanSchema.optional(),
    history: ddbStringSchema.optional(),
    knownAs: ddbStringSchema.optional(),
    surname: ddbStringSchema.optional(),
    driversLicenseCode: ddbStringSchema.optional(),
    driversLicenseAttachment: ddbStringSchema.optional(),
    employeeIdAttachment: ddbStringSchema.optional(),
    pdpAttachment: ddbStringSchema.optional(),
    cvAttachment: ddbStringSchema.optional(),
    ppeListAttachment: ddbStringSchema.optional(),
    pdpExpiry: ddbStringSchema.optional(),
    ppeExpiry: ddbStringSchema.optional(),
    passportNumber: ddbStringSchema.optional(),
    passportAttachment: ddbStringSchema.optional(),
});
// Full employee record schema with certificates
export const dynamoDBEmployeeSchema = object({
    employee: ddbEmployeeSchema,
    medicalCertificates: array(ddbCertificateSchema),
    trainingCertificates: array(ddbCertificateSchema),
    additionalCertificates: array(ddbCertificateSchema),
});

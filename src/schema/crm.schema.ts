import { object, string, boolean, array, TypeOf, unknown, ZodTypeAny, z } from 'zod';

// Creating reusable schema first - FIXED to handle NULL values like your original
const ddbStringSchema = object({
  S: string().optional(),
})
  .or(
    object({
      NULL: boolean().optional(),
    })
  )
  .optional();

const ddbBooleanSchema = object({
  BOOL: boolean(),
})
  .or(
    object({
      NULL: boolean().optional(),
    })
  )
  .optional();

// DynamoDB List schema for arrays
const ddbListSchema = object({
  L: array(
    object({
      S: string().optional(),
    }).or(
      object({
        NULL: boolean().optional(),
      })
    )
  ).optional(),
})
  .or(
    object({
      NULL: boolean().optional(),
    })
  )
  .optional();

// Compliance schema - FIXED to use ddbListSchema for array fields
const ddbComplianceSchema = object({
  __typename: ddbStringSchema,
  id: ddbStringSchema,
  complianceRating: ddbStringSchema.optional(),
  complianceRating30Days: ddbStringSchema.optional(),
  linkedEmployees: ddbListSchema,
  digitalContractorsPack: ddbListSchema,
  notes: ddbStringSchema.optional(),

  // Requirement arrays - CHANGED from array(ddbStringSchema) to ddbListSchema
  clinicPlusRqd: ddbListSchema,
  clinicPlusInductionRqd: ddbListSchema,
  driversLicenseRqd: ddbListSchema,
  firefightingRqd: ddbListSchema,
  firstAidLevel1Rqd: ddbListSchema,
  firstAidLevel2Rqd: ddbListSchema,
  heartlyHealthRqd: ddbListSchema,
  klipspruitMedicalRqd: ddbListSchema,
  legalLiabilityRqd: ddbListSchema,
  luvuyoMedicalRqd: ddbListSchema,
  oemCertRqd: ddbListSchema,
  passportRqd: ddbListSchema,
  pdpRqd: ddbListSchema,
  satsConveyorRqd: ddbListSchema,
  satsCopSopRqd: ddbListSchema,
  wilgeVxrRqd: ddbListSchema,
  workingAtHeightsRqd: ddbListSchema,
  workingWithHandToolsRqd: ddbListSchema,
  workingWithPowerToolsRqd: ddbListSchema,
  appointment292Rqd: ddbListSchema,
  curriculumVitaeRqd: ddbListSchema,
  ppeListRqd: ddbListSchema,
  ohsActRqd: ddbListSchema,
  mhsaRqd: ddbListSchema,
  krielMedicalRqd: ddbListSchema,
  proHealthMedicalRqd: ddbListSchema,
  satsIlotRqd: ddbListSchema,
  hiraTrainingRqd: ddbListSchema,

  // Linked vehicles section
  linkedVehicles: ddbListSchema,
  breakAndLuxRqd: ddbListSchema,
  licenseDiscExpiry: ddbListSchema,

  customerSiteId: ddbStringSchema,
  employeeLookup: ddbStringSchema.optional(), // JSON string
  createdAt: ddbStringSchema.optional(),
  updatedAt: ddbStringSchema.optional(),
});

// ComplianceAdditionals schema - FIXED to match actual DynamoDB structure
const ddbComplianceAdditionalsSchema = object({
  __typename: ddbStringSchema,
  id: ddbStringSchema,
  complianceid: ddbStringSchema,
  name: ddbStringSchema.optional(),
  expirey: ddbStringSchema.optional(),
  requirementDoc: ddbStringSchema.optional(),
  critical: ddbStringSchema.optional(),
  createdAt: ddbStringSchema.optional(),
  updatedAt: ddbStringSchema.optional(),
});

// Main Compliance record schema - KEPT SAME
export const dynamoDBComplianceSchema = object({
  compliance: ddbComplianceSchema,
  complianceAdditionals: array(ddbComplianceAdditionalsSchema).optional(),
});

export type DynamoDBComplianceItem = TypeOf<typeof dynamoDBComplianceSchema>;

// FIXED: This is what you should use for your DynamoDB items (without Item wrapper)
export const dynamoDBComplianceRecordSchema = ddbComplianceSchema;

// FIXED: For ComplianceAdditionals without Item wrapper
export const dynamoDBComplianceAdditionalSchema = ddbComplianceAdditionalsSchema;

// If you DO get items with Item wrapper, use these:
export const dynamoDBComplianceItemWithWrapperSchema = object({
  Item: ddbComplianceSchema,
});

export const dynamoDBComplianceAdditionalWithWrapperSchema = object({
  Item: ddbComplianceAdditionalsSchema,
});

const ddbNumberSchema = object({
  N: string().optional(),
})
  .or(
    object({
      NULL: boolean().optional(),
    })
  )
  .optional();

// CustomerSite schema
const ddbCustomerSiteSchema = object({
  __typename: ddbStringSchema,
  id: ddbStringSchema,

  // Site Information
  siteName: ddbStringSchema,
  siteLocation: ddbStringSchema.optional(),
  siteDistance: ddbNumberSchema.optional(),
  siteTolls: ddbNumberSchema.optional(),

  // Customer Company Information
  customerName: ddbStringSchema,
  registrationNo: ddbStringSchema.optional(),
  vatNo: ddbStringSchema.optional(),
  vendorNumber: ddbStringSchema.optional(),
  postalAddress: ddbStringSchema.optional(),
  physicalAddress: ddbStringSchema.optional(),

  // Contact Information
  siteContactName: ddbStringSchema.optional(),
  siteContactMail: ddbStringSchema.optional(),
  siteContactNumber: ddbStringSchema.optional(),

  siteManagerName: ddbStringSchema.optional(),
  siteManagerMail: ddbStringSchema.optional(),
  siteManagerNumber: ddbStringSchema.optional(),

  siteProcurementName: ddbStringSchema.optional(),
  siteProcurementMail: ddbStringSchema.optional(),
  siteProcurementNumber: ddbStringSchema.optional(),

  siteCreditorsName: ddbStringSchema.optional(),
  siteCreditorsMail: ddbStringSchema.optional(),
  siteCreditorsNumber: ddbStringSchema.optional(),

  comment: ddbStringSchema.optional(),
  createdAt: ddbStringSchema.optional(),
  updatedAt: ddbStringSchema.optional(),
});

// Export schemas
export const dynamoDBCustomerSiteSchema = ddbCustomerSiteSchema;
export const dynamoDBCustomerSiteItemSchema = object({
  Item: ddbCustomerSiteSchema,
});

// For when you have a customer site with its related data
export const dynamoDBCustomerSiteWithRelationsSchema = object({
  customerSite: ddbCustomerSiteSchema,
  assets: array(object({})).optional(), // Add your Asset schema here if needed
  compliance: array(ddbComplianceSchema).optional(), // Reuse your compliance schema
});

export type DynamoDBCustomerSite = TypeOf<typeof dynamoDBCustomerSiteSchema>;
export type DynamoDBCustomerSiteItem = TypeOf<typeof dynamoDBCustomerSiteItemSchema>;
export type DynamoDBCustomerSiteWithRelations = TypeOf<
  typeof dynamoDBCustomerSiteWithRelationsSchema
>;

export type DynamoDBComplianceRecord = TypeOf<typeof dynamoDBComplianceRecordSchema>;
export type DynamoDBComplianceAdditional = TypeOf<typeof dynamoDBComplianceAdditionalSchema>;
export type DynamoDBComplianceItemWithWrapper = TypeOf<
  typeof dynamoDBComplianceItemWithWrapperSchema
>;
export type DynamoDBComplianceAdditionalWithWrapper = TypeOf<
  typeof dynamoDBComplianceAdditionalWithWrapperSchema
>;

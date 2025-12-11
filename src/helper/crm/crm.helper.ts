import validateAndFilter from '../../middlewares/validateandfilter.middleware';
import {
  getCompliance,
  getComplianceAdditionals,
  getCustomerSites,
} from '../../repositories/dynamo.crm.repository';
import {
  DynamoDBComplianceAdditional,
  dynamoDBComplianceAdditionalSchema,
  DynamoDBComplianceRecord,
  dynamoDBComplianceRecordSchema,
  DynamoDBCustomerSite,
  dynamoDBCustomerSiteSchema,
} from '../../schema/crm.schema';
import logger from '../../utils/logger';

export const fetchCompliance = async (): Promise<DynamoDBComplianceRecord[] | undefined> => {
  try {
    const compliancerecords = await getCompliance();

    const { validItems, invalidItems } = await validateAndFilter(dynamoDBComplianceRecordSchema)(
      compliancerecords ?? []
    );

    logger.info(`Customer DynamoDB Valid items: ${validItems.length}`);
    logger.warn(`Customer DynamoDB Invalid items: ${invalidItems.length}`);

    invalidItems.forEach(({ item, error }, index) => {
      logger.warn(
        `DynamoDB Invalid Customer #${index + 1}: ${JSON.stringify({
          errors: error.issues.map((err) => ({
            path: err.path.join('.'),
            message: err.message,
          })),
          rawItem: item,
        })}`
      );
    });

    return validItems;
  } catch (error: any) {
    console.log(error);
    return [];
  }
};

export const fetchComplianceAdditionals = async (): Promise<
  DynamoDBComplianceAdditional[] | undefined
> => {
  try {
    const compliancerecordsAdditionals = await getComplianceAdditionals();

    const { validItems, invalidItems } = await validateAndFilter(
      dynamoDBComplianceAdditionalSchema
    )(compliancerecordsAdditionals ?? []);

    logger.info(`Customer DynamoDB Valid items: ${validItems.length}`);
    logger.warn(`Customer DynamoDB Invalid items: ${invalidItems.length}`);

    invalidItems.forEach(({ item, error }, index) => {
      logger.warn(
        `DynamoDB Invalid Customer #${index + 1}: ${JSON.stringify({
          errors: error.issues.map((err) => ({
            path: err.path.join('.'),
            message: err.message,
          })),
          rawItem: item,
        })}`
      );
    });

    return validItems;
  } catch (error: any) {
    console.log(error);
    return [];
  }
};

export const getAllCustomerSites = async (): Promise<DynamoDBCustomerSite[] | undefined> => {
  try {
    const customersite = await getCustomerSites();

    const { validItems, invalidItems } = await validateAndFilter(dynamoDBCustomerSiteSchema)(
      customersite ?? []
    );

    logger.info(`Customer DynamoDB Valid items: ${validItems.length}`);
    logger.warn(`Customer DynamoDB Invalid items: ${invalidItems.length}`);

    invalidItems.forEach(({ item, error }, index) => {
      logger.warn(
        `DynamoDB Invalid Customer #${index + 1}: ${JSON.stringify({
          errors: error.issues.map((err) => ({
            path: err.path.join('.'),
            message: err.message,
          })),
          rawItem: item,
        })}`
      );
    });

    return validItems;
  } catch (error: any) {
    console.log(error);
    return [];
  }
};

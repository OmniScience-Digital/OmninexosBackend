import validateAndFilter from "../../middlewares/validateandfilter.middleware.js";
import { getCompliance, getComplianceAdditionals, getCustomerSites } from "../../repositories/dynamo.crm.repository.js";
import { dynamoDBComplianceAdditionalSchema, dynamoDBComplianceRecordSchema, dynamoDBCustomerSiteSchema } from "../../schema/crm.schema.js";
import logger from "../../utils/logger.js";
export const fetchCompliance = async () => {
    try {
        const compliancerecords = await getCompliance();
        const { validItems, invalidItems } = await validateAndFilter(dynamoDBComplianceRecordSchema)(compliancerecords ?? []);
        logger.info(`Customer DynamoDB Valid items: ${validItems.length}`);
        logger.warn(`Customer DynamoDB Invalid items: ${invalidItems.length}`);
        invalidItems.forEach(({ item, error }, index) => {
            logger.warn(`DynamoDB Invalid Customer #${index + 1}: ${JSON.stringify({
                errors: error.issues.map((err) => ({
                    path: err.path.join("."),
                    message: err.message,
                })),
                rawItem: item,
            })}`);
        });
        return validItems;
    }
    catch (error) {
        console.log(error);
        return [];
    }
};
export const fetchComplianceAdditionals = async () => {
    try {
        const compliancerecordsAdditionals = await getComplianceAdditionals();
        const { validItems, invalidItems } = await validateAndFilter(dynamoDBComplianceAdditionalSchema)(compliancerecordsAdditionals ?? []);
        logger.info(`Customer DynamoDB Valid items: ${validItems.length}`);
        logger.warn(`Customer DynamoDB Invalid items: ${invalidItems.length}`);
        invalidItems.forEach(({ item, error }, index) => {
            logger.warn(`DynamoDB Invalid Customer #${index + 1}: ${JSON.stringify({
                errors: error.issues.map((err) => ({
                    path: err.path.join("."),
                    message: err.message,
                })),
                rawItem: item,
            })}`);
        });
        return validItems;
    }
    catch (error) {
        console.log(error);
        return [];
    }
};
export const getAllCustomerSites = async () => {
    try {
        const customersite = await getCustomerSites();
        const { validItems, invalidItems } = await validateAndFilter(dynamoDBCustomerSiteSchema)(customersite ?? []);
        logger.info(`Customer DynamoDB Valid items: ${validItems.length}`);
        logger.warn(`Customer DynamoDB Invalid items: ${invalidItems.length}`);
        invalidItems.forEach(({ item, error }, index) => {
            logger.warn(`DynamoDB Invalid Customer #${index + 1}: ${JSON.stringify({
                errors: error.issues.map((err) => ({
                    path: err.path.join("."),
                    message: err.message,
                })),
                rawItem: item,
            })}`);
        });
        return validItems;
    }
    catch (error) {
        console.log(error);
        return [];
    }
};

import validateAndFilter from "../../middlewares/validateandfilter.middleware.js";
import { fetchAllEmployeesWithRelations } from "../../repositories/dynamo.hrd.repository.js";
import { dynamoDBEmployeeSchema } from "../../schema/hrd.schema.js";
import logger from "../../utils/logger.js";
export const getEmployees = async () => {
    try {
        const employees = await fetchAllEmployeesWithRelations();
        const { validItems, invalidItems } = await validateAndFilter(dynamoDBEmployeeSchema)(employees ?? []);
        logger.info(`Employee DynamoDB Valid items: ${validItems.length}`);
        logger.warn(`Employee DynamoDB Invalid items: ${invalidItems.length}`);
        invalidItems.forEach(({ item, error }, index) => {
            logger.warn(`DynamoDB Invalid Employee #${index + 1}: ${JSON.stringify({
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
    }
};

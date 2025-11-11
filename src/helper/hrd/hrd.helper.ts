import validateAndFilter from '../../middlewares/validateandfilter.middleware';
import { fetchAllEmployeesWithRelations } from '../../repositories/dynamo.hrd.repository';
import { dynamoDBEmployeeSchema, DynamoDbEmployeeItem } from '../../schema/hrd.schema';
import logger from '../../utils/logger';

export const getEmployees = async (): Promise<DynamoDbEmployeeItem[] | undefined> => {
  try {
    const employees = await fetchAllEmployeesWithRelations();

    const { validItems, invalidItems } = await validateAndFilter(dynamoDBEmployeeSchema)(
      employees ?? []
    );

    logger.info(`Employee DynamoDB Valid items: ${validItems.length}`);
    logger.warn(`Employee DynamoDB Invalid items: ${invalidItems.length}`);

    invalidItems.forEach(({ item, error }, index) => {
      logger.warn(
        `DynamoDB Invalid Employee #${index + 1}: ${JSON.stringify({
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
  }
};

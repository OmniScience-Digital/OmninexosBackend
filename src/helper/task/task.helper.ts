import validateAndFilter from '../../middlewares/validateandfilter.middleware';
import { getddFleetTasks } from '../../repositories/dynamo.task';
import { DynamoDbTaskItem, dynamoDBTaskSchema } from '../../schema/task.schema';
import logger from '../../utils/logger';

export const getFleetTasks = async (): Promise<DynamoDbTaskItem[] | undefined> => {
  try {
    const tasks = await getddFleetTasks();

    const { validItems, invalidItems } = await validateAndFilter(dynamoDBTaskSchema)(tasks ?? []);

    logger.info(`Task DynamoDB Valid items: ${validItems.length}`);
    logger.warn(`Task DynamoDB Invalid items: ${invalidItems.length}`);

    // Log details of invalid items
    invalidItems.forEach(({ item, error }, index) => {
      logger.warn(
        `DynamoDB Invalid Item #${index + 1}: ${JSON.stringify({
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

import validateAndFilter from '../../middlewares/validateandfilter.middleware';
import { getddFleetvehicles } from '../../repositories/dynamo.task';
import { DynamoDbFleetItem, dynamoDBFleetSchema } from '../../schema/fleet.schema';
import logger from '../../utils/logger';

export const getFleetvehicles = async (): Promise<DynamoDbFleetItem[] | undefined> => {
  try {
    const fleets = await getddFleetvehicles();

    const { validItems, invalidItems } = await validateAndFilter(dynamoDBFleetSchema)(fleets ?? []);

    logger.info(`Fleet DynamoDB Valid items: ${validItems.length}`);
    logger.warn(`Fleet DynamoDB Invalid items: ${invalidItems.length}`);

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

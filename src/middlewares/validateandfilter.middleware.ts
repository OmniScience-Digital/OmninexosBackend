// validator.middleware.ts
import { ZodTypeAny, ZodError, TypeOf } from 'zod';
import logger from '../utils/logger';

const validateAndFilter =
  <T extends ZodTypeAny>(schema: T) =>
  async (
    data: unknown[]
  ): Promise<{
    validItems: TypeOf<T>[];
    invalidItems: { item: any; error: ZodError }[];
  }> => {
    const results = {
      validItems: [] as TypeOf<T>[],
      invalidItems: [] as { item: any; error: ZodError }[],
    };

    for (const item of data) {
      try {
        results.validItems.push(schema.parse(item));
      } catch (e) {
        if (e instanceof ZodError) {
          results.invalidItems.push({ item, error: e });

          // Enhanced error logging with proper error formatting
          logger.warn({
            message: 'Invalid item filtered',
            item,
            errors: e.issues.map((error) => ({
              code: error.code,
              path: error.path.join('.'),
              message: error.message,
              ...(error.code === 'invalid_type'
                ? {
                    received: (error as any).received,
                    expected: (error as any).expected,
                  }
                : {}),
            })),
          });
        }
      }
    }

    return results;
  };

export default validateAndFilter;

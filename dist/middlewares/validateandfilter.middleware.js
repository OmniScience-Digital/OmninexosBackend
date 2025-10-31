// validator.middleware.ts
import { ZodError } from "zod";
import logger from "../utils/logger.js";
const validateAndFilter = (schema) => async (data) => {
    const results = {
        validItems: [],
        invalidItems: [],
    };
    for (const item of data) {
        try {
            results.validItems.push(schema.parse(item));
        }
        catch (e) {
            if (e instanceof ZodError) {
                results.invalidItems.push({ item, error: e });
                // Enhanced error logging with proper error formatting
                logger.warn({
                    message: "Invalid item filtered",
                    item,
                    errors: e.issues.map((error) => ({
                        code: error.code,
                        path: error.path.join("."),
                        message: error.message,
                        ...(error.code === "invalid_type"
                            ? {
                                received: error.received,
                                expected: error.expected,
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

import { createWorker } from "../bull/bull.redis.js";
import { pollQuotes } from "../services/xero.quote.service.js";
import logger from "../utils/logger.js";
export const quoteWorker = createWorker("quote-polling", async (job) => {
    logger.info("\uD83D\uDFE2 Processing quote job:", job.name);
    try {
        await pollQuotes(); // service handles fetching quotes from Xero
    }
    catch (err) {
        console.error("\u274C Error polling quotes:", err);
    }
});

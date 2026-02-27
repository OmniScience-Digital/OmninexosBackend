import { createWorker } from "../bull/bull.redis.js";
import { pollPurchases } from "../services/xero.Purchases.service.js";
import logger from "../utils/logger.js";
export const purchaseWorker = createWorker("purchase-polling", async (job) => {
    logger.info("\uD83D\uDFE2 Processing purchase job:", job.name);
    try {
        await pollPurchases();
    }
    catch (err) {
        logger.error("\u274C Error polling purchases:", err);
    }
});

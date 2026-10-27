import { createWorker } from "../bull/bull.redis.js";
import logger from "../utils/logger.js";
import { jobCardFlowEnabled } from "../helper/jobcard/jobcard.config.js";
import { defaultDispatchDeps, processPendingSubmissions, requeueFailedSubmissions, } from "../services/jobcard.dispatch.service.js";
import { processJobCardWrapUps } from "../services/wrapup.service.js";
export const jobCardWorker = createWorker("jobcard-dispatch", async () => {
    if (!jobCardFlowEnabled())
        return;
    try {
        logger.info("\u2705 Job card dispatch run started...");
        const deps = await defaultDispatchDeps();
        const requeued = await requeueFailedSubmissions(deps);
        if (requeued > 0) {
            logger.info(`[dispatch] auto-retried ${requeued} FAILED submission(s)`);
        }
        await processPendingSubmissions(deps);
        await processJobCardWrapUps(deps);
    }
    catch (err) {
        logger.error("\u274C Job card dispatch run failed:", err);
    }
});

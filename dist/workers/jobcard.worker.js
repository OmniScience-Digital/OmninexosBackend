// src/workers/jobcard.worker.ts
import { createWorker } from "../bull/bull.redis.js";
import logger from "../utils/logger.js";
import { jobCardFlowEnabled } from "../helper/jobcard/jobcard.config.js";
import { defaultDispatchDeps, processPendingSubmissions, } from "../services/jobcard.dispatch.service.js";
export const jobCardWorker = createWorker("jobcard-dispatch", async () => {
    if (!jobCardFlowEnabled())
        return; // tables not configured yet: do nothing
    try {
        await processPendingSubmissions(await defaultDispatchDeps());
    }
    catch (err) {
        logger.error("\u274C Job card dispatch run failed:", err);
    }
});

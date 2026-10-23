// src/workers/jobcard.worker.ts
import { createWorker } from "../bull/bull.redis.js";
import logger from "../utils/logger.js";
import { jobCardFlowEnabled } from "../helper/jobcard/jobcard.config.js";
import { defaultDispatchDeps, processPendingSubmissions, } from "../services/jobcard.dispatch.service.js";
import { processJobCardWrapUps } from "../services/wrapup.service.js";
export const jobCardWorker = createWorker("jobcard-dispatch", async () => {
    if (!jobCardFlowEnabled())
        return; // tables not configured yet: do nothing
    try {
        logger.info("\u2705 Job card dispatch run started...");
        const deps = await defaultDispatchDeps();
        await processPendingSubmissions(deps);
        await processJobCardWrapUps(deps); // total time + placeholder certificate, once each
    }
    catch (err) {
        logger.error("\u274C Job card dispatch run failed:", err);
    }
});

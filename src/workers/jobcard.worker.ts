// src/workers/jobcard.worker.ts
import { createWorker } from '../bull/bull.redis';
import logger from '../utils/logger';
import { jobCardFlowEnabled } from '../helper/jobcard/jobcard.config';
import {
  defaultDispatchDeps,
  processPendingSubmissions,
} from '../services/jobcard.dispatch.service';

export const jobCardWorker = createWorker('jobcard-dispatch', async () => {
  if (!jobCardFlowEnabled()) return; // tables not configured yet: do nothing
  try {
    logger.info('✅ Job card dispatch run started...');
    await processPendingSubmissions(await defaultDispatchDeps());
  } catch (err) {
    logger.error('❌ Job card dispatch run failed:', err);
  }
});

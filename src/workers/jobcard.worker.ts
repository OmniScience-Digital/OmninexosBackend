import { createWorker } from '../bull/bull.redis';
import logger from '../utils/logger';
import { jobCardFlowEnabled } from '../helper/jobcard/jobcard.config';
import {
  defaultDispatchDeps,
  processPendingSubmissions,
  requeueFailedSubmissions,
} from '../services/jobcard.dispatch.service';
import { processJobCardWrapUps } from '../services/wrapup.service';

export const jobCardWorker = createWorker('jobcard-dispatch', async () => {
  if (!jobCardFlowEnabled()) return;
  try {
    logger.info('✅ Job card dispatch run started...');
    const deps = await defaultDispatchDeps();
    const requeued = await requeueFailedSubmissions(deps);
    if (requeued > 0) {
      logger.info(`[dispatch] auto-retried ${requeued} FAILED submission(s)`);
    }
    await processPendingSubmissions(deps);
    await processJobCardWrapUps(deps);
  } catch (err) {
    logger.error('❌ Job card dispatch run failed:', err);
  }
});

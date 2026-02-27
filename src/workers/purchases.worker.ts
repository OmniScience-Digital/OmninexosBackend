import { createWorker } from '../bull/bull.redis';
import { pollPurchases } from '../services/xero.Purchases.service';
import { Job } from 'bullmq';
import logger from '../utils/logger';

export const purchaseWorker = createWorker('purchase-polling', async (job: Job) => {
  logger.info('🟢 Processing purchase job:', job.name);

  try {
    await pollPurchases();
  } catch (err) {
    logger.error('❌ Error polling purchases:', err);
  }
});

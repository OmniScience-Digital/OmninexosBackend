import { createWorker } from '../bull/bull.redis';
import { pollQuotes } from '../services/xero.quote.service';
import { Job } from 'bullmq';
import logger from '../utils/logger';

export const quoteWorker = createWorker('quote-polling', async (job: Job) => {
  logger.info('🟢 Processing quote job:', job.name);
  try {
    await pollQuotes(); // service handles fetching quotes from Xero
  } catch (err) {
    console.error('❌ Error polling quotes:', err);
  }
});

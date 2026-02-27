import { createQueue } from '../bull/bull.redis';

export const purchaseQueue = createQueue('purchase-polling');

export async function addPurchaseJob() {
  const repeatableJobs = await purchaseQueue.getRepeatableJobs();

  for (const job of repeatableJobs) {
    if (job.name === 'poll-purchases') {
      await purchaseQueue.removeRepeatableByKey(job.key);
    }
  }

  await purchaseQueue.add(
    'poll-purchases',
    {},
    { repeat: { every: 60_000 } } // every 1 minute
  );
}

// src/queues/jobcard.queue.ts  (NEW FILE)
import { createQueue } from '../bull/bull.redis';

export const jobCardQueue = createQueue('jobcard-dispatch');

/** Checks for newly submitted results every 20 seconds. */
export async function addJobCardDispatchJob() {
  for (const job of await jobCardQueue.getRepeatableJobs()) {
    if (job.name === 'dispatch-results') await jobCardQueue.removeRepeatableByKey(job.key);
  }
  
   await jobCardQueue.add(
      'poll-quotes',
      {},
      { repeat: { every: 180_000 } } // repeat every 180 seconds
    );
}

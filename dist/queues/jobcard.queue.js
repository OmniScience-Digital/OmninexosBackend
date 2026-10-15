// src/queues/jobcard.queue.ts  (NEW FILE)
import { createQueue } from "../bull/bull.redis.js";
export const jobCardQueue = createQueue("jobcard-dispatch");
/** Checks for newly submitted results every 20 seconds. */
export async function addJobCardDispatchJob() {
    for (const job of await jobCardQueue.getRepeatableJobs()) {
        if (job.name === "dispatch-results")
            await jobCardQueue.removeRepeatableByKey(job.key);
    }
    await jobCardQueue.add("dispatch-results", {}, { repeat: { every: 20000 }, removeOnComplete: true, removeOnFail: 100 });
}

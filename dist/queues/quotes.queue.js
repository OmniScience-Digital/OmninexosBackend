import { createQueue } from "../bull/bull.redis.js";
export const quoteQueue = createQueue("quote-polling");
export async function addQuoteJob() {
    // Remove any existing repeatable jobs with the same name
    const repeatableJobs = await quoteQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        if (job.name === "poll-quotes") {
            await quoteQueue.removeRepeatableByKey(job.key);
        }
    }
    // Add a job to poll quotes, can repeat every 3 min
    await quoteQueue.add("poll-quotes", {}, { repeat: { every: 60000 } } // repeat every 180 seconds
    );
}

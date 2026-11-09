// src/queues/ticket.queue.ts 
// TICKETING: two repeating jobs, on separate queues so a slow ClickUp sync never delays intake.
import { createQueue } from "../bull/bull.redis.js";
export const ticketIntakeQueue = createQueue("ticket-intake");
export const ticketSyncQueue = createQueue("ticket-sync");
// BullMQ keeps every finished job unless told otherwise; at one job per 15 seconds that adds up.
const keepLittle = { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } };
export async function addTicketJobs() {
    for (const q of [ticketIntakeQueue, ticketSyncQueue]) {
        for (const job of await q.getRepeatableJobs())
            await q.removeRepeatableByKey(job.key);
    }
    // New submissions: every 15 seconds, so the person sees their task number quickly.
    await ticketIntakeQueue.add("intake", {}, { repeat: { every: 15000 }, ...keepLittle });
    // ClickUp updates and escalations: every 5 minutes, as agreed in the meeting.
    await ticketSyncQueue.add("sync", {}, { repeat: { every: 5 * 60000 }, ...keepLittle });
}

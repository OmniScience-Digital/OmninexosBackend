// src/workers/ticket.worker.ts 
// TICKETING: runs the intake and sync services on their schedules.
import { createWorker } from "../bull/bull.redis.js";
import logger from "../utils/logger.js";
import { clickUpTicketApi } from "../services/ticket.clickup.service.js";
import { createEscalationTask } from "../services/clickUpfetch.service.js";
import { getTelegramService } from "../services/telegram.service.js";
import * as repo from "../repositories/dynamo.ticket.repository.js";
import { processSubmittedTickets } from "../services/ticket.intake.service.js";
import { syncOpenTickets } from "../services/ticket.sync.service.js";
import { GLEED_NAME, assigneeOverrides, getBusinessCalendar, notifyOnCreate, numberPad, ticketFlowEnabled, } from "../helper/ticket/ticket.config.js";
const common = () => ({
    repo,
    clickup: clickUpTicketApi,
    now: () => new Date(),
    cal: getBusinessCalendar(),
    gleedName: GLEED_NAME,
    telegramChatId: process.env.TASKING_TELEGRAM_CHAT_ID,
    sendTelegram: (chatId, text) => getTelegramService().sendMessage(text, chatId),
});
const intakeDeps = () => ({
    ...common(),
    numberPad: numberPad(),
    overrides: assigneeOverrides(),
    notifyOnCreate: notifyOnCreate(),
    raiseEscalation: createEscalationTask,
});
const syncDeps = () => common();
let warned = false;
const enabled = () => {
    if (ticketFlowEnabled())
        return true;
    if (!warned) {
        warned = true;
        logger.warn("[ticket] flow is off: set the TICKET_* / TASKING_TELEGRAM_CHAT_ID variables (see TICKETING.md)");
    }
    return false;
};
export const ticketIntakeWorker = createWorker("ticket-intake", async () => {
    if (!enabled())
        return;
    try {
        await processSubmittedTickets(intakeDeps());
    }
    catch (err) {
        logger.error("\u274C Ticket intake run failed:", err);
    }
});
export const ticketSyncWorker = createWorker("ticket-sync", async () => {
    if (!enabled())
        return;
    try {
        await syncOpenTickets(syncDeps());
    }
    catch (err) {
        logger.error("\u274C Ticket sync run failed:", err);
    }
});

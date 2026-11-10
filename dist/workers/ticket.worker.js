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
import { refreshRoster } from "../services/ticket.roster.service.js";
import { GLEED_NAME, assigneeOverrides, escalationUserId, getBusinessCalendar, missingFlowVars, missingRosterVars, notifyOnCreate, numberPad, rosterEnabled, ticketFlowEnabled, } from "../helper/ticket/ticket.config.js";
const common = () => ({
    repo,
    clickup: clickUpTicketApi,
    now: () => new Date(),
    cal: getBusinessCalendar(),
    gleedName: GLEED_NAME,
    escalationUserId: escalationUserId(),
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
let warnedFlow = false;
const enabled = () => {
    if (ticketFlowEnabled())
        return true;
    if (!warnedFlow) {
        warnedFlow = true;
        logger.warn(`[ticket] flow is off. Missing in .env: ${missingFlowVars().join(", ")}`);
    }
    return false;
};
let warnedRoster = false;
const rosterOn = () => {
    if (rosterEnabled())
        return true;
    if (!warnedRoster) {
        warnedRoster = true;
        logger.warn(`[ticket] people list refresh is off. Missing in .env: ${missingRosterVars().join(", ")}`);
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
    // Keep the form's people list in step with ClickUp (runs even before Telegram is configured).
    if (rosterOn()) {
        try {
            const changed = await refreshRoster({ repo, clickup: clickUpTicketApi });
            if (changed > 0)
                logger.info(`[ticket] people list updated from ClickUp (${changed} change(s))`);
        }
        catch (err) {
            logger.error("\u274C Ticket people refresh failed:", err);
        }
    }
    if (!enabled())
        return;
    try {
        await syncOpenTickets(syncDeps());
    }
    catch (err) {
        logger.error("\u274C Ticket sync run failed:", err);
    }
});

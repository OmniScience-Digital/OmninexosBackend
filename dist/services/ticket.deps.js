// src/services/ticket.deps.ts
// TICKETING: the real dependencies for the ticket services, shared by the worker and the webhook.
import { clickUpTicketApi } from "./ticket.clickup.service.js";
import { getTelegramService } from "./telegram.service.js";
import * as repo from "../repositories/dynamo.ticket.repository.js";
import { GLEED_NAME, escalationUserId, getBusinessCalendar } from "../helper/ticket/ticket.config.js";
export const ticketCommonDeps = () => ({
    repo,
    clickup: clickUpTicketApi,
    now: () => new Date(),
    cal: getBusinessCalendar(),
    gleedName: GLEED_NAME,
    escalationUserId: escalationUserId(),
    telegramChatId: process.env.TASKING_TELEGRAM_CHAT_ID,
    sendTelegram: (chatId, text) => getTelegramService().sendMessage(text, chatId),
});
export const ticketSyncDeps = () => ticketCommonDeps();

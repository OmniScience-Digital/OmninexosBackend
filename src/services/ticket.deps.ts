// src/services/ticket.deps.ts
// TICKETING: the real dependencies for the ticket services, shared by the worker and the webhook.
import { clickUpTicketApi } from './ticket.clickup.service';
import { getTelegramService } from './telegram.service';
import * as repo from '../repositories/dynamo.ticket.repository';
import type { SyncDeps } from './ticket.sync.service';
import { GLEED_NAME, escalationUserId, getBusinessCalendar } from '../helper/ticket/ticket.config';

export const ticketCommonDeps = () => ({
  repo,
  clickup: clickUpTicketApi,
  now: () => new Date(),
  cal: getBusinessCalendar(),
  gleedName: GLEED_NAME,
  escalationUserId: escalationUserId(),
  telegramChatId: process.env.TASKING_TELEGRAM_CHAT_ID!,
  sendTelegram: (chatId: string, text: string) => getTelegramService().sendMessage(text, chatId),
});

export const ticketSyncDeps = (): SyncDeps => ticketCommonDeps();

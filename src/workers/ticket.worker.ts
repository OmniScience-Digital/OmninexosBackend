// src/workers/ticket.worker.ts
// TICKETING: runs the intake and sync services on their schedules.
import { createWorker } from '../bull/bull.redis';
import logger from '../utils/logger';
import { clickUpTicketApi } from '../services/ticket.clickup.service';
import { createEscalationTask } from '../services/clickUpfetch.service';
import { getTelegramService } from '../services/telegram.service';
import * as repo from '../repositories/dynamo.ticket.repository';
import { processSubmittedTickets, type IntakeDeps } from '../services/ticket.intake.service';
import { syncOpenTickets, type SyncDeps } from '../services/ticket.sync.service';
import {
  GLEED_NAME,
  assigneeOverrides,
  getBusinessCalendar,
  notifyOnCreate,
  numberPad,
  ticketFlowEnabled,
} from '../helper/ticket/ticket.config';

const common = () => ({
  repo,
  clickup: clickUpTicketApi,
  now: () => new Date(),
  cal: getBusinessCalendar(),
  gleedName: GLEED_NAME,
  telegramChatId: process.env.TASKING_TELEGRAM_CHAT_ID!,
  sendTelegram: (chatId: string, text: string) => getTelegramService().sendMessage(text, chatId),
});

const intakeDeps = (): IntakeDeps => ({
  ...common(),
  numberPad: numberPad(),
  overrides: assigneeOverrides(),
  notifyOnCreate: notifyOnCreate(),
  raiseEscalation: createEscalationTask,
});

const syncDeps = (): SyncDeps => common();

let warned = false;
const enabled = () => {
  if (ticketFlowEnabled()) return true;
  if (!warned) {
    warned = true;
    logger.warn(
      '[ticket] flow is off: set the TICKET_* / TASKING_TELEGRAM_CHAT_ID variables (see TICKETING.md)'
    );
  }
  return false;
};

export const ticketIntakeWorker = createWorker('ticket-intake', async () => {
  if (!enabled()) return;
  try {
    await processSubmittedTickets(intakeDeps());
  } catch (err) {
    logger.error('❌ Ticket intake run failed:', err);
  }
});

export const ticketSyncWorker = createWorker('ticket-sync', async () => {
  if (!enabled()) return;
  try {
    await syncOpenTickets(syncDeps());
  } catch (err) {
    logger.error('❌ Ticket sync run failed:', err);
  }
});

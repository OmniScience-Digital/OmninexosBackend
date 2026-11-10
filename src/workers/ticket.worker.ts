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
import { refreshRoster } from '../services/ticket.roster.service';
import {
  GLEED_NAME,
  assigneeOverrides,
  escalationUserId,
  getBusinessCalendar,
  missingFlowVars,
  missingRosterVars,
  notifyOnCreate,
  numberPad,
  rosterEnabled,
  ticketFlowEnabled,
} from '../helper/ticket/ticket.config';

const common = () => ({
  repo,
  clickup: clickUpTicketApi,
  now: () => new Date(),
  cal: getBusinessCalendar(),
  gleedName: GLEED_NAME,
  escalationUserId: escalationUserId(),
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

let warnedFlow = false;
const enabled = () => {
  if (ticketFlowEnabled()) return true;
  if (!warnedFlow) {
    warnedFlow = true;
    logger.warn(`[ticket] flow is off. Missing in .env: ${missingFlowVars().join(', ')}`);
  }
  return false;
};

let warnedRoster = false;
const rosterOn = () => {
  if (rosterEnabled()) return true;
  if (!warnedRoster) {
    warnedRoster = true;
    logger.warn(
      `[ticket] people list refresh is off. Missing in .env: ${missingRosterVars().join(', ')}`
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
  // Keep the form's people list in step with ClickUp (runs even before Telegram is configured).
  if (rosterOn()) {
    try {
      const changed = await refreshRoster({ repo, clickup: clickUpTicketApi });
      if (changed > 0)
        logger.info(`[ticket] people list updated from ClickUp (${changed} change(s))`);
    } catch (err) {
      logger.error('❌ Ticket people refresh failed:', err);
    }
  }
  if (!enabled()) return;
  try {
    await syncOpenTickets(syncDeps());
  } catch (err) {
    logger.error('❌ Ticket sync run failed:', err);
  }
});

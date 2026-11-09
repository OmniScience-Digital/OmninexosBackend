// src/services/ticket.sync.service.ts
// TICKETING: the 5 minute run over every OPEN ticket.
//   1. New comments from people on the ClickUp task are forwarded to the Telegram group and count
//      as an update. Comments the system posted itself are ignored.
//   2. A finished ClickUp task closes the ticket.
//   3. A ticket with no update gets the 50% follow-up and the 70% Gleed tag (see escalation.ts).
import logger from '../utils/logger';
import type { TicketClickUp } from './ticket.clickup.service';
import type { TicketRepo } from './ticket.intake.service';
import { dueEscalations } from '../helper/ticket/escalation';
import { matchMember } from '../helper/ticket/ticket.assignees';
import {
  buildTaskName,
  followUpComment,
  gleedComment,
  isBotText,
  telegramEscalationMessage,
  telegramUpdateMessage,
  type EscalationStep,
  type ResolvedAssignee,
} from '../helper/ticket/ticket.format';
import { SYNC_LEASE_MS, type BusinessCalendar } from '../helper/ticket/ticket.config';

export interface SyncDeps {
  repo: TicketRepo;
  clickup: TicketClickUp;
  now: () => Date;
  cal: BusinessCalendar;
  gleedName: string;
  telegramChatId: string;
  sendTelegram: (chatId: string, text: string) => Promise<boolean>;
}

type Row = Record<string, any>;
const DONE_TYPES = new Set(['done', 'closed']);

/** Runs one pass. One ticket failing never stops the others. */
export async function syncOpenTickets(deps: SyncDeps): Promise<void> {
  const rows = await deps.repo.listTicketsByStatus('OPEN');
  for (const row of rows) {
    try {
      await syncTicket(deps, row);
    } catch (err: any) {
      logger.error(
        `[ticket] sync failed for ${row.ticketNumber ?? row.id}: ${err?.message ?? err}`
      );
      // Drop the lease so the next run can retry straight away.
      await deps.repo.updateTicket(row.id, {}, ['lockedUntil']).catch(() => undefined);
    }
  }
}

async function syncTicket(deps: SyncDeps, row: Row) {
  if (!row.clickupTaskId) return;
  if (!(await deps.repo.claimTicket(row.id, 'OPEN', deps.now().getTime(), SYNC_LEASE_MS))) return;

  const taskName = buildTaskName(row.ticketNumber ?? row.id, row.title);
  const taskId: string = row.clickupTaskId;
  let hasUpdate = Boolean(row.hasUpdate);

  const task = await deps.clickup.getTask(taskId);
  if (!task) {
    await deps.repo.updateTicket(
      row.id,
      {
        status: 'CLOSED',
        closedAt: deps.now().toISOString(),
        lastError: 'ClickUp task no longer exists',
      },
      ['lockedUntil']
    );
    return;
  }

  // ---- 1. comments from people
  let cursorMs = Date.parse(row.lastCommentAt ?? row.createdAt);
  const botIds = new Set<string>(row.botCommentIds ?? []);
  const comments = await deps.clickup.listComments(taskId, cursorMs);
  for (const c of comments) {
    if (botIds.has(c.id) || isBotText(c.text)) {
      cursorMs = c.dateMs;
      continue;
    }
    const sent = await deps.sendTelegram(
      deps.telegramChatId,
      telegramUpdateMessage(taskName, c.userName, c.text)
    );
    if (!sent) break; // keep the cursor here: this comment is retried on the next run
    cursorMs = c.dateMs;
    hasUpdate = true;
    await deps.repo.updateTicket(row.id, {
      hasUpdate: true,
      lastCommentAt: new Date(cursorMs).toISOString(),
    });
  }
  if (cursorMs > Date.parse(row.lastCommentAt ?? row.createdAt)) {
    await deps.repo.updateTicket(row.id, { lastCommentAt: new Date(cursorMs).toISOString() });
  }

  // ---- 2. finished in ClickUp
  if (DONE_TYPES.has(task.statusType)) {
    await deps.repo.updateTicket(row.id, { status: 'CLOSED', closedAt: deps.now().toISOString() }, [
      'lockedUntil',
    ]);
    return;
  }

  // ---- 3. escalation
  const steps = dueEscalations(
    {
      urgencyMinutes: Number(row.urgencyMinutes ?? 0),
      submittedAt: new Date(row.createdAt),
      now: deps.now(),
      hasUpdate,
      followUpDone: Boolean(row.followUpSentAt),
      gleedDone: Boolean(row.gleedTaggedAt),
    },
    deps.cal
  );
  for (const step of steps) await escalate(deps, row, taskName, taskId, step);

  await deps.repo.updateTicket(row.id, {}, ['lockedUntil']);
}

async function escalate(
  deps: SyncDeps,
  row: Row,
  taskName: string,
  taskId: string,
  step: EscalationStep
) {
  const resolved: ResolvedAssignee[] = row.resolvedAssignees
    ? JSON.parse(row.resolvedAssignees)
    : [];
  const dueAt = new Date(row.dueAt);
  const number = row.ticketNumber ?? row.id;

  const blocks =
    step === 'followUp'
      ? followUpComment(
          number,
          [...new Set(resolved.map((a) => a.clickupUserId).filter((x): x is number => x !== null))],
          dueAt
        )
      : gleedComment(number, await gleedId(deps), dueAt);

  const posted = await deps.clickup.postComment(taskId, blocks);
  // Record before anything else so the comment can never be mistaken for a person's update.
  if (posted.id) await deps.repo.addBotCommentId(row.id, posted.id);
  const flag = step === 'followUp' ? 'followUpSentAt' : 'gleedTaggedAt';
  const stamp = deps.now().toISOString();
  await deps.repo.updateTicket(row.id, { [flag]: stamp });
  row[flag] = stamp;
  logger.info(`[ticket] ${number} escalation: ${step}`);

  await deps
    .sendTelegram(deps.telegramChatId, telegramEscalationMessage(taskName, step, dueAt))
    .catch(() => false);
}

/** Gleed's ClickUp id, looked up on the list (cached by the ClickUp client). */
async function gleedId(deps: SyncDeps): Promise<number | null> {
  const match = matchMember(deps.gleedName, await deps.clickup.getListMembers());
  return match.member ? match.member.id : null;
}

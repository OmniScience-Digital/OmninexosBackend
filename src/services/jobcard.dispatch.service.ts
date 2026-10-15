// src/services/jobcard.dispatch.service.ts  (NEW FILE)
// Handles every submitted result: stops the timer when the last work item is done, issues the certificate,
// then posts the result to the job card's ClickUp task and Telegram group.
//
// Results are found through the sparse `deliveryState = PENDING` index (whoever creates a result sets it).
// Everything is idempotent and independent: ClickUp and Telegram are tracked separately, so one failing never
// blocks the other, and a retry never re-sends what was already sent.
import logger from '../utils/logger';
import { certificatesEnabled, CALIBRATION_TYPES } from '../helper/jobcard/jobcard.config';
import {
  clampEnd,
  closedMinutesTotal,
  isOpen,
  minutesBetween,
  planStop,
} from '../helper/jobcard/timeTracking';
import {
  formatForClickUp,
  formatForTelegram,
  type ModuleType,
  type ResultContext,
} from '../helper/jobcard/resultFormat';
import type * as Repo from '../repositories/dynamo.jobcardflow.repository';
import {
  issueCertificateIfReady,
  renderCertificatePdf,
  uploadCertificatePdf,
} from './certificate.service';

type Row = Record<string, any>;
export type FlowRepo = Pick<
  typeof Repo,
  | 'getJobCard'
  | 'getScale'
  | 'getModule'
  | 'getTelegramGroup'
  | 'listModules'
  | 'listTimeEntries'
  | 'closeTimeEntry'
  | 'setJobCardTotal'
  | 'listPendingSubmissions'
  | 'claimSubmission'
  | 'updateSubmission'
>;

export interface DispatchDeps {
  repo: FlowRepo;
  now: () => Date;
  sendTelegram: (chatId: string, text: string) => Promise<boolean>;
  postClickUpComment: (taskId: string, text: string) => Promise<void>;
  /** undefined while certificates are switched off */
  issueCertificate?: (scaleId: string, jobCard: Row) => Promise<unknown>;
}

export const MAX_ATTEMPTS = 8;
export const WAIT_CAP_MS = 7 * 24 * 3600_000; // give up waiting for a missing group / ClickUp task after 7 days
const WAIT_RECHECK_MS = 2 * 60_000;
const LEASE_MS = 2 * 60_000;

/** 1, 2, 4, 8 ... minutes, at most one hour. */
export const retryDelayMs = (attempts: number): number =>
  Math.min(2 ** Math.max(0, attempts - 1), 60) * 60_000;

type Channel = 'SENT' | 'PENDING' | 'FAILED';
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const parsePayload = (p: unknown): Record<string, unknown> => {
  try {
    const v = typeof p === 'string' ? JSON.parse(p) : p;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export interface DispatchSummary {
  examined: number;
  handled: number;
  finished: number;
  retrying: number;
}

export async function processPendingSubmissions(
  deps: DispatchDeps,
  batch = 25
): Promise<DispatchSummary> {
  const { repo } = deps;
  const nowMs = deps.now().getTime();
  const pending = await repo.listPendingSubmissions(100);
  const due = pending
    .filter((s: any) => !s.nextAttemptAt || Date.parse(s.nextAttemptAt) <= nowMs)
    .slice(0, batch);

  const summary: DispatchSummary = {
    examined: pending.length,
    handled: 0,
    finished: 0,
    retrying: 0,
  };
  const stopped = new Map<string, Promise<void>>(); // stop the timer once per job card per run
  const stopTimer = (jobCardId: string) => {
    if (!stopped.has(jobCardId)) stopped.set(jobCardId, stopTimerIfComplete(deps, jobCardId));
    return stopped.get(jobCardId)!;
  };

  for (const sub of due) {
    if (!(await repo.claimSubmission(sub.id, nowMs, LEASE_MS))) continue; // another worker has it
    summary.handled += 1;
    try {
      const done = await processSubmission(deps, sub, stopTimer);
      done ? (summary.finished += 1) : (summary.retrying += 1);
    } catch (e) {
      logger.error(`Result ${sub.id}: unexpected failure`, e);
      const finished = await recordUnexpectedFailure(deps, sub, msg(e));
      finished ? (summary.finished += 1) : (summary.retrying += 1);
    }
  }
  if (summary.handled) logger.info('Job card results handled', summary);
  return summary;
}

/** Stops every open time entry once the last work item is submitted. Safe to run any number of times. */
export async function stopTimerIfComplete(
  deps: Pick<DispatchDeps, 'repo' | 'now'>,
  jobCardId: string
): Promise<void> {
  const { repo } = deps;
  const [items, entries] = await Promise.all([
    repo.listModules(jobCardId),
    repo.listTimeEntries(jobCardId),
  ]);
  const plan = planStop(
    items.map((i: any) => ({ status: i.status, submittedAt: i.submittedAt })),
    entries,
    deps.now().toISOString()
  );
  if (!plan) return;
  for (const e of entries.filter(isOpen)) {
    const endedAt = clampEnd(e.startedAt, plan.stopAt);
    await repo.closeTimeEntry(e.id, endedAt, minutesBetween(e.startedAt, endedAt), plan.reason);
  }
  // Recompute (never increment) so repeated runs and the web app cannot drift apart.
  await repo.setJobCardTotal(jobCardId, closedMinutesTotal(await repo.listTimeEntries(jobCardId)));
  logger.info(`Job card ${jobCardId}: time stopped (${plan.reason})`);
}

/** @returns true when the result is fully handled (and leaves the pending list), false if it will be retried. */
async function processSubmission(
  deps: DispatchDeps,
  sub: Row,
  stopTimer: (id: string) => Promise<void>
): Promise<boolean> {
  const { repo } = deps;
  const nowMs = deps.now().getTime();
  const jobCard = await repo.getJobCard(sub.jobCardId);
  if (!jobCard) {
    await finish(
      deps,
      sub,
      { clickup: 'FAILED', telegram: 'FAILED' },
      'Job card not found',
      Number(sub.deliveryAttempts) || 0
    );
    return true;
  }

  const errors: string[] = [];
  const notes: string[] = [];

  // 1. Timer
  try {
    await stopTimer(jobCard.id);
  } catch (e) {
    errors.push(`Timer: ${msg(e)}`);
  }

  // 2. Certificate (calibration results only, and only when switched on)
  if (deps.issueCertificate && (CALIBRATION_TYPES as readonly string[]).includes(sub.moduleType)) {
    try {
      await deps.issueCertificate(sub.scaleId, jobCard);
    } catch (e) {
      errors.push(`Certificate: ${msg(e)}`);
    }
  }

  // 3. Deliveries: independent of each other
  let clickup: Channel = sub.clickupStatus === 'SENT' ? 'SENT' : 'PENDING';
  let telegram: Channel = sub.telegramStatus === 'SENT' ? 'SENT' : 'PENDING';
  let waiting = false;

  if (clickup !== 'SENT' || telegram !== 'SENT') {
    const text = await buildTexts(deps, sub, jobCard);

    if (clickup !== 'SENT') {
      if (!jobCard.clickupTaskId) {
        waiting = true;
        notes.push('No ClickUp task on the job card yet');
      } else {
        try {
          await deps.postClickUpComment(jobCard.clickupTaskId, text.clickup);
          clickup = 'SENT';
        } catch (e) {
          errors.push(`ClickUp: ${msg(e)}`);
        }
      }
    }

    if (telegram !== 'SENT') {
      const group = jobCard.telegramGroupId
        ? await repo.getTelegramGroup(jobCard.telegramGroupId)
        : null;
      if (!group || group.active === false) {
        waiting = true;
        notes.push(
          group ? 'The linked Telegram group is inactive' : 'No Telegram group linked yet'
        );
      } else {
        try {
          if (await deps.sendTelegram(String(group.chatId), text.telegram)) telegram = 'SENT';
          else errors.push('Telegram: message was not accepted');
        } catch (e) {
          errors.push(`Telegram: ${msg(e)}`);
        }
      }
    }
  }

  const attempts = (Number(sub.deliveryAttempts) || 0) + (errors.length ? 1 : 0);
  const allDone = clickup === 'SENT' && telegram === 'SENT' && errors.length === 0;
  if (allDone) {
    await finish(deps, sub, { clickup, telegram }, undefined, attempts);
    return true;
  }

  const tooOld = nowMs - Date.parse(sub.submittedAt) > WAIT_CAP_MS;
  if (attempts >= MAX_ATTEMPTS || (tooOld && errors.length === 0)) {
    await finish(
      deps,
      sub,
      { clickup, telegram },
      [...errors, ...notes].join('; ') || 'Gave up',
      attempts
    );
    return true;
  }

  const delay = errors.length ? retryDelayMs(attempts) : WAIT_RECHECK_MS;
  await repo.updateSubmission(
    sub.id,
    {
      clickupStatus: clickup,
      telegramStatus: telegram,
      deliveryAttempts: attempts,
      deliveryError: [...errors, ...notes].join('; ') || undefined,
      nextAttemptAt: new Date(nowMs + delay).toISOString(),
    },
    ['lockedUntil', ...([...errors, ...notes].length ? [] : ['deliveryError'])]
  );
  return false;
}

/** Leaves the pending list: anything not sent by now is recorded as FAILED. */
async function finish(
  deps: DispatchDeps,
  sub: Row,
  status: { clickup: Channel; telegram: Channel },
  error: string | undefined,
  attempts: number
) {
  const f = (c: Channel): Channel => (c === 'SENT' ? 'SENT' : 'FAILED');
  await deps.repo.updateSubmission(
    sub.id,
    {
      clickupStatus: f(status.clickup),
      telegramStatus: f(status.telegram),
      deliveryAttempts: attempts,
      deliveredAt: deps.now().toISOString(),
      deliveryError: error,
    },
    ['deliveryState', 'lockedUntil', 'nextAttemptAt', ...(error ? [] : ['deliveryError'])]
  );
}

async function recordUnexpectedFailure(
  deps: DispatchDeps,
  sub: Row,
  error: string
): Promise<boolean> {
  const attempts = (Number(sub.deliveryAttempts) || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await finish(
      deps,
      sub,
      {
        clickup: sub.clickupStatus === 'SENT' ? 'SENT' : 'FAILED',
        telegram: sub.telegramStatus === 'SENT' ? 'SENT' : 'FAILED',
      },
      error,
      attempts
    );
    return true;
  }
  await deps.repo.updateSubmission(
    sub.id,
    {
      deliveryAttempts: attempts,
      deliveryError: error,
      nextAttemptAt: new Date(deps.now().getTime() + retryDelayMs(attempts)).toISOString(),
    },
    ['lockedUntil']
  );
  return false;
}

async function buildTexts(
  deps: DispatchDeps,
  sub: Row,
  jobCard: Row
): Promise<{ telegram: string; clickup: string }> {
  const { repo } = deps;
  const [scale, module, entries] = await Promise.all([
    repo.getScale(sub.scaleId),
    repo.getModule(sub.moduleId),
    repo.listTimeEntries(jobCard.id),
  ]);
  const ctx: ResultContext = {
    jcNumber: jobCard.jcNumber ?? jobCard.id,
    customerName: jobCard.customerName,
    scaleName: scale?.scaleName ?? 'Unknown scale',
    moduleType: sub.moduleType as ModuleType,
    sequence: module?.sequence,
    submittedAt: sub.submittedAt,
    submittedByName: entries.find((e: any) => e.userId === sub.submittedBy)?.userName,
    payload: parsePayload(sub.payload),
  };
  return { telegram: formatForTelegram(ctx), clickup: formatForClickUp(ctx) };
}

// ---------- production wiring ----------
export async function defaultDispatchDeps(): Promise<DispatchDeps> {
  const repo = await import('../repositories/dynamo.jobcardflow.repository');
  const certificateDeps = {
    repo,
    now: () => new Date(),
    render: renderCertificatePdf,
    upload: uploadCertificatePdf,
  };
  return {
    repo,
    now: () => new Date(),
    // Loaded on first use: these modules read their own environment settings when imported.
    sendTelegram: async (chatId, text) => {
      const { getTelegramService } = await import('./telegram.service');
      return getTelegramService().sendMessage(text, chatId, { maxRetries: 1 });
    },
    postClickUpComment: async (taskId, text) => {
      const { addClickUpComment } = await import('./xero.quote.service');
      await addClickUpComment(taskId, text);
    },
    issueCertificate: certificatesEnabled()
      ? (scaleId, jobCard) => issueCertificateIfReady(scaleId, jobCard, certificateDeps)
      : undefined,
  };
}

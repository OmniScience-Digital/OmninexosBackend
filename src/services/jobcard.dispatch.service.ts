// src/services/jobcard.dispatch.service.ts
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
  photoEntries,
  type ModuleType,
  type ResultContext,
} from '../helper/jobcard/resultFormat';
import { PhotoMissingError, type LoadedPhoto } from './jobcard.photos.service';
import type * as Repo from '../repositories/dynamo.jobcardflow.repository';
import {
  issueCertificateIfReady,
  renderCertificatePdf,
  uploadCertificatePdf,
} from './certificate.service';
import { getDefaultGroupLock, type GroupLock } from './group-lock.service';

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
  loadPhoto?: (key: string, label: string) => Promise<LoadedPhoto>;
  sendTelegramPhotos?: (
    chatId: string,
    photos: (LoadedPhoto & { caption?: string })[]
  ) => Promise<boolean>;
  attachClickUpFile?: (taskId: string, photo: LoadedPhoto) => Promise<void>;
  groupLock?: GroupLock;
  issueCertificate?: (scaleId: string, jobCard: Row) => Promise<unknown>;
}

export const MAX_ATTEMPTS = 8;
export const WAIT_CAP_MS = 7 * 24 * 3600_000;
const WAIT_RECHECK_MS = 2 * 60_000;
const LEASE_MS = 2 * 60_000;
const GROUP_LOCK_TTL_MS = 10 * 60_000;

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

logger.info('[dispatch] module loaded');

export async function processPendingSubmissions(
  deps: DispatchDeps,
  batch = 25
): Promise<DispatchSummary> {
  const { repo } = deps;
  const nowMs = deps.now().getTime();
  logger.info(`[dispatch] processPendingSubmissions start, batch=${batch}`);

  const raw = await repo.listPendingSubmissions(100);
  logger.info(`[dispatch] listPendingSubmissions returned ${raw.length} rows`);

  const pending = raw.sort(
    (a: any, b: any) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt)
  );

  const summary: DispatchSummary = {
    examined: pending.length,
    handled: 0,
    finished: 0,
    retrying: 0,
  };
  const stopped = new Map<string, Promise<void>>();
  const stopTimer = (jobCardId: string) => {
    if (!stopped.has(jobCardId)) stopped.set(jobCardId, stopTimerIfComplete(deps, jobCardId));
    return stopped.get(jobCardId)!;
  };

  for (const sub of pending.slice(0, batch)) {
    logger.info(
      `[dispatch] examine sub=${sub.id} jc=${sub.jobCardId} submittedAt=${sub.submittedAt} nextAttemptAt=${sub.nextAttemptAt ?? 'none'}`
    );

    if (sub.nextAttemptAt && Date.parse(sub.nextAttemptAt) > nowMs) {
      logger.info(`[dispatch] sub=${sub.id} not due yet — break (preserve order)`);
      break;
    }

    const claimed = await repo.claimSubmission(sub.id, nowMs, LEASE_MS);
    logger.info(`[dispatch] claim sub=${sub.id} => ${claimed}`);
    if (!claimed) {
      logger.info(`[dispatch] sub=${sub.id} claim failed — break (another worker has it)`);
      break;
    }

    summary.handled += 1;
    try {
      const done = await processSubmission(deps, sub, stopTimer);
      logger.info(`[dispatch] processSubmission sub=${sub.id} => done=${done}`);
      if (done) {
        summary.finished += 1;
      } else {
        summary.retrying += 1;
        logger.info(`[dispatch] sub=${sub.id} retrying — break (preserve order)`);
        break;
      }
    } catch (e) {
      logger.error(`[dispatch] sub=${sub.id} unexpected failure`, e);
      const finished = await recordUnexpectedFailure(deps, sub, msg(e));
      logger.info(`[dispatch] recordUnexpectedFailure sub=${sub.id} => finished=${finished}`);
      if (finished) {
        summary.finished += 1;
      } else {
        summary.retrying += 1;
        logger.info(`[dispatch] sub=${sub.id} retrying after error — break`);
        break;
      }
    }
  }

  logger.info(`[dispatch] summary ${JSON.stringify(summary)}`);
  return summary;
}

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
  if (!plan) {
    logger.info(`[dispatch] stopTimer jc=${jobCardId} — not complete yet`);
    return;
  }
  for (const e of entries.filter(isOpen)) {
    const endedAt = clampEnd(e.startedAt, plan.stopAt);
    await repo.closeTimeEntry(e.id, endedAt, minutesBetween(e.startedAt, endedAt), plan.reason);
  }
  await repo.setJobCardTotal(jobCardId, closedMinutesTotal(await repo.listTimeEntries(jobCardId)));
  logger.info(`[dispatch] stopTimer jc=${jobCardId} stopped (${plan.reason})`);
}

async function processSubmission(
  deps: DispatchDeps,
  sub: Row,
  stopTimer: (id: string) => Promise<void>
): Promise<boolean> {
  const { repo } = deps;
  const nowMs = deps.now().getTime();
  logger.info(`[dispatch] processSubmission start sub=${sub.id}`);
  const jobCard = await repo.getJobCard(sub.jobCardId);
  if (!jobCard) {
    logger.error(`[dispatch] sub=${sub.id} job card ${sub.jobCardId} not found — failing`);
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

  try {
    await stopTimer(jobCard.id);
  } catch (e) {
    logger.error(`[dispatch] sub=${sub.id} timer stop failed`, e);
    errors.push(`Timer: ${msg(e)}`);
  }

  if (deps.issueCertificate && (CALIBRATION_TYPES as readonly string[]).includes(sub.moduleType)) {
    try {
      logger.info(`[dispatch] sub=${sub.id} issuing certificate`);
      await deps.issueCertificate(sub.scaleId, jobCard);
    } catch (e) {
      logger.error(`[dispatch] sub=${sub.id} certificate failed`, e);
      errors.push(`Certificate: ${msg(e)}`);
    }
  }

  let clickup: Channel = sub.clickupStatus === 'SENT' ? 'SENT' : 'PENDING';
  let telegram: Channel = sub.telegramStatus === 'SENT' ? 'SENT' : 'PENDING';
  let waiting = false;
  const progress: Row = {};

  logger.info(`[dispatch] sub=${sub.id} initial clickup=${clickup} telegram=${telegram}`);

  if (clickup !== 'SENT' || telegram !== 'SENT') {
    logger.info(`[dispatch] sub=${sub.id} building texts`);
    const text = await buildTexts(deps, sub, jobCard);
    const photos = deps.loadPhoto ? photoEntries(parsePayload(sub.payload)) : [];
    logger.info(`[dispatch] sub=${sub.id} photos=${photos.length}`);
    const saveProgress = async (patch: Row) => {
      Object.assign(progress, patch);
      await repo.updateSubmission(sub.id, patch);
      logger.info(`[dispatch] sub=${sub.id} progress saved ${JSON.stringify(Object.keys(patch))}`);
    };
    const loadOne = async (p: { key: string; label: string }) => {
      try {
        return await deps.loadPhoto!(p.key, p.label);
      } catch (e) {
        if (e instanceof PhotoMissingError) {
          logger.warn(`[dispatch] sub=${sub.id} photo missing: ${msg(e)}`);
          return null;
        }
        throw e;
      }
    };

    if (clickup !== 'SENT') {
      if (!jobCard.clickupTaskId) {
        logger.info(`[dispatch] sub=${sub.id} no ClickUp task — waiting`);
        waiting = true;
        notes.push('No ClickUp task on the job card yet');
      } else {
        try {
          if (!(sub.clickupTextSent === true)) {
            logger.info(`[dispatch] sub=${sub.id} sending ClickUp text`);
            await deps.postClickUpComment(jobCard.clickupTaskId, text.clickup);
            await saveProgress({ clickupTextSent: true });
          }
          const done = new Set<string>(sub.clickupPhotosSent ?? []);
          for (const p of photos) {
            if (done.has(p.key) || !deps.attachClickUpFile) continue;
            const file = await loadOne(p);
            if (file) await deps.attachClickUpFile(jobCard.clickupTaskId, file);
            done.add(p.key);
            await saveProgress({ clickupPhotosSent: [...done] });
          }
          clickup = 'SENT';
          logger.info(`[dispatch] sub=${sub.id} ClickUp SENT`);
        } catch (e) {
          logger.error(`[dispatch] sub=${sub.id} ClickUp failed`, e);
          errors.push(`ClickUp: ${msg(e)}`);
        }
      }
    }

    if (telegram !== 'SENT') {
      const group = jobCard.telegramGroupId
        ? await repo.getTelegramGroup(jobCard.telegramGroupId)
        : null;
      if (!group || group.active === false) {
        logger.info(`[dispatch] sub=${sub.id} no active Telegram group — waiting`);
        waiting = true;
        notes.push(
          group ? 'The linked Telegram group is inactive' : 'No Telegram group linked yet'
        );
      } else {
        const chatId = String(group.chatId);
        const ownerId = String(sub.id);
        logger.info(`[dispatch] sub=${sub.id} Telegram group chatId=${chatId}`);

        let shouldProceed = true;
        let holdLock = false;

        if (deps.groupLock) {
          try {
            holdLock = await deps.groupLock.acquire(chatId, ownerId, GROUP_LOCK_TTL_MS);
            logger.info(`[dispatch] sub=${sub.id} lock acquire => ${holdLock}`);
            if (!holdLock) {
              shouldProceed = false;
              waiting = true;
              notes.push('Another dispatcher is delivering to this group');
            }
          } catch (e) {
            logger.warn(
              `[dispatch] sub=${sub.id} lock unavailable (${msg(e)}) — proceeding without lock`
            );
            shouldProceed = true;
            holdLock = false;
          }
        } else {
          logger.warn(
            `[dispatch] sub=${sub.id} no groupLock provided — cross-instance ordering OFF`
          );
        }

        if (shouldProceed) {
          try {
            if (!(sub.telegramTextSent === true)) {
              logger.info(`[dispatch] sub=${sub.id} sending Telegram text`);
              if (!(await deps.sendTelegram(chatId, text.telegram)))
                throw new Error('message was not accepted');
              await saveProgress({ telegramTextSent: true });
            } else {
              logger.info(`[dispatch] sub=${sub.id} Telegram text already sent — skipping`);
            }
            const done = new Set<string>(sub.telegramPhotosSent ?? []);
            const todo = photos.filter((p) => !done.has(p.key));
            logger.info(`[dispatch] sub=${sub.id} Telegram photos to send=${todo.length}`);
            for (let i = 0; i < todo.length && deps.sendTelegramPhotos; i += 10) {
              const chunk = todo.slice(i, i + 10);
              const files: (LoadedPhoto & { caption?: string })[] = [];
              for (const p of chunk) {
                const file = await loadOne(p);
                if (file) files.push({ ...file, caption: p.label });
              }
              logger.info(`[dispatch] sub=${sub.id} sending photo album size=${files.length}`);
              if (files.length && !(await deps.sendTelegramPhotos(chatId, files)))
                throw new Error('photos were not accepted');
              for (const p of chunk) done.add(p.key);
              await saveProgress({ telegramPhotosSent: [...done] });
            }
            telegram = 'SENT';
            logger.info(`[dispatch] sub=${sub.id} Telegram SENT`);
          } catch (e) {
            logger.error(`[dispatch] sub=${sub.id} Telegram failed`, e);
            errors.push(`Telegram: ${msg(e)}`);
          } finally {
            if (holdLock && deps.groupLock) {
              try {
                await deps.groupLock.release(chatId, ownerId);
                logger.info(`[dispatch] sub=${sub.id} lock released`);
              } catch (e) {
                logger.warn(`[dispatch] sub=${sub.id} lock release failed (${msg(e)})`);
              }
            }
          }
        }
      }
    }
  }

  const attempts = (Number(sub.deliveryAttempts) || 0) + (errors.length ? 1 : 0);
  const allDone = clickup === 'SENT' && telegram === 'SENT' && errors.length === 0;
  logger.info(
    `[dispatch] sub=${sub.id} result clickup=${clickup} telegram=${telegram} errors=${errors.length} notes=${notes.length} attempts=${attempts}`
  );

  if (allDone) {
    await finish(deps, sub, { clickup, telegram }, undefined, attempts);
    logger.info(`[dispatch] sub=${sub.id} FINISHED`);
    return true;
  }

  const tooOld = nowMs - Date.parse(sub.submittedAt) > WAIT_CAP_MS;
  if (attempts >= MAX_ATTEMPTS || (tooOld && errors.length === 0)) {
    const reason = [...errors, ...notes].join('; ') || 'Gave up';
    await finish(deps, sub, { clickup, telegram }, reason, attempts);
    logger.error(`[dispatch] sub=${sub.id} GIVING UP after ${attempts} attempts: ${reason}`);
    return true;
  }

  const delay = errors.length ? retryDelayMs(attempts) : WAIT_RECHECK_MS;
  const nextAttemptAt = new Date(nowMs + delay).toISOString();
  logger.info(`[dispatch] sub=${sub.id} RETRY scheduled at ${nextAttemptAt}`);
  await repo.updateSubmission(
    sub.id,
    {
      clickupStatus: clickup,
      telegramStatus: telegram,
      deliveryAttempts: attempts,
      deliveryError: [...errors, ...notes].join('; ') || undefined,
      nextAttemptAt,
    },
    ['lockedUntil', ...([...errors, ...notes].length ? [] : ['deliveryError'])]
  );
  return false;
}

async function finish(
  deps: DispatchDeps,
  sub: Row,
  status: { clickup: Channel; telegram: Channel },
  error: string | undefined,
  attempts: number
) {
  const f = (c: Channel): Channel => (c === 'SENT' ? 'SENT' : 'FAILED');
  logger.info(
    `[dispatch] finish sub=${sub.id} clickup=${f(status.clickup)} telegram=${f(status.telegram)} error=${error ?? 'none'}`
  );
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
  logger.error(`[dispatch] recordUnexpectedFailure sub=${sub.id} attempts=${attempts}: ${error}`);
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

export async function defaultDispatchDeps(): Promise<DispatchDeps> {
  logger.info('[dispatch] defaultDispatchDeps — building deps');
  const repo = await import('../repositories/dynamo.jobcardflow.repository');
  const certificateDeps = {
    repo,
    now: () => new Date(),
    render: renderCertificatePdf,
    upload: uploadCertificatePdf,
  };
  const groupLock = await getDefaultGroupLock();
  logger.info('[dispatch] defaultDispatchDeps — groupLock ready');
  return {
    repo,
    now: () => new Date(),
    groupLock,
    sendTelegram: async (chatId, text) => {
      const { getTelegramService } = await import('./telegram.service');
      return getTelegramService().sendMessage(text, chatId, { maxRetries: 1 });
    },
    postClickUpComment: async (taskId, text) => {
      const { addClickUpComment } = await import('./xero.quote.service');
      await addClickUpComment(taskId, text);
    },
    loadPhoto: async (key, label) => {
      const { loadJobCardPhoto } = await import('./jobcard.photos.service');
      return loadJobCardPhoto(key, label);
    },
    sendTelegramPhotos: async (chatId, photos) => {
      const { getTelegramService } = await import('./telegram.service');
      return getTelegramService().sendPhotos(chatId, photos);
    },
    attachClickUpFile: async (taskId, photo) => {
      const { uploadBufferToClickUpTask } = await import('./xero.quote.service');
      await uploadBufferToClickUpTask(taskId, photo.data, photo.filename);
    },
    issueCertificate: certificatesEnabled()
      ? (scaleId, jobCard) => issueCertificateIfReady(scaleId, jobCard, certificateDeps)
      : undefined,
  };
}

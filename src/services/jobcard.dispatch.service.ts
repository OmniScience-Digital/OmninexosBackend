// src/services/jobcard.dispatch.service.ts
import logger from '../utils/logger';
import { certificatesEnabled, CALIBRATION_TYPES } from '../helper/jobcard/jobcard.config';
import {
  clampEnd,
  mergedMinutesTotal,
  isOpen,
  minutesBetween,
  planStop,
} from '../helper/jobcard/timeTracking';
import {
  countPhotos,
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
  | 'listJobCardsAwaitingWrapUp'
  | 'setJobCardFields'
  | 'listPendingSubmissions'
  | 'listSubmissionsByDeliveryState'
  | 'listFailedSubmissionsSince'
  | 'getSubmission'
  | 'claimSubmission'
  | 'updateSubmission'
  | 'listSubmissionsByModule'
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
  sendTelegramPdf?: (
    chatId: string,
    pdf: Buffer,
    filename: string,
    caption: string
  ) => Promise<boolean>;
  groupLock?: GroupLock;
  issueCertificate?: (scaleId: string, jobCard: Row) => Promise<unknown>;
}

export const MAX_ATTEMPTS = 8;
export const WAIT_CAP_MS = 7 * 24 * 3600_000;
const WAIT_RECHECK_MS = 2 * 60_000;
const LEASE_MS = 2 * 60_000;
const GROUP_LOCK_TTL_MS = 10 * 60_000;

export const HOLD_MAX_AGE_MS = 30 * 60_000;
export const AUTO_RETRY_COOLDOWN_MS = 60 * 60_000;
export const AUTO_RETRY_MAX_AGE_MS = 24 * 60 * 60_000;

const CLICKUP_STORAGE_ERROR = 'GBUSED_005';
const CLICKUP_PERMANENT_ERRORS = ['ACCESS_083', 'OAUTH_0', 'TOKEN_0'] as const;
const isPermanentClickUpError = (message: string): boolean =>
  CLICKUP_PERMANENT_ERRORS.some((code) => message.includes(code));

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

interface SubmissionOutcome {
  finished: boolean;
  telegramDone: boolean;
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

  const jobCards = new Map<string, Promise<Row | null>>();
  const orderKey = async (sub: Row): Promise<string> => {
    if (!jobCards.has(sub.jobCardId)) jobCards.set(sub.jobCardId, repo.getJobCard(sub.jobCardId));
    const jc = await jobCards.get(sub.jobCardId)!;
    return jc?.telegramGroupId ? `group:${jc.telegramGroupId}` : `jc:${sub.jobCardId}`;
  };
  const held = new Set<string>();

  for (const sub of pending.slice(0, batch)) {
    const telegramDoneInDb = sub.telegramStatus === 'SENT';
    const key = await orderKey(sub);

    logger.info(
      `[dispatch] examine sub=${sub.id} jc=${sub.jobCardId} submittedAt=${sub.submittedAt} nextAttemptAt=${sub.nextAttemptAt ?? 'none'} telegramStatus=${sub.telegramStatus} clickupStatus=${sub.clickupStatus}`
    );

    if (!telegramDoneInDb && held.has(key)) {
      logger.info(`[dispatch] sub=${sub.id} waits behind an earlier result for ${key} — skip`);
      continue;
    }

    if (sub.nextAttemptAt && Date.parse(sub.nextAttemptAt) > nowMs) {
      const ageMs = nowMs - Date.parse(String(sub.submittedAt ?? ''));
      const ageText = Number.isFinite(ageMs) ? `${Math.round(ageMs / 60_000)}min` : '?';
      if (!telegramDoneInDb && ageMs < HOLD_MAX_AGE_MS) {
        held.add(key);
        logger.info(`[dispatch] sub=${sub.id} not due yet (age ${ageText}) — holding ${key}`);
      } else {
        logger.warn(
          `[dispatch] sub=${sub.id} not due yet but age ${ageText} ≥ ${Math.round(
            HOLD_MAX_AGE_MS / 60_000
          )}min — releasing order on ${key}`
        );
      }
      continue;
    }

    const claimed = await repo.claimSubmission(sub.id, nowMs, LEASE_MS);
    if (!claimed) {
      if (!telegramDoneInDb) {
        const ageMs = nowMs - Date.parse(String(sub.submittedAt ?? ''));
        if (ageMs < HOLD_MAX_AGE_MS) {
          held.add(key);
        } else {
          logger.warn(
            `[dispatch] sub=${sub.id} claim failed but age ≥ ${Math.round(
              HOLD_MAX_AGE_MS / 60_000
            )}min — not holding ${key}`
          );
        }
      }
      logger.info(`[dispatch] sub=${sub.id} claim failed (another worker has it)`);
      continue;
    }
    logger.info(`[dispatch] claim sub=${sub.id} => true`);

    summary.handled += 1;
    try {
      const outcome = await processSubmission(deps, sub, stopTimer);
      logger.info(
        `[dispatch] processSubmission sub=${sub.id} => finished=${outcome.finished} telegramDone=${outcome.telegramDone}`
      );

      if (outcome.finished) {
        summary.finished += 1;
        continue;
      }

      summary.retrying += 1;
      if (!outcome.telegramDone) {
        const ageMs = nowMs - Date.parse(String(sub.submittedAt ?? ''));
        if (ageMs < HOLD_MAX_AGE_MS) {
          held.add(key);
        } else {
          logger.warn(
            `[dispatch] sub=${sub.id} failed but age ≥ ${Math.round(
              HOLD_MAX_AGE_MS / 60_000
            )}min — not holding ${key}`
          );
        }
      }
    } catch (e) {
      logger.error(`[dispatch] sub=${sub.id} unexpected failure: ${msg(e)}`, e);
      const finished = await recordUnexpectedFailure(deps, sub, msg(e));
      logger.info(`[dispatch] recordUnexpectedFailure sub=${sub.id} => finished=${finished}`);
      if (finished) {
        summary.finished += 1;
        continue;
      }
      summary.retrying += 1;
      const ageMs = nowMs - Date.parse(String(sub.submittedAt ?? ''));
      if (ageMs < HOLD_MAX_AGE_MS) {
        held.add(key);
      } else {
        logger.warn(
          `[dispatch] sub=${sub.id} unexpected failure but age ≥ ${Math.round(
            HOLD_MAX_AGE_MS / 60_000
          )}min — not holding ${key}`
        );
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
  await repo.setJobCardTotal(jobCardId, mergedMinutesTotal(await repo.listTimeEntries(jobCardId)));
  logger.info(`[dispatch] stopTimer jc=${jobCardId} stopped (${plan.reason})`);
}

/**
 * Requeue FAILED submissions.
 *
 * - Automatic path: query the deliveryState GSI with a `submittedAt >= cutoff`
 *   range so the query returns only FAILED rows still within the retry window.
 *   Without this range, old FAILED rows fill the page and newer FAILED rows
 *   are never seen once 100+ old rows exist.
 * - `force` widens the cutoff to epoch (manual override).
 * - `submissionId` short-circuits to a single GetItem (explicit intent, no
 *   time gate).
 */
export async function requeueFailedSubmissions(
  deps: Pick<DispatchDeps, 'repo' | 'now'>,
  opts: { jobCardId?: string; submissionId?: string; force?: boolean } = {}
): Promise<number> {
  const { repo, now } = deps;
  const nowMs = now().getTime();
  const nowIso = now().toISOString();

  if (opts.submissionId) {
    const sub = await repo.getSubmission(opts.submissionId);
    if (!sub || sub.deliveryState !== 'FAILED') return 0;
    await repo.updateSubmission(
      sub.id,
      {
        deliveryState: 'PENDING',
        clickupStatus: sub.clickupStatus === 'SENT' ? 'SENT' : 'PENDING',
        telegramStatus: sub.telegramStatus === 'SENT' ? 'SENT' : 'PENDING',
        deliveryAttempts: 0,
        nextAttemptAt: nowIso,
      },
      ['deliveryError', 'deliveredAt', 'lockedUntil']
    );
    logger.info(`[dispatch] requeued sub=${sub.id} jc=${sub.jobCardId} (targeted)`);
    return 1;
  }

  const cutoffIso = opts.force
    ? new Date(0).toISOString()
    : new Date(nowMs - AUTO_RETRY_MAX_AGE_MS).toISOString();
  const failures = await repo.listFailedSubmissionsSince(cutoffIso, 100);
  logger.info(
    `[dispatch] requeue candidates=${failures.length} cutoff=${cutoffIso} force=${!!opts.force}`
  );

  let count = 0;
  for (const sub of failures) {
    if (opts.jobCardId && sub.jobCardId !== opts.jobCardId) continue;
    if (!opts.force) {
      const delivered = Date.parse(String(sub.deliveredAt ?? sub.updatedAt ?? ''));
      if (!Number.isFinite(delivered) || nowMs - delivered < AUTO_RETRY_COOLDOWN_MS) continue;
    }
    await repo.updateSubmission(
      sub.id,
      {
        deliveryState: 'PENDING',
        clickupStatus: sub.clickupStatus === 'SENT' ? 'SENT' : 'PENDING',
        telegramStatus: sub.telegramStatus === 'SENT' ? 'SENT' : 'PENDING',
        deliveryAttempts: 0,
        nextAttemptAt: nowIso,
      },
      ['deliveryError', 'deliveredAt', 'lockedUntil']
    );
    logger.info(`[dispatch] requeued sub=${sub.id} jc=${sub.jobCardId} force=${!!opts.force}`);
    count += 1;
  }
  return count;
}

async function processSubmission(
  deps: DispatchDeps,
  sub: Row,
  stopTimer: (id: string) => Promise<void>
): Promise<SubmissionOutcome> {
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
    return { finished: true, telegramDone: false };
  }

  const errors: string[] = [];
  const notes: string[] = [];

  try {
    await stopTimer(jobCard.id);
  } catch (e) {
    logger.error(`[dispatch] sub=${sub.id} timer stop failed: ${msg(e)}`, e);
    errors.push(`Timer: ${msg(e)}`);
  }

  if (deps.issueCertificate && (CALIBRATION_TYPES as readonly string[]).includes(sub.moduleType)) {
    try {
      logger.info(`[dispatch] sub=${sub.id} issuing certificate`);
      await deps.issueCertificate(sub.scaleId, jobCard);
    } catch (e) {
      logger.error(`[dispatch] sub=${sub.id} certificate failed: ${msg(e)}`, e);
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
    const payload = parsePayload(sub.payload);
    const payloadPhotos = countPhotos(payload);

    const photos = deps.loadPhoto
      ? photoEntries(payload, {
          scaleName: text.scaleName,
          submittedAt: sub.submittedAt,
        })
      : [];
    logger.info(
      `[dispatch] sub=${sub.id} loadPhoto=${deps.loadPhoto ? 'wired' : 'MISSING'} photos=${photos.length} payloadPhotos=${payloadPhotos} keys=[${photos.map((p) => p.key).join(', ')}]`
    );
    logger.info(
      `[dispatch] sub=${sub.id} photo labels=[${photos.map((p) => p.label).join(' | ')}]`
    );
    if (photos.length === 0 && payloadPhotos > 0) {
      logger.error(
        `[dispatch] sub=${sub.id} payload has ${payloadPhotos} photo entries but photoEntries returned 0`
      );
      errors.push(`Photos: ${payloadPhotos} declared in payload but none could be listed`);
    }

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
          logger.warn(`[dispatch] sub=${sub.id} photo missing for key=${p.key}: ${msg(e)}`);
          return null;
        }
        logger.error(`[dispatch] sub=${sub.id} photo load threw for key=${p.key}: ${msg(e)}`, e);
        throw e;
      }
    };

    if (clickup !== 'SENT') {
      if (!jobCard.clickupTaskId) {
        logger.info(`[dispatch] sub=${sub.id} no ClickUp task — waiting`);
        waiting = true;
        notes.push('No ClickUp task on the job card yet');
      } else if (photos.length > 0 && !deps.attachClickUpFile) {
        logger.error(
          `[dispatch] sub=${sub.id} attachClickUpFile is NOT wired — refusing to mark ClickUp SENT`
        );
        errors.push('ClickUp: attachClickUpFile is not wired');
        clickup = 'FAILED';
      } else {
        try {
          logger.info(
            `[dispatch] sub=${sub.id} ClickUp taskId=${jobCard.clickupTaskId} attachClickUpFile=${deps.attachClickUpFile ? 'wired' : 'MISSING'}`
          );
          if (!(sub.clickupTextSent === true)) {
            logger.info(`[dispatch] sub=${sub.id} sending ClickUp text`);
            await deps.postClickUpComment(jobCard.clickupTaskId, text.clickup);
            await saveProgress({ clickupTextSent: true });
          } else {
            logger.info(`[dispatch] sub=${sub.id} ClickUp text already sent — skipping`);
          }

          const done = new Set<string>(sub.clickupPhotosSent ?? []);
          logger.info(
            `[dispatch] sub=${sub.id} ClickUp photos already sent=${done.size} of ${photos.length}`
          );

          let clickupPhotosOk = true;
          let permanentClickupError: string | null = null;

          for (const p of photos) {
            if (done.has(p.key)) {
              logger.info(
                `[dispatch] sub=${sub.id} ClickUp photo key=${p.key} already sent — skip`
              );
              continue;
            }
            logger.info(
              `[dispatch] sub=${sub.id} ClickUp loading photo key=${p.key} label=${p.label}`
            );
            const file = await loadOne(p);
            if (!file) {
              logger.error(
                `[dispatch] sub=${sub.id} ClickUp photo key=${p.key} unavailable — permanently skipping`
              );
              done.add(p.key);
              await saveProgress({ clickupPhotosSent: [...done] });
              continue;
            }
            logger.info(
              `[dispatch] sub=${sub.id} ClickUp uploading key=${p.key} file=${file.filename} bytes=${file.data?.length ?? '?'}`
            );
            try {
              await deps.attachClickUpFile!(jobCard.clickupTaskId, file);
            } catch (uploadError) {
              const errorMessage = msg(uploadError);
              if (errorMessage.includes(CLICKUP_STORAGE_ERROR)) {
                logger.warn(
                  `[dispatch] sub=${sub.id} ClickUp storage quota exhausted (${CLICKUP_STORAGE_ERROR}); ` +
                    `skipping ClickUp photo key=${p.key} — Telegram delivery will continue`
                );
                clickupPhotosOk = false;
                notes.push('ClickUp storage quota exhausted — some photos not uploaded');
                continue;
              }
              if (isPermanentClickUpError(errorMessage)) {
                logger.error(
                  `[dispatch] sub=${sub.id} ClickUp PERMANENT error for key=${p.key}: ${errorMessage}`
                );
                clickupPhotosOk = false;
                permanentClickupError = errorMessage;
                break;
              }
              logger.error(
                `[dispatch] sub=${sub.id} ClickUp upload failed key=${p.key}: ${errorMessage}`,
                uploadError
              );
              throw uploadError;
            }
            logger.info(`[dispatch] sub=${sub.id} ClickUp uploaded key=${p.key}`);
            done.add(p.key);
            await saveProgress({ clickupPhotosSent: [...done] });
          }

          if (permanentClickupError) {
            errors.push(`ClickUp: ${permanentClickupError}`);
            clickup = 'FAILED';
            logger.error(
              `[dispatch] sub=${sub.id} ClickUp FAILED (permanent) after photos=${done.size}/${photos.length}`
            );
          } else if (clickupPhotosOk) {
            clickup = 'SENT';
            logger.info(
              `[dispatch] sub=${sub.id} ClickUp SENT (photos=${done.size}/${photos.length})`
            );
          } else {
            clickup = 'SENT';
            logger.warn(
              `[dispatch] sub=${sub.id} ClickUp SENT with skipped photos (photos=${done.size}/${photos.length})`
            );
          }
        } catch (e) {
          logger.error(`[dispatch] sub=${sub.id} ClickUp failed: ${msg(e)}`, e);
          errors.push(`ClickUp: ${msg(e)}`);
        }
      }
    }

    if (telegram !== 'SENT') {
      if (photos.length > 0 && !deps.sendTelegramPhotos) {
        logger.error(
          `[dispatch] sub=${sub.id} sendTelegramPhotos is NOT wired — refusing to mark Telegram SENT`
        );
        errors.push('Telegram: sendTelegramPhotos is not wired');
        telegram = 'FAILED';
      } else {
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
              for (let i = 0; i < todo.length; i += 10) {
                const chunk = todo.slice(i, i + 10);
                const files: (LoadedPhoto & { caption?: string })[] = [];
                for (const p of chunk) {
                  const file = await loadOne(p);
                  if (file) files.push({ ...file, caption: p.label });
                }
                logger.info(`[dispatch] sub=${sub.id} sending photo album size=${files.length}`);
                if (files.length) {
                  await deps.sendTelegramPhotos!(chatId, files);
                  for (const p of chunk) done.add(p.key);
                  await saveProgress({ telegramPhotosSent: [...done] });
                } else {
                  throw new Error(
                    `photos declared in payload could not be loaded (${chunk.length} in this chunk)`
                  );
                }
              }
              telegram = 'SENT';
              logger.info(`[dispatch] sub=${sub.id} Telegram SENT`);
            } catch (e) {
              logger.error(`[dispatch] sub=${sub.id} Telegram failed: ${msg(e)}`, e);
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
  }

  const attempts = (Number(sub.deliveryAttempts) || 0) + (errors.length ? 1 : 0);
  const allDone = clickup === 'SENT' && telegram === 'SENT' && errors.length === 0;
  const telegramDone = telegram === 'SENT';

  logger.info(
    `[dispatch] sub=${sub.id} result clickup=${clickup} telegram=${telegram} errors=${errors.length} notes=${notes.length} attempts=${attempts}`
  );

  if (allDone) {
    await finish(
      deps,
      sub,
      { clickup, telegram },
      notes.length ? notes.join('; ') : undefined,
      attempts
    );
    logger.info(`[dispatch] sub=${sub.id} FINISHED`);
    return { finished: true, telegramDone: true };
  }

  const tooOld = nowMs - Date.parse(sub.submittedAt) > WAIT_CAP_MS;
  if (attempts >= MAX_ATTEMPTS || (tooOld && errors.length === 0)) {
    const reason = [...errors, ...notes].join('; ') || 'Gave up';
    await finish(deps, sub, { clickup, telegram }, reason, attempts);
    logger.error(`[dispatch] sub=${sub.id} GIVING UP after ${attempts} attempts: ${reason}`);
    return { finished: true, telegramDone };
  }

  const delay = errors.length ? retryDelayMs(attempts) : WAIT_RECHECK_MS;
  const nextAttemptAt = new Date(nowMs + delay).toISOString();
  logger.info(
    `[dispatch] sub=${sub.id} RETRY scheduled at ${nextAttemptAt} telegram=${telegram} clickup=${clickup} errors=[${errors.join(' | ') || 'none'}] notes=[${notes.join(' | ') || 'none'}]`
  );
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
  return { finished: false, telegramDone };
}

async function finish(
  deps: DispatchDeps,
  sub: Row,
  status: { clickup: Channel; telegram: Channel },
  error: string | undefined,
  attempts: number
) {
  const f = (c: Channel): Channel => (c === 'SENT' ? 'SENT' : 'FAILED');
  const finalClickup = f(status.clickup);
  const finalTelegram = f(status.telegram);
  const allSent = finalClickup === 'SENT' && finalTelegram === 'SENT';

  logger.info(
    `[dispatch] finish sub=${sub.id} clickup=${finalClickup} telegram=${finalTelegram} deliveryState=${
      allSent ? 'SENT' : 'FAILED'
    } error=${error ?? 'none'}`
  );
  await deps.repo.updateSubmission(
    sub.id,
    {
      clickupStatus: finalClickup,
      telegramStatus: finalTelegram,
      deliveryState: allSent ? 'SENT' : 'FAILED',
      deliveryAttempts: attempts,
      deliveredAt: deps.now().toISOString(),
      deliveryError: error,
    },
    ['lockedUntil', 'nextAttemptAt', ...(error ? [] : ['deliveryError'])]
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
): Promise<{ telegram: string; clickup: string; scaleName: string }> {
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
    submittedByName:
      (parsePayload(sub.payload).submittedByName as string | undefined) ??
      entries.find((e: any) => e.userId === sub.submittedBy)?.userName,
    revision: Number(parsePayload(sub.payload).revision) || undefined,
    payload: parsePayload(sub.payload),
  };
  return {
    telegram: formatForTelegram(ctx),
    clickup: formatForClickUp(ctx),
    scaleName: ctx.scaleName,
  };
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
      return getTelegramService().sendPhotos(chatId, photos, { maxRetries: 3 });
    },
    sendTelegramPdf: async (chatId, pdf, filename, caption) => {
      const { getTelegramService } = await import('./telegram.service');
      return getTelegramService().sendPdf(pdf, chatId, { filename, caption, maxRetries: 1 });
    },
    attachClickUpFile: async (taskId, photo) => {
      logger.info(
        `[dispatch] attachClickUpFile → taskId=${taskId} file=${photo.filename} bytes=${photo.data?.length ?? '?'}`
      );
      const { uploadBufferToClickUpTask } = await import('./xero.quote.service');
      await uploadBufferToClickUpTask(taskId, photo.data, photo.filename);
    },
    issueCertificate: certificatesEnabled()
      ? (scaleId, jobCard) => issueCertificateIfReady(scaleId, jobCard, certificateDeps)
      : undefined,
  };
}

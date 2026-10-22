// src/services/jobcard.dispatch.service.ts
import logger from "../utils/logger.js";
import { certificatesEnabled, CALIBRATION_TYPES } from "../helper/jobcard/jobcard.config.js";
import { clampEnd, closedMinutesTotal, isOpen, minutesBetween, planStop, } from "../helper/jobcard/timeTracking.js";
import { formatForClickUp, formatForTelegram, photoEntries, } from "../helper/jobcard/resultFormat.js";
import { PhotoMissingError } from "./jobcard.photos.service.js";
import { issueCertificateIfReady, renderCertificatePdf, uploadCertificatePdf, } from "./certificate.service.js";
import { getDefaultGroupLock } from "./group-lock.service.js";
export const MAX_ATTEMPTS = 8;
export const WAIT_CAP_MS = 7 * 24 * 3600000;
const WAIT_RECHECK_MS = 2 * 60000;
const LEASE_MS = 2 * 60000;
const GROUP_LOCK_TTL_MS = 10 * 60000;
/** ClickUp error code emitted when the workspace's storage quota is exhausted. */
const CLICKUP_STORAGE_ERROR = "GBUSED_005";
export const retryDelayMs = (attempts) => Math.min(2 ** Math.max(0, attempts - 1), 60) * 60000;
const msg = (e) => (e instanceof Error ? e.message : String(e));
const parsePayload = (p) => {
    try {
        const v = typeof p === "string" ? JSON.parse(p) : p;
        return v && typeof v === "object" ? v : {};
    }
    catch {
        return {};
    }
};
logger.info("[dispatch] module loaded");
export async function processPendingSubmissions(deps, batch = 25) {
    const { repo } = deps;
    const nowMs = deps.now().getTime();
    logger.info(`[dispatch] processPendingSubmissions start, batch=${batch}`);
    const raw = await repo.listPendingSubmissions(100);
    logger.info(`[dispatch] listPendingSubmissions returned ${raw.length} rows`);
    const pending = raw.sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt));
    const summary = {
        examined: pending.length,
        handled: 0,
        finished: 0,
        retrying: 0,
    };
    const stopped = new Map();
    const stopTimer = (jobCardId) => {
        if (!stopped.has(jobCardId))
            stopped.set(jobCardId, stopTimerIfComplete(deps, jobCardId));
        return stopped.get(jobCardId);
    };
    for (const sub of pending.slice(0, batch)) {
        const telegramDoneInDb = sub.telegramStatus === "SENT";
        logger.info(`[dispatch] examine sub=${sub.id} jc=${sub.jobCardId} submittedAt=${sub.submittedAt} nextAttemptAt=${sub.nextAttemptAt ?? "none"} telegramStatus=${sub.telegramStatus} clickupStatus=${sub.clickupStatus}`);
        if (sub.nextAttemptAt && Date.parse(sub.nextAttemptAt) > nowMs) {
            if (telegramDoneInDb) {
                logger.info(`[dispatch] sub=${sub.id} not due, telegram=SENT — skip (ClickUp-only retry)`);
                continue;
            }
            logger.info(`[dispatch] sub=${sub.id} not due, telegram pending — break (preserve order)`);
            break;
        }
        const claimed = await repo.claimSubmission(sub.id, nowMs, LEASE_MS);
        if (!claimed) {
            if (telegramDoneInDb) {
                logger.info(`[dispatch] sub=${sub.id} claim failed, telegram=SENT — skip`);
                continue;
            }
            logger.info(`[dispatch] sub=${sub.id} claim failed, telegram pending — break (preserve order)`);
            break;
        }
        logger.info(`[dispatch] claim sub=${sub.id} => true`);
        summary.handled += 1;
        try {
            const outcome = await processSubmission(deps, sub, stopTimer);
            logger.info(`[dispatch] processSubmission sub=${sub.id} => finished=${outcome.finished} telegramDone=${outcome.telegramDone}`);
            if (outcome.finished) {
                summary.finished += 1;
                continue;
            }
            summary.retrying += 1;
            if (outcome.telegramDone) {
                logger.info(`[dispatch] sub=${sub.id} retrying (Telegram done, ClickUp pending) — continue`);
                continue;
            }
            logger.info(`[dispatch] sub=${sub.id} retrying (Telegram pending) — break (preserve order)`);
            break;
        }
        catch (e) {
            logger.error(`[dispatch] sub=${sub.id} unexpected failure: ${msg(e)}`, e);
            const finished = await recordUnexpectedFailure(deps, sub, msg(e));
            logger.info(`[dispatch] recordUnexpectedFailure sub=${sub.id} => finished=${finished}`);
            if (finished) {
                summary.finished += 1;
                continue;
            }
            summary.retrying += 1;
            logger.info(`[dispatch] sub=${sub.id} retrying after exception — break (preserve order)`);
            break;
        }
    }
    logger.info(`[dispatch] summary ${JSON.stringify(summary)}`);
    return summary;
}
export async function stopTimerIfComplete(deps, jobCardId) {
    const { repo } = deps;
    const [items, entries] = await Promise.all([
        repo.listModules(jobCardId),
        repo.listTimeEntries(jobCardId),
    ]);
    const plan = planStop(items.map((i) => ({ status: i.status, submittedAt: i.submittedAt })), entries, deps.now().toISOString());
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
async function processSubmission(deps, sub, stopTimer) {
    const { repo } = deps;
    const nowMs = deps.now().getTime();
    logger.info(`[dispatch] processSubmission start sub=${sub.id}`);
    const jobCard = await repo.getJobCard(sub.jobCardId);
    if (!jobCard) {
        logger.error(`[dispatch] sub=${sub.id} job card ${sub.jobCardId} not found — failing`);
        await finish(deps, sub, { clickup: "FAILED", telegram: "FAILED" }, "Job card not found", Number(sub.deliveryAttempts) || 0);
        return { finished: true, telegramDone: false };
    }
    const errors = [];
    const notes = [];
    try {
        await stopTimer(jobCard.id);
    }
    catch (e) {
        logger.error(`[dispatch] sub=${sub.id} timer stop failed: ${msg(e)}`, e);
        errors.push(`Timer: ${msg(e)}`);
    }
    if (deps.issueCertificate && CALIBRATION_TYPES.includes(sub.moduleType)) {
        try {
            logger.info(`[dispatch] sub=${sub.id} issuing certificate`);
            await deps.issueCertificate(sub.scaleId, jobCard);
        }
        catch (e) {
            logger.error(`[dispatch] sub=${sub.id} certificate failed: ${msg(e)}`, e);
            errors.push(`Certificate: ${msg(e)}`);
        }
    }
    let clickup = sub.clickupStatus === "SENT" ? "SENT" : "PENDING";
    let telegram = sub.telegramStatus === "SENT" ? "SENT" : "PENDING";
    let waiting = false;
    const progress = {};
    logger.info(`[dispatch] sub=${sub.id} initial clickup=${clickup} telegram=${telegram}`);
    if (clickup !== "SENT" || telegram !== "SENT") {
        logger.info(`[dispatch] sub=${sub.id} building texts`);
        // buildTexts also returns the scale name so photo labels can include it.
        const text = await buildTexts(deps, sub, jobCard);
        // Photo labels carry scale name + submission date, e.g.
        //   "Actual — Avery 1064 — 22 Oct 2026"
        const photos = deps.loadPhoto
            ? photoEntries(parsePayload(sub.payload), {
                scaleName: text.scaleName,
                submittedAt: sub.submittedAt,
            })
            : [];
        logger.info(`[dispatch] sub=${sub.id} loadPhoto=${deps.loadPhoto ? "wired" : "MISSING"} photos=${photos.length} keys=[${photos.map((p) => p.key).join(", ")}]`);
        logger.info(`[dispatch] sub=${sub.id} photo labels=[${photos.map((p) => p.label).join(" | ")}]`);
        if (photos.length === 0) {
            logger.warn(`[dispatch] sub=${sub.id} payload has no photo entries — nothing will be uploaded`);
        }
        const saveProgress = async (patch) => {
            Object.assign(progress, patch);
            await repo.updateSubmission(sub.id, patch);
            logger.info(`[dispatch] sub=${sub.id} progress saved ${JSON.stringify(Object.keys(patch))}`);
        };
        const loadOne = async (p) => {
            try {
                return await deps.loadPhoto(p.key, p.label);
            }
            catch (e) {
                if (e instanceof PhotoMissingError) {
                    logger.warn(`[dispatch] sub=${sub.id} photo missing for key=${p.key}: ${msg(e)}`);
                    return null;
                }
                logger.error(`[dispatch] sub=${sub.id} photo load threw for key=${p.key}: ${msg(e)}`, e);
                throw e;
            }
        };
        if (clickup !== "SENT") {
            if (!jobCard.clickupTaskId) {
                logger.info(`[dispatch] sub=${sub.id} no ClickUp task — waiting`);
                waiting = true;
                notes.push("No ClickUp task on the job card yet");
            }
            else {
                let clickupPhotosOk = true;
                try {
                    logger.info(`[dispatch] sub=${sub.id} ClickUp taskId=${jobCard.clickupTaskId} attachClickUpFile=${deps.attachClickUpFile ? "wired" : "MISSING"}`);
                    if (!(sub.clickupTextSent === true)) {
                        logger.info(`[dispatch] sub=${sub.id} sending ClickUp text`);
                        await deps.postClickUpComment(jobCard.clickupTaskId, text.clickup);
                        await saveProgress({ clickupTextSent: true });
                    }
                    else {
                        logger.info(`[dispatch] sub=${sub.id} ClickUp text already sent — skipping`);
                    }
                    if (!deps.attachClickUpFile) {
                        logger.warn(`[dispatch] sub=${sub.id} attachClickUpFile is NOT wired — photos will be skipped entirely`);
                    }
                    const done = new Set(sub.clickupPhotosSent ?? []);
                    logger.info(`[dispatch] sub=${sub.id} ClickUp photos already sent=${done.size} of ${photos.length}`);
                    for (const p of photos) {
                        if (done.has(p.key)) {
                            logger.info(`[dispatch] sub=${sub.id} ClickUp photo key=${p.key} already sent — skip`);
                            continue;
                        }
                        if (!deps.attachClickUpFile) {
                            logger.warn(`[dispatch] sub=${sub.id} ClickUp photo key=${p.key} skipped — no attachClickUpFile wired`);
                            continue;
                        }
                        logger.info(`[dispatch] sub=${sub.id} ClickUp loading photo key=${p.key} label=${p.label}`);
                        const file = await loadOne(p);
                        if (!file) {
                            logger.error(`[dispatch] sub=${sub.id} ClickUp photo key=${p.key} unavailable — permanently skipping`);
                            done.add(p.key);
                            await saveProgress({ clickupPhotosSent: [...done] });
                            continue;
                        }
                        logger.info(`[dispatch] sub=${sub.id} ClickUp uploading key=${p.key} file=${file.filename} bytes=${file.data?.length ?? "?"}`);
                        try {
                            await deps.attachClickUpFile(jobCard.clickupTaskId, file);
                        }
                        catch (uploadError) {
                            const errorMessage = msg(uploadError);
                            if (errorMessage.includes(CLICKUP_STORAGE_ERROR)) {
                                logger.warn(`[dispatch] sub=${sub.id} ClickUp storage quota exhausted (${CLICKUP_STORAGE_ERROR}); ` +
                                    `skipping ClickUp photo key=${p.key} — Telegram delivery will continue`);
                                clickupPhotosOk = false;
                                notes.push("ClickUp storage quota exhausted \u2014 some photos not uploaded");
                                continue;
                            }
                            logger.error(`[dispatch] sub=${sub.id} ClickUp upload failed key=${p.key}: ${errorMessage}`, uploadError);
                            throw uploadError;
                        }
                        logger.info(`[dispatch] sub=${sub.id} ClickUp uploaded key=${p.key}`);
                        done.add(p.key);
                        await saveProgress({ clickupPhotosSent: [...done] });
                    }
                    if (clickupPhotosOk) {
                        clickup = "SENT";
                        logger.info(`[dispatch] sub=${sub.id} ClickUp SENT (photos=${done.size}/${photos.length})`);
                    }
                    else {
                        clickup = "SENT";
                        logger.warn(`[dispatch] sub=${sub.id} ClickUp SENT with skipped photos (photos=${done.size}/${photos.length})`);
                    }
                }
                catch (e) {
                    logger.error(`[dispatch] sub=${sub.id} ClickUp failed: ${msg(e)}`, e);
                    errors.push(`ClickUp: ${msg(e)}`);
                }
            }
        }
        if (telegram !== "SENT") {
            const group = jobCard.telegramGroupId
                ? await repo.getTelegramGroup(jobCard.telegramGroupId)
                : null;
            if (!group || group.active === false) {
                logger.info(`[dispatch] sub=${sub.id} no active Telegram group — waiting`);
                waiting = true;
                notes.push(group ? "The linked Telegram group is inactive" : "No Telegram group linked yet");
            }
            else {
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
                            notes.push("Another dispatcher is delivering to this group");
                        }
                    }
                    catch (e) {
                        logger.warn(`[dispatch] sub=${sub.id} lock unavailable (${msg(e)}) — proceeding without lock`);
                        shouldProceed = true;
                        holdLock = false;
                    }
                }
                else {
                    logger.warn(`[dispatch] sub=${sub.id} no groupLock provided — cross-instance ordering OFF`);
                }
                if (shouldProceed) {
                    try {
                        if (!(sub.telegramTextSent === true)) {
                            logger.info(`[dispatch] sub=${sub.id} sending Telegram text`);
                            if (!(await deps.sendTelegram(chatId, text.telegram)))
                                throw new Error("message was not accepted");
                            await saveProgress({ telegramTextSent: true });
                        }
                        else {
                            logger.info(`[dispatch] sub=${sub.id} Telegram text already sent — skipping`);
                        }
                        const done = new Set(sub.telegramPhotosSent ?? []);
                        const todo = photos.filter((p) => !done.has(p.key));
                        logger.info(`[dispatch] sub=${sub.id} Telegram photos to send=${todo.length}`);
                        for (let i = 0; i < todo.length && deps.sendTelegramPhotos; i += 10) {
                            const chunk = todo.slice(i, i + 10);
                            const files = [];
                            for (const p of chunk) {
                                const file = await loadOne(p);
                                if (file)
                                    files.push({ ...file, caption: p.label });
                            }
                            logger.info(`[dispatch] sub=${sub.id} sending photo album size=${files.length}`);
                            if (files.length && !(await deps.sendTelegramPhotos(chatId, files)))
                                throw new Error("photos were not accepted");
                            for (const p of chunk)
                                done.add(p.key);
                            await saveProgress({ telegramPhotosSent: [...done] });
                        }
                        telegram = "SENT";
                        logger.info(`[dispatch] sub=${sub.id} Telegram SENT`);
                    }
                    catch (e) {
                        logger.error(`[dispatch] sub=${sub.id} Telegram failed: ${msg(e)}`, e);
                        errors.push(`Telegram: ${msg(e)}`);
                    }
                    finally {
                        if (holdLock && deps.groupLock) {
                            try {
                                await deps.groupLock.release(chatId, ownerId);
                                logger.info(`[dispatch] sub=${sub.id} lock released`);
                            }
                            catch (e) {
                                logger.warn(`[dispatch] sub=${sub.id} lock release failed (${msg(e)})`);
                            }
                        }
                    }
                }
            }
        }
    }
    const attempts = (Number(sub.deliveryAttempts) || 0) + (errors.length ? 1 : 0);
    const allDone = clickup === "SENT" && telegram === "SENT" && errors.length === 0;
    const telegramDone = telegram === "SENT";
    logger.info(`[dispatch] sub=${sub.id} result clickup=${clickup} telegram=${telegram} errors=${errors.length} notes=${notes.length} attempts=${attempts}`);
    if (allDone) {
        await finish(deps, sub, { clickup, telegram }, notes.length ? notes.join("; ") : undefined, attempts);
        logger.info(`[dispatch] sub=${sub.id} FINISHED`);
        return { finished: true, telegramDone: true };
    }
    const tooOld = nowMs - Date.parse(sub.submittedAt) > WAIT_CAP_MS;
    if (attempts >= MAX_ATTEMPTS || (tooOld && errors.length === 0)) {
        const reason = [...errors, ...notes].join("; ") || "Gave up";
        await finish(deps, sub, { clickup, telegram }, reason, attempts);
        logger.error(`[dispatch] sub=${sub.id} GIVING UP after ${attempts} attempts: ${reason}`);
        return { finished: true, telegramDone };
    }
    const delay = errors.length ? retryDelayMs(attempts) : WAIT_RECHECK_MS;
    const nextAttemptAt = new Date(nowMs + delay).toISOString();
    logger.info(`[dispatch] sub=${sub.id} RETRY scheduled at ${nextAttemptAt} telegram=${telegram} clickup=${clickup} errors=[${errors.join(" | ") || "none"}] notes=[${notes.join(" | ") || "none"}]`);
    await repo.updateSubmission(sub.id, {
        clickupStatus: clickup,
        telegramStatus: telegram,
        deliveryAttempts: attempts,
        deliveryError: [...errors, ...notes].join("; ") || undefined,
        nextAttemptAt,
    }, ["lockedUntil", ...([...errors, ...notes].length ? [] : ["deliveryError"])]);
    return { finished: false, telegramDone };
}
async function finish(deps, sub, status, error, attempts) {
    const f = (c) => (c === "SENT" ? "SENT" : "FAILED");
    logger.info(`[dispatch] finish sub=${sub.id} clickup=${f(status.clickup)} telegram=${f(status.telegram)} error=${error ?? "none"}`);
    await deps.repo.updateSubmission(sub.id, {
        clickupStatus: f(status.clickup),
        telegramStatus: f(status.telegram),
        deliveryAttempts: attempts,
        deliveredAt: deps.now().toISOString(),
        deliveryError: error,
    }, ["deliveryState", "lockedUntil", "nextAttemptAt", ...(error ? [] : ["deliveryError"])]);
}
async function recordUnexpectedFailure(deps, sub, error) {
    const attempts = (Number(sub.deliveryAttempts) || 0) + 1;
    logger.error(`[dispatch] recordUnexpectedFailure sub=${sub.id} attempts=${attempts}: ${error}`);
    if (attempts >= MAX_ATTEMPTS) {
        await finish(deps, sub, {
            clickup: sub.clickupStatus === "SENT" ? "SENT" : "FAILED",
            telegram: sub.telegramStatus === "SENT" ? "SENT" : "FAILED",
        }, error, attempts);
        return true;
    }
    await deps.repo.updateSubmission(sub.id, {
        deliveryAttempts: attempts,
        deliveryError: error,
        nextAttemptAt: new Date(deps.now().getTime() + retryDelayMs(attempts)).toISOString(),
    }, ["lockedUntil"]);
    return false;
}
async function buildTexts(deps, sub, jobCard) {
    const { repo } = deps;
    const [scale, module, entries] = await Promise.all([
        repo.getScale(sub.scaleId),
        repo.getModule(sub.moduleId),
        repo.listTimeEntries(jobCard.id),
    ]);
    const ctx = {
        jcNumber: jobCard.jcNumber ?? jobCard.id,
        customerName: jobCard.customerName,
        scaleName: scale?.scaleName ?? "Unknown scale",
        moduleType: sub.moduleType,
        sequence: module?.sequence,
        submittedAt: sub.submittedAt,
        submittedByName: entries.find((e) => e.userId === sub.submittedBy)?.userName,
        payload: parsePayload(sub.payload),
    };
    return {
        telegram: formatForTelegram(ctx),
        clickup: formatForClickUp(ctx),
        scaleName: ctx.scaleName,
    };
}
export async function defaultDispatchDeps() {
    logger.info("[dispatch] defaultDispatchDeps \u2014 building deps");
    const repo = await import("../repositories/dynamo.jobcardflow.repository.js");
    const certificateDeps = {
        repo,
        now: () => new Date(),
        render: renderCertificatePdf,
        upload: uploadCertificatePdf,
    };
    const groupLock = await getDefaultGroupLock();
    logger.info("[dispatch] defaultDispatchDeps \u2014 groupLock ready");
    return {
        repo,
        now: () => new Date(),
        groupLock,
        sendTelegram: async (chatId, text) => {
            const { getTelegramService } = await import("./telegram.service.js");
            return getTelegramService().sendMessage(text, chatId, { maxRetries: 1 });
        },
        postClickUpComment: async (taskId, text) => {
            const { addClickUpComment } = await import("./xero.quote.service.js");
            await addClickUpComment(taskId, text);
        },
        loadPhoto: async (key, label) => {
            const { loadJobCardPhoto } = await import("./jobcard.photos.service.js");
            return loadJobCardPhoto(key, label);
        },
        sendTelegramPhotos: async (chatId, photos) => {
            const { getTelegramService } = await import("./telegram.service.js");
            return getTelegramService().sendPhotos(chatId, photos);
        },
        attachClickUpFile: async (taskId, photo) => {
            logger.info(`[dispatch] attachClickUpFile → taskId=${taskId} file=${photo.filename} bytes=${photo.data?.length ?? "?"}`);
            const { uploadBufferToClickUpTask } = await import("./xero.quote.service.js");
            await uploadBufferToClickUpTask(taskId, photo.data, photo.filename);
        },
        issueCertificate: certificatesEnabled()
            ? (scaleId, jobCard) => issueCertificateIfReady(scaleId, jobCard, certificateDeps)
            : undefined,
    };
}

// src/services/jobcard.dispatch.service.ts  (NEW FILE)
// Handles every submitted result: stops the timer when the last work item is done, issues the certificate,
// then posts the result to the job card's ClickUp task and Telegram group.
import logger from "../utils/logger.js";
import { certificatesEnabled, CALIBRATION_TYPES } from "../helper/jobcard/jobcard.config.js";
import { clampEnd, closedMinutesTotal, isOpen, minutesBetween, planStop, } from "../helper/jobcard/timeTracking.js";
import { formatForClickUp, formatForTelegram, photoEntries, } from "../helper/jobcard/resultFormat.js";
import { PhotoMissingError } from "./jobcard.photos.service.js";
import { issueCertificateIfReady, renderCertificatePdf, uploadCertificatePdf, } from "./certificate.service.js";
export const MAX_ATTEMPTS = 8;
export const WAIT_CAP_MS = 7 * 24 * 3600000; // give up waiting for a missing group / ClickUp task after 7 days
const WAIT_RECHECK_MS = 2 * 60000;
const LEASE_MS = 2 * 60000;
/** 1, 2, 4, 8 ... minutes, at most one hour. */
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
export async function processPendingSubmissions(deps, batch = 25) {
    const { repo } = deps;
    const nowMs = deps.now().getTime();
    const pending = await repo.listPendingSubmissions(100);
    const due = pending
        .filter((s) => !s.nextAttemptAt || Date.parse(s.nextAttemptAt) <= nowMs)
        .slice(0, batch);
    const summary = {
        examined: pending.length,
        handled: 0,
        finished: 0,
        retrying: 0,
    };
    const stopped = new Map(); // stop the timer once per job card per run
    const stopTimer = (jobCardId) => {
        if (!stopped.has(jobCardId))
            stopped.set(jobCardId, stopTimerIfComplete(deps, jobCardId));
        return stopped.get(jobCardId);
    };
    for (const sub of due) {
        if (!(await repo.claimSubmission(sub.id, nowMs, LEASE_MS)))
            continue; // another worker has it
        summary.handled += 1;
        try {
            const done = await processSubmission(deps, sub, stopTimer);
            done ? (summary.finished += 1) : (summary.retrying += 1);
        }
        catch (e) {
            logger.error(`Result ${sub.id}: unexpected failure`, e);
            const finished = await recordUnexpectedFailure(deps, sub, msg(e));
            finished ? (summary.finished += 1) : (summary.retrying += 1);
        }
    }
    if (summary.handled)
        logger.info("Job card results handled", summary);
    return summary;
}
/** Stops every open time entry once the last work item is submitted. Safe to run any number of times. */
export async function stopTimerIfComplete(deps, jobCardId) {
    const { repo } = deps;
    const [items, entries] = await Promise.all([
        repo.listModules(jobCardId),
        repo.listTimeEntries(jobCardId),
    ]);
    const plan = planStop(items.map((i) => ({ status: i.status, submittedAt: i.submittedAt })), entries, deps.now().toISOString());
    if (!plan)
        return;
    for (const e of entries.filter(isOpen)) {
        const endedAt = clampEnd(e.startedAt, plan.stopAt);
        await repo.closeTimeEntry(e.id, endedAt, minutesBetween(e.startedAt, endedAt), plan.reason);
    }
    // Recompute (never increment) so repeated runs and the web app cannot drift apart.
    await repo.setJobCardTotal(jobCardId, closedMinutesTotal(await repo.listTimeEntries(jobCardId)));
    logger.info(`Job card ${jobCardId}: time stopped (${plan.reason})`);
}
/** @returns true when the result is fully handled (and leaves the pending list), false if it will be retried. */
async function processSubmission(deps, sub, stopTimer) {
    const { repo } = deps;
    const nowMs = deps.now().getTime();
    const jobCard = await repo.getJobCard(sub.jobCardId);
    if (!jobCard) {
        await finish(deps, sub, { clickup: "FAILED", telegram: "FAILED" }, "Job card not found", Number(sub.deliveryAttempts) || 0);
        return true;
    }
    const errors = [];
    const notes = [];
    // 1. Timer
    try {
        await stopTimer(jobCard.id);
    }
    catch (e) {
        errors.push(`Timer: ${msg(e)}`);
    }
    // 2. Certificate (calibration results only, and only when switched on)
    if (deps.issueCertificate && CALIBRATION_TYPES.includes(sub.moduleType)) {
        try {
            await deps.issueCertificate(sub.scaleId, jobCard);
        }
        catch (e) {
            errors.push(`Certificate: ${msg(e)}`);
        }
    }
    // 3. Deliveries: independent of each other. A channel is finished when its text AND its photos are there.
    // Progress is saved as it goes, so a retry sends only what is still missing (never the text twice).
    let clickup = sub.clickupStatus === "SENT" ? "SENT" : "PENDING";
    let telegram = sub.telegramStatus === "SENT" ? "SENT" : "PENDING";
    let waiting = false;
    const progress = {};
    if (clickup !== "SENT" || telegram !== "SENT") {
        const text = await buildTexts(deps, sub, jobCard);
        const photos = deps.loadPhoto ? photoEntries(parsePayload(sub.payload)) : [];
        const saveProgress = async (patch) => {
            Object.assign(progress, patch);
            await repo.updateSubmission(sub.id, patch);
        };
        const loadOne = async (p) => {
            try {
                return await deps.loadPhoto(p.key, p.label);
            }
            catch (e) {
                if (e instanceof PhotoMissingError) {
                    logger.warn(`Result ${sub.id}: ${msg(e)}`);
                    return null; // gone for good: skip it rather than block the rest
                }
                throw e;
            }
        };
        if (clickup !== "SENT") {
            if (!jobCard.clickupTaskId) {
                waiting = true;
                notes.push("No ClickUp task on the job card yet");
            }
            else {
                try {
                    if (!(sub.clickupTextSent === true)) {
                        await deps.postClickUpComment(jobCard.clickupTaskId, text.clickup);
                        await saveProgress({ clickupTextSent: true });
                    }
                    const done = new Set(sub.clickupPhotosSent ?? []);
                    for (const p of photos) {
                        if (done.has(p.key) || !deps.attachClickUpFile)
                            continue;
                        const file = await loadOne(p);
                        if (file)
                            await deps.attachClickUpFile(jobCard.clickupTaskId, file);
                        done.add(p.key);
                        await saveProgress({ clickupPhotosSent: [...done] });
                    }
                    clickup = "SENT";
                }
                catch (e) {
                    errors.push(`ClickUp: ${msg(e)}`);
                }
            }
        }
        if (telegram !== "SENT") {
            const group = jobCard.telegramGroupId
                ? await repo.getTelegramGroup(jobCard.telegramGroupId)
                : null;
            if (!group || group.active === false) {
                waiting = true;
                notes.push(group ? "The linked Telegram group is inactive" : "No Telegram group linked yet");
            }
            else {
                try {
                    const chatId = String(group.chatId);
                    if (!(sub.telegramTextSent === true)) {
                        if (!(await deps.sendTelegram(chatId, text.telegram)))
                            throw new Error("message was not accepted");
                        await saveProgress({ telegramTextSent: true });
                    }
                    const done = new Set(sub.telegramPhotosSent ?? []);
                    const todo = photos.filter((p) => !done.has(p.key));
                    for (let i = 0; i < todo.length && deps.sendTelegramPhotos; i += 10) {
                        const chunk = todo.slice(i, i + 10);
                        const files = [];
                        for (const p of chunk) {
                            const file = await loadOne(p);
                            if (file)
                                files.push({ ...file, caption: p.label });
                        }
                        if (files.length && !(await deps.sendTelegramPhotos(chatId, files)))
                            throw new Error("photos were not accepted");
                        for (const p of chunk)
                            done.add(p.key);
                        await saveProgress({ telegramPhotosSent: [...done] });
                    }
                    telegram = "SENT";
                }
                catch (e) {
                    errors.push(`Telegram: ${msg(e)}`);
                }
            }
        }
    }
    const attempts = (Number(sub.deliveryAttempts) || 0) + (errors.length ? 1 : 0);
    const allDone = clickup === "SENT" && telegram === "SENT" && errors.length === 0;
    if (allDone) {
        await finish(deps, sub, { clickup, telegram }, undefined, attempts);
        return true;
    }
    const tooOld = nowMs - Date.parse(sub.submittedAt) > WAIT_CAP_MS;
    if (attempts >= MAX_ATTEMPTS || (tooOld && errors.length === 0)) {
        await finish(deps, sub, { clickup, telegram }, [...errors, ...notes].join("; ") || "Gave up", attempts);
        return true;
    }
    const delay = errors.length ? retryDelayMs(attempts) : WAIT_RECHECK_MS;
    await repo.updateSubmission(sub.id, {
        clickupStatus: clickup,
        telegramStatus: telegram,
        deliveryAttempts: attempts,
        deliveryError: [...errors, ...notes].join("; ") || undefined,
        nextAttemptAt: new Date(nowMs + delay).toISOString(),
    }, ["lockedUntil", ...([...errors, ...notes].length ? [] : ["deliveryError"])]);
    return false;
}
/** Leaves the pending list: anything not sent by now is recorded as FAILED. */
async function finish(deps, sub, status, error, attempts) {
    const f = (c) => (c === "SENT" ? "SENT" : "FAILED");
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
    return { telegram: formatForTelegram(ctx), clickup: formatForClickUp(ctx) };
}
// ---------- production wiring ----------
export async function defaultDispatchDeps() {
    const repo = await import("../repositories/dynamo.jobcardflow.repository.js");
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
            const { uploadBufferToClickUpTask } = await import("./xero.quote.service.js");
            await uploadBufferToClickUpTask(taskId, photo.data, photo.filename);
        },
        issueCertificate: certificatesEnabled()
            ? (scaleId, jobCard) => issueCertificateIfReady(scaleId, jobCard, certificateDeps)
            : undefined,
    };
}

// src/services/wrapup.service.ts
//
// Sweep that finds job cards awaiting wrap-up via the sparse
// jobCardsByWrapUpPendingAndClosedAt GSI.
//
// Sequence for each closed card:
//   1. Send the certificate on Telegram        → set certificateSentAt
//   2. Send the total-time message             → set totalTimePostedAt
//   3. Remove wrapUpPending                    → drops from GSI
//
// The marker wrapUpPending = "PENDING" MUST be set on close (by the close
// handler) for a card to appear in the GSI. Without it, the sweep never
// sees the card. See notes at the bottom.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { certificatesEnabled } from "../helper/jobcard/jobcard.config.js";
import { formatTotalTimeForTelegram } from "../helper/jobcard/resultFormat.js";
import { allSubmitted, formatDuration, isOpen, mergedMinutesTotal, personTimes, } from "../helper/jobcard/timeTracking.js";
import logger from "../utils/logger.js";
const DAY_MS = 86400000;
/** Give up on a stuck card 7 days after close. */
const WRAPUP_MAX_AGE_MS = 7 * DAY_MS;
const msg = (e) => (e instanceof Error ? e.message : String(e));
function since(deps) {
    const from = process.env.JOBCARD_WRAPUP_FROM ? Date.parse(process.env.JOBCARD_WRAPUP_FROM) : NaN;
    return Number.isFinite(from) ? from : deps.now().getTime() - DAY_MS;
}
export async function buildPlaceholderCertificate(info) {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const dark = rgb(0.1, 0.1, 0.1);
    const grey = rgb(0.4, 0.4, 0.4);
    let y = 770;
    const line = (text, size = 12, f = font, color = dark, gap = 22) => {
        page.drawText(text, { x: 60, y, size, font: f, color });
        y -= gap;
    };
    line("Calibration Certificate", 24, bold, dark, 34);
    line("PLACEHOLDER - NOT A VALID CERTIFICATE", 12, bold, rgb(0.75, 0.15, 0.15), 36);
    line(`Job card: ${info.jcNumber}`, 13, bold);
    if (info.customerName)
        line(`Customer: ${info.customerName}`, 13);
    line(`Closed on: ${info.closedOn}`, 13, font, dark, 34);
    if (info.scales.length) {
        line("Scales", 13, bold);
        for (const s of info.scales.slice(0, 25))
            line(`- ${s}`, 11, font, dark, 18);
    }
    page.drawText("This page stands in until the calibration certificate template is ready.", {
        x: 60,
        y: 60,
        size: 10,
        font,
        color: grey,
    });
    return Buffer.from(await pdf.save());
}
export async function processJobCardWrapUps(deps) {
    const { repo } = deps;
    const from = since(deps);
    const nowMs = deps.now().getTime();
    const summary = {
        examined: 0,
        totalsPosted: 0,
        certificatesSent: 0,
        done: 0,
    };
    for (const jc of await repo.listJobCardsAwaitingWrapUp()) {
        summary.examined += 1;
        try {
            // Only CLOSED cards should hold the marker. Clear any stray.
            if (jc.status !== "CLOSED") {
                logger.warn(`[wrapup] jc=${jc.id} has wrapUpPending but is not CLOSED — removing marker`);
                await repo.setJobCardFields(jc.id, {}, ["wrapUpPending"]);
                summary.done += 1;
                continue;
            }
            const closedAt = Date.parse(jc.closedAt ?? jc.updatedAt ?? "");
            if (!Number.isFinite(closedAt) || closedAt < from) {
                logger.info(`[wrapup] jc=${jc.id} closed before JOBCARD_WRAPUP_FROM — removing marker`);
                await repo.setJobCardFields(jc.id, {}, ["wrapUpPending"]);
                summary.done += 1;
                continue;
            }
            // Soft cap: give up on cards that have been stuck > 7 days.
            if (nowMs - closedAt > WRAPUP_MAX_AGE_MS) {
                logger.error(`[wrapup] jc=${jc.id} stuck for > 7 days — removing marker and giving up`);
                await repo.setJobCardFields(jc.id, {}, ["wrapUpPending"]);
                summary.done += 1;
                continue;
            }
            const items = await repo.listModules(jc.id);
            const group = jc.telegramGroupId ? await repo.getTelegramGroup(jc.telegramGroupId) : null;
            const chatId = group && group.active !== false ? String(group.chatId) : null;
            // ---------------- 1. Certificate ----------------
            const certsOn = certificatesEnabled() && !!deps.sendTelegramPdf;
            let certSent = !!jc.certificateSentAt;
            if (certsOn && !certSent) {
                if (!chatId) {
                    logger.info(`[wrapup] jc=${jc.id} certificate waiting: no active Telegram group`);
                }
                else {
                    const scaleIds = [...new Set(items.map((i) => i.scaleId).filter(Boolean))];
                    const scales = [];
                    for (const id of scaleIds) {
                        const s = await repo.getScale(id);
                        if (s?.scaleName)
                            scales.push(String(s.scaleName));
                    }
                    const jcNumber = jc.jcNumber ?? jc.id;
                    const pdf = await buildPlaceholderCertificate({
                        jcNumber,
                        customerName: jc.customerName,
                        closedOn: new Date(closedAt).toISOString().slice(0, 10),
                        scales,
                    });
                    const filename = `${jcNumber} - certificate (placeholder).pdf`;
                    const ok = await deps.sendTelegramPdf(chatId, pdf, filename, `Certificate placeholder - ${jcNumber}`);
                    if (ok) {
                        await repo.setJobCardFields(jc.id, {
                            certificateSentAt: deps.now().toISOString(),
                        });
                        certSent = true;
                        summary.certificatesSent += 1;
                        logger.info(`[wrapup] jc=${jc.id} certificate sent on Telegram`);
                    }
                    else {
                        logger.warn(`[wrapup] jc=${jc.id} certificate Telegram send returned false — will retry`);
                        continue;
                    }
                }
            }
            if (certsOn && !certSent) {
                // Cert not yet sent (no group or send failed) — retry next sweep.
                continue;
            }
            // ---------------- 2. Time message ----------------
            let timeSent = !!jc.totalTimePostedAt;
            if (!timeSent) {
                if (!chatId) {
                    logger.info(`[wrapup] jc=${jc.id} time message waiting: no active Telegram group`);
                    continue;
                }
                if (!allSubmitted(items)) {
                    logger.info(`[wrapup] jc=${jc.id} time message waiting: not all modules submitted`);
                    continue;
                }
                const entries = await repo.listTimeEntries(jc.id);
                if (entries.length === 0) {
                    logger.info(`[wrapup] jc=${jc.id} time message skipped: no time entries — removing marker`);
                    await repo.setJobCardFields(jc.id, {}, ["wrapUpPending"]);
                    summary.done += 1;
                    continue;
                }
                if (entries.some(isOpen)) {
                    const openIds = entries.filter(isOpen).map((e) => e.id);
                    logger.warn(`[wrapup] jc=${jc.id} time message waiting: ${openIds.length} open time entr${openIds.length === 1 ? "y" : "ies"} (${openIds.slice(0, 3).join(", ")}${openIds.length > 3 ? ", \u2026" : ""})`);
                    continue;
                }
                const text = formatTotalTimeForTelegram({
                    jcNumber: jc.jcNumber ?? jc.id,
                    customerName: jc.customerName,
                    totalText: formatDuration(mergedMinutesTotal(entries)),
                    people: personTimes(entries).map((p) => ({
                        name: p.name,
                        text: formatDuration(p.minutes),
                    })),
                });
                if (await deps.sendTelegram(chatId, text)) {
                    await repo.setJobCardFields(jc.id, {
                        totalTimePostedAt: deps.now().toISOString(),
                    });
                    timeSent = true;
                    summary.totalsPosted += 1;
                    logger.info(`[wrapup] jc=${jc.id} time message sent`);
                }
                else {
                    logger.warn(`[wrapup] jc=${jc.id} time message send returned false — will retry`);
                    continue;
                }
            }
            // ---------------- 3. Done — remove marker ----------------
            if (timeSent && (!certsOn || certSent)) {
                await repo.setJobCardFields(jc.id, {}, ["wrapUpPending"]);
                summary.done += 1;
                logger.info(`[wrapup] jc=${jc.id} wrap-up complete, marker removed`);
            }
        }
        catch (e) {
            logger.error(`Job card ${jc.id}: wrap-up failed (will try again): ${msg(e)}`);
        }
    }
    return summary;
}

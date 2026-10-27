// src/services/wrapup.service.ts
// What happens at the END of a job card, found by a sweep that runs with the dispatcher:
//   1. When the whole scope of work is submitted AND every result has finished delivering: post the total time to
//      Telegram, ONCE per job card.
//   2. When a job card is closed: send a placeholder certificate PDF (Telegram and ClickUp), once per channel.
// Each step records what it has sent on the job card (timePostedAt, certTelegramAt, certClickupAt), so a retry
// or a second sweep never repeats a message.
//
// IMPORTANT (bug fixed 2026-10-27): "Job card complete" was going out the moment the LAST module was marked
// SUBMITTED, even while its images were still being delivered. That looks like "the job is done" followed by
// images trickling in. The gate below waits until every module's latest submission has a terminal delivery state
// (SENT delivered, or FAILED gave up) before the message is allowed out.
//
// Only job cards that finished or closed recently are touched, so switching this on never floods old job cards.
// Set JOBCARD_WRAPUP_FROM (an ISO date) to choose the start; without it the last 24 hours are used.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { formatTotalTimeForTelegram } from '../helper/jobcard/resultFormat';
import { AUTO_RETRY_MAX_AGE_MS } from './jobcard.dispatch.service';
import {
  allSubmitted,
  formatDuration,
  isOpen,
  lastSubmittedAt,
  mergedMinutesTotal,
  personTimes,
} from '../helper/jobcard/timeTracking';
import logger from '../utils/logger';
import type { DispatchDeps } from './jobcard.dispatch.service';

const DAY_MS = 86_400_000;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Row = Record<string, any>;

export interface WrapUpSummary {
  examined: number;
  totalsPosted: number;
  certificatesSent: number;
}

function since(deps: Pick<DispatchDeps, 'now'>): number {
  const from = process.env.JOBCARD_WRAPUP_FROM ? Date.parse(process.env.JOBCARD_WRAPUP_FROM) : NaN;
  return Number.isFinite(from) ? from : deps.now().getTime() - DAY_MS;
}

/**
 * A submission is "terminal" when no further dispatch attempt will change it:
 *   deliveryState = SENT   → every configured channel accepted it
 *   deliveryState = FAILED → at least one channel gave up permanently
 * PENDING (or missing) means a dispatch attempt is still in flight (or waiting for its next retry), so the
 * individual result and its images have not yet reached the office. "Job card complete" must wait for all of
 * them to be terminal, otherwise the message goes out first and the images land afterwards.
 *
 * Legacy rows written by the old code had deliveryState removed at the end. For those, fall back to the channel
 * statuses: both SENT, or at least one FAILED, means terminal.
 */
function isTerminalSubmission(s: Row, nowMs: number): boolean {
  const ds = String(s.deliveryState ?? '');
  if (ds === 'SENT') return true;
  if (ds === 'FAILED') {
    // Auto-retry (requeueFailedSubmissions) will pick this up within AUTO_RETRY_MAX_AGE_MS. Hold "Job card
    // complete" until either the retry succeeds (SENT) or the grace period expires with it still FAILED.
    const submitted = Date.parse(String(s.submittedAt ?? ''));
    return !Number.isFinite(submitted) || nowMs - submitted > AUTO_RETRY_MAX_AGE_MS;
  }
  // Legacy rows (deliveryState was deleted by the old finish()): fall back to channel statuses.
  const c = String(s.clickupStatus ?? 'PENDING');
  const t = String(s.telegramStatus ?? 'PENDING');
  if (c === 'SENT' && t === 'SENT') return true;
  if ((c === 'SENT' || c === 'FAILED') && (t === 'SENT' || t === 'FAILED')) {
    const submitted = Date.parse(String(s.submittedAt ?? ''));
    return !Number.isFinite(submitted) || nowMs - submitted > AUTO_RETRY_MAX_AGE_MS;
  }
  return false;
}

/**
 * True only when every module of the job card has at least one submission and the LATEST submission for each is
 * terminal. If any module has no submission (bad data) or its latest is still PENDING, this returns false — the
 * "Job card complete" message will be held back to the next sweep.
 */
async function everyResultTerminal(
  repo: DispatchDeps['repo'],
  items: Row[],
  nowMs: number
): Promise<boolean> {
  if (items.length === 0) return false;
  for (const item of items) {
    const subs = await repo.listSubmissionsByModule(item.id);
    const latest = subs[0];
    if (!latest) {
      logger.warn(
        `[wrapup] module ${item.id} has no submission row — refusing to declare the job card complete`
      );
      return false;
    }
    if (!isTerminalSubmission(latest, nowMs)) {
      logger.info(
        `[wrapup] module ${item.id} latest submission ${latest.id} is still ${latest.deliveryState ?? 'PENDING'} — holding back "Job card complete"`
      );
      return false;
    }
  }
  return true;
}

/** A one-page placeholder, clearly marked as not a real certificate. */
export async function buildPlaceholderCertificate(info: {
  jcNumber: string;
  customerName?: string;
  closedOn: string;
  scales: string[];
}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const dark = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.4, 0.4, 0.4);
  let y = 770;
  const line = (text: string, size = 12, f = font, color = dark, gap = 22) => {
    page.drawText(text, { x: 60, y, size, font: f, color });
    y -= gap;
  };
  line('Calibration Certificate', 24, bold, dark, 34);
  line('PLACEHOLDER - NOT A VALID CERTIFICATE', 12, bold, rgb(0.75, 0.15, 0.15), 36);
  line(`Job card: ${info.jcNumber}`, 13, bold);
  if (info.customerName) line(`Customer: ${info.customerName}`, 13);
  line(`Closed on: ${info.closedOn}`, 13, font, dark, 34);
  if (info.scales.length) {
    line('Scales', 13, bold);
    for (const s of info.scales.slice(0, 25)) line(`- ${s}`, 11, font, dark, 18);
  }
  page.drawText('This page stands in until the calibration certificate template is ready.', {
    x: 60,
    y: 60,
    size: 10,
    font,
    color: grey,
  });
  return Buffer.from(await pdf.save());
}

export async function processJobCardWrapUps(deps: DispatchDeps): Promise<WrapUpSummary> {
  const { repo } = deps;
  const from = since(deps);
  const summary: WrapUpSummary = { examined: 0, totalsPosted: 0, certificatesSent: 0 };

  for (const jc of await repo.listJobCardsAwaitingWrapUp()) {
    summary.examined += 1;
    try {
      const items: any[] = await repo.listModules(jc.id);

      const group = jc.telegramGroupId ? await repo.getTelegramGroup(jc.telegramGroupId) : null;
      const chatId = group && group.active !== false ? String(group.chatId) : null;

      // 1. total time: only when (a) every module is SUBMITTED (technician finished the work) AND (b) every
      // module's latest submission is terminal (dispatch delivered it — images included — or gave up). Without
      // (b) this message went out before the individual result images arrived, which looked like the job finished
      // before it did.
      if (!jc.timePostedAt && chatId && allSubmitted(items)) {
        if (!(await everyResultTerminal(repo, items, deps.now().getTime()))) {
          logger.info(
            `[wrapup] jc=${jc.id} all modules SUBMITTED but not all deliveries are terminal — holding back`
          );
        } else {
          const completedAt = lastSubmittedAt(items);
          const entries: any[] = await repo.listTimeEntries(jc.id);
          if (
            completedAt &&
            Date.parse(completedAt) >= from &&
            entries.length > 0 &&
            !entries.some(isOpen)
          ) {
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
              await repo.setJobCardFields(jc.id, { timePostedAt: deps.now().toISOString() });
              summary.totalsPosted += 1;
            }
          }
        }
      }

      // 2. placeholder certificate when the job card is closed
      if (jc.status === 'CLOSED') {
        const closedAt = Date.parse(jc.closedAt ?? jc.updatedAt ?? '');
        const wantTelegram = !jc.certTelegramAt && !!chatId && !!deps.sendTelegramPdf;
        const wantClickUp = !jc.certClickupAt && !!jc.clickupTaskId && !!deps.attachClickUpFile;
        if (Number.isFinite(closedAt) && closedAt >= from && (wantTelegram || wantClickUp)) {
          const scaleIds = [...new Set(items.map((i) => i.scaleId).filter(Boolean))];
          const scales: string[] = [];
          for (const id of scaleIds) {
            const s = await repo.getScale(id as string);
            if (s?.scaleName) scales.push(String(s.scaleName));
          }
          const jcNumber = jc.jcNumber ?? jc.id;
          const pdf = await buildPlaceholderCertificate({
            jcNumber,
            customerName: jc.customerName,
            closedOn: new Date(closedAt).toISOString().slice(0, 10),
            scales,
          });
          const filename = `${jcNumber} - certificate (placeholder).pdf`;
          let sent = false;
          if (wantTelegram) {
            if (
              await deps.sendTelegramPdf!(
                chatId!,
                pdf,
                filename,
                `Certificate placeholder - ${jcNumber}`
              )
            ) {
              await repo.setJobCardFields(jc.id, { certTelegramAt: deps.now().toISOString() });
              sent = true;
            }
          }
          if (wantClickUp) {
            await deps.attachClickUpFile!(jc.clickupTaskId, {
              data: pdf,
              contentType: 'application/pdf',
              filename,
            });
            await repo.setJobCardFields(jc.id, { certClickupAt: deps.now().toISOString() });
            sent = true;
          }
          if (sent) summary.certificatesSent += 1;
        }
      }
    } catch (e) {
      logger.error(`Job card ${jc.id}: wrap-up failed (will try again): ${msg(e)}`);
    }
  }
  return summary;
}

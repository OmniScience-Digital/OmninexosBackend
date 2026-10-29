// src/services/wrapup.service.ts
// What happens at the END of a job card, found by a sweep that runs with the dispatcher.
//   1. When the job card is CLOSED: send the certificate (Telegram and ClickUp), once per channel.
//   2. AFTER the certificate has gone out on Telegram: post the total time to Telegram, ONCE per job card.
// Each step records what it has sent on the job card (timePostedAt, certTelegramAt, certClickupAt), so a retry
// or a second sweep never repeats a message.
//
// Only job cards that closed recently are touched, so switching this on never floods old job cards.
// Set JOBCARD_WRAPUP_FROM (an ISO date) to choose the start; without it the last 24 hours are used.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { certificatesEnabled } from '../helper/jobcard/jobcard.config';
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

function isTerminalSubmission(s: Row, nowMs: number): boolean {
  const ds = String(s.deliveryState ?? '');
  if (ds === 'SENT') return true;
  if (ds === 'FAILED') {
    const submitted = Date.parse(String(s.submittedAt ?? ''));
    return !Number.isFinite(submitted) || nowMs - submitted > AUTO_RETRY_MAX_AGE_MS;
  }
  const c = String(s.clickupStatus ?? 'PENDING');
  const t = String(s.telegramStatus ?? 'PENDING');
  if (c === 'SENT' && t === 'SENT') return true;
  if ((c === 'SENT' || c === 'FAILED') && (t === 'SENT' || t === 'FAILED')) {
    const submitted = Date.parse(String(s.submittedAt ?? ''));
    return !Number.isFinite(submitted) || nowMs - submitted > AUTO_RETRY_MAX_AGE_MS;
  }
  return false;
}

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

      // ----------------------------------------------------------------
      // 1. CERTIFICATE — fires on CLOSED, once per channel.
      //    (Runs FIRST so the time message can gate on the Telegram cert.)
      // ----------------------------------------------------------------
      let certTelegramSentThisRun = false;

      if (jc.status === 'CLOSED' && certificatesEnabled()) {
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
              certTelegramSentThisRun = true;
              sent = true;
              logger.info(`[wrapup] jc=${jc.id} certificate sent on Telegram`);
            } else {
              logger.warn(`[wrapup] jc=${jc.id} certificate Telegram send returned false`);
            }
          }
          if (wantClickUp) {
            try {
              await deps.attachClickUpFile!(jc.clickupTaskId, {
                data: pdf,
                contentType: 'application/pdf',
                filename,
              });
              await repo.setJobCardFields(jc.id, { certClickupAt: deps.now().toISOString() });
              sent = true;
              logger.info(`[wrapup] jc=${jc.id} certificate uploaded to ClickUp`);
            } catch (e) {
              logger.error(`[wrapup] jc=${jc.id} certificate ClickUp upload failed: ${msg(e)}`);
            }
          }
          if (sent) summary.certificatesSent += 1;
        }
      }

      // ----------------------------------------------------------------
      // 2. TIME MESSAGE — fires on CLOSED, only AFTER the certificate
      //    has gone out on Telegram. ClickUp cert failures don't block it.
      //    If certificates are off or Telegram cert isn't wired, the
      //    time message runs immediately (nothing to wait for).
      // ----------------------------------------------------------------
      const certTelegramOk =
        !certificatesEnabled() ||
        !deps.sendTelegramPdf ||
        !!jc.certTelegramAt ||
        certTelegramSentThisRun;

      if (jc.status !== 'CLOSED') {
        // Not closed yet — nothing to do.
      } else if (jc.timePostedAt) {
        // Already sent.
      } else if (!chatId) {
        logger.info(`[wrapup] jc=${jc.id} time message waiting: no active Telegram group`);
      } else if (!allSubmitted(items)) {
        logger.info(`[wrapup] jc=${jc.id} time message waiting: not all modules submitted`);
      } else if (!certTelegramOk) {
        logger.info(
          `[wrapup] jc=${jc.id} time message waiting: certificate has not yet been sent on Telegram`
        );
      } else if (!(await everyResultTerminal(repo, items, deps.now().getTime()))) {
        logger.info(`[wrapup] jc=${jc.id} time message waiting: not all deliveries are terminal`);
      } else {
        const closedAt = Date.parse(jc.closedAt ?? jc.updatedAt ?? '');
        if (!Number.isFinite(closedAt) || closedAt < from) {
          logger.info(
            `[wrapup] jc=${jc.id} time message skipped: closed before JOBCARD_WRAPUP_FROM`
          );
        } else {
          const entries: any[] = await repo.listTimeEntries(jc.id);
          if (entries.length === 0) {
            logger.info(`[wrapup] jc=${jc.id} time message skipped: no time entries`);
          } else if (entries.some(isOpen)) {
            const openIds = entries.filter(isOpen).map((e) => e.id);
            logger.warn(
              `[wrapup] jc=${jc.id} time message skipped: ${openIds.length} open time entr${
                openIds.length === 1 ? 'y' : 'ies'
              } (${openIds.slice(0, 3).join(', ')}${openIds.length > 3 ? ', …' : ''})`
            );
          } else {
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
              logger.info(`[wrapup] jc=${jc.id} time message sent`);
            } else {
              logger.warn(`[wrapup] jc=${jc.id} time message send returned false — will retry`);
            }
          }
        }
      }
    } catch (e) {
      logger.error(`Job card ${jc.id}: wrap-up failed (will try again): ${msg(e)}`);
    }
  }
  return summary;
}

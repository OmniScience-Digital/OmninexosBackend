// src/services/wrapup.service.ts
// What happens at the END of a job card, found by a sweep that runs with the dispatcher:
//   1. When the whole scope of work is submitted: post the total time to Telegram, ONCE per job card.
//   2. When a job card is closed: send a placeholder certificate PDF (Telegram and ClickUp), once per channel.
// Each step records what it has sent on the job card (timePostedAt, certTelegramAt, certClickupAt), so a retry
// or a second sweep never repeats a message.
//
// Only job cards that finished or closed recently are touched, so switching this on never floods old job cards.
// Set JOBCARD_WRAPUP_FROM (an ISO date) to choose the start; without it the last 24 hours are used.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { formatTotalTimeForTelegram } from '../helper/jobcard/resultFormat';
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

export interface WrapUpSummary {
  examined: number;
  totalsPosted: number;
  certificatesSent: number;
}

function since(deps: Pick<DispatchDeps, 'now'>): number {
  const from = process.env.JOBCARD_WRAPUP_FROM ? Date.parse(process.env.JOBCARD_WRAPUP_FROM) : NaN;
  return Number.isFinite(from) ? from : deps.now().getTime() - DAY_MS;
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
      // rows come back untyped from the database, so they are read as plain records here
      const items: any[] = await repo.listModules(jc.id);
      const group = jc.telegramGroupId ? await repo.getTelegramGroup(jc.telegramGroupId) : null;
      const chatId = group && group.active !== false ? String(group.chatId) : null;

      // 1. total time: only when everything is submitted and the timer has stopped
      if (!jc.timePostedAt && chatId && allSubmitted(items)) {
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

      // 2. placeholder certificate when the job card is closed
      if (jc.status === 'CLOSED') {
        const closedAt = Date.parse(jc.closedAt ?? jc.updatedAt ?? '');
        const wantTelegram = !jc.certTelegramAt && !!chatId && !!deps.sendTelegramPdf;
        const wantClickUp = !jc.certClickupAt && !!jc.clickupTaskId && !!deps.attachClickUpFile;
        if (Number.isFinite(closedAt) && closedAt >= from && (wantTelegram || wantClickUp)) {
          const scaleIds = [...new Set(items.map((i: any) => i.scaleId).filter(Boolean))];
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

// src/services/wrapup.service.ts
//
// Sweep driven by the sparse jobCardsByWrapUpPendingAndClosedAt GSI.
// For each closed card:
//   1. Certificate → Telegram  → write certificateSentAt
//   2. Certificate → ClickUp   → write certificateClickupAt
//   3. Time message → Telegram → write totalTimePostedAt
//   4. Time message → ClickUp  → write totalTimePostedClickupAt
//   5. All wired channels done → remove wrapUpPending
//
// Local state per card avoids re-reading a stale snapshot; both channels can
// complete in a single sweep when sends succeed.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { certificatesEnabled } from '../helper/jobcard/jobcard.config';
import { formatTotalTimeForTelegram } from '../helper/jobcard/resultFormat';
import {
  allSubmitted,
  formatDuration,
  isOpen,
  mergedMinutesTotal,
  personTimes,
} from '../helper/jobcard/timeTracking';
import logger from '../utils/logger';
import type { DispatchDeps } from './jobcard.dispatch.service';

const DAY_MS = 86_400_000;
const WRAPUP_MAX_AGE_MS = 7 * DAY_MS;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Row = Record<string, any>;

export interface WrapUpSummary {
  examined: number;
  totalsPosted: number;
  certificatesSent: number;
  done: number;
}

function since(deps: Pick<DispatchDeps, 'now'>): number {
  const from = process.env.JOBCARD_WRAPUP_FROM ? Date.parse(process.env.JOBCARD_WRAPUP_FROM) : NaN;
  return Number.isFinite(from) ? from : deps.now().getTime() - DAY_MS;
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
  const nowMs = deps.now().getTime();
  const summary: WrapUpSummary = {
    examined: 0,
    totalsPosted: 0,
    certificatesSent: 0,
    done: 0,
  };

  for (const jc of await repo.listJobCardsAwaitingWrapUp()) {
    summary.examined += 1;
    try {
      if (jc.status !== 'CLOSED') {
        logger.warn(`[wrapup] jc=${jc.id} has wrapUpPending but is not CLOSED — removing marker`);
        await repo.setJobCardFields(jc.id, {}, ['wrapUpPending']);
        summary.done += 1;
        continue;
      }

      const closedAt = Date.parse(jc.closedAt ?? jc.updatedAt ?? '');
      if (!Number.isFinite(closedAt) || closedAt < from) {
        logger.info(`[wrapup] jc=${jc.id} closed before JOBCARD_WRAPUP_FROM — removing marker`);
        await repo.setJobCardFields(jc.id, {}, ['wrapUpPending']);
        summary.done += 1;
        continue;
      }
      if (nowMs - closedAt > WRAPUP_MAX_AGE_MS) {
        logger.error(`[wrapup] jc=${jc.id} stuck for > 7 days — removing marker and giving up`);
        await repo.setJobCardFields(jc.id, {}, ['wrapUpPending']);
        summary.done += 1;
        continue;
      }

      const items: any[] = await repo.listModules(jc.id);
      const group = jc.telegramGroupId ? await repo.getTelegramGroup(jc.telegramGroupId) : null;
      const chatId = group && group.active !== false ? String(group.chatId) : null;

      const certsOn = certificatesEnabled();

      // Local state — updated as we go so a successful send doesn't get re-checked
      // against the stale `jc` snapshot loaded at the top of this loop.
      let certTgOk = !!jc.certificateSentAt;
      let certCuOk = !!jc.certificateClickupAt;
      let timeTgOk = !!jc.totalTimePostedAt;
      let timeCuOk = !!jc.totalTimePostedClickupAt;

      // ---------------- 1. Certificate ----------------
      const needCertTg = certsOn && !certTgOk && !!chatId && !!deps.sendTelegramPdf;
      const needCertCu = certsOn && !certCuOk && !!jc.clickupTaskId && !!deps.attachClickUpFile;

      if (needCertTg || needCertCu) {
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

        if (needCertTg) {
          if (
            await deps.sendTelegramPdf!(
              chatId!,
              pdf,
              filename,
              `Certificate placeholder - ${jcNumber}`
            )
          ) {
            await repo.setJobCardFields(jc.id, {
              certificateSentAt: deps.now().toISOString(),
            });
            certTgOk = true;
            summary.certificatesSent += 1;
            logger.info(`[wrapup] jc=${jc.id} certificate sent on Telegram`);
          } else {
            logger.warn(
              `[wrapup] jc=${jc.id} certificate Telegram send returned false — will retry`
            );
          }
        }

        if (needCertCu) {
          try {
            await deps.attachClickUpFile!(jc.clickupTaskId, {
              data: pdf,
              contentType: 'application/pdf',
              filename,
            });
            await repo.setJobCardFields(jc.id, {
              certificateClickupAt: deps.now().toISOString(),
            });
            certCuOk = true;
            if (!needCertTg) summary.certificatesSent += 1;
            logger.info(`[wrapup] jc=${jc.id} certificate uploaded to ClickUp`);
          } catch (e) {
            logger.error(
              `[wrapup] jc=${jc.id} certificate ClickUp upload failed (will retry): ${msg(e)}`
            );
          }
        }
      }

      // Cert gate for the time message: when certificates are enabled and a
      // channel is wired, that channel must be done first.
      const certTgGate = !certsOn || !deps.sendTelegramPdf || !chatId || certTgOk;
      const certCuGate = !certsOn || !deps.attachClickUpFile || !jc.clickupTaskId || certCuOk;
      const certsReady = certTgGate && certCuGate;

      if (certsOn && !certsReady) {
        logger.info(
          `[wrapup] jc=${jc.id} time message waiting: certificate not yet done (tg=${certTgGate} cu=${certCuGate})`
        );
      } else {
        // ---------------- 2. Time message ----------------
        const needTimeTg = !timeTgOk && !!chatId;
        const needTimeCu = !timeCuOk && !!jc.clickupTaskId;
        let timeText: string | null = null;

        if (needTimeTg || needTimeCu) {
          if (!allSubmitted(items)) {
            logger.info(`[wrapup] jc=${jc.id} time message waiting: not all modules submitted`);
          } else {
            const entries: any[] = await repo.listTimeEntries(jc.id);
            if (entries.length === 0) {
              logger.info(
                `[wrapup] jc=${jc.id} time message skipped: no time entries — removing marker`
              );
              await repo.setJobCardFields(jc.id, {}, ['wrapUpPending']);
              summary.done += 1;
              continue;
            }
            if (entries.some(isOpen)) {
              const openIds = entries.filter(isOpen).map((e) => e.id);
              logger.warn(
                `[wrapup] jc=${jc.id} time message waiting: ${openIds.length} open time entr${
                  openIds.length === 1 ? 'y' : 'ies'
                } (${openIds.slice(0, 3).join(', ')}${openIds.length > 3 ? ', …' : ''})`
              );
            } else {
              timeText = formatTotalTimeForTelegram({
                jcNumber: jc.jcNumber ?? jc.id,
                customerName: jc.customerName,
                totalText: formatDuration(mergedMinutesTotal(entries)),
                people: personTimes(entries).map((p) => ({
                  name: p.name,
                  text: formatDuration(p.minutes),
                })),
              });
            }
          }
        }

        if (timeText) {
          if (needTimeTg) {
            if (await deps.sendTelegram(chatId!, timeText)) {
              await repo.setJobCardFields(jc.id, {
                totalTimePostedAt: deps.now().toISOString(),
              });
              timeTgOk = true;
              summary.totalsPosted += 1;
              logger.info(`[wrapup] jc=${jc.id} time message sent on Telegram`);
            } else {
              logger.warn(
                `[wrapup] jc=${jc.id} time message Telegram send returned false — will retry`
              );
            }
          }

          if (needTimeCu) {
            try {
              // ClickUp renders Markdown; strip the Telegram backslash escapes.
              const cuText = timeText.replace(/\\([_*`[])/g, '$1');
              await deps.postClickUpComment(jc.clickupTaskId, cuText);
              await repo.setJobCardFields(jc.id, {
                totalTimePostedClickupAt: deps.now().toISOString(),
              });
              timeCuOk = true;
              logger.info(`[wrapup] jc=${jc.id} time message posted to ClickUp`);
            } catch (e) {
              logger.error(
                `[wrapup] jc=${jc.id} time message ClickUp post failed (will retry): ${msg(e)}`
              );
            }
          }
        }
      }

      // ---------------- 3. Done? ----------------
      // Marker removed only when every wired channel is done.
      const finalCertTg = !certsOn || !deps.sendTelegramPdf || !chatId || certTgOk;
      const finalCertCu = !certsOn || !deps.attachClickUpFile || !jc.clickupTaskId || certCuOk;
      const finalTimeTg = !chatId || timeTgOk;
      const finalTimeCu = !jc.clickupTaskId || timeCuOk;

      if (finalCertTg && finalCertCu && finalTimeTg && finalTimeCu) {
        await repo.setJobCardFields(jc.id, {}, ['wrapUpPending']);
        summary.done += 1;
        logger.info(`[wrapup] jc=${jc.id} wrap-up complete, marker removed`);
      }
    } catch (e) {
      logger.error(`Job card ${jc.id}: wrap-up failed (will try again): ${msg(e)}`);
    }
  }
  return summary;
}

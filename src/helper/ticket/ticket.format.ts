// src/helper/ticket/ticket.format.ts
// TICKETING: pure text builders for ClickUp and Telegram.
import { DateTime } from 'luxon';
import { BOT_SIGNATURE, MAX_TELEGRAM_TEXT } from './ticket.config';

export const formatTicketNumber = (n: number, pad = 4): string =>
  `T-${String(n).padStart(pad, '0')}`;

/** ClickUp task name: "T-0001, Fix the pump". */
export const buildTaskName = (ticketNumber: string, title: string): string =>
  `${ticketNumber}, ${title.trim().replace(/\s+/g, ' ')}`;

export const formatDue = (d: Date, zone = 'Africa/Johannesburg'): string =>
  `${DateTime.fromJSDate(d, { zone }).toFormat('ccc d LLL yyyy, HH:mm')} SAST`;

/** "11 November 14:00" in Johannesburg time (used on every Telegram message). */
export const formatDueShort = (d: Date, zone = 'Africa/Johannesburg'): string =>
  DateTime.fromJSDate(d, { zone }).setLocale('en').toFormat('d LLLL HH:mm');

const dueLine = (d: Date | null | undefined): string => (d ? `\nDue ${formatDueShort(d)}` : '');

export interface ResolvedAssignee {
  name: string; // the name ticked on the form
  clickupUserId: number | null; // null = could not be resolved at all
  fallback: boolean; // true = not on ClickUp, so Gleed was assigned instead
}

/** ClickUp task description (Assignees / Due Date / Required Outcome, as on the spreadsheet). */
export function buildDescription(p: {
  assignees: ResolvedAssignee[];
  dueAt: Date;
  requiredOutcome: string;
}): string {
  const who = p.assignees
    .map((a) => (a.fallback ? `${a.name} (not on ClickUp)` : a.name))
    .join(', ');
  return [
    `Assignees: ${who}`,
    `Due Date: ${formatDue(p.dueAt)}`,
    `Required Outcome: ${p.requiredOutcome.trim()}`,
  ].join('\n');
}

// ------------------------------------------------------------------ Telegram (legacy Markdown)
// The shared Telegram service sends with parse_mode "Markdown", where _ * ` [ start formatting.
// A task title like "fix pump_2" would make Telegram reject the whole message, so escape them.
export const escapeTelegram = (text: string): string => text.replace(/([_*`[\\])/g, '\\$1');

const clip = (text: string, max = MAX_TELEGRAM_TEXT): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** "T-0001, Title", then "Due 11 November 14:00", then "<Name> sent this message: <text>". */
export function telegramUpdateMessage(
  taskName: string,
  author: string,
  text: string,
  dueAt?: Date | null
): string {
  const body = text.trim() || '(no text)';
  return clip(
    `${escapeTelegram(taskName)}${dueLine(dueAt)}\n${escapeTelegram(author)} sent this message: ${escapeTelegram(body)}`
  );
}

export type EscalationStep = 'followUp' | 'gleed';

/** Posted to the group when a task still has no update at 50% / 70%. */
export function telegramEscalationMessage(
  taskName: string,
  step: EscalationStep,
  dueAt?: Date | null
): string {
  const pct = step === 'followUp' ? '50%' : '70%';
  return clip(
    `${escapeTelegram(taskName)}${dueLine(dueAt)}\nNo feedback received on this task yet (${pct} of the time used).`
  );
}

/** The number in "T-0042, Title" (42), compared as a number so T-10000 sorts after T-9999. */
const taskNumberOf = (taskName: string): number => {
  const m = /^T-(\d+)/.exec(taskName);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};

export interface OverdueItem {
  taskName: string;
  dueAt: Date;
}

/**
 * The hourly reminder: every open task past its due date in one message, in task-number order
 * (T-0001, T-0002 ...). Split into
 * several messages only if the list is too long for Telegram.
 */
export function telegramOverdueDigest(items: OverdueItem[]): string[] {
  const entries = [...items]
    .sort(
      (a, b) =>
        taskNumberOf(a.taskName) - taskNumberOf(b.taskName) || a.taskName.localeCompare(b.taskName)
    )
    .map((i) => `${escapeTelegram(i.taskName)}\nDue ${formatDueShort(i.dueAt)}`);
  const messages: string[] = [];
  let current = '';
  for (const entry of entries) {
    if (current && current.length + entry.length + 2 > MAX_TELEGRAM_TEXT) {
      messages.push(current);
      current = '';
    }
    if (!current) {
      const header =
        messages.length === 0
          ? `Overdue tasks, still open (${entries.length}):`
          : 'Overdue tasks, continued:';
      current = `${header}\n\n${entry}`;
    } else {
      current = `${current}\n\n${entry}`;
    }
  }
  if (current) messages.push(current);
  return messages;
}

export const telegramCreatedMessage = (
  taskName: string,
  assignees: string[],
  dueAt?: Date | null
): string =>
  clip(
    `${escapeTelegram(taskName)}${dueLine(dueAt)}\nTask created for ${escapeTelegram(assignees.join(', '))}.`
  );

// ------------------------------------------------------------------ ClickUp comment blocks
export type CommentBlock = { text: string } | { type: 'tag'; user: { id: number } };

const tag = (id: number): CommentBlock => ({ type: 'tag', user: { id } });

/** 50%: tag the assignee(s) and ask for an update. */
export function followUpComment(
  ticketNumber: string,
  assigneeIds: number[],
  dueAt: Date
): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  assigneeIds.forEach((id) => blocks.push(tag(id), { text: ' ' }));
  blocks.push({
    text: `${ticketNumber} is due ${formatDue(dueAt)} and has no update yet. Please reply here with an update. ${BOT_SIGNATURE}`,
  });
  return blocks;
}

/** 70%: tag Gleed. When Gleed cannot be tagged the text still goes out. */
export function gleedComment(
  ticketNumber: string,
  gleedId: number | null,
  dueAt: Date
): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  if (gleedId !== null) blocks.push(tag(gleedId), { text: ' ' });
  blocks.push({
    text: `${ticketNumber} is still without an update (70% of the time used), due ${formatDue(dueAt)}. ${BOT_SIGNATURE}`,
  });
  return blocks;
}

/** True when a ClickUp comment was written by this system rather than a person. */
export const isBotText = (commentText: string): boolean => commentText.includes(BOT_SIGNATURE);

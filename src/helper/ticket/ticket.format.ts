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

/** "T-0001, Title" then a new line then "<Name> sent this message: <text>". */
export function telegramUpdateMessage(taskName: string, author: string, text: string): string {
  const body = text.trim() || '(no text)';
  return clip(
    `${escapeTelegram(taskName)}\n${escapeTelegram(author)} sent this message: ${escapeTelegram(body)}`
  );
}

export type EscalationStep = 'followUp' | 'gleed';

/** Posted to the group when a task still has no update at 50% / 70%. */
export function telegramEscalationMessage(
  taskName: string,
  step: EscalationStep,
  dueAt: Date
): string {
  const pct = step === 'followUp' ? '50%' : '70%';
  return clip(
    `${escapeTelegram(taskName)}\nNo feedback received on this task yet (${pct} of the time used, due ${formatDue(dueAt)}).`
  );
}

export const telegramCreatedMessage = (
  taskName: string,
  assignees: string[],
  dueAt: Date
): string =>
  clip(
    `${escapeTelegram(taskName)}\nTask created for ${escapeTelegram(assignees.join(', '))}, due ${formatDue(dueAt)}.`
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

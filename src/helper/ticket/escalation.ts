// src/helper/ticket/escalation.ts
// TICKETING: decides which escalations are due for one ticket. Pure.
//
// Rules (from the spreadsheet):
//   - Any message from a person on the ClickUp task counts as an update and stops escalation.
//   - 50% of the urgency window used with no update -> follow-up tagging the assignee(s).
//   - 70% with no update -> tag Gleed.
//   - Each step happens once.
// "Used" is measured in business minutes since the ticket was submitted, so a 16H task does
// not escalate overnight. Nothing is posted outside business hours; it waits for 06:00.
import { businessMinutesBetween, isBusinessTime } from './businessTime';
import { DateTime } from 'luxon';
import {
  ASAP_FIRST_REMINDER_MS,
  ESCALATION,
  REMINDER_WINDOW_MINUTES,
  type BusinessCalendar,
} from './ticket.config';
import type { EscalationStep } from './ticket.format';

export interface EscalationInput {
  urgencyMinutes: number;
  submittedAt: Date; // the server-assigned createdAt
  now: Date;
  hasUpdate: boolean;
  followUpDone: boolean;
  gleedDone: boolean;
}

export function dueEscalations(input: EscalationInput, cal: BusinessCalendar): EscalationStep[] {
  if (input.urgencyMinutes <= 0) return []; // ASAP: covered by the hourly overdue reminder (reminderDue)
  if (input.hasUpdate) return [];
  if (!isBusinessTime(input.now, cal)) return [];

  const used = businessMinutesBetween(input.submittedAt, input.now, cal);
  const steps: EscalationStep[] = [];
  if (!input.followUpDone && used >= input.urgencyMinutes * ESCALATION.followUpAt)
    steps.push('followUp');
  if (!input.gleedDone && used >= input.urgencyMinutes * ESCALATION.gleedAt) steps.push('gleed');
  return steps;
}

/**
 * Hourly reminder for an open task that is past its due date. True when this task belongs in the reminder
 * sent now: inside business hours, in the first minutes of the hour, not already reminded this hour, and
 * past due. ASAP tasks are due when created, so they start one hour after creation. A reply does not stop
 * it; only closing the ClickUp task does.
 */
export function reminderDue(
  input: {
    urgency: string;
    createdAt: Date;
    dueAt: Date | null;
    lastReminderAt: Date | null;
    now: Date;
  },
  cal: BusinessCalendar
): boolean {
  if (!input.dueAt || !isBusinessTime(input.now, cal)) return false;
  const local = DateTime.fromJSDate(input.now, { zone: cal.zone });
  if (local.minute >= REMINDER_WINDOW_MINUTES) return false;
  if (input.lastReminderAt && input.lastReminderAt.getTime() >= local.startOf('hour').toMillis())
    return false;
  const overdueFrom =
    input.urgency === 'ASAP'
      ? input.createdAt.getTime() + ASAP_FIRST_REMINDER_MS
      : input.dueAt.getTime();
  return input.now.getTime() >= overdueFrom;
}

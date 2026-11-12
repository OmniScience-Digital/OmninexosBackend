// src/helper/ticket/escalation.ts  (NEW FILE)
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
import { ASAP_REPORT_EVERY_MS, ESCALATION, type BusinessCalendar } from './ticket.config';
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
  if (input.urgencyMinutes <= 0) return []; // ASAP: see asapReportDue
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
 * ASAP tasks: true when Telegram should be told the task is still open. First report one hour after
 * the task was created, then one every hour, until the ClickUp task is closed (a reply does not stop it).
 * Only inside business hours; after a quiet night there is ONE report at 06:00, not a catch-up.
 */
export function asapReportDue(
  input: { createdAt: Date; lastReportAt: Date | null; now: Date },
  cal: BusinessCalendar
): boolean {
  if (!isBusinessTime(input.now, cal)) return false;
  const since = input.lastReportAt ?? input.createdAt;
  return input.now.getTime() - since.getTime() >= ASAP_REPORT_EVERY_MS;
}

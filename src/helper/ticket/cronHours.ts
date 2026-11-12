// src/helper/ticket/cronHours.ts
// TICKETING: the sync job (reminders, follow-ups, forwarding replies) only runs 06:00 to 17:00.
// Intake is not limited: a new task is created in ClickUp straight away at any hour.
import { isBusinessTime } from './businessTime';
import { cronsAlwaysOn, type BusinessCalendar } from './ticket.config';

export function syncWindowOpen(
  now: Date,
  cal: BusinessCalendar,
  always: boolean = cronsAlwaysOn()
): boolean {
  return always || isBusinessTime(now, cal);
}

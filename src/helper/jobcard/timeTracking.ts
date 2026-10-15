// src/helper/jobcard/timeTracking.ts  (NEW FILE)
// The "stop the timer" rule, identical to the web app's (src/utils/helper/jobCardTime.ts). Pure, no I/O.
//
//  - Entries are per user per job card and are opened by the apps when a user engages.
//  - ALL open entries stop when the LAST work item is submitted, at that submission's time (not "now"),
//    so it does not matter who or what notices first, or how late.
//  - They also stop if every work item was removed.

export interface WorkItemLite {
  status: string;
  submittedAt?: string | null;
}
export interface EntryLite {
  id: string;
  startedAt: string;
  endedAt?: string | null;
  minutes?: number | null;
}
export type EndReason = 'ALL_SUBMITTED' | 'JOB_CLOSED' | 'NO_WORK_ITEMS';
export interface StopPlan {
  stopAt: string;
  reason: EndReason;
}

export const isOpen = (e: Pick<EntryLite, 'endedAt'>) => !e.endedAt;

export function allSubmitted(items: Pick<WorkItemLite, 'status'>[]): boolean {
  return items.length > 0 && items.every((i) => i.status === 'SUBMITTED');
}

export function lastSubmittedAt(items: WorkItemLite[]): string | null {
  let best: string | null = null;
  for (const i of items) {
    if (i.status !== 'SUBMITTED' || !i.submittedAt) continue;
    if (best === null || Date.parse(i.submittedAt) > Date.parse(best)) best = i.submittedAt;
  }
  return best;
}

export function planStop(
  items: WorkItemLite[],
  entries: Pick<EntryLite, 'endedAt'>[],
  nowIso: string
): StopPlan | null {
  if (!entries.some(isOpen)) return null;
  if (items.length === 0) return { stopAt: nowIso, reason: 'NO_WORK_ITEMS' };
  if (allSubmitted(items))
    return { stopAt: lastSubmittedAt(items) ?? nowIso, reason: 'ALL_SUBMITTED' };
  return null;
}

/** An entry never ends before it started. */
export const clampEnd = (startedAt: string, stopAt: string): string =>
  Date.parse(stopAt) < Date.parse(startedAt) ? startedAt : stopAt;

export const minutesBetween = (startIso: string, endIso: string): number =>
  Math.max(0, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000));

/** Stored job card total: whole minutes across CLOSED entries only. */
export const closedMinutesTotal = (entries: Pick<EntryLite, 'endedAt' | 'minutes'>[]): number =>
  entries.reduce((sum, e) => sum + (e.endedAt ? (e.minutes ?? 0) : 0), 0);

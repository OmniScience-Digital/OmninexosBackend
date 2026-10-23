// src/helper/jobcard/timeTracking.ts
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
  userId?: string | null;
  userName?: string | null;
  startedAt?: string | null;
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

export interface PersonTime {
  userId: string;
  name: string;
  minutes: number;
}

/**
 * Time per PERSON across CLOSED entries. Entries of one person that overlap (two logins running at once, or a
 * second device) are counted once; different people at the same time each count (it is time on the job).
 */
export function personTimes(
  entries: Pick<EntryLite, 'userId' | 'userName' | 'startedAt' | 'endedAt'>[]
): PersonTime[] {
  const byPerson = new Map<string, { name: string; spans: [number, number][] }>();
  for (const e of entries) {
    if (!e.startedAt || !e.endedAt) continue;
    const start = Date.parse(e.startedAt);
    const end = Date.parse(e.endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const key = e.userId || e.userName || 'unknown';
    const p = byPerson.get(key) ?? { name: e.userName || key, spans: [] };
    p.spans.push([start, end]);
    byPerson.set(key, p);
  }
  return [...byPerson.entries()].map(([userId, p]) => {
    p.spans.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let [curStart, curEnd] = p.spans[0];
    for (const [s0, e0] of p.spans.slice(1)) {
      if (s0 <= curEnd) curEnd = Math.max(curEnd, e0);
      else {
        total += curEnd - curStart;
        [curStart, curEnd] = [s0, e0];
      }
    }
    total += curEnd - curStart;
    return { userId, name: p.name, minutes: Math.round(total / 60_000) };
  });
}

/** Job card total: the sum of each person's time. */
export const mergedMinutesTotal = (
  entries: Pick<EntryLite, 'userId' | 'userName' | 'startedAt' | 'endedAt'>[]
): number => personTimes(entries).reduce((n, p) => n + p.minutes, 0);

export const formatDuration = (minutes: number): string => {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${m % 60} min` : `${m} min`;
};

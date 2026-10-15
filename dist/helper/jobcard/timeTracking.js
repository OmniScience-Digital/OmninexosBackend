// src/helper/jobcard/timeTracking.ts  (NEW FILE)
// The "stop the timer" rule, identical to the web app's (src/utils/helper/jobCardTime.ts). Pure, no I/O.
//
//  - Entries are per user per job card and are opened by the apps when a user engages.
//  - ALL open entries stop when the LAST work item is submitted, at that submission's time (not "now"),
//    so it does not matter who or what notices first, or how late.
//  - They also stop if every work item was removed.
export const isOpen = (e) => !e.endedAt;
export function allSubmitted(items) {
    return items.length > 0 && items.every((i) => i.status === 'SUBMITTED');
}
export function lastSubmittedAt(items) {
    let best = null;
    for (const i of items) {
        if (i.status !== 'SUBMITTED' || !i.submittedAt)
            continue;
        if (best === null || Date.parse(i.submittedAt) > Date.parse(best))
            best = i.submittedAt;
    }
    return best;
}
export function planStop(items, entries, nowIso) {
    if (!entries.some(isOpen))
        return null;
    if (items.length === 0)
        return { stopAt: nowIso, reason: 'NO_WORK_ITEMS' };
    if (allSubmitted(items))
        return { stopAt: lastSubmittedAt(items) ?? nowIso, reason: 'ALL_SUBMITTED' };
    return null;
}
/** An entry never ends before it started. */
export const clampEnd = (startedAt, stopAt) => Date.parse(stopAt) < Date.parse(startedAt) ? startedAt : stopAt;
export const minutesBetween = (startIso, endIso) => Math.max(0, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60000));
/** Stored job card total: whole minutes across CLOSED entries only. */
export const closedMinutesTotal = (entries) => entries.reduce((sum, e) => sum + (e.endedAt ? (e.minutes ?? 0) : 0), 0);

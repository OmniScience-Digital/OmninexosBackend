// src/helper/ticket/businessTime.ts
// TICKETING: pure business-hours maths. No I/O, no clock reads: callers pass the time in.
//
// Business day = startMinute..endMinute (06:00..17:00 by default), every day of the week.
// Time that does not fit in today carries over to the start of the next day.
import { DateTime } from 'luxon';
const MAX_DAYS = 3650; // safety stop for absurd inputs
function window(day, cal) {
    const dayStart = day.startOf('day');
    return {
        dayStart,
        open: dayStart.plus({ minutes: cal.startMinute }),
        close: dayStart.plus({ minutes: cal.endMinute }),
    };
}
/** True while the business day is running (start inclusive, end exclusive). */
export function isBusinessTime(at, cal) {
    const t = DateTime.fromJSDate(at, { zone: cal.zone });
    const { open, close } = window(t, cal);
    return t >= open && t < close;
}
/**
 * Moves `from` forward by `minutes` of business time.
 * Example (06:00-17:00): 08:00 + 16h -> 9h today + 7h tomorrow = 13:00 tomorrow.
 * A start outside business hours first moves to the next 06:00. With 0 minutes (ASAP) the result
 * is the first moment work can happen: now if inside the day, otherwise the next 06:00.
 */
export function addBusinessMinutes(from, minutes, cal) {
    if (!Number.isFinite(minutes) || minutes < 0)
        throw new Error(`Bad duration: ${minutes}`);
    let t = DateTime.fromJSDate(from, { zone: cal.zone });
    let remaining = minutes;
    for (let i = 0; i < MAX_DAYS; i++) {
        const { dayStart, open, close } = window(t, cal);
        if (t < open)
            t = open;
        if (t >= close) {
            t = dayStart.plus({ days: 1, minutes: cal.startMinute });
            continue;
        }
        const available = close.diff(t, 'minutes').minutes;
        if (remaining <= available)
            return t.plus({ minutes: remaining }).toJSDate();
        remaining -= available;
        t = dayStart.plus({ days: 1, minutes: cal.startMinute });
    }
    throw new Error('addBusinessMinutes: duration too long');
}
/** Business minutes between two instants (0 when `to` is not after `from`). */
export function businessMinutesBetween(from, to, cal) {
    if (to <= from)
        return 0;
    const start = DateTime.fromJSDate(from, { zone: cal.zone });
    const end = DateTime.fromJSDate(to, { zone: cal.zone });
    let total = 0;
    let day = start.startOf('day');
    for (let i = 0; i < MAX_DAYS && day <= end; i++) {
        const { open, close } = window(day, cal);
        const s = Math.max(open.toMillis(), start.toMillis());
        const e = Math.min(close.toMillis(), end.toMillis());
        if (e > s)
            total += (e - s) / 60000;
        day = day.plus({ days: 1 });
    }
    return total;
}

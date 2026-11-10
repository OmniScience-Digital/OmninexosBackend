// src/helper/ticket/businessTime.test.ts  (run with: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { addBusinessMinutes, businessMinutesBetween, isBusinessTime } from "./businessTime.js";
import { getBusinessCalendar, parseClock } from "./ticket.config.js";
const cal = getBusinessCalendar({}); // 06:00-17:00 Africa/Johannesburg
// SAST is UTC+2 all year, so 08:00 local = 06:00Z
const sast = (iso) => new Date(`${iso}+02:00`);
const show = (d) => new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    dateStyle: "short",
    timeStyle: "short",
    hour12: false,
}).format(d);
test("1 hour at 08:15 is due 09:15 (meeting example)", () => {
    assert.equal(show(addBusinessMinutes(sast("2026-11-09T08:15:00"), 60, cal)), "09/11/2026, 09:15");
});
test("16 hours at 08:00: 9h today + 7h tomorrow from 06:00 = 13:00 (meeting example)", () => {
    assert.equal(show(addBusinessMinutes(sast("2026-11-09T08:00:00"), 16 * 60, cal)), "10/11/2026, 13:00");
});
test("27 hours at 08:00 spans three days", () => {
    assert.equal(show(addBusinessMinutes(sast("2026-11-09T08:00:00"), 27 * 60, cal)), "11/11/2026, 13:00");
});
test("work that ends exactly at 17:00 stays on the same day", () => {
    assert.equal(show(addBusinessMinutes(sast("2026-11-09T15:00:00"), 120, cal)), "09/11/2026, 17:00");
});
test("submitted after hours starts at 06:00 next day", () => {
    assert.equal(show(addBusinessMinutes(sast("2026-11-09T21:30:00"), 60, cal)), "10/11/2026, 07:00");
});
test("submitted before 06:00 starts at 06:00 the same day", () => {
    assert.equal(show(addBusinessMinutes(sast("2026-11-09T03:00:00"), 120, cal)), "09/11/2026, 08:00");
});
test("every day counts: Friday evening work carries into Saturday", () => {
    // 2026-11-13 is a Friday
    assert.equal(show(addBusinessMinutes(sast("2026-11-13T16:00:00"), 120, cal)), "14/11/2026, 07:00");
});
test("ASAP (0 minutes): now inside the day, next 06:00 outside it", () => {
    assert.equal(show(addBusinessMinutes(sast("2026-11-09T10:20:00"), 0, cal)), "09/11/2026, 10:20");
    assert.equal(show(addBusinessMinutes(sast("2026-11-09T18:00:00"), 0, cal)), "10/11/2026, 06:00");
});
test("rejects negative or non-finite durations", () => {
    assert.throws(() => addBusinessMinutes(new Date(), -1, cal));
    assert.throws(() => addBusinessMinutes(new Date(), NaN, cal));
});
test("isBusinessTime: start inclusive, end exclusive", () => {
    assert.equal(isBusinessTime(sast("2026-11-09T05:59:00"), cal), false);
    assert.equal(isBusinessTime(sast("2026-11-09T06:00:00"), cal), true);
    assert.equal(isBusinessTime(sast("2026-11-09T16:59:00"), cal), true);
    assert.equal(isBusinessTime(sast("2026-11-09T17:00:00"), cal), false);
});
test("businessMinutesBetween counts only business time", () => {
    assert.equal(businessMinutesBetween(sast("2026-11-09T08:00:00"), sast("2026-11-09T09:30:00"), cal), 90);
    // 16:00 -> 07:00 next day = 60 (today) + 60 (tomorrow)
    assert.equal(businessMinutesBetween(sast("2026-11-09T16:00:00"), sast("2026-11-10T07:00:00"), cal), 120);
    // fully outside hours
    assert.equal(businessMinutesBetween(sast("2026-11-09T18:00:00"), sast("2026-11-10T05:00:00"), cal), 0);
    assert.equal(businessMinutesBetween(sast("2026-11-09T10:00:00"), sast("2026-11-09T09:00:00"), cal), 0);
});
test("addBusinessMinutes and businessMinutesBetween agree", () => {
    for (const mins of [30, 60, 240, 960, 1620]) {
        const from = sast("2026-11-09T08:00:00");
        const due = addBusinessMinutes(from, mins, cal);
        assert.equal(businessMinutesBetween(from, due, cal), mins);
    }
});
test("business hours can be changed through the environment", () => {
    const late = getBusinessCalendar({
        TICKET_BUSINESS_END: "19:00",
    });
    assert.equal(show(addBusinessMinutes(sast("2026-11-09T17:00:00"), 60, late)), "09/11/2026, 18:00");
    assert.throws(() => getBusinessCalendar({ TICKET_BUSINESS_END: "05:00" }));
    assert.throws(() => parseClock("9am"));
});

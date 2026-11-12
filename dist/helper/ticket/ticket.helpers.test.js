// src/helper/ticket/ticket.helpers.test.ts  (run with: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { dueEscalations, reminderDue } from "./escalation.js";
import { syncWindowOpen } from "./cronHours.js";
import { buildDescription, buildTaskName, escapeTelegram, followUpComment, formatTicketNumber, gleedComment, isBotText, formatDueShort, telegramEscalationMessage, telegramOverdueDigest, telegramUpdateMessage, } from "./ticket.format.js";
import { BOT_SIGNATURE, getBusinessCalendar } from "./ticket.config.js";
const cal = getBusinessCalendar({});
const sast = (iso) => new Date(`${iso}+02:00`);
// ---------------------------------------------------------------- formatting
test("task numbers are padded and the pad is configurable", () => {
    assert.equal(formatTicketNumber(1), "T-0001");
    assert.equal(formatTicketNumber(42), "T-0042");
    assert.equal(formatTicketNumber(12345), "T-12345");
    assert.equal(formatTicketNumber(1, 5), "T-00001");
});
test("task name is \"T-0001, Title\" with tidy spacing", () => {
    assert.equal(buildTaskName("T-0001", "  Fix   the pump "), "T-0001, Fix the pump");
});
test("description lists assignees, due date and outcome, and flags fallbacks", () => {
    const text = buildDescription({
        assignees: [
            { name: "Marco", clickupUserId: 1, fallback: false },
            { name: "Byron", clickupUserId: 9, fallback: true },
        ],
        dueAt: sast("2026-11-10T13:00:00"),
        requiredOutcome: " Pump running ",
    });
    assert.equal(text, "Assignees: Marco, Byron (not on ClickUp)\nDue Date: Tue 10 Nov 2026, 13:00 SAST\nRequired Outcome: Pump running");
});
test("every Telegram message carries the due date as \"Due 11 November 14:00\"", () => {
    const due = sast("2026-11-11T14:00:00");
    assert.equal(formatDueShort(due), "11 November 14:00");
    assert.equal(telegramUpdateMessage("T-0002, Test Ticket", "Sean Fray", "I have started", due), "T-0002, Test Ticket\nDue 11 November 14:00\nSean Fray sent this message: I have started");
    assert.equal(telegramEscalationMessage("T-0002, Test Ticket", "followUp", due), "T-0002, Test Ticket\nDue 11 November 14:00\nNo feedback received on this task yet (50% of the time used).");
    // no due date known: the line is simply left out
    assert.equal(telegramUpdateMessage("T-0002, x", "A", "hi"), "T-0002, x\nA sent this message: hi");
});
test("Telegram text escapes legacy Markdown characters", () => {
    assert.equal(escapeTelegram("pump_2 *urgent* [a] `x`"), "pump\\_2 \\*urgent\\* \\[a] \\`x\\`");
    assert.equal(telegramUpdateMessage("T-0001, Fix pump_2", "Sean Fray", "Started *now*"), "T-0001, Fix pump\\_2\nSean Fray sent this message: Started \\*now\\*");
});
test("very long updates are clipped under the Telegram limit", () => {
    assert.ok(telegramUpdateMessage("T-0001, x", "A", "y".repeat(10000)).length < 4096);
});
test("escalation notice names the stage and never mentions Gleed or tagging", () => {
    const due = sast("2026-11-10T13:00:00");
    assert.match(telegramEscalationMessage("T-0001, x", "followUp", due), /50%/);
    const g = telegramEscalationMessage("T-0001, x", "gleed", due);
    assert.match(g, /70%/);
    assert.doesNotMatch(g, /Gleed|tagged/); // the group is never told who was tagged
});
test("ClickUp comments tag the right people and carry the bot signature", () => {
    const due = sast("2026-11-10T13:00:00");
    const f = followUpComment("T-0001", [11, 22], due);
    assert.deepEqual(f.filter((b) => "type" in b), [
        { type: "tag", user: { id: 11 } },
        { type: "tag", user: { id: 22 } },
    ]);
    const g = gleedComment("T-0001", null, due); // Gleed unresolved: still posts, no tag
    assert.equal(g.filter((b) => "type" in b).length, 0);
    for (const blocks of [f, g]) {
        const all = blocks.map((b) => ("text" in b ? b.text : "")).join("");
        assert.ok(isBotText(all));
        assert.ok(all.includes(BOT_SIGNATURE));
    }
    assert.equal(isBotText("I have started"), false);
});
// ---------------------------------------------------------------- escalation
const base = (over) => ({
    urgencyMinutes: 240, // 4H
    submittedAt: sast("2026-11-09T08:00:00"),
    now: sast("2026-11-09T08:00:00"),
    hasUpdate: false,
    followUpDone: false,
    gleedDone: false,
    ...over,
});
test("4H task: nothing before 50%, follow-up at 50%, Gleed at 70%", () => {
    assert.deepEqual(dueEscalations(base({ now: sast("2026-11-09T09:55:00") }), cal), []); // 115 min
    assert.deepEqual(dueEscalations(base({ now: sast("2026-11-09T10:00:00") }), cal), ["followUp"]); // 120 = 50%
    assert.deepEqual(dueEscalations(base({ now: sast("2026-11-09T10:55:00"), followUpDone: true }), cal), ["gleed"]); // 175 >= 168
});
test("70% is 168 minutes on a 4H task", () => {
    assert.deepEqual(dueEscalations(base({ now: sast("2026-11-09T10:47:00"), followUpDone: true }), cal), []); // 167
    assert.deepEqual(dueEscalations(base({ now: sast("2026-11-09T10:48:00"), followUpDone: true }), cal), ["gleed"]); // 168
});
test("a person replying stops all escalation", () => {
    assert.deepEqual(dueEscalations(base({ now: sast("2026-11-09T14:00:00"), hasUpdate: true }), cal), []);
});
test("steps already done are not repeated", () => {
    const now = sast("2026-11-09T14:00:00");
    assert.deepEqual(dueEscalations(base({ now, followUpDone: true, gleedDone: true }), cal), []);
});
test("after downtime both steps come out in order", () => {
    assert.deepEqual(dueEscalations(base({ now: sast("2026-11-09T14:00:00") }), cal), ["followUp", "gleed"]);
});
test("ASAP has no 50% / 70% steps (it has the hourly report instead)", () => {
    const t = base({ urgencyMinutes: 0, submittedAt: sast("2026-11-09T10:00:00"), now: sast("2026-11-09T12:00:00") });
    assert.deepEqual(dueEscalations(t, cal), []);
});
test("nothing is posted outside business hours; the step waits for 06:00", () => {
    // 1H task submitted 16:30: 30 min today, 30 min tomorrow. 50% is reached at 17:00 but nobody is paged at night.
    const t = base({ urgencyMinutes: 60, submittedAt: sast("2026-11-09T16:30:00"), now: sast("2026-11-09T17:05:00") });
    assert.deepEqual(dueEscalations(t, cal), []);
    assert.deepEqual(dueEscalations({ ...t, now: sast("2026-11-10T06:05:00") }, cal), ["followUp"]); // 35 min used
});
test("overnight time does not count: 16H task submitted 16:00", () => {
    const t = base({ urgencyMinutes: 960, submittedAt: sast("2026-11-09T16:00:00") });
    // 60 min used by 17:00, 60 more by 07:00 next day = 120 of 960: nowhere near 50%
    assert.deepEqual(dueEscalations({ ...t, now: sast("2026-11-10T07:00:00") }, cal), []);
});
// ---------------------------------------------------------------- hourly overdue reminder
test("digest: one message, oldest first, with a count and each due date, special characters escaped", () => {
    const [msg, ...rest] = telegramOverdueDigest([
        { taskName: "T-0002, Later_task", dueAt: sast("2026-11-09T12:00:00") },
        { taskName: "T-0001, Earlier", dueAt: sast("2026-11-09T09:00:00") },
    ]);
    assert.equal(rest.length, 0);
    assert.equal(msg, "Overdue tasks, still open (2):\n\nT-0001, Earlier\nDue 9 November 09:00\n\nT-0002, Later\\_task\nDue 9 November 12:00");
});
test("digest: a very long list is split into several messages, none over the Telegram limit", () => {
    const items = Array.from({ length: 120 }, (_, i) => ({
        taskName: `T-${String(i + 1).padStart(4, "0")}, ${"x".repeat(60)}`,
        dueAt: sast("2026-11-09T09:00:00"),
    }));
    const messages = telegramOverdueDigest(items);
    assert.ok(messages.length > 1);
    assert.ok(messages.every((m) => m.length < 4096));
    assert.match(messages[1], /^Overdue tasks, continued:/);
    assert.equal(messages.join("\n").match(/T-\d{4}/g).length, 120); // nothing dropped
});
test("digest: nothing to report gives no message", () => {
    assert.deepEqual(telegramOverdueDigest([]), []);
});
test("reminder: an open task past its due date is listed on the hour, but not before it is due", () => {
    const t = (now, last = null) => reminderDue({ urgency: "4H", createdAt: sast("2026-11-09T08:00:00"), dueAt: sast("2026-11-09T12:00:00"), lastReminderAt: last ? sast(last) : null, now: sast(now) }, cal);
    assert.equal(t("2026-11-09T11:05:00"), false); // not due yet
    assert.equal(t("2026-11-09T12:00:00"), true);
    assert.equal(t("2026-11-09T12:05:00"), true); // second run in the same window
    assert.equal(t("2026-11-09T12:30:00"), false); // only in the first minutes of the hour
    assert.equal(t("2026-11-09T12:05:00", "2026-11-09T12:00:00"), false); // already reminded this hour
    assert.equal(t("2026-11-09T13:00:00", "2026-11-09T12:00:00"), true); // and again next hour
});
test("reminder: never outside business hours, and nothing without a due date", () => {
    const base = { urgency: "4H", createdAt: sast("2026-11-09T08:00:00"), dueAt: sast("2026-11-09T12:00:00"), lastReminderAt: null };
    assert.equal(reminderDue({ ...base, now: sast("2026-11-09T17:00:00") }, cal), false);
    assert.equal(reminderDue({ ...base, now: sast("2026-11-09T20:00:00") }, cal), false);
    assert.equal(reminderDue({ ...base, now: sast("2026-11-10T06:00:00") }, cal), true); // first thing next morning
    assert.equal(reminderDue({ ...base, dueAt: null, now: sast("2026-11-09T13:00:00") }, cal), false);
});
test("reminder: ASAP tasks join one hour after creation", () => {
    const base = { urgency: "ASAP", createdAt: sast("2026-11-09T08:00:00"), dueAt: sast("2026-11-09T08:00:00"), lastReminderAt: null };
    assert.equal(reminderDue({ ...base, now: sast("2026-11-09T08:05:00") }, cal), false);
    assert.equal(reminderDue({ ...base, now: sast("2026-11-09T09:00:00") }, cal), true);
});
test("sync window: 06:00 to 17:00 only, unless switched to always", () => {
    assert.equal(syncWindowOpen(sast("2026-11-09T05:59:00"), cal, false), false);
    assert.equal(syncWindowOpen(sast("2026-11-09T06:00:00"), cal, false), true);
    assert.equal(syncWindowOpen(sast("2026-11-09T16:59:00"), cal, false), true);
    assert.equal(syncWindowOpen(sast("2026-11-09T17:00:00"), cal, false), false);
    assert.equal(syncWindowOpen(sast("2026-11-09T23:00:00"), cal, true), true);
});

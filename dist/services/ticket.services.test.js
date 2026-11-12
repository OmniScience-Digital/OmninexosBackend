// src/services/ticket.services.test.ts  (run with: npm test)
// Runs the real intake and sync services against in-memory fakes of DynamoDB, ClickUp and Telegram.
import { test } from "node:test";
import assert from "node:assert/strict";
import { processSubmittedTickets } from "./ticket.intake.service.js";
import { syncOpenTickets, syncTicketByTaskId } from "./ticket.sync.service.js";
import { resolveAssignees, resolveTicketAssignees } from "../helper/ticket/ticket.assignees.js";
import { refreshRoster } from "./ticket.roster.service.js";
import { BOT_SIGNATURE, MAX_ATTEMPTS, getBusinessCalendar } from "../helper/ticket/ticket.config.js";
const cal = getBusinessCalendar({});
const sast = (iso) => new Date(`${iso}+02:00`);
const MEMBERS = [
    { id: 1, username: "Marco Venter" },
    { id: 2, username: "Byron Smit" },
    { id: 9, username: "Gleed Nkosi" },
];
// ------------------------------------------------------------------ fakes
function world(start = "2026-11-09T08:00:00") {
    let clock = sast(start);
    const rows = new Map();
    let counter = 0;
    const repo = {
        async listTicketsByStatus(status, max) {
            return [...rows.values()].filter((r) => r.status === status).slice(0, max).map((r) => structuredClone(r));
        },
        async claimTicket(id, expect, nowMs, leaseMs) {
            const r = rows.get(id);
            if (!r || r.status !== expect || (r.lockedUntil !== undefined && r.lockedUntil >= nowMs))
                return false;
            r.lockedUntil = nowMs + leaseMs;
            return true;
        },
        async updateTicket(id, set, remove = []) {
            const r = rows.get(id);
            for (const [k, v] of Object.entries(set))
                if (v !== undefined)
                    r[k] = v;
            remove.forEach((k) => delete r[k]);
        },
        async nextTicketNumber() {
            return ++counter;
        },
        async setTicketNumberOnce(id, n) {
            const r = rows.get(id);
            if (r.ticketNumber)
                return false;
            r.ticketNumber = n;
            return true;
        },
        async getTicket(id) {
            return structuredClone(rows.get(id) ?? null);
        },
        async addBotCommentId(id, cid) {
            const r = rows.get(id);
            r.botCommentIds = [...(r.botCommentIds ?? []), cid];
        },
    };
    const tasks = new Map();
    const comments = {};
    const created = [];
    const posted = [];
    const failures = { createTask: 0 };
    let nextId = 100;
    let members = MEMBERS;
    const clickup = {
        async getListMembers() {
            return members;
        },
        async createTask(input) {
            if (failures.createTask > 0) {
                failures.createTask--;
                throw new Error("ClickUp is down");
            }
            const id = `cu${nextId++}`;
            created.push({ id, ...input });
            tasks.set(id, { statusType: "open" });
            comments[id] = [];
            return { id, url: `https://app.clickup.com/t/${id}` };
        },
        async getTask(id) {
            const t = tasks.get(id);
            return t ? { id, statusType: t.statusType } : null;
        },
        async listComments(id, since) {
            return (comments[id] ?? []).filter((c) => c.dateMs > since).sort((a, b) => a.dateMs - b.dateMs);
        },
        async postComment(id, blocks) {
            const cid = `bot${nextId++}`;
            posted.push({ taskId: id, blocks });
            const text = blocks.map((b) => ("text" in b ? b.text : "@tag")).join("");
            comments[id].push({ id: cid, text, userId: 99, userName: "Token owner", dateMs: clock.getTime() });
            return { id: cid };
        },
    };
    const telegram = [];
    let telegramOk = true;
    const base = {
        repo,
        clickup,
        now: () => clock,
        cal,
        gleedName: "Gleed",
        escalationUserId: null,
        telegramChatId: "chat1",
        sendTelegram: async (_c, text) => {
            if (!telegramOk)
                return false;
            telegram.push(text);
            return true;
        },
    };
    const intake = {
        ...base,
        numberPad: 4,
        overrides: {},
        notifyOnCreate: false,
        raiseEscalation: async (t) => void escalations.push(t),
    };
    const sync = base;
    const escalations = [];
    const submit = (over = {}) => {
        const id = `id${rows.size + 1}`;
        rows.set(id, {
            id,
            status: "SUBMITTED",
            title: "Fix the pump",
            requiredOutcome: "Pump running",
            urgency: "4H",
            assignees: ["Marco"],
            createdAt: clock.toISOString(),
            ...over,
        });
        return id;
    };
    return {
        rows,
        tasks,
        comments,
        created,
        posted,
        telegram,
        escalations,
        failures,
        intake,
        sync,
        submit,
        setMembers: (m) => (members = m),
        setClock: (iso) => (clock = sast(iso)),
        advance: (ms) => (clock = new Date(clock.getTime() + ms)),
        setTelegramOk: (ok) => (telegramOk = ok),
        human: (taskId, text, at, name = "Sean Fray") => comments[taskId].push({ id: `h${nextId++}`, text, userId: 1, userName: name, dateMs: sast(at).getTime() }),
    };
}
// ------------------------------------------------------------------ intake
test("intake: numbers the ticket, works out the due date, creates the ClickUp task, goes OPEN", async () => {
    const w = world();
    const id = w.submit({ assignees: ["Marco", "Byron"], urgency: "16H" });
    assert.equal(await processSubmittedTickets(w.intake), 1);
    const r = w.rows.get(id);
    assert.equal(r.status, "OPEN");
    assert.equal(r.ticketNumber, "T-0001");
    assert.equal(r.dueAt, sast("2026-11-10T13:00:00").toISOString()); // 9h today + 7h tomorrow
    assert.equal(r.urgencyMinutes, 960);
    assert.equal(r.lockedUntil, undefined);
    assert.equal(typeof r.resolvedAssignees, "string"); // AWSJSON is stored as a string
    assert.ok(r.clickupTaskId);
    const task = w.created[0];
    assert.equal(task.name, "T-0001, Fix the pump");
    assert.deepEqual(task.assigneeIds, [1, 2]);
    assert.equal(task.dueAt.getTime(), sast("2026-11-10T13:00:00").getTime());
    assert.match(task.description, /^Assignees: Marco, Byron\nDue Date: Tue 10 Nov 2026, 13:00 SAST\nRequired Outcome: Pump running$/);
});
test("intake: due date is based on the server creation time, not when the worker ran", async () => {
    const w = world("2026-11-09T08:15:00");
    w.submit({ urgency: "1H" });
    w.advance(10 * 60000); // the worker only gets to it 10 minutes later
    await processSubmittedTickets(w.intake);
    assert.equal(w.created[0].dueAt.getTime(), sast("2026-11-09T09:15:00").getTime());
});
test("intake: consecutive tickets get consecutive numbers", async () => {
    const w = world();
    w.submit();
    w.submit();
    await processSubmittedTickets(w.intake);
    assert.deepEqual([...w.rows.values()].map((r) => r.ticketNumber), ["T-0001", "T-0002"]);
});
test("intake: a name that is not on ClickUp goes to Gleed", async () => {
    const w = world();
    w.submit({ assignees: ["Shaughn"] });
    await processSubmittedTickets(w.intake);
    assert.deepEqual(w.created[0].assigneeIds, [9]);
    assert.match(w.created[0].description, /Shaughn \(not on ClickUp\)/);
});
test("intake: ClickUp down -> retried later, same number, one task, back-off respected", async () => {
    const w = world();
    const id = w.submit();
    w.failures.createTask = 1;
    assert.equal(await processSubmittedTickets(w.intake), 0);
    let r = w.rows.get(id);
    assert.equal(r.status, "SUBMITTED");
    assert.equal(r.attempts, 1);
    assert.match(r.lastError, /ClickUp is down/);
    assert.equal(r.ticketNumber, "T-0001");
    // straight away: still backing off
    assert.equal(await processSubmittedTickets(w.intake), 0);
    assert.equal(w.created.length, 0);
    w.advance(60000);
    assert.equal(await processSubmittedTickets(w.intake), 1);
    r = w.rows.get(id);
    assert.equal(r.status, "OPEN");
    assert.equal(r.ticketNumber, "T-0001"); // number not burned by the retry
    assert.equal(w.created.length, 1);
    assert.equal(r.lastError, undefined);
});
test("intake: gives up after MAX_ATTEMPTS, marks FAILED and raises an escalation", async () => {
    const w = world();
    const id = w.submit();
    w.failures.createTask = 999;
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
        await processSubmittedTickets(w.intake);
        w.advance(11 * 60000);
    }
    assert.equal(w.rows.get(id).status, "FAILED");
    assert.equal(w.escalations.length, 1);
});
test("intake: an unknown urgency is rejected without using up a number", async () => {
    const w = world();
    const bad = w.submit({ urgency: "48H" });
    const good = w.submit();
    await processSubmittedTickets(w.intake);
    assert.equal(w.rows.get(bad).status, "FAILED");
    assert.equal(w.rows.get(bad).ticketNumber, undefined);
    assert.equal(w.rows.get(good).ticketNumber, "T-0001");
});
test("intake: Telegram \"created\" message only when switched on", async () => {
    const w = world();
    w.submit();
    await processSubmittedTickets(w.intake);
    assert.equal(w.telegram.length, 0);
    w.submit();
    await processSubmittedTickets({ ...w.intake, notifyOnCreate: true });
    assert.equal(w.telegram.length, 1);
});
// ------------------------------------------------------------------ sync
async function openTicket(w, over = {}) {
    const id = w.submit(over);
    await processSubmittedTickets(w.intake);
    return { id, taskId: w.rows.get(id).clickupTaskId };
}
test("sync: a person's comment goes to Telegram once and counts as an update", async () => {
    const w = world();
    const { id, taskId } = await openTicket(w);
    w.advance(5 * 60000);
    w.human(taskId, "I have started", "2026-11-09T08:03:00");
    await syncOpenTickets(w.sync);
    assert.deepEqual(w.telegram, ["T-0001, Fix the pump\nDue 9 November 12:00\nSean Fray sent this message: I have started"]);
    assert.equal(w.rows.get(id).hasUpdate, true);
    w.advance(5 * 60000);
    await syncOpenTickets(w.sync);
    assert.equal(w.telegram.length, 1); // not sent again
});
test("sync: Telegram down -> comment kept and sent on the next run, never lost or doubled", async () => {
    const w = world();
    const { taskId } = await openTicket(w);
    w.human(taskId, "Working on it", "2026-11-09T08:02:00");
    w.advance(5 * 60000);
    w.setTelegramOk(false);
    await syncOpenTickets(w.sync);
    assert.equal(w.telegram.length, 0);
    w.setTelegramOk(true);
    w.advance(5 * 60000);
    await syncOpenTickets(w.sync);
    w.advance(5 * 60000);
    await syncOpenTickets(w.sync);
    assert.equal(w.telegram.length, 1);
});
test("sync: 4H task with no update -> follow-up at 50% tagging the assignee, Gleed at 70%", async () => {
    const w = world(); // created 08:00, 4H -> due 12:00
    const { id } = await openTicket(w, { assignees: ["Marco", "Byron"] });
    w.setClock("2026-11-09T09:55:00"); // 115 min: not yet
    await syncOpenTickets(w.sync);
    assert.equal(w.posted.length, 0);
    w.setClock("2026-11-09T10:00:00"); // 120 min = 50%
    await syncOpenTickets(w.sync);
    assert.equal(w.posted.length, 1);
    assert.deepEqual(w.posted[0].blocks.filter((b) => "type" in b), [
        { type: "tag", user: { id: 1 } },
        { type: "tag", user: { id: 2 } },
    ]);
    assert.match(w.telegram[w.telegram.length - 1], /No feedback received on this task yet \(50%/);
    w.setClock("2026-11-09T10:05:00"); // the bot's own comment must not count as an update
    await syncOpenTickets(w.sync);
    assert.equal(w.rows.get(id).hasUpdate, false);
    assert.equal(w.posted.length, 1); // follow-up not repeated
    w.setClock("2026-11-09T10:50:00"); // 170 min >= 168 = 70%
    await syncOpenTickets(w.sync);
    assert.equal(w.posted.length, 2);
    assert.deepEqual(w.posted[1].blocks.filter((b) => "type" in b), [{ type: "tag", user: { id: 9 } }]); // Gleed
    assert.match(w.telegram[w.telegram.length - 1], /70%/);
    assert.doesNotMatch(w.telegram[w.telegram.length - 1], /Gleed|tagged/);
    w.setClock("2026-11-09T11:30:00");
    await syncOpenTickets(w.sync);
    assert.equal(w.posted.length, 2); // each step happens once
    assert.ok(w.posted.every((p) => p.blocks.some((b) => "text" in b && b.text.includes(BOT_SIGNATURE))));
});
test("sync: an update before 50% means no escalation at all", async () => {
    const w = world();
    const { taskId } = await openTicket(w);
    w.human(taskId, "On it", "2026-11-09T08:30:00");
    w.setClock("2026-11-09T11:00:00");
    await syncOpenTickets(w.sync);
    assert.equal(w.posted.length, 0);
    assert.equal(w.telegram.length, 1); // just the forwarded update
});
test("sync: finished or deleted ClickUp tasks close the ticket and stop all follow-ups", async () => {
    const w = world();
    const a = await openTicket(w);
    const b = await openTicket(w);
    w.tasks.get(a.taskId).statusType = "closed";
    w.tasks.delete(b.taskId);
    w.setClock("2026-11-09T12:00:00");
    await syncOpenTickets(w.sync);
    assert.equal(w.rows.get(a.id).status, "CLOSED");
    assert.equal(w.rows.get(b.id).status, "CLOSED");
    assert.equal(w.posted.length, 0);
});
test("sync: one broken ticket does not stop the others", async () => {
    const w = world();
    const a = await openTicket(w);
    const b = await openTicket(w);
    const original = w.sync.clickup.getTask;
    w.sync.clickup.getTask = async (id) => {
        if (id === a.taskId)
            throw new Error("boom");
        return original(id);
    };
    w.human(b.taskId, "Done soon", "2026-11-09T08:01:00");
    w.advance(5 * 60000);
    await syncOpenTickets(w.sync);
    assert.equal(w.telegram.length, 1);
    assert.equal(w.rows.get(a.id).lockedUntil, undefined); // lease released for the retry
});
// ------------------------------------------------------------------ assignee matching
test("assignees: whole-word match, ambiguity and unknown names fall back to Gleed", () => {
    const members = [...MEMBERS, { id: 3, username: "Marco Botha" }];
    const r = resolveAssignees(["Byron", "Marco", "Tshepo", "byron"], members, {}, "Gleed");
    assert.deepEqual(r.assignees, [
        { name: "Byron", clickupUserId: 2, fallback: false },
        { name: "Marco", clickupUserId: 9, fallback: true }, // two Marcos: ambiguous
        { name: "Tshepo", clickupUserId: 9, fallback: true },
    ]);
    assert.equal(r.warnings.length, 2);
});
test("assignees: an explicit id map pins a name, and Gleed missing is tolerated", () => {
    const r = resolveAssignees(["Shaughn"], MEMBERS, { shaughn: 2 }, "Gleed");
    assert.equal(r.assignees[0].clickupUserId, 2);
    const none = resolveAssignees(["Shaughn"], [], {}, "Gleed");
    assert.equal(none.assignees[0].clickupUserId, null);
    assert.ok(none.warnings.some((x) => x.includes("Fallback")));
});
// ------------------------------------------------------------------ people picked from ClickUp (by id)
test("intake: ClickUp people go by id; someone with no ClickUp account (Gleed) goes to the fallback user", async () => {
    const w = world();
    w.submit({ assignees: ["Marco", "Gleed"], assigneeClickupIds: ["1"] });
    await processSubmittedTickets(w.intake);
    assert.deepEqual(w.created[0].assigneeIds, [1, 9]); // 9 = fallback user (the member named Gleed here)
    assert.match(w.created[0].description, /^Assignees: Marco Venter, Gleed \(not on ClickUp\)/);
});
test("intake: an alias must never cause a wrong assignment (counts decide, not name guessing)", async () => {
    const w = world();
    // The picker shows the standard name "Conraad" for ClickUp user 2 ("Byron Smit" here stands in for
    // a member whose ClickUp name differs from the standard name). Names 1, ids 1: nobody lacks an account.
    w.submit({ assignees: ["Conraad"], assigneeClickupIds: ["2"] });
    await processSubmittedTickets(w.intake);
    assert.deepEqual(w.created[0].assigneeIds, [2]);
});
test("intake: a picked ClickUp user who has since left ClickUp goes to the fallback user", async () => {
    const w = world();
    w.submit({ assignees: ["Ghost"], assigneeClickupIds: ["555"] });
    await processSubmittedTickets(w.intake);
    assert.deepEqual(w.created[0].assigneeIds, [9]);
});
test("intake: tickets saved without ids (older ones) are still resolved by name", async () => {
    const w = world();
    w.submit({ assignees: ["Byron"] });
    await processSubmittedTickets(w.intake);
    assert.deepEqual(w.created[0].assigneeIds, [2]);
});
test("resolveTicketAssignees: nobody picked still gets an owner", () => {
    const r = resolveTicketAssignees([], [], MEMBERS, 9, {}, "Gleed");
    assert.equal(r.assignees[0].clickupUserId, 9);
});
test("resolveTicketAssignees: two without accounts, labelled when the names line up", () => {
    const r = resolveTicketAssignees(["Marco", "Gleed", "Visitor"], ["1"], MEMBERS, 9, {}, "Gleed");
    assert.deepEqual(r.assignees.map((a) => [a.name, a.fallback]), [["Marco Venter", false], ["Gleed", true], ["Visitor", true]]);
});
test("70%: the configured ClickUp user is tagged, even if that person is not on the list", async () => {
    const w = world();
    await openTicket(w);
    w.sync.escalationUserId = 77;
    w.setClock("2026-11-09T11:30:00");
    await syncOpenTickets(w.sync);
    const gleedStep = w.posted[w.posted.length - 1];
    assert.deepEqual(gleedStep.blocks.filter((b) => "type" in b), [{ type: "tag", user: { id: 77 } }]);
});
test("70%: if nobody can be tagged the comment still goes out untagged and Telegram does not claim a tag", async () => {
    const w = world();
    w.setMembers([MEMBERS[0], MEMBERS[1]]); // no Gleed in ClickUp
    await openTicket(w);
    w.setClock("2026-11-09T11:30:00");
    await syncOpenTickets(w.sync);
    assert.equal(w.posted.length, 2);
    assert.equal(w.posted[1].blocks.filter((b) => "type" in b).length, 0);
    assert.ok(w.telegram.every((t) => !/tagged|Gleed/.test(t)));
});
// ------------------------------------------------------------------ people list kept in step with ClickUp
function rosterWorld(initial = []) {
    const table = new Map(initial.map((r) => [r.id, r]));
    let members = [];
    return {
        table,
        setMembers: (m) => (members = m),
        run: () => refreshRoster({
            clickup: { getListMembers: async () => members },
            repo: {
                listMembers: async () => [...table.values()],
                putMember: async (p) => void table.set(p.id, { ...p }),
            },
        }),
    };
}
test("roster: copies ClickUp members, then only writes what changed", async () => {
    const r = rosterWorld();
    r.setMembers([{ id: 1, username: "Marco Venter", email: "m@x.co", avatarUrl: "https://a/1.png" }, { id: 2, username: "Byron Smit" }]);
    assert.equal(await r.run(), 2);
    assert.equal(r.table.get("1").avatarUrl, "https://a/1.png");
    assert.equal(r.table.get("1").isActive, true);
    assert.equal(await r.run(), 0); // nothing changed, nothing written
    r.setMembers([{ id: 1, username: "Marco V", email: "m@x.co", avatarUrl: "https://a/1.png" }, { id: 2, username: "Byron Smit" }]);
    assert.equal(await r.run(), 1);
    assert.equal(r.table.get("1").name, "Marco V");
});
test("roster: someone removed from ClickUp is switched off, and comes back when re-added", async () => {
    const r = rosterWorld();
    r.setMembers([{ id: 1, username: "Marco" }, { id: 2, username: "Byron" }]);
    await r.run();
    r.setMembers([{ id: 1, username: "Marco" }]);
    await r.run();
    assert.equal(r.table.get("2").isActive, false);
    r.setMembers([{ id: 1, username: "Marco" }, { id: 2, username: "Byron" }]);
    await r.run();
    assert.equal(r.table.get("2").isActive, true);
});
test("roster: an empty ClickUp answer never switches everyone off", async () => {
    const r = rosterWorld();
    r.setMembers([{ id: 1, username: "Marco" }]);
    await r.run();
    r.setMembers([]);
    assert.equal(await r.run(), 0);
    assert.equal(r.table.get("1").isActive, true);
});
// ------------------------------------------------------------------ webhook wake-up
test("webhook: a reply reaches Telegram straight away, only for the ticket it is about", async () => {
    const w = world();
    const a = await openTicket(w);
    const b = await openTicket(w);
    w.human(a.taskId, "Started now", "2026-11-09T08:01:00");
    w.human(b.taskId, "Other ticket reply", "2026-11-09T08:01:00");
    w.advance(60000);
    assert.equal(await syncTicketByTaskId(w.sync, a.taskId), true);
    assert.equal(w.telegram.length, 1);
    assert.match(w.telegram[0], /T-0001/);
    assert.equal(w.rows.get(a.id).hasUpdate, true);
    assert.equal(w.rows.get(b.id).hasUpdate, false); // the other ticket waits for its own wake-up or the 5 minute run
    await syncOpenTickets(w.sync); // the safety-net run does not send the same reply twice
    assert.equal(w.telegram.filter((t) => t.includes("Started now")).length, 1);
    assert.equal(w.telegram.filter((t) => t.includes("Other ticket reply")).length, 1);
});
test("webhook: a task with no open ticket is ignored, and a busy ticket is skipped without double sending", async () => {
    const w = world();
    const a = await openTicket(w);
    assert.equal(await syncTicketByTaskId(w.sync, "nope"), false);
    w.human(a.taskId, "Hello", "2026-11-09T08:01:00");
    w.advance(60000);
    w.rows.get(a.id).lockedUntil = w.sync.now().getTime() + 60000; // the 5 minute run holds it
    await syncTicketByTaskId(w.sync, a.taskId);
    assert.equal(w.telegram.length, 0); // skipped: that run will read the same comments
});
// ------------------------------------------------------------------ hourly overdue reminder
const digests = (w) => w.telegram.filter((t) => t.startsWith("Overdue tasks"));
test("reminder: a task past its due date is listed every hour until it is closed; a reply does not stop it", async () => {
    const w = world(); // 4H from 08:00, due 12:00
    const { id, taskId } = await openTicket(w);
    w.human(taskId, "On it", "2026-11-09T08:30:00");
    w.setClock("2026-11-09T11:00:00");
    await syncOpenTickets(w.sync);
    assert.equal(digests(w).length, 0); // not due yet
    w.setClock("2026-11-09T12:05:00");
    await syncOpenTickets(w.sync);
    assert.equal(digests(w).length, 1);
    assert.match(digests(w)[0], /T-0001, Fix the pump\nDue 9 November 12:00/);
    w.setClock("2026-11-09T12:30:00"); // not again within the hour
    await syncOpenTickets(w.sync);
    assert.equal(digests(w).length, 1);
    w.setClock("2026-11-09T13:00:00");
    await syncOpenTickets(w.sync);
    w.setClock("2026-11-09T16:00:00");
    await syncOpenTickets(w.sync);
    assert.equal(digests(w).length, 3);
    w.setClock("2026-11-09T17:00:00"); // 17:00 is outside business hours
    await syncOpenTickets(w.sync);
    assert.equal(digests(w).length, 3);
    w.tasks.get(taskId).statusType = "closed"; // closing the ClickUp task ends the reminders
    w.setClock("2026-11-10T06:00:00");
    await syncOpenTickets(w.sync);
    assert.equal(w.rows.get(id).status, "CLOSED");
    assert.equal(digests(w).length, 3);
});
test("reminder: ASAP tasks have no 50/70% steps and join the hourly reminder one hour after creation", async () => {
    const w = world();
    const { id } = await openTicket(w, { urgency: "ASAP" });
    w.setClock("2026-11-09T08:05:00");
    await syncOpenTickets(w.sync);
    assert.equal(digests(w).length, 0);
    w.setClock("2026-11-09T09:00:00");
    await syncOpenTickets(w.sync);
    assert.equal(digests(w).length, 1);
    assert.match(digests(w)[0], /T-0001, Fix the pump\nDue 9 November 08:00/);
    w.setClock("2026-11-09T09:05:00");
    await syncOpenTickets(w.sync);
    assert.equal(digests(w).length, 1);
    w.setClock("2026-11-09T10:00:00");
    await syncOpenTickets(w.sync);
    assert.equal(digests(w).length, 2);
    assert.equal(w.posted.length, 0); // nothing posted to ClickUp, nobody tagged
    assert.equal(w.rows.get(id).followUpSentAt, undefined);
});
test("reminder: several overdue tasks arrive in ONE message, in task-number order", async () => {
    const w = world();
    const a = await openTicket(w); // T-0001, 4H, due 12:00
    const b = await openTicket(w, { urgency: "1H" }); // T-0002, due 09:00
    w.human(a.taskId, "ok", "2026-11-09T08:10:00");
    w.human(b.taskId, "ok", "2026-11-09T08:10:00");
    w.setClock("2026-11-09T12:05:00");
    await syncOpenTickets(w.sync);
    assert.equal(digests(w).length, 1);
    const msg = digests(w)[0];
    assert.match(msg, /still open \(2\)/);
    assert.ok(msg.indexOf("T-0001") < msg.indexOf("T-0002")); // T-0002 is due earlier, but order follows the number
});
test("reminder: a failed Telegram send is retried in the same hour and never sent twice", async () => {
    const w = world();
    const { taskId } = await openTicket(w);
    w.human(taskId, "ok", "2026-11-09T08:10:00");
    w.setClock("2026-11-09T12:00:00");
    w.setTelegramOk(false);
    await syncOpenTickets(w.sync);
    assert.equal(digests(w).length, 0);
    w.setTelegramOk(true);
    w.setClock("2026-11-09T12:05:00");
    await syncOpenTickets(w.sync);
    assert.equal(digests(w).length, 1);
    w.setClock("2026-11-09T12:10:00");
    await syncOpenTickets(w.sync);
    assert.equal(digests(w).length, 1);
});
test("reminder: nothing overnight; the first reminder comes at 06:00", async () => {
    const w = world();
    const { taskId } = await openTicket(w);
    w.human(taskId, "ok", "2026-11-09T08:10:00");
    w.setClock("2026-11-09T18:00:00");
    await syncOpenTickets(w.sync);
    assert.equal(digests(w).length, 0);
    w.setClock("2026-11-10T06:00:00");
    await syncOpenTickets(w.sync);
    assert.equal(digests(w).length, 1);
    w.setClock("2026-11-10T06:05:00");
    await syncOpenTickets(w.sync);
    assert.equal(digests(w).length, 1);
});

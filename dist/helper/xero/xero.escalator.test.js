// src/helper/xero/xero.escalator.test.ts  (run with: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createQuoteSyncEscalator } from "./xero.escalator.js";
import { xeroEscalationAssignees, xeroTagComment } from "./xero.assignees.js";
const setup = (over = {}) => {
    const created = [];
    const state = { tokenActive: over.tokenActive ?? false };
    const esc = createQuoteSyncEscalator({
        create: async (title, description, assignees) => void created.push({ title, description, assignees }),
        tokenOutageActive: () => state.tokenActive,
        assignees: () => over.assignees ?? [11, 22],
        now: () => new Date("2026-11-10T06:00:00.000Z"),
    });
    return { esc, created, state };
};
test("a failed quote poll raises one escalation that tags both people", async () => {
    const { esc, created } = setup();
    assert.equal(await esc.raise(new Error("Failed to fetch quotes: 500")), true);
    assert.equal(created.length, 1);
    assert.deepEqual(created[0].assignees, [11, 22]);
    assert.match(created[0].description, /Failed to fetch quotes: 500/);
});
test("repeated failures in the same outage do not create more tasks", async () => {
    const { esc, created } = setup();
    await esc.raise(new Error("a"));
    await esc.raise(new Error("b"));
    await esc.raise(new Error("c"));
    assert.equal(created.length, 1);
});
test("after a successful poll the next failure escalates again", async () => {
    const { esc, created } = setup();
    await esc.raise(new Error("a"));
    esc.markHealthy();
    await esc.raise(new Error("b"));
    assert.equal(created.length, 2);
});
test("no second task while the \"token invalid\" escalation is already open, but it escalates once that clears", async () => {
    const { esc, created, state } = setup({ tokenActive: true });
    assert.equal(await esc.raise(new Error("401")), false);
    assert.equal(created.length, 0);
    state.tokenActive = false;
    assert.equal(await esc.raise(new Error("still failing")), true);
    assert.equal(created.length, 1);
});
test("xero_excalation_a / _b are read as ClickUp user ids; bad or missing values are ignored", () => {
    const env = (o) => o;
    assert.deepEqual(xeroEscalationAssignees(env({ xero_excalation_a: "123", xero_excalation_b: " 456 " })), [123, 456]);
    assert.deepEqual(xeroEscalationAssignees(env({ xero_excalation_a: "123" })), [123]);
    assert.deepEqual(xeroEscalationAssignees(env({ xero_excalation_a: "abc", xero_excalation_b: "" })), []);
    assert.deepEqual(xeroEscalationAssignees(env({ xero_excalation_a: "7", xero_escalation_a: "7", xero_escalation_b: "8" })), [7, 8]);
    assert.deepEqual(xeroEscalationAssignees(env({})), []);
});
test("the tag comment @mentions every user, then says what it is for", () => {
    assert.deepEqual(xeroTagComment([11, 22]), [
        { type: "tag", user: { id: 11 } },
        { text: " " },
        { type: "tag", user: { id: 22 } },
        { text: " " },
        { text: "Xero escalation: please take a look." },
    ]);
    assert.deepEqual(xeroTagComment([]), [{ text: "Xero escalation: please take a look." }]);
});

// src/helper/ticket/clickup.webhook.test.ts  (run with: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { parseCommentEvent, verifyClickUpSignature } from "./clickup.webhook.js";
const sign = (body, secret) => crypto.createHmac("sha256", secret).update(body).digest("hex");
const body = JSON.stringify({ event: "taskCommentPosted", task_id: "abc123", webhook_id: "w1" });
test("a correctly signed delivery is accepted", () => {
    assert.equal(verifyClickUpSignature(Buffer.from(body), sign(body, "s3cret"), "s3cret"), true);
});
test("wrong secret, tampered body, missing or malformed header are all rejected", () => {
    assert.equal(verifyClickUpSignature(Buffer.from(body), sign(body, "other"), "s3cret"), false);
    assert.equal(verifyClickUpSignature(Buffer.from(body + " "), sign(body, "s3cret"), "s3cret"), false);
    assert.equal(verifyClickUpSignature(Buffer.from(body), undefined, "s3cret"), false);
    assert.equal(verifyClickUpSignature(Buffer.from(body), "abc", "s3cret"), false);
    assert.equal(verifyClickUpSignature(Buffer.from(body), sign(body, "s3cret"), ""), false);
});
test("only \"comment added\" events for a task are acted on", () => {
    assert.deepEqual(parseCommentEvent(Buffer.from(body)), { taskId: "abc123" });
    assert.equal(parseCommentEvent(Buffer.from(JSON.stringify({ event: "taskUpdated", task_id: "x" }))), null);
    assert.equal(parseCommentEvent(Buffer.from(JSON.stringify({ event: "taskCommentPosted" }))), null);
    assert.equal(parseCommentEvent(Buffer.from("not json")), null);
});

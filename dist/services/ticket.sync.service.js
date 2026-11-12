// src/services/ticket.sync.service.ts  (NEW FILE)
// TICKETING: the 5 minute run over every OPEN ticket.
//   1. New comments from people on the ClickUp task are forwarded to the Telegram group and count
//      as an update. Comments the system posted itself are ignored.
//   2. A finished ClickUp task closes the ticket.
//   3. A ticket with no update gets the 50% follow-up and the 70% Gleed tag (see escalation.ts).
import logger from "../utils/logger.js";
import { dueEscalations, reminderDue } from "../helper/ticket/escalation.js";
import { escalationTarget } from "../helper/ticket/ticket.assignees.js";
import { buildTaskName, followUpComment, gleedComment, isBotText, telegramEscalationMessage, telegramOverdueDigest, telegramUpdateMessage, } from "../helper/ticket/ticket.format.js";
import { SYNC_LEASE_MS } from "../helper/ticket/ticket.config.js";
const DONE_TYPES = new Set(["done", "closed"]);
/** Syncs one ticket; a failure is logged and the lease released so the next run can retry. */
async function syncTicketSafely(deps, row) {
    try {
        await syncTicket(deps, row);
    }
    catch (err) {
        logger.error(`[ticket] sync failed for ${row.ticketNumber ?? row.id}: ${err?.message ?? err}`);
        await deps.repo.updateTicket(row.id, {}, ["lockedUntil"]).catch(() => undefined);
    }
}
/** Runs one pass. One ticket failing never stops the others. */
export async function syncOpenTickets(deps) {
    for (const row of await deps.repo.listTicketsByStatus("OPEN"))
        await syncTicketSafely(deps, row);
    await sendOverdueReminder(deps);
}
/**
 * The hourly reminder: every open task past its due date, in one Telegram message. Runs after the
 * tickets are synced, so a task closed a moment ago is not listed. Tickets are only marked as
 * reminded once their message was sent, so a failed send is retried on the next run.
 */
async function sendOverdueReminder(deps) {
    const now = deps.now();
    const due = (await deps.repo.listTicketsByStatus("OPEN")).filter((r) => reminderDue({
        urgency: r.urgency,
        createdAt: new Date(r.createdAt),
        dueAt: r.dueAt ? new Date(r.dueAt) : null,
        lastReminderAt: r.lastReminderAt ? new Date(r.lastReminderAt) : null,
        now,
    }, deps.cal));
    if (due.length === 0)
        return;
    const items = due.map((r) => ({
        taskName: buildTaskName(r.ticketNumber ?? r.id, r.title),
        dueAt: new Date(r.dueAt),
    }));
    for (const message of telegramOverdueDigest(items)) {
        if (!(await deps.sendTelegram(deps.telegramChatId, message)))
            return; // not marked: retried on the next run
    }
    for (const r of due)
        await deps.repo.updateTicket(r.id, { lastReminderAt: now.toISOString() });
    logger.info(`[ticket] overdue reminder sent for ${due.length} task(s)`);
}
/**
 * Syncs just the ticket behind one ClickUp task (used by the comment webhook). Returns false when no open
 * ticket has that task. If the 5 minute run is already working on it, this is skipped: that run reads
 * the same comments.
 */
export async function syncTicketByTaskId(deps, taskId) {
    const row = (await deps.repo.listTicketsByStatus("OPEN")).find((r) => r.clickupTaskId === taskId);
    if (!row)
        return false;
    await syncTicketSafely(deps, row);
    return true;
}
async function syncTicket(deps, row) {
    if (!row.clickupTaskId)
        return;
    if (!(await deps.repo.claimTicket(row.id, "OPEN", deps.now().getTime(), SYNC_LEASE_MS)))
        return;
    const taskName = buildTaskName(row.ticketNumber ?? row.id, row.title);
    const taskId = row.clickupTaskId;
    let hasUpdate = Boolean(row.hasUpdate);
    const dueAt = row.dueAt ? new Date(row.dueAt) : null;
    const task = await deps.clickup.getTask(taskId);
    if (!task) {
        await deps.repo.updateTicket(row.id, {
            status: "CLOSED",
            closedAt: deps.now().toISOString(),
            lastError: "ClickUp task no longer exists",
        }, ["lockedUntil"]);
        return;
    }
    // ---- 1. comments from people
    let cursorMs = Date.parse(row.lastCommentAt ?? row.createdAt);
    const botIds = new Set(row.botCommentIds ?? []);
    const comments = await deps.clickup.listComments(taskId, cursorMs);
    for (const c of comments) {
        if (botIds.has(c.id) || isBotText(c.text)) {
            cursorMs = c.dateMs;
            continue;
        }
        const sent = await deps.sendTelegram(deps.telegramChatId, telegramUpdateMessage(taskName, c.userName, c.text, dueAt));
        if (!sent)
            break; // keep the cursor here: this comment is retried on the next run
        cursorMs = c.dateMs;
        hasUpdate = true;
        await deps.repo.updateTicket(row.id, {
            hasUpdate: true,
            lastCommentAt: new Date(cursorMs).toISOString(),
        });
    }
    if (cursorMs > Date.parse(row.lastCommentAt ?? row.createdAt)) {
        await deps.repo.updateTicket(row.id, { lastCommentAt: new Date(cursorMs).toISOString() });
    }
    // ---- 2. finished in ClickUp
    if (DONE_TYPES.has(task.statusType)) {
        await deps.repo.updateTicket(row.id, { status: "CLOSED", closedAt: deps.now().toISOString() }, [
            "lockedUntil",
        ]);
        return;
    }
    // ---- 3. follow-ups at 50% / 70% (ASAP has none: it is covered by the hourly overdue reminder)
    const steps = dueEscalations({
        urgencyMinutes: Number(row.urgencyMinutes ?? 0),
        submittedAt: new Date(row.createdAt),
        now: deps.now(),
        hasUpdate,
        followUpDone: Boolean(row.followUpSentAt),
        gleedDone: Boolean(row.gleedTaggedAt),
    }, deps.cal);
    for (const step of steps)
        await escalate(deps, row, taskName, taskId, step);
    await deps.repo.updateTicket(row.id, {}, ["lockedUntil"]);
}
async function escalate(deps, row, taskName, taskId, step) {
    const resolved = row.resolvedAssignees
        ? JSON.parse(row.resolvedAssignees)
        : [];
    const dueAt = new Date(row.dueAt);
    const number = row.ticketNumber ?? row.id;
    const blocks = step === "followUp"
        ? followUpComment(number, [...new Set(resolved.map((a) => a.clickupUserId).filter((x) => x !== null))], dueAt)
        : gleedComment(number, await escalationUser(deps), dueAt);
    if (step === "gleed" && !blocks.some((b) => "type" in b)) {
        logger.warn(`[ticket] ${number}: nobody could be tagged at 70%. Set TICKET_ESCALATION_USER_ID to a ClickUp user id`);
    }
    const posted = await deps.clickup.postComment(taskId, blocks);
    // Record before anything else so the comment can never be mistaken for a person's update.
    if (posted.id)
        await deps.repo.addBotCommentId(row.id, posted.id);
    const flag = step === "followUp" ? "followUpSentAt" : "gleedTaggedAt";
    const stamp = deps.now().toISOString();
    await deps.repo.updateTicket(row.id, { [flag]: stamp });
    row[flag] = stamp;
    logger.info(`[ticket] ${number} escalation: ${step}`);
    await deps
        .sendTelegram(deps.telegramChatId, telegramEscalationMessage(taskName, step, dueAt))
        .catch(() => false);
}
/** Who gets tagged at 70%: the configured ClickUp user, else the list member named Gleed. */
async function escalationUser(deps) {
    return escalationTarget(deps.escalationUserId, await deps.clickup.getListMembers(), deps.gleedName);
}

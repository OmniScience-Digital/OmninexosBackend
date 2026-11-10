// src/services/ticket.intake.service.ts  
// TICKETING: picks up SUBMITTED tickets (saved by the web form) and turns each into a numbered
// ClickUp task. Safe to re-run: the number is allocated once, computed values are saved before the
// ClickUp call, and a ticket that already has a ClickUp task id never creates a second task.
import logger from "../utils/logger.js";
import { addBusinessMinutes } from "../helper/ticket/businessTime.js";
import { assigneeIds, escalationTarget, resolveTicketAssignees } from "../helper/ticket/ticket.assignees.js";
import { buildDescription, buildTaskName, formatTicketNumber, telegramCreatedMessage, } from "../helper/ticket/ticket.format.js";
import { INTAKE_BATCH, INTAKE_LEASE_MS, MAX_ATTEMPTS, URGENCY_MINUTES, isKnownUrgency, } from "../helper/ticket/ticket.config.js";
const backoffMs = (attempts) => Math.min(15000 * 2 ** attempts, 10 * 60000);
/** Handles up to INTAKE_BATCH submitted tickets, oldest first. Returns how many became OPEN. */
export async function processSubmittedTickets(deps) {
    const rows = await deps.repo.listTicketsByStatus("SUBMITTED", INTAKE_BATCH);
    let opened = 0;
    for (const row of rows) {
        try {
            if (await processTicket(deps, row))
                opened++;
        }
        catch (err) {
            await recordFailure(deps, row, err);
        }
    }
    return opened;
}
async function processTicket(deps, row) {
    const nowMs = deps.now().getTime();
    if (!(await deps.repo.claimTicket(row.id, "SUBMITTED", nowMs, INTAKE_LEASE_MS)))
        return false;
    // Reject what can never succeed, before a number is spent on it.
    const problem = validate(row);
    if (problem) {
        await deps.repo.updateTicket(row.id, { status: "FAILED", lastError: problem }, ["lockedUntil"]);
        logger.warn(`[ticket] ${row.id} rejected: ${problem}`);
        return false;
    }
    // 1. Number: allocated exactly once per ticket.
    let ticketNumber = row.ticketNumber;
    if (!ticketNumber) {
        const candidate = formatTicketNumber(await deps.repo.nextTicketNumber(), deps.numberPad);
        if (await deps.repo.setTicketNumberOnce(row.id, candidate)) {
            ticketNumber = candidate;
        }
        else {
            ticketNumber = (await deps.repo.getTicket(row.id))?.ticketNumber;
        }
    }
    if (!ticketNumber)
        throw new Error("Could not store a ticket number");
    // 2. Due date + assignees, saved first so a retry reuses identical values.
    const submittedAt = new Date(row.createdAt); // server time, not the browser clock
    const urgencyMinutes = URGENCY_MINUTES[row.urgency];
    let dueAt;
    let resolved;
    if (row.dueAt && row.resolvedAssignees) {
        dueAt = new Date(row.dueAt);
        resolved = JSON.parse(row.resolvedAssignees);
    }
    else {
        dueAt = addBusinessMinutes(submittedAt, urgencyMinutes, deps.cal);
        const members = await deps.clickup.getListMembers();
        const fallbackId = escalationTarget(deps.escalationUserId, members, deps.gleedName);
        const r = resolveTicketAssignees(row.assignees ?? [], row.assigneeClickupIds ?? [], members, fallbackId, deps.overrides, deps.gleedName);
        r.warnings.forEach((w) => logger.warn(`[ticket] ${ticketNumber}: ${w}`));
        resolved = r.assignees;
        await deps.repo.updateTicket(row.id, {
            urgencyMinutes,
            dueAt: dueAt.toISOString(),
            resolvedAssignees: JSON.stringify(resolved), // AWSJSON is stored as a string
        });
    }
    // 3. ClickUp task (skipped if a previous attempt already made it).
    const taskName = buildTaskName(ticketNumber, row.title);
    let taskId = row.clickupTaskId;
    let taskUrl = row.clickupTaskUrl ?? null;
    if (!taskId) {
        const created = await deps.clickup.createTask({
            name: taskName,
            description: buildDescription({ assignees: resolved, dueAt, requiredOutcome: row.requiredOutcome }),
            assigneeIds: assigneeIds(resolved),
            dueAt,
        });
        taskId = created.id;
        taskUrl = created.url;
        await saveWithRetry(() => deps.repo.updateTicket(row.id, { clickupTaskId: taskId, clickupTaskUrl: taskUrl ?? undefined }), taskId);
    }
    // 4. Go live: from here the 5 minute sync follows the ticket.
    await deps.repo.updateTicket(row.id, {
        status: "OPEN",
        hasUpdate: false,
        lastCommentAt: deps.now().toISOString(),
    }, ["lockedUntil", "lastError"]);
    logger.info(`[ticket] ${ticketNumber} created in ClickUp (${taskId})`);
    if (deps.notifyOnCreate) {
        const names = resolved.map((a) => a.name);
        await deps.sendTelegram(deps.telegramChatId, telegramCreatedMessage(taskName, names, dueAt)).catch(() => false);
    }
    return true;
}
function validate(row) {
    if (!isKnownUrgency(row.urgency))
        return `Unknown urgency "${row.urgency}"`;
    if (!String(row.title ?? "").trim())
        return "Missing title";
    if (!String(row.requiredOutcome ?? "").trim())
        return "Missing required outcome";
    if (!row.createdAt || Number.isNaN(new Date(row.createdAt).getTime()))
        return "Missing creation time";
    return null;
}
/** A ClickUp task exists but its id could not be saved: retry, and shout if it still fails. */
async function saveWithRetry(save, taskId) {
    let last;
    for (let i = 0; i < 3; i++) {
        try {
            return await save();
        }
        catch (e) {
            last = e;
        }
    }
    logger.error(`[ticket] ClickUp task ${taskId} was created but could not be saved on the ticket`, last);
    throw last;
}
async function recordFailure(deps, row, err) {
    const attempts = Number(row.attempts ?? 0) + 1;
    const message = String(err?.message ?? err).slice(0, 500);
    logger.error(`[ticket] ${row.id} attempt ${attempts} failed: ${message}`);
    try {
        if (attempts >= MAX_ATTEMPTS) {
            await deps.repo.updateTicket(row.id, { status: "FAILED", attempts, lastError: message }, ["lockedUntil"]);
            await deps.raiseEscalation?.(`Task ticket could not be created (${row.ticketNumber ?? row.id})`, `Ticket "${row.title}" failed ${attempts} times.\nLast error: ${message}\nTicket id: ${row.id}`);
        }
        else {
            // Leave the lease in the future: that is the back-off before the next try.
            await deps.repo.updateTicket(row.id, {
                attempts,
                lastError: message,
                lockedUntil: deps.now().getTime() + backoffMs(attempts),
            });
        }
    }
    catch (e) {
        logger.error(`[ticket] could not record failure for ${row.id}`, e);
    }
}

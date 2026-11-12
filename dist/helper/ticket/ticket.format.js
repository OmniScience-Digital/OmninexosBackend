// src/helper/ticket/ticket.format.ts
// TICKETING: pure text builders for ClickUp and Telegram.
import { DateTime } from "luxon";
import { BOT_SIGNATURE, MAX_TELEGRAM_TEXT } from "./ticket.config.js";
export const formatTicketNumber = (n, pad = 4) => `T-${String(n).padStart(pad, "0")}`;
/** ClickUp task name: "T-0001, Fix the pump". */
export const buildTaskName = (ticketNumber, title) => `${ticketNumber}, ${title.trim().replace(/\s+/g, " ")}`;
export const formatDue = (d, zone = "Africa/Johannesburg") => `${DateTime.fromJSDate(d, { zone }).toFormat("ccc d LLL yyyy, HH:mm")} SAST`;
/** "11 November 14:00" in Johannesburg time (used on every Telegram message). */
export const formatDueShort = (d, zone = "Africa/Johannesburg") => DateTime.fromJSDate(d, { zone }).setLocale("en").toFormat("d LLLL HH:mm");
const dueLine = (d) => (d ? `\nDue ${formatDueShort(d)}` : "");
/** ClickUp task description (Assignees / Due Date / Required Outcome, as on the spreadsheet). */
export function buildDescription(p) {
    const who = p.assignees
        .map((a) => (a.fallback ? `${a.name} (not on ClickUp)` : a.name))
        .join(", ");
    return [
        `Assignees: ${who}`,
        `Due Date: ${formatDue(p.dueAt)}`,
        `Required Outcome: ${p.requiredOutcome.trim()}`,
    ].join("\n");
}
// ------------------------------------------------------------------ Telegram (legacy Markdown)
// The shared Telegram service sends with parse_mode "Markdown", where _ * ` [ start formatting.
// A task title like "fix pump_2" would make Telegram reject the whole message, so escape them.
export const escapeTelegram = (text) => text.replace(/([_*`[\\])/g, "\\$1");
const clip = (text, max = MAX_TELEGRAM_TEXT) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
/** "T-0001, Title", then "Due 11 November 14:00", then "<Name> sent this message: <text>". */
export function telegramUpdateMessage(taskName, author, text, dueAt) {
    const body = text.trim() || "(no text)";
    return clip(`${escapeTelegram(taskName)}${dueLine(dueAt)}\n${escapeTelegram(author)} sent this message: ${escapeTelegram(body)}`);
}
/** Posted to the group when a task still has no update at 50% / 70%. */
export function telegramEscalationMessage(taskName, step, dueAt) {
    const pct = step === "followUp" ? "50%" : "70%";
    return clip(`${escapeTelegram(taskName)}${dueLine(dueAt)}\nNo feedback received on this task yet (${pct} of the time used).`);
}
/** The number in "T-0042, Title" (42), compared as a number so T-10000 sorts after T-9999. */
const taskNumberOf = (taskName) => {
    const m = /^T-(\d+)/.exec(taskName);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};
/**
 * The hourly reminder: every open task past its due date in one message, in task-number order
 * (T-0001, T-0002 ...). Split into
 * several messages only if the list is too long for Telegram.
 */
export function telegramOverdueDigest(items) {
    const entries = [...items]
        .sort((a, b) => taskNumberOf(a.taskName) - taskNumberOf(b.taskName) || a.taskName.localeCompare(b.taskName))
        .map((i) => `${escapeTelegram(i.taskName)}\nDue ${formatDueShort(i.dueAt)}`);
    const messages = [];
    let current = "";
    for (const entry of entries) {
        if (current && current.length + entry.length + 2 > MAX_TELEGRAM_TEXT) {
            messages.push(current);
            current = "";
        }
        if (!current) {
            const header = messages.length === 0
                ? `Overdue tasks, still open (${entries.length}):`
                : "Overdue tasks, continued:";
            current = `${header}\n\n${entry}`;
        }
        else {
            current = `${current}\n\n${entry}`;
        }
    }
    if (current)
        messages.push(current);
    return messages;
}
export const telegramCreatedMessage = (taskName, assignees, dueAt) => clip(`${escapeTelegram(taskName)}${dueLine(dueAt)}\nTask created for ${escapeTelegram(assignees.join(", "))}.`);
const tag = (id) => ({ type: "tag", user: { id } });
/** 50%: tag the assignee(s) and ask for an update. */
export function followUpComment(ticketNumber, assigneeIds, dueAt) {
    const blocks = [];
    assigneeIds.forEach((id) => blocks.push(tag(id), { text: " " }));
    blocks.push({
        text: `${ticketNumber} is due ${formatDue(dueAt)} and has no update yet. Please reply here with an update. ${BOT_SIGNATURE}`,
    });
    return blocks;
}
/** 70%: tag Gleed. When Gleed cannot be tagged the text still goes out. */
export function gleedComment(ticketNumber, gleedId, dueAt) {
    const blocks = [];
    if (gleedId !== null)
        blocks.push(tag(gleedId), { text: " " });
    blocks.push({
        text: `${ticketNumber} is still without an update (70% of the time used), due ${formatDue(dueAt)}. ${BOT_SIGNATURE}`,
    });
    return blocks;
}
/** True when a ClickUp comment was written by this system rather than a person. */
export const isBotText = (commentText) => commentText.includes(BOT_SIGNATURE);

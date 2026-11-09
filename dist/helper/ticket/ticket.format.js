// src/helper/ticket/ticket.format.ts  
// TICKETING: pure text builders for ClickUp and Telegram.
import { DateTime } from "luxon";
import { BOT_SIGNATURE, MAX_TELEGRAM_TEXT } from "./ticket.config.js";
export const formatTicketNumber = (n, pad = 4) => `T-${String(n).padStart(pad, "0")}`;
/** ClickUp task name: "T-0001, Fix the pump". */
export const buildTaskName = (ticketNumber, title) => `${ticketNumber}, ${title.trim().replace(/\s+/g, " ")}`;
export const formatDue = (d, zone = "Africa/Johannesburg") => `${DateTime.fromJSDate(d, { zone }).toFormat("ccc d LLL yyyy, HH:mm")} SAST`;
/** ClickUp task description (Assignees / Due Date / Required Outcome, as on the spreadsheet). */
export function buildDescription(p) {
    const who = p.assignees
        .map((a) => (a.fallback ? `${a.name} (not on ClickUp, assigned to Gleed)` : a.name))
        .join(", ");
    return [`Assignees: ${who}`, `Due Date: ${formatDue(p.dueAt)}`, `Required Outcome: ${p.requiredOutcome.trim()}`].join("\n");
}
// ------------------------------------------------------------------ Telegram (legacy Markdown)
// The shared Telegram service sends with parse_mode "Markdown", where _ * ` [ start formatting.
// A task title like "fix pump_2" would make Telegram reject the whole message, so escape them.
export const escapeTelegram = (text) => text.replace(/([_*`[\\])/g, "\\$1");
const clip = (text, max = MAX_TELEGRAM_TEXT) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
/** "T-0001, Title" then a new line then "<Name> sent this message: <text>". */
export function telegramUpdateMessage(taskName, author, text) {
    const body = text.trim() || "(no text)";
    return clip(`${escapeTelegram(taskName)}\n${escapeTelegram(author)} sent this message: ${escapeTelegram(body)}`);
}
/** Posted to the group when a task still has no update at 50% / 70%. */
export function telegramEscalationMessage(taskName, step, dueAt) {
    const pct = step === "followUp" ? "50%" : "70%";
    const extra = step === "gleed" ? " Gleed has been tagged on the task." : "";
    return clip(`${escapeTelegram(taskName)}\nNo feedback received on this task yet (${pct} of the time used, due ${formatDue(dueAt)}).${extra}`);
}
export const telegramCreatedMessage = (taskName, assignees, dueAt) => clip(`${escapeTelegram(taskName)}\nTask created for ${escapeTelegram(assignees.join(", "))}, due ${formatDue(dueAt)}.`);
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

// src/helper/ticket/escalation.ts
// TICKETING: decides which escalations are due for one ticket. Pure.
//
// Rules (from the spreadsheet):
//   - Any message from a person on the ClickUp task counts as an update and stops escalation.
//   - 50% of the urgency window used with no update -> follow-up tagging the assignee(s).
//   - 70% with no update -> tag Gleed.
//   - Each step happens once.
// "Used" is measured in business minutes since the ticket was submitted, so a 16H task does
// not escalate overnight. Nothing is posted outside business hours; it waits for 06:00.
import { businessMinutesBetween, isBusinessTime } from "./businessTime.js";
import { ESCALATION } from "./ticket.config.js";
export function dueEscalations(input, cal) {
    if (input.hasUpdate)
        return [];
    if (!isBusinessTime(input.now, cal))
        return [];
    const used = businessMinutesBetween(input.submittedAt, input.now, cal);
    const steps = [];
    if (!input.followUpDone && used >= input.urgencyMinutes * ESCALATION.followUpAt)
        steps.push("followUp");
    if (!input.gleedDone && used >= input.urgencyMinutes * ESCALATION.gleedAt)
        steps.push("gleed");
    return steps;
}

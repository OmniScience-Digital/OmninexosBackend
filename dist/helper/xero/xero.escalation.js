// src/helper/xero/xero.escalation.ts  (NEW FILE)
// XERO ESCALATION: the ClickUp escalation task for Xero problems, with the users in
// xero_excalation_a / xero_excalation_b tagged on it. Deliberately self-contained: it does not import or change
// token.helper.ts or clickUpfetch.service.ts, so it cannot clash with changes made to those files.
import "dotenv/config";
import logger from "../../utils/logger.js";
import { clickupFetch } from "../../services/clickup.throttle.js";
import { xeroEscalationAssignees, xeroTagComment } from "./xero.assignees.js";
import { createQuoteSyncEscalator } from "./xero.escalator.js";
const API = "https://api.clickup.com/api/v2";
const headers = () => ({
    Authorization: process.env.CLICKUP_API_TOKEN,
    "Content-Type": "application/json",
});
/**
 * Creates the task in the Server_Escalations list, then tags the xero_excalation_a / _b users in a
 * comment on it (ClickUp can only @mention people in a comment, not when a task is created).
 * Use this in place of createEscalationTask for any Xero escalation. Never throws: an escalation
 * must not hide the real error, and a failed tag still leaves the task in place.
 */
export async function createXeroEscalationTask(title, description, tagUserIds = xeroEscalationAssignees()) {
    const listId = process.env.Server_Escalations;
    if (!listId) {
        logger.error(`[ClickUp] Server_Escalations env var not set - could not raise escalation task: ${title}`);
        return;
    }
    try {
        const res = await clickupFetch(`${API}/list/${listId}/task`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ name: title, description, priority: 1 }), // Urgent
        });
        if (!res.ok) {
            logger.error(`[ClickUp] Failed to create escalation task "${title}": ${res.status} ${await res.text()}`);
            return;
        }
        logger.warn(`[ClickUp] Escalation task created: ${title}`);
        const taskId = String((await res.json()).id ?? "");
        if (!taskId || tagUserIds.length === 0)
            return;
        const tag = await clickupFetch(`${API}/task/${taskId}/comment`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ comment: xeroTagComment(tagUserIds), notify_all: false }),
        });
        if (!tag.ok)
            logger.error(`[ClickUp] Escalation task ${taskId} created but tagging failed: ${tag.status} ${await tag.text()}`);
    }
    catch (err) {
        logger.error(`[ClickUp] Error creating escalation task "${title}":`, err);
    }
}
const escalator = createQuoteSyncEscalator({
    create: (title, description, tagUserIds) => createXeroEscalationTask(title, description, tagUserIds),
    // Not linked to token.helper.ts: if Xero's token is also invalid you may get this task as well as
    // the token one, one per outage.
    tokenOutageActive: () => false,
    assignees: () => xeroEscalationAssignees(),
});
export const raiseQuoteSyncEscalation = (err) => escalator.raise(err);
export const markQuoteSyncHealthy = () => escalator.markHealthy();

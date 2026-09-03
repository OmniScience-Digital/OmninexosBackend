import "dotenv/config";
import { businessUnit_FIELD_ID } from "../controllers/xero.businessUnit.controller.js";
import logger from "../utils/logger.js";
const CLICKUP_API_KEY = process.env.CLICKUP_API_TOKEN;
// List that server-side failures (e.g. a Xero token that can no longer be
// refreshed and needs manual re-auth) get escalated to.
const SERVER_ESCALATIONS_LIST_ID = process.env.Server_Escalations;
export const getClickUpTask = async (taskId) => {
    const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
        method: "GET",
        headers: {
            Authorization: CLICKUP_API_KEY,
            "Content-Type": "application/json",
        },
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch task: ${res.statusText}`);
    }
    return res.json();
};
export const updateClickUpBusinessUnit = async (taskId, value) => {
    const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/field/${businessUnit_FIELD_ID}`, {
        method: "POST",
        headers: {
            Authorization: CLICKUP_API_KEY,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            value: value,
        }),
    });
    if (!res.ok) {
        const error = await res.text();
        throw new Error(`Failed to update ClickUp Business Unit: ${res.status} ${error}`);
    }
};
/**
 * Raises a ClickUp task in the Server_Escalations list, for backend failures that
 * need a human (e.g. Xero's refresh token has stopped working and needs manual
 * re-auth via /api/v1/xero/connect). Swallows its own errors - an escalation task
 * failing to create must never mask or replace the original error being escalated.
 */
export const createEscalationTask = async (title, description) => {
    if (!SERVER_ESCALATIONS_LIST_ID) {
        logger.error(`[ClickUp] Server_Escalations env var not set - could not raise escalation task: ${title}`);
        return;
    }
    try {
        const res = await fetch(`https://api.clickup.com/api/v2/list/${SERVER_ESCALATIONS_LIST_ID}/task`, {
            method: "POST",
            headers: {
                Authorization: CLICKUP_API_KEY,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                name: title,
                description,
                priority: 1, // Urgent
            }),
        });
        if (!res.ok) {
            const error = await res.text();
            logger.error(`[ClickUp] Failed to create escalation task "${title}": ${res.status} ${error}`);
            return;
        }
        logger.warn(`[ClickUp] Escalation task created: ${title}`);
    }
    catch (err) {
        logger.error(`[ClickUp] Error creating escalation task "${title}":`, err);
    }
};

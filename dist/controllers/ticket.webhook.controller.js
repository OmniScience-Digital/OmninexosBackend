import logger from "../utils/logger.js";
import { parseCommentEvent, verifyClickUpSignature } from "../helper/ticket/clickup.webhook.js";
import { ticketFlowEnabled } from "../helper/ticket/ticket.config.js";
import { syncTicketByTaskId } from "../services/ticket.sync.service.js";
import { ticketSyncDeps } from "../services/ticket.deps.js";
export const ticketWebhookController = async (req, res) => {
    const secret = process.env.CLICKUP_WEBHOOK_SECRET;
    if (!secret) {
        logger.warn("[ticket] ClickUp webhook received but CLICKUP_WEBHOOK_SECRET is not set; ignoring");
        return res.status(503).send("Not configured");
    }
    const raw = req.body;
    if (!Buffer.isBuffer(raw) || !verifyClickUpSignature(raw, req.header("x-signature"), secret)) {
        logger.warn("\u274C Invalid signature on ClickUp comment webhook");
        return res.status(401).send("Unauthorized");
    }
    // Answer first: ClickUp disables webhooks that time out or keep failing.
    res.status(200).send("OK");
    const event = parseCommentEvent(raw);
    if (!event || !ticketFlowEnabled())
        return;
    try {
        const found = await syncTicketByTaskId(ticketSyncDeps(), event.taskId);
        if (found)
            logger.info(`[ticket] webhook synced task ${event.taskId}`);
    }
    catch (err) {
        logger.error(`[ticket] webhook sync failed for task ${event.taskId}:`, err);
    }
};

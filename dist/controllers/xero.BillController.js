import crypto from "crypto";
import logger from "../utils/logger.js";
export const xeroControllerRouter = async (req, res) => {
    try {
        // Intent-to-receive request (no signature)
        const signature = req.headers["x-xero-signature"];
        if (!signature) {
            console.log("\u2705 Intent-to-receive request detected");
            return res.status(200).send("OK");
        }
        const webhookKey = process.env.XERO_WEBHOOK_KEY;
        if (!webhookKey) {
            logger.error("XERO_WEBHOOK_KEY not configured");
            return res.status(500).send("Webhook key missing");
        }
        const rawBody = req.body; // express.raw() gives Buffer
        // Verify Xero signature
        const hmac = crypto.createHmac("sha256", webhookKey);
        hmac.update(rawBody);
        const computedSignature = hmac.digest("base64");
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature))) {
            logger.warn("\u274C Invalid Xero signature");
            return res.status(401).send("Unauthorized");
        }
        console.log("\uD83D\uDE80 Xero webhook verified, responding 200 immediately");
        // Respond immediately so Xero is happy
        res.status(200).send("OK");
        // Process payload asynchronously
        const payload = JSON.parse(rawBody.toString("utf8"));
        processWebhookEvents(payload);
    }
    catch (error) {
        logger.error("Error in Xero webhook:", error);
        if (!res.headersSent)
            res.status(500).send("Internal Server Error");
    }
};
async function processWebhookEvents(payload) {
    if (!payload.events)
        return;
    for (const event of payload.events) {
        logger.info(`Processing event: ${event.eventType} - ${event.resourceId} for tenant ${event.tenantId}`);
        // Place your business logic here
    }
    logger.info("\u2705 Webhook processing complete");
}

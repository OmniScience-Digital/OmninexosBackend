import logger from "../utils/logger.js";
import { verifyXeroWebhookSignature } from "../utils/xero.webhook.js";
export const xeroControllerRouter = async (req, res) => {
    try {
        // Get the raw body - IMPORTANT: must be raw string, not parsed JSON
        const rawBody = req.rawBody || JSON.stringify(req.body);
        const signature = req.headers["x-xero-signature"];
        const webhookKey = process.env.XERO_WEBHOOK_KEY;
        if (!signature) {
            logger.warn("Missing Xero signature header");
            return res.status(401).send("Unauthorized");
        }
        if (!webhookKey) {
            logger.error("XERO_WEBHOOK_KEY not configured");
            return res.status(500).send("Server configuration error");
        }
        // Verify signature
        const isValid = verifyXeroWebhookSignature(rawBody, signature, webhookKey);
        if (!isValid) {
            logger.warn("Invalid Xero webhook signature");
            return res.status(401).send("Unauthorized");
        }
        // Signature valid - process webhook
        logger.info("Xero Bill Webhook received and verified");
        logger.info(JSON.stringify(req.body));
        // IMPORTANT: Return 200 OK immediately, process asynchronously
        res.status(200).send("OK");
        // Process the actual events in background (don't await)
        processWebhookEvents(req.body);
    }
    catch (error) {
        logger.error("Failed to process Xero Bill webhook:", error);
        // Still return 200 to prevent Xero from retrying unnecessarily
        // Log the error and handle internally
        res.status(200).send("OK");
    }
};
// Separate async processing function
async function processWebhookEvents(payload) {
    try {
        // Process your events here
        if (payload.events) {
            for (const event of payload.events) {
                logger.info(`Processing event: ${event.eventType} - ${event.eventCategory}`);
                // Add your business logic here
            }
        }
    }
    catch (error) {
        logger.error("Error processing webhook events:", error);
    }
}

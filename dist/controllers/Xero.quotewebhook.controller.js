import crypto from "crypto";
import logger from "../utils/logger.js";
import { getAccessToken } from "../helper/tokens/token.helper.js";
import { handleQuoteStatuses } from "../services/xero.quote.service.js";
const TENANT_ID = process.env.XERO_TENANT_ID;
/**
 * Xero QUOTE webhook receiver.
 *
 * Mirrors the verification pattern used by xeroControllerRouter (INVOICE webhook) exactly:
 * - Intent-to-receive check (no x-xero-signature header -> 200 OK, no-op)
 * - HMAC-SHA256 signature verification against XERO_WEBHOOK_KEY using the raw request body
 * - Returns 200 immediately after verification, processes events asynchronously after
 *
 * On each QUOTE event, fetches the full quote from Xero and drives BOTH quote pipelines
 * independently (full CRM1/2/5/7/9 fan-out, and the minified CRM Shaughn single-list sync).
 * This makes quote updates event-driven in addition to the existing pollQuotes() cron —
 * both are idempotent (diff against the stored quote before acting), so if a quote is
 * also picked up by the next poll cycle, the second pass is a no-op.
 */
export const xeroQuoteWebhookController = async (req, res) => {
    try {
        const signature = req.headers["x-xero-signature"];
        // Intent-to-receive test
        if (!signature) {
            logger.info("\u2705 Xero QUOTE webhook intent-to-receive test passed");
            return res.status(200).send("OK");
        }
        const webhookKey = process.env.XERO_WEBHOOK_KEY;
        if (!webhookKey) {
            logger.error("XERO_WEBHOOK_KEY not configured");
            return res.status(500).send("Webhook key missing");
        }
        const rawBody = req.body;
        const hmac = crypto.createHmac("sha256", webhookKey);
        hmac.update(rawBody);
        const computedSignature = hmac.digest("base64");
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature))) {
            logger.warn("\u274C Invalid Xero signature on QUOTE webhook");
            return res.status(401).send("Unauthorized");
        }
        logger.info("\uD83D\uDE80 Xero QUOTE webhook verified, returning 200");
        // Return 200 immediately (important for Xero)
        res.status(200).send("OK");
        // Process asynchronously
        try {
            const payload = JSON.parse(rawBody.toString("utf8"));
            await processQuoteWebhookEvents(payload);
        }
        catch (err) {
            logger.error("Failed to parse QUOTE webhook payload:", err);
        }
    }
    catch (error) {
        logger.error("Error in Xero QUOTE webhook:", error);
        if (!res.headersSent)
            res.status(500).send("Internal Server Error");
    }
};
async function processQuoteWebhookEvents(payload) {
    if (!payload.events?.length)
        return;
    for (const event of payload.events) {
        if (event.eventCategory !== "QUOTE") {
            logger.warn(`Unhandled category in quote webhook: ${event.eventCategory}`);
            continue;
        }
        await handleQuoteEvent(event);
    }
    logger.info("\u2705 Quote webhook processing complete");
}
async function handleQuoteEvent(event) {
    try {
        const ACCESS_TOKEN = await getAccessToken();
        const res = await fetch(event.resourceUrl, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                "xero-tenant-id": event.tenantId || TENANT_ID,
                Accept: "application/json",
            },
        });
        if (!res.ok)
            throw new Error(`Xero quote fetch failed: ${res.status} ${res.statusText}`);
        const data = (await res.json());
        const quote = data?.Quotes?.[0];
        if (!quote) {
            logger.warn(`No quote found for resource ${event.resourceUrl}`);
            return;
        }
        // Drive both pipelines independently — see module docstring.
        const results = await Promise.allSettled([handleQuoteStatuses(quote)]);
        results.forEach((result, idx) => {
            const pipeline = idx === 0 ? "full pipeline" : "CRM Shaughn";
            if (result.status === "rejected") {
                logger.error(`Quote webhook: ${pipeline} failed for ${quote.QuoteNumber}:`, result.reason);
            }
        });
    }
    catch (err) {
        logger.error("Quote webhook event handler error:", err);
    }
}

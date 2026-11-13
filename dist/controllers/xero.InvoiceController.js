import crypto from "crypto";
import fetch from "node-fetch";
import logger from "../utils/logger.js";
import { getAccessToken } from "../helper/tokens/token.helper.js";
/*
|--------------------------------------------------------------------------
| Controller
|--------------------------------------------------------------------------
*/
export const xeroControllerRouter = async (req, res) => {
    try {
        const signature = req.headers["x-xero-signature"];
        // Intent-to-receive test
        if (!signature) {
            console.log("\u2705 Intent-to-receive test passed");
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
            logger.warn("\u274C Invalid Xero signature");
            return res.status(401).send("Unauthorized");
        }
        console.log("\uD83D\uDE80 Xero webhook verified, returning 200");
        // Return 200 immediately (important for Xero)
        res.status(200).send("OK");
        // Process asynchronously
        try {
            const payload = JSON.parse(rawBody.toString("utf8"));
            logger.info("\u2705 Webhook processing complete");
        }
        catch (err) {
            logger.error("Failed to parse webhook payload:", err);
        }
    }
    catch (error) {
        logger.error("Error in Xero webhook:", error);
        if (!res.headersSent)
            res.status(500).send("Internal Server Error");
    }
};
/*
|--------------------------------------------------------------------------
| Xero Fetch Helper
|--------------------------------------------------------------------------
*/
async function fetchFromXero(url, tenantId) {
    const ACCESS_TOKEN = await getAccessToken();
    const res = await fetch(url, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            "xero-tenant-id": tenantId,
            Accept: "application/json",
        },
    });
    if (!res.ok)
        throw new Error(`Xero fetch failed: ${res.status} ${res.statusText}`);
    return (await res.json());
}
/*
|--------------------------------------------------------------------------
| Contact Handler
|--------------------------------------------------------------------------
*/
async function handleContactEvent(event) {
    try {
        const data = await fetchFromXero(event.resourceUrl, event.tenantId);
        const contact = data?.Contacts?.[0];
        if (!contact)
            return;
        // console.log('👤 Contact Name:', contact.Name);
        // console.log('Email:', contact.EmailAddress);
        // console.log(data);
    }
    catch (err) {
        logger.error("Contact handler error:", err);
    }
}

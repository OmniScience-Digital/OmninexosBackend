import fetch from "node-fetch";
import { syncQuoteToCrmShaughn } from "../services/xero.crmshaughn.service";
import { getAccessToken } from "../helper/tokens/token.helper.js";
import logger from "../utils/logger.js";
const TENANT_ID = process.env.XERO_TENANT_ID;
export const xeroCrmShaughnController = {
    /**
     * Webhook-style entry point: accepts a single Xero quote payload (e.g. forwarded from
     * the existing poll loop, or a future Xero webhook) and syncs it to the single
     * "CRM Shaughn" ClickUp list.
     */
    syncQuote: async (req, res) => {
        try {
            const quote = req.body;
            if (!quote?.QuoteNumber) {
                return res.status(400).json({ success: false, error: "QuoteNumber is required" });
            }
            const result = await syncQuoteToCrmShaughn(quote);
            res.status(200).json({ success: true, data: result });
        }
        catch (error) {
            logger.error("[CRM Shaughn] Error syncing quote:", error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    },
};
export const xeroCrmShaughnManagementController = {
    /**
     * Manual/admin trigger: looks up a quote by quote number directly from Xero and
     * (re)syncs it into CRM Shaughn on demand. Useful for re-posting a quote that
     * failed to sync, or forcing a refresh without waiting for the poll cycle.
     * Protected by a shared secret (X-Admin-Secret header) — see route file.
     */
    resyncQuoteByNumber: async (req, res) => {
        try {
            const { quoteNumber } = req.params;
            if (!quoteNumber) {
                return res.status(400).json({ success: false, error: "quoteNumber param is required" });
            }
            const ACCESS_TOKEN = await getAccessToken();
            const url = `https://api.xero.com/api.xro/2.0/Quotes?QuoteNumber=${encodeURIComponent(quoteNumber)}`;
            const xeroRes = await fetch(url, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                    "xero-tenant-id": TENANT_ID,
                    Accept: "application/json",
                },
            });
            if (!xeroRes.ok) {
                return res.status(502).json({
                    success: false,
                    error: `Failed to fetch quote from Xero: ${xeroRes.statusText}`,
                });
            }
            const data = (await xeroRes.json());
            const quote = data.Quotes?.[0];
            if (!quote) {
                return res
                    .status(404)
                    .json({ success: false, error: `Quote ${quoteNumber} not found in Xero` });
            }
            const result = await syncQuoteToCrmShaughn(quote);
            logger.info(`[CRM Shaughn][Management] Manual resync triggered for ${quoteNumber}`);
            res.status(200).json({ success: true, data: result });
        }
        catch (error) {
            logger.error("[CRM Shaughn][Management] Error resyncing quote:", error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    },
};

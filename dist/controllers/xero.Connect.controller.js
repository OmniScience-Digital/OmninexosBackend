import logger from "../utils/logger.js";
import xeroService from "../services/xero.service.js";
export const xeroController = {
    // GET /connect → redirects user to Xero login
    redirectToXero: (req, res) => {
        try {
            const url = xeroService.getAuthUrl();
            logger.info("Redirecting user to Xero login");
            res.send(`<a href="${url}">Connect to Xero</a>`);
        }
        catch (error) {
            logger.error("Error generating Xero auth URL", error);
            res
                .status(500)
                .json({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
        }
    },
    // GET /callback → Xero sends authorization code here
    handleCallback: async (req, res) => {
        try {
            const code = req.query.code;
            if (!code) {
                res.status(400).json({ success: false, error: "Authorization code missing" });
                return;
            }
            logger.info("Received Xero callback, exchanging code for tokens");
            const tokens = await xeroService.exchangeCodeForToken(code);
            logger.info("Xero tokens received", {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
            });
            const tenants = await xeroService.getTenants(tokens.access_token);
            logger.info("Xero tenants fetched", tenants);
            res.status(200).json({ success: true, message: "Xero connected!", tokens, tenants });
        }
        catch (error) {
            logger.error("Error handling Xero callback", error);
            res
                .status(500)
                .json({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
        }
    },
    fetchBills: async (req, res) => {
        try {
            // In a real app, you’d store these tokens after callback
            const accessToken = req.query.access_token;
            const tenantId = req.query.tenant_id;
            if (!accessToken || !tenantId) {
                res.status(400).json({ success: false, error: "Missing accessToken or tenantId" });
                return;
            }
            const bills = await xeroService.getBills(accessToken, tenantId);
            logger.info("Fetched bills from Xero", bills);
            res.status(200).json({ success: true, data: bills });
        }
        catch (error) {
            logger.error("Error fetching bills", error);
            res
                .status(500)
                .json({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
        }
    },
    fetchInvoices: async (req, res) => {
        try {
            const accessToken = req.query.access_token;
            const tenantId = req.query.tenant_id;
            if (!accessToken || !tenantId) {
                res.status(400).json({ success: false, error: "Missing accessToken or tenantId" });
                return;
            }
            const invoices = await xeroService.getInvoices(accessToken, tenantId);
            logger.info("Fetched invoices from Xero", invoices);
            res.status(200).json({ success: true, data: invoices });
        }
        catch (error) {
            logger.error("Error fetching invoices", error);
            res
                .status(500)
                .json({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
        }
    },
};

import crypto from "crypto";
import logger from "../utils/logger.js";
import xeroService from "../services/xero.service.js";
import { encrypt } from "../services/encryption.service.js";
import { updateXeroConfig } from "../repositories/dynamo.xeroconfig.repository.js";
const STATE_COOKIE = "xero_oauth_state";
export const xeroController = {
    // GET /connect → redirects user to Xero login
    redirectToXero: (req, res) => {
        try {
            const state = crypto.randomUUID();
            // Requires cookie-parser + app.use(cookieParser()) in server.ts,
            // and CORS credentials to actually be allowed cross-origin (see
            // server.ts notes) — otherwise this cookie never round-trips and
            // handleCallback below will always reject with a state mismatch.
            res.cookie(STATE_COOKIE, state, {
                httpOnly: true,
                secure: true, // requires HTTPS end-to-end (fine behind trust proxy + ALB/CloudFront on https)
                sameSite: "lax", // use 'none' instead if /connect and /callback are on different domains
                maxAge: 5 * 60 * 1000, // matches Xero's 5-minute auth code expiry
            });
            const url = xeroService.getAuthUrl(state);
            logger.info("Redirecting user to Xero login");
            res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
            res.set("Pragma", "no-cache");
            res.set("Expires", "0");
            res.redirect(url);
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
            const returnedState = req.query.state;
            const expectedState = req.cookies?.[STATE_COOKIE];
            res.clearCookie(STATE_COOKIE);
            if (!returnedState || !expectedState || returnedState !== expectedState) {
                logger.error(`Xero OAuth state mismatch — expected=${expectedState ?? "undefined"} returned=${returnedState ?? "undefined"}`);
                res.status(400).json({ success: false, error: "Invalid or missing state parameter" });
                return;
            }
            if (!code) {
                res.status(400).json({ success: false, error: "Authorization code missing" });
                return;
            }
            logger.info("Received Xero callback, exchanging code for tokens");
            const tokens = await xeroService.exchangeCodeForToken(code);
            const tenants = await xeroService.getTenants(tokens.access_token);
            if (!tenants || tenants.length === 0) {
                throw new Error("No Xero tenants returned");
            }
            const encryptedRefreshToken = encrypt(tokens.refresh_token);
            await updateXeroConfig(tenants[0].tenantId, {
                refreshTokenEncrypted: encryptedRefreshToken,
            });
            res.status(200).json({
                success: true,
                message: "Xero connected!",
                tenants,
            });
        }
        catch (error) {
            logger.error("Error handling Xero callback", error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    },
    fetchBills: async (req, res) => {
        try {
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
export default xeroController;

// import { Request, Response } from 'express';
// import logger from '../utils/logger';
// import xeroService from '../services/xero.service';
// import { encrypt } from '../services/encryption.service';
// import { updateXeroConfig } from '../repositories/dynamo.xeroconfig.repository';
import logger from "../utils/logger.js";
import xeroService from "../services/xero.service.js";
import { encrypt } from "../services/encryption.service.js";
import { updateXeroConfig } from "../repositories/dynamo.xeroconfig.repository.js";
import crypto from "crypto";
// Simple in-memory store for OAuth state (use Redis in production)
const pendingStates = new Map();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const xeroController = {
    // GET /connect → redirects user to Xero login
    redirectToXero: (req, res) => {
        try {
            const state = crypto.randomUUID();
            pendingStates.set(state, Date.now() + STATE_TTL_MS);
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
            const state = req.query.state;
            // Validate state to prevent CSRF
            if (!state || !pendingStates.has(state)) {
                res.status(400).json({ success: false, error: "Invalid or expired state" });
                return;
            }
            const expiry = pendingStates.get(state);
            if (Date.now() > expiry) {
                pendingStates.delete(state);
                res.status(400).json({ success: false, error: "State expired" });
                return;
            }
            pendingStates.delete(state);
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

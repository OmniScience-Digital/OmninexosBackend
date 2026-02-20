import express from "express";
import { xeroController } from "../controllers/xero.controller.js";
const router = express.Router();
// OAuth routes
router.get("/connect", xeroController.redirectToXero);
router.get("/callback", xeroController.handleCallback);
// Fetch bills / invoices
router.get("/bills", xeroController.fetchBills);
router.get("/invoices", xeroController.fetchInvoices);
export default router;

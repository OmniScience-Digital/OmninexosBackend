import express from "express";
import { xeroQuoteController } from "../controllers/xero.quote.controller.js";
const router = express.Router();
// Create a new quote
router.post("/quotes", xeroQuoteController.createQuote);
export default router;

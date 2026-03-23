import express from "express";
import { xeroBusinessUnitController } from "../controllers/xero.businessUnit.controller.js";
const router = express.Router();
// Create a new quote
router.post("/business", xeroBusinessUnitController.businessUnit);
export default router;

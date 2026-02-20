import express from "express";
const router = express.Router();
import { xeroControllerRouter } from "../controllers/xero.BillController.js";
router.post("/xeroBillwebhook", xeroControllerRouter);
export default router;

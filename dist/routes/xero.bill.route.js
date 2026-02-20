import express from "express";
const router = express.Router();
import { xeroControllerRouter } from "../controllers/xero.BillController.js";
router.post("/xeroBillwebhook", xeroControllerRouter);
export default router;
// https://apqirzaiib.execute-api.us-east-1.amazonaws.com/api/v1/xero/xeroBillwebhook

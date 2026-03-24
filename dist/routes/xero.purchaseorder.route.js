import express from "express";
import { xeroPOController } from "../controllers/xero.purchaseorder.controller.js";
const router = express.Router();
// Create a new quote
router.post("/purchaseorder", xeroPOController.poUpdate);
router.post("/pod", xeroPOController.poDUpdate);
export default router;

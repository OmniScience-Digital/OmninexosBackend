import express from "express";
const router = express.Router();
import { stockControllerRouter } from "../controllers/stock.controller.js";
router.post("/stockcontroller", stockControllerRouter);
export default router;

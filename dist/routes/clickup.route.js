import express from "express";
import { clickUpRouter } from "../controllers/clickup.controller.js";
const router = express.Router();
router.post("/clickuppost", clickUpRouter);
export default router;

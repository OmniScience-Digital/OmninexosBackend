import express from "express";
import multer from "multer";
import { vifClickUp } from "../controllers/vifClickup.controller.js";
const router = express.Router();
// configure multer to keep uploaded files in memory
const upload = multer({ storage: multer.memoryStorage() });
// attach multer
router.post("/vifclickup", upload.array("photos"), vifClickUp);
export default router;

// routes file
import express from "express";
import multer from "multer";
import { vifClickUp } from "../controllers/vifClickup.controller.js";
const router = express.Router();
// configure multer to keep uploaded files in memory
const upload = multer({ storage: multer.memoryStorage() });
// Change from upload.array('photos') to upload.any()
router.post("/vifclickup", upload.any(), vifClickUp);
export default router;

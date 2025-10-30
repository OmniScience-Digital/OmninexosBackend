import express from 'express';
const router = express.Router();

import { vifControllerRouter } from '../controllers/ClickupVif.controller';

router.post('/vifcontroller', vifControllerRouter);

export default router;

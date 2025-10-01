import express from 'express';
const router = express.Router();

import { stockControllerRouter } from '../controllers/stock.controller';

router.post('/stockcontroller', stockControllerRouter);

export default router;

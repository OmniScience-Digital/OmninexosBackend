import express from 'express';
const router = express.Router();

import { xeroControllerRouter } from '../controllers/xero.InvoiceController';

// This route is specifically for Xero webhooks
router.post('/xeroBillwebhook', xeroControllerRouter);

export default router;

import express from 'express';
const router = express.Router();

import { xeroControllerRouter } from '../controllers/xero.InvoiceController';

// This route is specifically for Xero webhooks
router.post('/xeroBillwebhook', xeroControllerRouter);

export default router;

// https://apqirzaiib.execute-api.us-east-1.amazonaws.com/api/v1/xeroBillwebhook

// curl -X POST https://wq3qo9l3de.execute-api.us-east-1.amazonaws.com/api/v1/xeroBillwebhook \
//   -H "Content-Type: application/json" \
//   -d '{"test": "data"}'

// curl -X POST http://44.211.210.154/5001/api/v1/xero/xeroBillwebhook \
//   -H "Content-Type: application/json" \
//   -d '{"test": "data"}'

// curl -X POST https://apqirzaiib.execute-api.us-east-1.amazonaws.com/api/v1/xeroBillwebhook \
//   -H "Content-Type: application/json" \
//   -d '{"test": "data"}'

//https://wq3qo9l3de.execute-api.us-east-1.amazonaws.com/xero-webhook

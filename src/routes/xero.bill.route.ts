import express from 'express';
const router = express.Router();
import { rawBodyMiddleware } from '../middlewares/rawbody.middleware';
import { xeroControllerRouter } from '../controllers/xero.BillController';

// IMPORTANT: Use raw body middleware BEFORE json parser for this route
router.post('/xeroBillwebhook', rawBodyMiddleware, express.json(), xeroControllerRouter);

export default router;

// https://apqirzaiib.execute-api.us-east-1.amazonaws.com/api/v1/xero/xeroBillwebhook

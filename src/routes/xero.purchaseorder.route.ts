import express from 'express';
import { xeroPOController } from '../controllers/xero.purchaseorder.controller';

const router = express.Router();

// Create a new quote
router.post('/purchaseorder', xeroPOController.poUpdate);
router.post('/pod', xeroPOController.poDUpdate);
router.post('/invoicenumber', xeroPOController.invUpdate);

export default router;

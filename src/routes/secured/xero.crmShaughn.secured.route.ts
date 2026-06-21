// src/routes/secured/xero.crmShaughn.secured.route.ts
import { Request, Response } from 'express';
import { z } from 'zod';
import { Route } from '../../decorators/route';
import { BaseController } from '../../controllers/BaseController';
import {
  xeroCrmShaughnController,
  xeroCrmShaughnManagementController,
} from '../../controllers/xero.crmshaughn.controller';

// matches the Xero `Quote` shape consumed by syncQuoteToCrmShaughn()
const lineItemSchema = z.object({
  Description: z.string().trim().min(1).max(2000),
  Quantity: z.number(),
  UnitAmount: z.number(),
  AccountCode: z.string().trim().max(20).optional().default(''),
});

const contactSchema = z.object({
  ContactID: z.string().trim().min(1).max(100),
  Name: z.string().trim().min(1).max(300),
  EmailAddress: z.string().trim().email().optional(),
});

const syncQuoteSchema = z.object({
  QuoteID: z.string().trim().min(1).max(100),
  QuoteNumber: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/),
  Type: z.enum(['ACCREC', 'ACCPAY']).optional(),
  Status: z.string().trim().min(1).max(50),
  UpdatedDateUTC: z.string().trim().min(1),
  LineItems: z.array(lineItemSchema).default([]),
  Contact: contactSchema,
  Date: z.string().optional(),
  DateString: z.string().optional(),
  ExpiryDate: z.string().optional(),
  ExpiryDateString: z.string().optional(),
  CurrencyCode: z.string().trim().max(10).optional(),
  SubTotal: z.number().optional(),
  Total: z.number().optional(),
  Title: z.string().trim().max(500).optional(),
  TotalDiscount: z.number().optional(),
  TotalTax: z.number().optional(),
  Reference: z.string().trim().max(500).optional(),
});

// /management/resync/:quoteNumber has no body — params are validated by the
// route-level regex below, before reaching the handler.
const emptyBodySchema = z.object({}).optional();

const QUOTE_NUMBER_REGEX = /^[a-zA-Z0-9_-]+$/;

class XeroCrmShaughnSecuredController extends BaseController {
  @Route({
    method: 'post',
    path: '/crm-shaughn/sync',
    rateLimit: 'crmShaughn:sync',
    schema: syncQuoteSchema,
  })
  async sync(req: Request, res: Response): Promise<void> {
    req.body = req.validated;
    await xeroCrmShaughnController.syncQuote(req, res);
  }

  @Route({
    method: 'post',
    path: '/crm-shaughn/management/resync/:quoteNumber',
    rateLimit: 'crmShaughn:resync',
    schema: emptyBodySchema,
  })
  async resync(req: Request, res: Response): Promise<void> {
    const quoteNumber = req.params.quoteNumber as string;
    if (!QUOTE_NUMBER_REGEX.test(quoteNumber || '')) {
      res.status(400).json({ error: 'Invalid quoteNumber' });
      return;
    }
    await xeroCrmShaughnManagementController.resyncQuoteByNumber(req, res);
  }
}

const ctrl = new XeroCrmShaughnSecuredController();
export default ctrl.registerRoutes(ctrl);

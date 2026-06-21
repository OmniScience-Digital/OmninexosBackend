// src/routes/secured/xero.quote.secured.route.ts
import { Request, Response } from 'express';
import { z } from 'zod';
import { Route } from '../../decorators/route';
import { BaseController } from '../../controllers/BaseController';
import { xeroQuoteController } from '../../controllers/xero.quote.controller';

// matches QuoteData in schema/xero.schema.ts, consumed by createXeroQuote()
const lineItemSchema = z.object({
  Description: z.string().trim().min(1).max(2000),
  Quantity: z.number().positive(),
  UnitAmount: z.number(),
  AccountCode: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[a-zA-Z0-9_-]+$/),
});

const createQuoteSchema = z.object({
  contactId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/),
  reference: z.string().trim().max(500).optional().default(''),
  date: z.string().trim().min(1),
  expiryDate: z.string().trim().min(1),
  lineItems: z.array(lineItemSchema).min(1),
});

class XeroQuoteSecuredController extends BaseController {
  @Route({
    method: 'post',
    path: '/quotes',
    rateLimit: 'xero:createQuote',
    schema: createQuoteSchema,
  })
  async createQuote(req: Request, res: Response): Promise<void> {
    req.body = req.validated;
    await xeroQuoteController.createQuote(req, res);
  }
}

const ctrl = new XeroQuoteSecuredController();
export default ctrl.registerRoutes(ctrl);

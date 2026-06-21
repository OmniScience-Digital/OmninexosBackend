var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function")
        r = Reflect.decorate(decorators, target, key, desc);
    else
        for (var i = decorators.length - 1; i >= 0; i--)
            if (d = decorators[i])
                r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function")
        return Reflect.metadata(k, v);
};
import { z } from "zod";
import { Route } from "../../decorators/route.js";
import { BaseController } from "../../controllers/BaseController.js";
import { xeroCrmShaughnController, xeroCrmShaughnManagementController, } from "../../controllers/xero.crmshaughn.controller";
// matches the Xero `Quote` shape consumed by syncQuoteToCrmShaughn()
const lineItemSchema = z.object({
    Description: z.string().trim().min(1).max(2000),
    Quantity: z.number(),
    UnitAmount: z.number(),
    AccountCode: z.string().trim().max(20).optional().default(""),
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
    Type: z.enum(["ACCREC", "ACCPAY"]).optional(),
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
    async sync(req, res) {
        req.body = req.validated;
        await xeroCrmShaughnController.syncQuote(req, res);
    }
    async resync(req, res) {
        const quoteNumber = req.params.quoteNumber;
        if (!QUOTE_NUMBER_REGEX.test(quoteNumber || "")) {
            res.status(400).json({ error: "Invalid quoteNumber" });
            return;
        }
        await xeroCrmShaughnManagementController.resyncQuoteByNumber(req, res);
    }
}
__decorate([
    Route({
        method: "post",
        path: "/crm-shaughn/sync",
        rateLimit: "crmShaughn:sync",
        schema: syncQuoteSchema,
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], XeroCrmShaughnSecuredController.prototype, "sync", null);
__decorate([
    Route({
        method: "post",
        path: "/crm-shaughn/management/resync/:quoteNumber",
        rateLimit: "crmShaughn:resync",
        schema: emptyBodySchema,
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], XeroCrmShaughnSecuredController.prototype, "resync", null);
const ctrl = new XeroCrmShaughnSecuredController();
export default ctrl.registerRoutes(ctrl);

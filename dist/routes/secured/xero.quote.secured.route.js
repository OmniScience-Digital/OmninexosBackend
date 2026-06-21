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
import { xeroQuoteController } from "../../controllers/xero.quote.controller.js";
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
    reference: z.string().trim().max(500).optional().default(""),
    date: z.string().trim().min(1),
    expiryDate: z.string().trim().min(1),
    lineItems: z.array(lineItemSchema).min(1),
});
class XeroQuoteSecuredController extends BaseController {
    async createQuote(req, res) {
        req.body = req.validated;
        await xeroQuoteController.createQuote(req, res);
    }
}
__decorate([
    Route({
        method: "post",
        path: "/quotes",
        rateLimit: "xero:createQuote",
        schema: createQuoteSchema,
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], XeroQuoteSecuredController.prototype, "createQuote", null);
const ctrl = new XeroQuoteSecuredController();
export default ctrl.registerRoutes(ctrl);

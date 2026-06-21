// src/controllers/BaseController.ts
import { Router } from "express";
import { secureRoute } from "../security/securityFactory.js";
export class BaseController {
    constructor() {
        this.router = Router();
    }
    registerRoutes(instance) {
        const routes = Reflect.getMetadata("routes", instance.constructor) || [];
        if (routes.length === 0) {
            throw new Error(`No @Route decorators found on ${instance.constructor.name}`);
        }
        for (const route of routes) {
            const handler = instance[route.handler];
            if (typeof handler !== "function") {
                throw new Error(`Handler "${route.handler}" on ${instance.constructor.name} is not a function`);
            }
            const middlewares = secureRoute({
                schema: route.schema,
                rateLimit: route.rateLimit,
            });
            this.router[route.method](route.path, ...middlewares, handler.bind(instance));
        }
        return this.router;
    }
}

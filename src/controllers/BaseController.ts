// src/controllers/BaseController.ts
import { Router, RequestHandler } from 'express';
import { secureRoute } from '../security/securityFactory';
import { RouteMeta } from '../decorators/route';

export class BaseController {
  router = Router();

  registerRoutes(instance: BaseController): Router {
    const routes: Array<RouteMeta & { handler: string }> =
      Reflect.getMetadata('routes', instance.constructor) || [];

    if (routes.length === 0) {
      throw new Error(`No @Route decorators found on ${instance.constructor.name}`);
    }

    for (const route of routes) {
      const handler = (instance as any)[route.handler];
      if (typeof handler !== 'function') {
        throw new Error(
          `Handler "${route.handler}" on ${instance.constructor.name} is not a function`
        );
      }
      const middlewares: RequestHandler[] = secureRoute({
        schema: route.schema,
        rateLimit: route.rateLimit,
      });
      this.router[route.method](route.path, ...middlewares, handler.bind(instance));
    }

    return this.router;
  }
}

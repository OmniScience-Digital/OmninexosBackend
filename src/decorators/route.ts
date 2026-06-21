// src/decorators/route.ts
import 'reflect-metadata';
import { ZodSchema } from 'zod';
import { RateLimitKey, RateLimitConfig } from '../security/policyEngine';

type HttpMethod = 'get' | 'post' | 'put' | 'delete';

export interface RouteMeta {
  method: HttpMethod;
  path: string;
  rateLimit?: RateLimitKey | RateLimitConfig;
  schema?: ZodSchema;
}

export const Route = (meta: RouteMeta) => {
  return (target: object, propertyKey: string) => {
    const constructor = (target as any).constructor;
    const routes: Array<RouteMeta & { handler: string }> =
      Reflect.getMetadata('routes', constructor) || [];
    routes.push({ handler: propertyKey, ...meta });
    Reflect.defineMetadata('routes', routes, constructor);
  };
};

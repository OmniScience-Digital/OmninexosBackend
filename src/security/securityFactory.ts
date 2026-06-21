// src/security/securityFactory.ts
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import crypto from 'crypto';
import { ZodSchema } from 'zod';
import { RequestHandler } from 'express';
import { resolveRateLimit, RateLimitKey, RateLimitConfig } from './policyEngine';
import logger from '../utils/logger';
import { client } from '../services/redis.service';

export const apiKeyAuth = (): RequestHandler => (req, res, next) => {
  const key = req.headers['x-api-key'] as string;
  const secret = process.env.API_SECRET_KEY;

  if (!key || !secret || key.length !== secret.length) {
    logger.warn(`Unauthorized request - ip: ${req.ip}, path: ${req.path}`);
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const valid = crypto.timingSafeEqual(Buffer.from(key), Buffer.from(secret));
  if (!valid) {
    logger.warn(`Invalid API key - ip: ${req.ip}, path: ${req.path}`);
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  req.apiKey = key;
  next();
};

export const createLimiter = (policy: RateLimitKey | RateLimitConfig): RequestHandler => {
  const config = resolveRateLimit(policy);
  return rateLimit({
    windowMs: config?.windowMs ?? 60000,
    max: config?.max ?? 20,
    // ipKeyGenerator handles both IPv4 and IPv6 correctly
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${req.apiKey || 'anon'}`,
    message: { error: 'Too many requests' },
    store: new RedisStore({
      sendCommand: (...args: string[]) => (client as any).sendCommand(args),
    }),
  });
};

export const validate =
  (schema: ZodSchema): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      logger.warn(
        `Validation failed - path: ${req.path}, ip: ${req.ip}, issues: ${JSON.stringify(
          result.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message }))
        )}`
      );
      res.status(400).json({ error: result.error.issues });
      return;
    }
    req.validated = result.data;
    next();
  };

export const secureRoute = (config: {
  schema?: ZodSchema;
  rateLimit?: RateLimitKey | RateLimitConfig;
}): RequestHandler[] => {
  const middlewares: RequestHandler[] = [apiKeyAuth()];
  if (config.rateLimit) middlewares.push(createLimiter(config.rateLimit));
  if (config.schema) middlewares.push(validate(config.schema));
  return middlewares;
};

// src/security/securityFactory.ts
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import crypto from "crypto";
import { resolveRateLimit } from "./policyEngine.js";
import logger from "../utils/logger.js";
import { client } from "../services/redis.service.js";
export const apiKeyAuth = () => (req, res, next) => {
    const key = req.headers["x-api-key"];
    const secret = process.env.API_SECRET_KEY;
    if (!key || !secret || key.length !== secret.length) {
        logger.warn(`Unauthorized request - ip: ${req.ip}, path: ${req.path}`);
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    const valid = crypto.timingSafeEqual(Buffer.from(key), Buffer.from(secret));
    if (!valid) {
        logger.warn(`Invalid API key - ip: ${req.ip}, path: ${req.path}`);
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    req.apiKey = key;
    next();
};
export const createLimiter = (policy) => {
    const config = resolveRateLimit(policy);
    return rateLimit({
        windowMs: config?.windowMs ?? 60000,
        max: config?.max ?? 20,
        // ipKeyGenerator handles both IPv4 and IPv6 correctly
        keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "")}:${req.apiKey || "anon"}`,
        message: { error: "Too many requests" },
        store: new RedisStore({
            sendCommand: (...args) => client.sendCommand(args),
        }),
    });
};
export const validate = (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
        logger.warn(`Validation failed - path: ${req.path}, ip: ${req.ip}, issues: ${JSON.stringify(result.error.issues.map((e) => ({ field: e.path.join("."), message: e.message })))}`);
        res.status(400).json({ error: result.error.issues });
        return;
    }
    req.validated = result.data;
    next();
};
export const secureRoute = (config) => {
    const middlewares = [apiKeyAuth()];
    if (config.rateLimit)
        middlewares.push(createLimiter(config.rateLimit));
    if (config.schema)
        middlewares.push(validate(config.schema));
    return middlewares;
};

// src/middlewares/requestId.ts
import { randomUUID } from 'crypto';
export const requestId = (req, res, next) => {
    req.id = randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
};

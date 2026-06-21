// src/middlewares/requestId.ts
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

export const requestId = (req: Request, res: Response, next: NextFunction): void => {
  req.id = randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
};

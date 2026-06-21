// src/types/express.d.ts
import 'express';

declare global {
  namespace Express {
    interface Request {
      apiKey?: string;
      validated?: unknown;
      id?: string;
    }
  }
}

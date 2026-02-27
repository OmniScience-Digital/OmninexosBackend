import { Request, Response } from 'express';
import { createXeroQuote } from '../services/xero.CreateQuote.service';

export const xeroQuoteController = {
  createQuote: async (req: Request, res: Response) => {
    try {
      const quoteData = req.body; // JSON from React

      const result = await createXeroQuote(quoteData);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error creating Xero quote:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
};

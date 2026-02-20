import logger from '../utils/logger';
import { Request, Response } from 'express';

export const xeroControllerRouter = async (req: Request, res: Response) => {
  try {
    logger.info('Executing Xero Bill Webhook control route.');
    logger.info(JSON.stringify(req.body));

    res.status(200).json({ success: true, message: 'Xero Bill Updated successfully' }).send('OK');
  } catch (error: any) {
    logger.error('Failed to update Xero Bill:', error);
    console.error(error);

    res.status(500).json({
      success: false,
      error: 'Error Xero Bill not  Updated',
      details: (error as Error).message,
    });
  }
};

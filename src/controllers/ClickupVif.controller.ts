import logger from '../utils/logger';
import { Request, Response } from 'express';

export const vifControllerRouter = async (req: Request, res: Response) => {
  try {
    logger.info('Executing Vif control route.');

    console.log('Full request body:');
    console.log(JSON.stringify(req.body, null, 2));

    const payload = parseVifClickUpPayload(req.body);

    res.status(200).json({ success: true, message: 'Report Generated' });
  } catch (error: any) {
    logger.error('Failed to generate report:', error);
    console.error(error);

    res.status(500).json({
      success: false,
      error: 'Error generating report',
      details: (error as Error).message,
    });
  }
};

function parseVifClickUpPayload(clickupPayload: any) {
  try {
    const { payload } = clickupPayload;
    const description = payload.text_content;

    const lines = description.split('\n').filter(Boolean);

    // Process all lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // console.log(line);
    }
  } catch (error) {
    console.log(error);
  }
}

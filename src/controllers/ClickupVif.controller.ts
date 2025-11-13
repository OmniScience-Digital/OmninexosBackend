import { deleteTaskByClickupId } from '../repositories/dynamo.task.repository';
import logger from '../utils/logger';
import { Request, Response } from 'express';

export const vifControllerRouter = async (req: Request, res: Response) => {
  try {
    logger.info('Executing Inspection control route.');
    logger.info(JSON.stringify(req.body, null, 2));

    const taskid = parseInspectionClickUpPayload(req.body);

    await deleteTaskByClickupId(taskid);

    res.status(200).json({ success: true, message: 'Task updated successfully' });
  } catch (error: any) {
    logger.error('Failed to insert inspection:', error);
    console.error(error);

    res.status(500).json({
      success: false,
      error: 'Error inserting inspection',
      details: (error as Error).message,
    });
  }
};

function parseInspectionClickUpPayload(clickupPayload: any) {
  try {
    const { payload } = clickupPayload;
    const taskid = payload.id;

    return taskid;
  } catch (error: any) {
    logger.error('Error parsing inspection payload:', error);
    throw error;
  }
}

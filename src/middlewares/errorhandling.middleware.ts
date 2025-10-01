import { Express, Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

function errorhandling(app: Express) {
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error(err.stack);
    res.status(500).send('Something went wrong !');
  });
}

export default errorhandling;

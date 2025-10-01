import { Express, Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

function executiontime(app: Express) {
  //logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    next();
    //after all action in the middleware
    const delta = Date.now() - start;
    logger.info(`Execution time :  ${req.method}   ${req.url}    ${delta}   ms`);
  });
}

export default executiontime;

import { Express, Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

function executiontime(app: Express) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    // Log request received
    logger.debug(`➡️  ${req.method} ${req.url} - Request received`);

    // Capture response finish event to log complete timing
    res.on('finish', () => {
      const duration = Date.now() - start;
      const status = res.statusCode;

      // Log with emoji based on status
      const statusEmoji = status >= 400 ? '❌' : status >= 300 ? '↪️' : '✅';

      logger.info(
        `${statusEmoji} ${req.method} ${req.url} - ` + `Status: ${status} - Duration: ${duration}ms`
      );
    });

    next();
  });
}

export default executiontime;

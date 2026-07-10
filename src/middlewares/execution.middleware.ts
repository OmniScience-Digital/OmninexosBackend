import { Express, Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

function executiontime(app: Express) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    logger.debug(`➡️  ${req.method} ${req.url} - Request received`);

    res.on('finish', () => {
      const duration = Date.now() - start;
      const status = res.statusCode;

      // Skip logging noisy 404s (bot scans hitting random paths)
      if (status === 404) return;

      const statusEmoji = status >= 400 ? '❌' : status >= 300 ? '↪️' : '✅';

      logger.info(
        `${statusEmoji} ${req.method} ${req.url} - ` + `Status: ${status} - Duration: ${duration}ms`
      );
    });

    next();
  });
}

export default executiontime;

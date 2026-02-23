import express from 'express';
import { Request, Response, NextFunction } from 'express';
import 'dotenv/config';
import cors from 'cors';
import compression from 'compression';
import logger from './utils/logger';
import executiontime from './middlewares/execution.middleware';
import errorhandling from './middlewares/errorhandling.middleware';
import routes from './routes/api.route';

const config = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || 'localhost',
};

const app = express();

// Trust the proxy
app.set('trust proxy', true);

// IMPORTANT: executiontime should be EARLY to measure everything
executiontime(app);

// Raw body capture middleware (BEFORE body parsing)
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.includes('/xeroBillwebhook')) {
    let data = '';
    req.setEncoding('utf8');

    req.on('data', (chunk) => {
      data += chunk;
    });

    req.on('end', () => {
      (req as any).rawBody = data;
      next();
    });

    req.on('error', (err) => {
      logger.error('Error reading raw body:', err);
      next(err);
    });
  } else {
    next();
  }
});

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Enable Cors
app.use(
  cors({
    origin: '*',
    methods: 'GET,POST',
    credentials: true,
  })
);

// JSON compression
app.use(compression());

// Register routes
app.use('/', routes);

// Error handling should be LAST
errorhandling(app);

app.listen(config.port, () => {
  logger.info(`App running at http://${config.host}:${config.port}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
});

export default app;

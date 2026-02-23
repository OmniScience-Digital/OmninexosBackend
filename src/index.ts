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

// IMPORTANT: Raw body capture middleware - MUST come BEFORE any body parsing
app.use((req: Request, res: Response, next: NextFunction) => {
  // Only capture raw body for Xero webhook path
  if (req.path.includes('/xeroBillwebhook')) {
    let data = '';
    req.setEncoding('utf8');

    req.on('data', (chunk) => {
      data += chunk;
    });

    req.on('end', () => {
      (req as any).rawBody = data;
      // Don't parse JSON here, let the route handle it
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

// Standard middleware for all routes
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

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Register routes
app.use('/', routes);

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).send('Internal Server Error');
});

app.listen(config.port, () => {
  logger.info(`App is running at http://${config.host}:${config.port}`);
  logger.info(`Running on env: ${process.env.NODE_ENV}`);
});

export default app;

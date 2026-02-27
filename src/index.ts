import express from 'express';
import 'dotenv/config';
import cors from 'cors';
import compression from 'compression';
import logger from './utils/logger';
import executiontime from './middlewares/execution.middleware';
import errorhandling from './middlewares/errorhandling.middleware';
import routes from './routes/api.route';

//workers for xero
import './workers/quotes.worker';
import './workers/purchases.worker';

const PORT = Number(process.env.PORT) || 5001;

const app = express();

app.set('trust proxy', true);
executiontime(app);

// **RAW body parser for Xero webhook - MUST match exact route path**
app.use('/api/v1/xeroBillwebhook', express.raw({ type: '*/*', limit: '10mb' }));

// JSON parser for all other routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(
  cors({
    origin: '*',
    methods: 'GET,POST',
    credentials: true,
  })
);

app.use(compression());
app.use('/', routes);
errorhandling(app);

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
});

export default app;

import express from 'express';
import 'dotenv/config';
import cors from 'cors';
import compression from 'compression';
import logger from './utils/logger';
import executiontime from './middlewares/execution.middleware';
import errorhandling from './middlewares/errorhandling.middleware';
import routes from './routes/api.route';

const config = {
  port: process.env.PORT,
  host: process.env.HOST,
};

//Server Port
const port = config.port;
const app = express();

// Trust the proxy
app.set('trust proxy', true);

// Middleware to parse JSON bodies
app.use(express.json({ limit: '10mb' })); // Increase limit as needed
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

//Enable Cors
app.use(
  cors({
    origin: '*',
    methods: 'Get,POST',
    credentials: true,
  })
);

//json compression
app.use(compression());

//register routes
app.use('/', routes);

app.listen(port, async () => {
  logger.info(`App is running  at http://localhost:${port}`);
  logger.info(`Running on env : ${process.env.NODE_ENV}`);
});

//logging middleware
executiontime(app);

//Error handling middleware
errorhandling(app);

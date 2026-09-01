// import 'reflect-metadata';
// import express from 'express';
// import 'dotenv/config';
// import cors from 'cors';
// import compression from 'compression';
// import logger from './utils/logger';
// import executiontime from './middlewares/execution.middleware';
// import errorhandling from './middlewares/errorhandling.middleware';
// import { requestId } from './middlewares/requestId';
// import routes from './routes/api.route';
// // workers for xero
// import './workers/quotes.worker';
// //import './workers/purchases.worker';
// // keepalive cron - prevents Xero refresh token from expiring during inactivity
// import './crons/xero.tokenKeepalive.cron';
// const PORT = Number(process.env.PORT) || 5001;
// const app = express();
// app.set('trust proxy', true);
// app.use(requestId);
// executiontime(app);
// // **RAW body parser for Xero webhooks - MUST match exact route paths (HMAC verification needs the raw bytes)**
// app.use('/api/v1/xeroBillwebhook', express.raw({ type: '*/*', limit: '10mb' }));
// app.use('/api/v1/xeroQuotewebhook', express.raw({ type: '*/*', limit: '10mb' }));
// // JSON parser for all other routes
// app.use(express.json({ limit: '10mb' }));
// app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// app.use(
//   cors({
//     origin: '*',
//     methods: 'GET,POST',
//     credentials: true,
//   })
// );
// app.use(compression());
// app.use('/', routes);
// errorhandling(app);
// app.listen(PORT, () => {
//   logger.info(`Server running on port ${PORT}`);
//   logger.info(`Environment: ${process.env.NODE_ENV}`);
// });
// export default app;
import "reflect-metadata";
import express from "express";
import "dotenv/config";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import logger from "./utils/logger.js";
import executiontime from "./middlewares/execution.middleware.js";
import errorhandling from "./middlewares/errorhandling.middleware.js";
import { requestId } from "./middlewares/requestId.js";
import routes from "./routes/api.route.js";
// workers for xero
import "./workers/quotes.worker.js";
//import './workers/purchases.worker';
// keepalive cron - prevents Xero refresh token from expiring during inactivity
import "./crons/xero.tokenKeepalive.cron.js";
const PORT = Number(process.env.PORT) || 5001;
const app = express();
app.set("trust proxy", true);
app.use(requestId);
executiontime(app);
// **RAW body parser for Xero webhooks - MUST match exact route paths (HMAC verification needs the raw bytes)**
app.use("/api/v1/xeroBillwebhook", express.raw({ type: "*/*", limit: "10mb" }));
app.use("/api/v1/xeroQuotewebhook", express.raw({ type: "*/*", limit: "10mb" }));
// JSON parser for all other routes
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
// Needed to read the xero_oauth_state cookie set on /connect and read back
// on /callback for CSRF protection. Without this, req.cookies is always
// undefined and the state check in xero.controller always fails.
app.use(cookieParser());
// NOTE: `origin: '*'` combined with `credentials: true` is invalid — browsers
// silently refuse to send/store cookies (including the Xero OAuth state
// cookie) for wildcard-origin + credentials responses. Reflecting the
// request's Origin header (or listing explicit allowed origins) is required
// for cookies to work cross-origin. If your frontend and this API are on the
// same origin, replace this with your actual origin string instead.
const allowedOrigins = process.env.CORS_ORIGINS?.split(",").map((o) => o.trim());
app.use(cors({
    origin: allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : true, // reflect request origin if no explicit list is configured
    methods: "GET,POST",
    credentials: true,
}));
app.use(compression());
app.use("/", routes);
errorhandling(app);
app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV}`);
});
export default app;

import "reflect-metadata";
import express from "express";
import "dotenv/config";
import cors from "cors";
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
app.use(cors({
    origin: "*",
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

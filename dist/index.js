import express from "express";
import "dotenv/config";
import cors from "cors";
import compression from "compression";
import logger from "./utils/logger.js";
import executiontime from "./middlewares/execution.middleware.js";
import errorhandling from "./middlewares/errorhandling.middleware.js";
import routes from "./routes/api.route.js";
const port = process.env.PORT;
const app = express();
app.set("trust proxy", true);
/* ===============================
   IMPORTANT:XERO WEBHOOK RAW BODY
================================= */
app.use("/api/v1/xero/xeroBillwebhook", express.raw({ type: "application/json" }));
/* ===============================
   Normal Body Parsers (after)
================================= */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
/* =============================== */
app.use(cors({
    origin: "*",
    methods: "GET,POST",
    credentials: true,
}));
app.use(compression());
/* ===============================
   Routes
================================= */
app.use("/", routes);
app.listen(port, () => {
    logger.info(`App is running at http://localhost:${port}`);
    logger.info(`Running on env : ${process.env.NODE_ENV}`);
});
executiontime(app);
errorhandling(app);

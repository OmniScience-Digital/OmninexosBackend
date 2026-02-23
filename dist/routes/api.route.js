import express from "express";
const routes = express.Router();
import stockControllerApi from "./stock.route.js";
import clickupApi from "./clickup.route.js";
import clickupVifApi from "./vif.route.js";
import xeroApi from "./xero.auth.route.js";
import xeroQuoteApi from "./xero.quote.route.js";
import xeroBillApi from "./xero.bill.route.js";
routes.use("/api/v1/xeroBillwebhook", xeroBillApi); // Most specific first
routes.use("/api/v1", stockControllerApi);
routes.use("/api/v1", clickupApi);
routes.use("/api/v1", clickupVifApi);
routes.use("/api/v1/xero", xeroApi);
routes.use("/api/v1/xero", xeroQuoteApi);
export default routes;

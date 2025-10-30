import express from "express";
const routes = express.Router();
import stockControllerApi from "./stock.route.js";
import clickupApi from "./clickup.route.js";
import clickupVifApi from "./vif.route.js";
routes.use("/api/v1", stockControllerApi);
routes.use("/api/v1", clickupApi);
routes.use("/api/v1", clickupVifApi);
export default routes;

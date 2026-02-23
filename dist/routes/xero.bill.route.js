import express from "express";
const router = express.Router();
import { rawBodyMiddleware } from "../middlewares/rawbody.middleware.js";
import { xeroControllerRouter } from "../controllers/xero.BillController.js";
// IMPORTANT: Use raw body middleware BEFORE json parser for this route
router.post("/xeroBillwebhook", rawBodyMiddleware, express.json(), xeroControllerRouter);
export default router;
// https://apqirzaiib.execute-api.us-east-1.amazonaws.com/api/v1/xeroBillwebhook
// curl -X POST https://wq3qo9l3de.execute-api.us-east-1.amazonaws.com/api/v1/xeroBillwebhook \
//   -H "Content-Type: application/json" \
//   -d '{"test": "data"}'
// curl -X POST http://44.211.210.154/5001/api/v1/xero/xeroBillwebhook \
//   -H "Content-Type: application/json" \
//   -d '{"test": "data"}'
// curl -X POST https://apqirzaiib.execute-api.us-east-1.amazonaws.com/api/v1/xeroBillwebhook \
//   -H "Content-Type: application/json" \
//   -d '{"test": "data"}'

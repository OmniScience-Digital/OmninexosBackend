import express from 'express';
const routes = express.Router();

import stockControllerApi from './stock.route';
import clickupApi from './clickup.route';
import clickupVifApi from './vif.route';
import xeroApi from './xero.auth.route';
import xeroQuoteApi from './xero.quote.route';
import xeroBillApi from './xero.bill.route';

routes.use('/api/v1', stockControllerApi);
routes.use('/api/v1', clickupApi);
routes.use('/api/v1', clickupVifApi);
routes.use('/api/v1/xero', xeroApi);
routes.use('/api/v1/xero', xeroQuoteApi);
routes.use('/api/v1/xero', xeroBillApi);

export default routes;

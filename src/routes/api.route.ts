import express from 'express';
const routes = express.Router();

import stockControllerApi from './stock.route';
import clickupApi from './clickup.route';
import clickupVifApi from './vif.route';
import xeroApi from './xero.auth.route';
import xeroQuoteApi from './xero.quote.route';
import xeroBillApi from './xero.bill.route';
import server from './server.route';
import apiCheck from './api.check.route';
import businessUnit from './xero.businessUnit.route';

routes.use('/api/v1', xeroBillApi); // Most specific first
routes.use('/api/v1', stockControllerApi);
routes.use('/api/v1', clickupApi);
routes.use('/api/v1', clickupVifApi);
routes.use('/api/v1/xero', xeroApi);
routes.use('/api/v1/xero', xeroQuoteApi);
routes.use('/api/v1/check', apiCheck);
routes.use('/api/v1', businessUnit);
routes.use('/', server);

export default routes;

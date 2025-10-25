import express from 'express';
const routes = express.Router();

import stockControllerApi from './stock.route';
import clickupApi from './clickup.route';


routes.use('/api/v1', stockControllerApi);
routes.use('/api/v1', clickupApi);


export default routes;

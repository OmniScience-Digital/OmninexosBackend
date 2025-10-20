import express from 'express';
const routes = express.Router();

import stockControllerApi from './stock.route';
import clickupApi from './clickup.route';
import vifClickUpApi from './vif_clickup.route';
import ClickUpvifApi from './vif.route';

routes.use('/api/v1', stockControllerApi);
routes.use('/api/v1', clickupApi);
routes.use('/api/v1', vifClickUpApi);
routes.use('/api/v1', ClickUpvifApi);

export default routes;

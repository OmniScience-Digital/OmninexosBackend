import './test.cron';
import { FleetController } from '../../controllers/cron.fleetController';
import { getFleetvehicles } from '../../helper/fleet/fleet.helper';
import { getFleetTasks, getHrdTasks } from '../../helper/task/task.helper';
import logger from '../../utils/logger';
import { getEmployees } from '../../helper/hrd/hrd.helper';
import { HrdController } from '../../controllers/cron.hrd.controller';
import {
  fetchCompliance,
  fetchComplianceAdditionals,
  getAllCustomerSites,
} from '../../helper/crm/crm.helper';
import { CustomerRelations } from '../../controllers/cron.crm.controller';

logger.info('Dev Cron Loaded');

(async () => {
  try {
    // const [compliance, additionals, employees,hrdtasks,customer,
    // ] = await Promise.all([
    //   fetchCompliance(),
    //   fetchComplianceAdditionals(),
    //   getEmployees(),
    //   getHrdTasks(),
    //   getAllCustomerSites(),
    // ]);
    // if (compliance && additionals && employees&&hrdtasks) {
    //   //call fleet controller
    //   await CustomerRelations(employees, compliance, additionals,hrdtasks,customer||[]);
    // }
    // const tasks = await getFleetTasks();
    // if(fleets &&tasks)
    // {
    // //call fleet controller
    // await FleetController(fleets,tasks);
    // }
    // if(employees&&tasks )
    // {
    // //call HrdController controller
    // await HrdController(employees,tasks);
    //}
    // const tasks = await getHrdTasks();
    // if(employees&&tasks )
    // {
    // //call HrdController controller
    // await HrdController(employees,tasks);
    // }
  } catch (error: any) {
    logger.error('Runtime error:', error);
  }
})();

import { addQuoteJob } from '../../queues/quotes.queue';

(async () => {
  logger.info('🕒 Starting quote cron...');
  await addQuoteJob();
})();

import { addPurchaseJob } from '../../queues/purchases.queue';

(async () => {
  logger.info('🕒 Starting purchase cron...');
  await addPurchaseJob();
})();

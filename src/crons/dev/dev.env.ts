import './test.cron';
import { FleetController } from '../../controllers/cron.fleetController';
import { getFleetvehicles } from '../../helper/fleet/fleet.helper';
import { getFleetTasks } from '../../helper/task/task.helper';
import logger from '../../utils/logger';

logger.info('Dev Cron Loaded');

// Set the time zone to Johannesburg, South Africa (SAST)
const timeZone = 'Africa/Johannesburg';

(async () => {
  try {
    // const fleets = await getFleetvehicles();
    // const tasks = await getFleetTasks();
    // if(fleets &&tasks)
    // {
    // //call fleet controller
    // await FleetController(fleets,tasks);
    // }
  } catch (error: any) {
    logger.error('Runtime error:', error);
  }
})();

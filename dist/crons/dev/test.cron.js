import cron from "node-cron";
import logger from "../../utils/logger.js";
import { getFleetvehicles } from "../../helper/fleet/fleet.helper.js";
import { getFleetTasks, getHrdTasks } from "../../helper/task/task.helper.js";
import { FleetController } from "../../controllers/cron.fleetController.js";
import { getEmployees } from "../../helper/hrd/hrd.helper.js";
import { HrdController } from "../../controllers/cron.hrd.controller.js";
// Set the time zone to Johannesburg, South Africa (SAST)
const timeZone = "Africa/Johannesburg";
//Task 1am cron
cron.schedule("0 1 * * *", async () => {
    try {
        logger.info("[CRON] Triggered 01:00 (2AM) Task Check");
        const fleets = await getFleetvehicles();
        const tasks = await getFleetTasks();
        if (fleets && tasks) {
            //call fleet controller
            await FleetController(fleets, tasks);
        }
        else {
            logger.warn("No valid progressive sites to process");
        }
    }
    catch (error) {
        logger.error("Runtime error:", error);
    }
}, { timezone: timeZone });
//Task 1:10am cron
cron.schedule("10 1 * * *", async () => {
    try {
        logger.info("[CRON] Triggered 01:10 (1AM) Task Check");
        const employees = await getEmployees();
        const tasks = await getHrdTasks();
        if (employees && tasks) {
            //call HrdController controller
            await HrdController(employees, tasks);
        }
        else {
            logger.warn("No valid progressive sites to process");
        }
    }
    catch (error) {
        logger.error("Runtime error:", error);
    }
}, { timezone: timeZone });

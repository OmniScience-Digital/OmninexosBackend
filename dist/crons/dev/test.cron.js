import cron from "node-cron";
import logger from "../../utils/logger.js";
import { getFleetvehicles } from "../../helper/fleet/fleet.helper.js";
import { getFleetTasks, getHrdTasks } from "../../helper/task/task.helper.js";
import { FleetController } from "../../controllers/cron.fleetController.js";
import { getEmployees } from "../../helper/hrd/hrd.helper.js";
import { HrdController } from "../../controllers/cron.hrd.controller.js";
import { fetchCompliance, fetchComplianceAdditionals, getAllCustomerSites } from "../../helper/crm/crm.helper.js";
import { CustomerRelations } from "../../controllers/cron.crm.controller.js";
const timeZone = "Africa/Johannesburg";
// Task 1:00 AM cron 
cron.schedule("0 1 * * *", async () => {
    try {
        logger.info("[CRON] Triggered 01:00 AM Fleet Task Check");
        const fleets = await getFleetvehicles();
        const tasks = await getFleetTasks();
        if (fleets && tasks) {
            await FleetController(fleets, tasks);
        }
        else {
            logger.warn("Fleet: No valid data to process");
        }
    }
    catch (error) {
        logger.error("Runtime error:", error);
    }
}, { timezone: timeZone });
// Task 1:10 AM cron - SINGLE COMBINED JOB FOR HRD + CUSTOMER RELATIONS
cron.schedule("10 1 * * *", async () => {
    try {
        logger.info("[CRON] Triggered 01:10 AM HRD & Customer Relations Task Check");
        // Fetch all data once
        const [employees, hrdtasks, compliance, additionals, customer] = await Promise.all([
            getEmployees(),
            getHrdTasks(),
            fetchCompliance(),
            fetchComplianceAdditionals(),
            getAllCustomerSites(),
        ]);
        // Run HRD Controller
        if (employees && hrdtasks) {
            await HrdController(employees, hrdtasks);
        }
        else {
            logger.warn("HRD: No valid data to process");
        }
        // Run Customer Relations Controller
        if (compliance && additionals && employees && hrdtasks) {
            await CustomerRelations(employees, compliance, additionals, hrdtasks, customer || []);
        }
        else {
            logger.warn("Customer Relations: No valid data to process");
        }
    }
    catch (error) {
        logger.error("Runtime error:", error);
    }
}, { timezone: timeZone });

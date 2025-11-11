import "./test.cron.js";
import logger from "../../utils/logger.js";
logger.info("Dev Cron Loaded");
// Set the time zone to Johannesburg, South Africa (SAST)
const timeZone = "Africa/Johannesburg";
(async () => {
    try {
        // const fleets = await getFleetvehicles();
        // const tasks = await getFleetTasks();
        // if(fleets &&tasks)
        // {
        // //call fleet controller
        // await FleetController(fleets,tasks);
        // }
        // const employees = await getEmployees();
        // const tasks = await getHrdTasks();
        // if(employees&&tasks )
        // {
        // //call HrdController controller
        // await HrdController(employees,tasks);
        // }
    }
    catch (error) {
        logger.error("Runtime error:", error);
    }
})();

import "./test.cron.js";
import logger from "../../utils/logger.js";
logger.info("Dev Cron Loaded");
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
    }
    catch (error) {
        logger.error("Runtime error:", error);
    }
})();
import { addQuoteJob } from "../../queues/quotes.queue.js";
(async () => {
    logger.info("\uD83D\uDD52 Starting quote cron...");
    await addQuoteJob();
})();
import { addPurchaseJob } from "../../queues/purchases.queue.js";
(async () => {
    logger.info("\uD83D\uDD52 Starting purchase cron...");
    await addPurchaseJob();
})();

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
import { addJobCardDispatchJob } from "../../queues/jobcard.queue.js";
import { addTicketJobs } from "../../queues/ticket.queue.js"; // TICKETING
(async () => {
    try {
        logger.info("\uD83D\uDD52 Starting quote cron...");
        await addQuoteJob();
    }
    catch (err) {
        logger.error("Could not schedule quote job:", err);
    }
})();
// JOBCARD: its own block so a failure in the quote job above can never stop it
(async () => {
    try {
        logger.info("\uD83D\uDD52 Starting job card dispatch cron...");
        await addJobCardDispatchJob();
    }
    catch (err) {
        logger.error("Could not schedule job card job:", err);
    }
})();
// TICKETING
(async () => {
    try {
        await addTicketJobs();
        logger.info("\uD83D\uDD52 Ticket intake and sync jobs scheduled");
    }
    catch (err) {
        logger.error("Could not schedule ticket jobs:", err);
    }
})();
// import { addPurchaseJob } from '../../queues/purchases.queue';
// (async () => {
//   logger.info('🕒 Starting purchase cron...');
//   await addPurchaseJob();
// })();

// src/crons/prod/index.prod.ts  (MODIFIED - search "JOBCARD" for the 2 additions)
import logger from "../../utils/logger.js";
import cron from "node-cron";
import { getFleetvehicles } from "../../helper/fleet/fleet.helper.js";
import { getFleetTasks } from "../../helper/task/task.helper.js";
import { FleetController } from "../../controllers/cron.fleetController.js";
import { addQuoteJob } from "../../queues/quotes.queue.js";
import { addJobCardDispatchJob } from "../../queues/jobcard.queue.js"; // JOBCARD
import { addTicketJobs } from "../../queues/ticket.queue.js"; // TICKETING
logger.info("Prod Cron Loaded");
// Set the time zone to Johannesburg, South Africa (SAST)
const timeZone = "Africa/Johannesburg";
(async () => {
    try {
        logger.info("\uD83D\uDD52 Starting Prod Quote cron...");
        await addQuoteJob();
    }
    catch (err) {
        logger.error("Could not schedule quote job:", err);
    }
})();
// JOBCARD: its own block so a failure in the quote job above can never stop it
(async () => {
    try {
        await addJobCardDispatchJob(); // check for submitted results
        logger.info("\uD83D\uDD52 Job card dispatch job scheduled");
    }
    catch (err) {
        logger.error("Could not schedule job card job:", err);
    }
})();
// TICKETING: its own block so a failure here can never stop the quote / job card jobs above
(async () => {
    try {
        await addTicketJobs();
        logger.info("\uD83D\uDD52 Ticket intake (15s) and sync (5min) jobs scheduled");
    }
    catch (err) {
        logger.error("Could not schedule ticket jobs:", err);
    }
})();
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

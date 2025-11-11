import { getJhbDate, getJhbTimestamp, parseDateInJhb } from "../helper/time/time.helper.js";
import { insertTaskService } from "../repositories/dynamo.task.repository.js";
import logger from "../utils/logger.js";
const API_TOKEN = process.env.CLICKUP_API_TOKEN;
const LIST_ID = process.env.VIF_LIST_ID;
const USERNAME_FIELD_ID = "daf6f996-8096-473b-b9e4-9e20f4568d63";
export const FleetController = async (fleets, tasks) => {
    try {
        const filteredItems = await fleetHelper(fleets, tasks);
    }
    catch (error) {
        console.log("Fleet Cron controller ", error);
    }
};
const fleetHelper = async (items, tasks) => {
    const jhbCurrentDate = getJhbDate();
    const timestamp = getJhbTimestamp();
    for (let i = 0; i < items.length; i++) {
        try {
            const vehicle = items[i];
            const breakAndLux = parseDateInJhb(vehicle.breakandLuxExpirey?.S);
            const licenseDisc = parseDateInJhb(vehicle.liscenseDiscExpirey?.S);
            const lastService = parseDateInJhb(vehicle.lastServicedate?.S);
            // Comparison Logic
            const isServiceExpired = lastService && jhbCurrentDate > new Date(lastService.getTime() + 334 * 24 * 60 * 60 * 1000);
            const isLicenseDiscExpired = licenseDisc && jhbCurrentDate > new Date(licenseDisc.getTime() - 31 * 24 * 60 * 60 * 1000);
            const isBreakAndLuxExpired = breakAndLux && jhbCurrentDate > new Date(breakAndLux.getTime() - 31 * 24 * 60 * 60 * 1000);
            // Check if tasks already exist for this vehicle
            const existingTasks = tasks.filter((task) => task.vehicleReg.S === vehicle.vehicleReg.S);
            // Create tasks only if they don't exist
            if (isBreakAndLuxExpired) {
                const breakAndLuxTaskExists = existingTasks.some((task) => task.taskType.S === "breaknlux");
                if (!breakAndLuxTaskExists) {
                    const topic = `${vehicle.fleetNumber?.S}, Break and Lux Renewal, ${timestamp}`;
                    const description = `Vehicle Registration - ${vehicle.vehicleReg?.S} \nVehicle Vin - ${vehicle.vehicleVin?.S} \nCurrent Driver - ${vehicle.currentDriver?.S} \nCurrent Break and Lux Expirey  - ${vehicle.breakandLuxExpirey?.S}`;
                    // create click up task
                    const task = await createTasks(description, topic, vehicle.currentDriver?.S);
                    if (!task) {
                        console.error(`Failed to create ClickUp task for ${vehicle.vehicleReg?.S} - breaknlux`);
                        continue; // Skip to next vehicle
                    }
                    //insert task to db
                    await insertTaskService({
                        taskType: "breaknlux",
                        vehicleReg: vehicle.vehicleReg?.S,
                        clickupTaskId: task.id,
                    });
                    logger.info(`Created breaknlux task for ${vehicle.vehicleReg?.S}`);
                }
            }
            if (isLicenseDiscExpired) {
                const licenseDiscTaskExists = existingTasks.some((task) => task.taskType.S === "licensedisc");
                if (!licenseDiscTaskExists) {
                    const topic = `${vehicle.fleetNumber?.S}, Liscence Disc Expirey, ${timestamp}`;
                    const description = `Vehicle Registration - ${vehicle.vehicleReg?.S} \nVehicle Vin - ${vehicle.vehicleVin?.S} \nCurrent Driver - ${vehicle.currentDriver?.S} \nCurrent Disc Expirey  - ${vehicle.liscenseDiscExpirey?.S}`;
                    // create click up task
                    const task = await createTasks(description, topic, vehicle.currentDriver?.S);
                    if (!task) {
                        console.error(`Failed to create ClickUp task for ${vehicle.vehicleReg?.S} - licensedisc`);
                        continue;
                    }
                    //insert task to db
                    await insertTaskService({
                        taskType: "licensedisc",
                        vehicleReg: vehicle.vehicleReg?.S,
                        clickupTaskId: task.id,
                    });
                    logger.info(`Created licensedisc task for ${vehicle.vehicleReg?.S}`);
                }
            }
            if (isServiceExpired) {
                const serviceTaskExists = existingTasks.some((task) => task.taskType.S === "service");
                if (!serviceTaskExists) {
                    const topic = `${vehicle.fleetNumber?.S}, Service Due, ${timestamp}`;
                    const description = `Vehicle Registration - ${vehicle.vehicleReg?.S} \nVehicle Vin - ${vehicle.vehicleVin?.S} \nCurrent Driver - ${vehicle.currentDriver?.S} \nService Plan Status - ${vehicle.servicePlanStatus?.BOOL} \nService Plan KM - ${vehicle.serviceplankm?.toFixed(2)} \nPrevious Service KM - ${vehicle.lastServicekm?.toFixed(2)} \nPrevious Date - ${vehicle.lastServicedate?.S} \nCurrent Km - ${vehicle.currentkm?.toFixed(2)} \n`;
                    // create click up task
                    const task = await createTasks(description, topic, vehicle.currentDriver?.S);
                    if (!task) {
                        console.error(`Failed to create ClickUp task for ${vehicle.vehicleReg?.S} - service`);
                        continue;
                    }
                    //insert task to db
                    await insertTaskService({
                        taskType: "service",
                        vehicleReg: vehicle.vehicleReg?.S,
                        clickupTaskId: task.id,
                    });
                    logger.info(`Created service task for ${vehicle.vehicleReg?.S}`);
                }
            }
        }
        catch (error) {
            console.error(`Error processing vehicle ${items[i]?.vehicleReg?.S}:`, error);
            // Continue with next vehicle even if this one fails
            continue;
        }
    }
};
async function createTasks(descriptionLines, topic, username) {
    const url = `https://api.clickup.com/api/v2/list/${LIST_ID}/task`;
    const body = {
        name: topic,
        description: descriptionLines,
        priority: 3,
        custom_fields: [
            {
                id: USERNAME_FIELD_ID,
                value: normalize(username),
            },
        ],
        status: "to do",
    };
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: API_TOKEN,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    return data;
}
// Normalize strings: trim, remove extra quotes
function normalize(str) {
    if (typeof str !== "string")
        return String(str);
    return str.trim().replace(/^"+|"+$/g, "");
}

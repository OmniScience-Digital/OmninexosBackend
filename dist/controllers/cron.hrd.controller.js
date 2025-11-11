import { getJhbDate, getJhbTimestamp, parseDateInJhb } from "../helper/time/time.helper.js";
import { insertEmployeeTaskService } from "../repositories/dynamo.employee.repository.js";
import logger from "../utils/logger.js";
const API_TOKEN = process.env.CLICKUP_API_TOKEN;
const LIST_ID = process.env.HRD_LIST_ID;
const USERNAME_FIELD_ID = "daf6f996-8096-473b-b9e4-9e20f4568d63";
export const HrdController = async (employees, tasks) => {
    try {
        await hrdHelper(employees, tasks);
    }
    catch (error) {
        console.log("HRD Cron controller ", error);
    }
};
const hrdHelper = async (employees, tasks) => {
    const jhbCurrentDate = getJhbDate();
    const timestamp = getJhbTimestamp();
    // Helper function to safely access string values from DynamoDB
    const getStringValue = (attr) => {
        if (!attr)
            return undefined;
        return "S" in attr ? attr.S : undefined;
    };
    for (let i = 0; i < employees.length; i++) {
        try {
            const employeeData = employees[i];
            const employee = employeeData.employee;
            // Get employee details
            const employeeId = getStringValue(employee.employeeId);
            const employeeNumber = getStringValue(employee.employeeNumber);
            const knownAs = getStringValue(employee.knownAs);
            const firstName = getStringValue(employee.firstName);
            const surname = getStringValue(employee.surname);
            if (!employeeId) {
                console.error("Employee missing employeeId");
                continue;
            }
            // Check existing tasks for this employee
            const existingTasks = tasks.filter((task) => task.employeeId.S === employeeId);
            // Access all dates safely
            const passportExpiry = getStringValue(employee.passportExpiry);
            const driversLicenseExpiry = getStringValue(employee.driversLicenseExpiry);
            const pdpExpiry = getStringValue(employee.pdpExpiry);
            const ppeExpiry = getStringValue(employee.ppeExpiry);
            // Parse the dates
            const passportExpiryDate = passportExpiry ? parseDateInJhb(passportExpiry) : null;
            const driversLicenseExpiryDate = driversLicenseExpiry
                ? parseDateInJhb(driversLicenseExpiry)
                : null;
            const pdpExpiryDate = pdpExpiry ? parseDateInJhb(pdpExpiry) : null;
            const ppeExpiryDate = ppeExpiry ? parseDateInJhb(ppeExpiry) : null;
            // Access certificate dates with expiry details
            const medicalCertificates = employeeData.medicalCertificates.map((cert) => ({
                type: getStringValue(cert.certificateType) || "Medical Certificate",
                expiryDate: getStringValue(cert.expiryDate)
                    ? parseDateInJhb(getStringValue(cert.expiryDate))
                    : null,
                expiryDateString: getStringValue(cert.expiryDate),
                certificateType: getStringValue(cert.certificateType),
                attachment: getStringValue(cert.attachment),
            }));
            const trainingCertificates = employeeData.trainingCertificates.map((cert) => ({
                type: getStringValue(cert.certificateType) || "Training Certificate",
                expiryDate: getStringValue(cert.expiryDate)
                    ? parseDateInJhb(getStringValue(cert.expiryDate))
                    : null,
                expiryDateString: getStringValue(cert.expiryDate),
                certificateType: getStringValue(cert.certificateType),
                attachment: getStringValue(cert.attachment),
            }));
            const additionalCertificates = employeeData.additionalCertificates.map((cert) => ({
                type: getStringValue(cert.certificateName) || "Additional Certificate",
                expiryDate: getStringValue(cert.expiryDate)
                    ? parseDateInJhb(getStringValue(cert.expiryDate))
                    : null,
                expiryDateString: getStringValue(cert.expiryDate),
                certificateName: getStringValue(cert.certificateName),
                attachment: getStringValue(cert.attachment),
            }));
            // Check document expirations
            await checkDateCondition("passport", passportExpiryDate, jhbCurrentDate, employee, existingTasks, timestamp, employeeId, employeeNumber, knownAs, firstName, surname, getStringValue(employee.passportAttachment));
            await checkDateCondition("drivers_license", driversLicenseExpiryDate, jhbCurrentDate, employee, existingTasks, timestamp, employeeId, employeeNumber, knownAs, firstName, surname, getStringValue(employee.driversLicenseAttachment));
            await checkDateCondition("pdp", pdpExpiryDate, jhbCurrentDate, employee, existingTasks, timestamp, employeeId, employeeNumber, knownAs, firstName, surname, getStringValue(employee.pdpAttachment));
            await checkDateCondition("ppe", ppeExpiryDate, jhbCurrentDate, employee, existingTasks, timestamp, employeeId, employeeNumber, knownAs, firstName, surname, getStringValue(employee.ppeListAttachment));
            // Check certificate expirations
            for (const cert of medicalCertificates) {
                await checkDateCondition(`medical_${cert.certificateType}`, cert.expiryDate, jhbCurrentDate, employee, existingTasks, timestamp, employeeId, employeeNumber, knownAs, firstName, surname, cert.attachment);
            }
            for (const cert of trainingCertificates) {
                await checkDateCondition(`training_${cert.certificateType}`, cert.expiryDate, jhbCurrentDate, employee, existingTasks, timestamp, employeeId, employeeNumber, knownAs, firstName, surname, cert.attachment);
            }
            for (const cert of additionalCertificates) {
                await checkDateCondition(`additional_${cert.certificateName}`, cert.expiryDate, jhbCurrentDate, employee, existingTasks, timestamp, employeeId, employeeNumber, knownAs, firstName, surname, cert.attachment);
            }
        }
        catch (error) {
            const employeeId = getStringValue(employees[i]?.employee?.employeeId);
            console.error(`Error processing employee ${employeeId}:`, error);
            continue;
        }
    }
};
// Helper function to check your date condition and create task
async function checkDateCondition(documentType, expiryDate, currentDate, employee, existingTasks, timestamp, employeeId, employeeNumber, knownAs, firstName, surname, attachmentUrl) {
    if (!expiryDate) {
        return false;
    }
    // Is {Current Date} > ({X Expiry} - 50 days)
    const warningDate = new Date(expiryDate.getTime() - 50 * 24 * 60 * 60 * 1000);
    const isExpiring = currentDate > warningDate;
    if (isExpiring) {
        // Check if task already exists for this specific document type
        const taskExists = existingTasks.some((task) => task.taskType?.S === documentType && task.employeeId.S === employeeId);
        if (taskExists) {
            console.log(`Task already exists for ${documentType} - ${employeeId}`);
            return false; // Do Nothing
        }
        // Create new Task
        await createTask(documentType, expiryDate, attachmentUrl, timestamp, employeeId, employeeNumber, knownAs, firstName, surname);
        return true;
    }
    return false;
}
// Simple task creation function
async function createTask(documentType, expiryDate, attachmentUrl, timestamp, employeeId, employeeNumber, knownAs, firstName, surname) {
    try {
        // Task Name: {X}, Certificate Expiry, {Current Date}
        const taskName = `${documentType?.toUpperCase()}, Certificate Expiry, ${timestamp}`;
        // Description:
        const description = `Employee- ${(firstName?.toUpperCase() || "") + " " + (surname?.toUpperCase() || "")}\nEmployee ID- ${employeeId}\n${documentType} will require renewal\nCurrent Expiration Date- ${expiryDate.toISOString().split("T")[0]}`;
        // Create ClickUp task with due date = expiry date
        const clickUpTask = await createHrdTasks(taskName, description, employeeNumber || "N/A", expiryDate, attachmentUrl);
        if (!clickUpTask || !clickUpTask.id) {
            console.error(`Failed to create ClickUp task for ${employeeId} - ${documentType}`);
            return;
        }
        // Insert into EmployeeTaskTable
        await insertEmployeeTaskService({
            employeeId: employeeId,
            employeeName: `${firstName} ${surname}`,
            taskType: documentType,
            documentType: documentType,
            documentIdentifier: `${employeeId}_${documentType}`,
            clickupTaskId: clickUpTask.id,
        });
        logger.info(`Created ${documentType} task for employee ${employeeId}`);
    }
    catch (error) {
        console.error(`Error creating task for ${employeeId} - ${documentType}:`, error);
    }
}
// ClickUp task creation
async function createHrdTasks(taskName, description, employeeNumber, dueDate, attachmentUrl) {
    const url = `https://api.clickup.com/api/v2/list/${LIST_ID}/task`;
    const body = {
        name: taskName,
        description: description,
        due_date: dueDate.getTime(),
        status: "to do",
        custom_fields: [
            {
                id: USERNAME_FIELD_ID,
                value: normalize(employeeNumber),
            },
        ],
    };
    // Attachment: [X attachment]
    if (attachmentUrl) {
        body.attachments = [attachmentUrl];
    }
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

import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getJhbDate, getJhbTimestamp, parseDateInJhb } from "../helper/time/time.helper.js";
import { insertEmployeeTaskService } from "../repositories/dynamo.employee.repository.js";
import logger from "../utils/logger.js";
const API_TOKEN = process.env.CLICKUP_API_TOKEN;
const LIST_ID = process.env.HRD_LIST_ID;
const BUCKET_NAME = "amplify-d1nmjnbjfdtu8r-te-inspectionstoragebucketd-ljylm6b7tbbz";
const REGION = "us-east-1";
// AWS SDK v3 S3 Client
const s3Client = new S3Client({
    region: REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
// Environment validation
const validateEnvironment = () => {
    const required = [
        "CLICKUP_API_TOKEN",
        "HRD_LIST_ID",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
    ];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        throw new Error(`Missing environment variables: ${missing.join(", ")}`);
    }
};
export const HrdController = async (employees, tasks) => {
    try {
        validateEnvironment();
        await hrdHelper(employees, tasks);
    }
    catch (error) {
        logger.error("HRD Cron controller error:", error);
        throw error;
    }
};
const hrdHelper = async (employees, tasks) => {
    const jhbCurrentDate = getJhbDate();
    const timestamp = getJhbTimestamp();
    const getStringValue = (attr) => {
        if (!attr)
            return undefined;
        return "S" in attr ? attr.S : undefined;
    };
    await processEmployeesInBatches(employees, tasks, jhbCurrentDate, timestamp, getStringValue);
};
const processEmployeesInBatches = async (employees, tasks, jhbCurrentDate, timestamp, getStringValue, batchSize = 3) => {
    for (let i = 0; i < employees.length; i += batchSize) {
        const batch = employees.slice(i, i + batchSize);
        await Promise.all(batch.map(async (employeeData) => {
            try {
                await processSingleEmployee(employeeData, tasks, jhbCurrentDate, timestamp, getStringValue);
            }
            catch (error) {
                const employeeId = getStringValue(employeeData?.employee?.employeeId);
                logger.error(`Error processing employee ${employeeId}:`, error);
            }
        }));
        if (i + batchSize < employees.length) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
};
const processSingleEmployee = async (employeeData, tasks, jhbCurrentDate, timestamp, getStringValue) => {
    const employee = employeeData.employee;
    const employeeId = getStringValue(employee.employeeId);
    const employeeNumber = getStringValue(employee.employeeNumber);
    const knownAs = getStringValue(employee.knownAs);
    const firstName = getStringValue(employee.firstName);
    const surname = getStringValue(employee.surname);
    if (!employeeId) {
        logger.error("Employee missing employeeId");
        return;
    }
    const existingTasks = tasks.filter((task) => task.employeeId.S === employeeId);
    const passportExpiry = getStringValue(employee.passportExpiry);
    const driversLicenseExpiry = getStringValue(employee.driversLicenseExpiry);
    const pdpExpiry = getStringValue(employee.pdpExpiry);
    const ppeExpiry = getStringValue(employee.ppeExpiry);
    const passportExpiryDate = passportExpiry ? parseDateInJhb(passportExpiry) : null;
    const driversLicenseExpiryDate = driversLicenseExpiry
        ? parseDateInJhb(driversLicenseExpiry)
        : null;
    const pdpExpiryDate = pdpExpiry ? parseDateInJhb(pdpExpiry) : null;
    const ppeExpiryDate = ppeExpiry ? parseDateInJhb(ppeExpiry) : null;
    const medicalCertificates = processCertificates(employeeData.medicalCertificates, "medical", getStringValue);
    const trainingCertificates = processCertificates(employeeData.trainingCertificates, "training", getStringValue);
    const additionalCertificates = processCertificates(employeeData.additionalCertificates, "additional", getStringValue);
    const documentChecks = [
        {
            type: "passport",
            expiryDate: passportExpiryDate,
            attachment: getStringValue(employee.passportAttachment),
        },
        {
            type: "drivers_license",
            expiryDate: driversLicenseExpiryDate,
            attachment: getStringValue(employee.driversLicenseAttachment),
        },
        {
            type: "pdp",
            expiryDate: pdpExpiryDate,
            attachment: getStringValue(employee.pdpAttachment),
        },
        {
            type: "ppe",
            expiryDate: ppeExpiryDate,
            attachment: getStringValue(employee.ppeListAttachment),
        },
    ];
    for (const doc of documentChecks) {
        await checkDateCondition(doc.type, doc.expiryDate, jhbCurrentDate, employee, existingTasks, timestamp, employeeId, employeeNumber, firstName, surname, doc.attachment);
    }
    await processCertificateArray(medicalCertificates, "medical", jhbCurrentDate, employee, existingTasks, timestamp, employeeId, employeeNumber, knownAs, firstName, surname);
    await processCertificateArray(trainingCertificates, "training", jhbCurrentDate, employee, existingTasks, timestamp, employeeId, employeeNumber, knownAs, firstName, surname);
    await processCertificateArray(additionalCertificates, "additional", jhbCurrentDate, employee, existingTasks, timestamp, employeeId, employeeNumber, knownAs, firstName, surname);
};
const processCertificates = (certificates, type, getStringValue) => {
    return certificates.map((cert) => {
        const certificateType = getStringValue(cert.certificateType);
        const certificateName = getStringValue(cert.certificateName);
        const expiryDateStr = getStringValue(cert.expiryDate);
        return {
            type: certificateType || certificateName || `${type} Certificate`,
            expiryDate: expiryDateStr ? parseDateInJhb(expiryDateStr) : null,
            expiryDateString: expiryDateStr,
            certificateType,
            certificateName,
            attachment: getStringValue(cert.attachment),
        };
    });
};
const processCertificateArray = async (certificates, prefix, jhbCurrentDate, employee, existingTasks, timestamp, employeeId, employeeNumber, knownAs, firstName, surname) => {
    for (const cert of certificates) {
        const documentType = `${prefix}_${cert.certificateType || cert.certificateName || cert.type}`;
        await checkDateCondition(documentType, cert.expiryDate, jhbCurrentDate, employee, existingTasks, timestamp, employeeId, employeeNumber, firstName, surname, cert.attachment);
    }
};
async function checkDateCondition(documentType, expiryDate, currentDate, employee, existingTasks, timestamp, employeeId, employeeNumber, firstName, surname, attachmentKey) {
    if (!expiryDate) {
        return false;
    }
    const warningDate = new Date(expiryDate.getTime() - 50 * 24 * 60 * 60 * 1000);
    const isExpiring = currentDate > warningDate;
    if (isExpiring) {
        const taskExists = existingTasks.some((task) => task.taskType?.S === documentType && task.employeeId.S === employeeId);
        if (taskExists) {
            logger.info(`Task already exists for ${documentType} - ${employeeId}`);
            return false;
        }
        await createTask(documentType, expiryDate, attachmentKey, timestamp, employeeId, employeeNumber, firstName, surname);
        return true;
    }
    return false;
}
async function createTask(documentType, expiryDate, attachmentKey, timestamp, employeeId, employeeNumber, firstName, surname) {
    try {
        const taskName = `${documentType?.toUpperCase()}, Certificate Expiry, ${timestamp}`;
        const description = `Employee- ${(firstName?.toUpperCase() || "") + " " + (surname?.toUpperCase() || "")}\nEmployee ID- ${employeeId}\n${documentType} will require renewal\nCurrent Expiration Date- ${expiryDate.toISOString().split("T")[0]}`;
        // Create ClickUp task with due date = expiry date
        const clickUpTask = await createHrdTasks(taskName, description, employeeNumber || "N/A", expiryDate, attachmentKey);
        if (!clickUpTask || !clickUpTask.id) {
            logger.error(`Failed to create ClickUp task for ${employeeId} - ${documentType}`);
            return;
        }
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
        logger.error(`Error creating task for ${employeeId} - ${documentType}:`, error);
        throw error;
    }
}
// Check if file exists and is accessible before generating signed URL
async function checkS3FileAccess(key) {
    try {
        const command = new HeadObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });
        await s3Client.send(command);
        return true;
    }
    catch (error) {
        logger.warn(`S3 file not accessible: ${key} - ${error.message}`);
        return false;
    }
}
// Get signed URL from S3 with better error handling
async function getAttachmentUrl(key) {
    try {
        // First check if the file exists and is accessible
        const isAccessible = await checkS3FileAccess(key);
        if (!isAccessible) {
            logger.warn(`S3 file not accessible, skipping signed URL generation: ${key}`);
            return null;
        }
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });
        const signedUrl = await getSignedUrl(s3Client, command, {
            expiresIn: 3600, // 1 hour
        });
        logger.info(`Generated signed URL for: ${key}`);
        return signedUrl;
    }
    catch (error) {
        logger.error(`Failed to get signed URL for key ${key}:`, error.message);
        return null;
    }
}
// ClickUp task creation with robust attachment handling
async function createHrdTasks(taskName, description, employeeNumber, dueDate, attachmentKey) {
    try {
        let attachmentInfo = "";
        // Handle attachment if provided
        if (attachmentKey) {
            logger.info(`Processing attachment for task: ${attachmentKey}`);
            // Try to get signed URL
            const signedUrl = await getAttachmentUrl(attachmentKey);
            if (signedUrl) {
                // Add the signed URL to description
                const filename = attachmentKey.split("/").pop() || "document";
                attachmentInfo = `\n\n Document Attachment: ${signedUrl}`;
                logger.info(`Added signed URL to task description: ${filename}`);
            }
            else {
                // If we can't get a signed URL, at least show the key for debugging
                attachmentInfo = `\n\n📎 Document Reference: ${attachmentKey} (Access issues - check S3 permissions)`;
                logger.warn(`Could not generate signed URL for: ${attachmentKey}`);
            }
        }
        const url = `https://api.clickup.com/api/v2/list/${LIST_ID}/task`;
        const body = {
            name: taskName,
            description: description + attachmentInfo,
            due_date: dueDate.getTime(),
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
        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`ClickUp API error: ${res.status} - ${errorText}`);
        }
        const data = await res.json();
        logger.info(`Successfully created ClickUp task: ${data.id}`);
        return data;
    }
    catch (error) {
        logger.error("Error creating ClickUp task:", error);
        throw error;
    }
}
// Normalize strings
function normalize(str) {
    if (typeof str !== "string")
        return String(str);
    return str.trim().replace(/^"+|"+$/g, "");
}

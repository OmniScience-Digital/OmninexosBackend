import { updateComplianceRating } from "../repositories/dynamo.crm.repository.js";
import { insertEmployeeTaskService } from "../repositories/dynamo.employee.repository.js";
import { getJhbTimestamp } from "../helper/time/time.helper.js";
import logger from "../utils/logger.js";
const API_TOKEN = process.env.CLICKUP_API_TOKEN;
const CRM_LIST_ID = process.env.CRM_LIST_ID;
// Helper function to extract value from DynamoDB format
const extractValue = (obj) => {
    if (!obj)
        return null;
    if (obj.S !== undefined)
        return obj.S;
    if (obj.N !== undefined)
        return obj.N;
    if (obj.BOOL !== undefined)
        return obj.BOOL.toString();
    if (obj.NULL !== undefined)
        return null;
    return null;
};
// Helper to extract array from DynamoDB List
const extractArray = (obj) => {
    if (!obj || !obj.L)
        return [];
    return obj.L.map((item) => extractValue(item)).filter(Boolean);
};
// Helper to parse date safely
const parseDate = (dateStr) => {
    if (!dateStr)
        return null;
    try {
        return new Date(dateStr);
    }
    catch {
        return null;
    }
};
// Check if a date is expired
const isExpired = (date) => {
    if (!date)
        return true; // No date = expired
    return date < new Date();
};
// Check if a date expires in next 30 days
const expiresIn30Days = (date) => {
    if (!date)
        return false;
    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);
    return date >= today && date <= thirtyDaysFromNow;
};
// Parse employeeLookup JSON
const parseEmployeeLookup = (employeeLookup) => {
    try {
        const lookupStr = extractValue(employeeLookup);
        if (!lookupStr)
            return {};
        return JSON.parse(lookupStr);
    }
    catch {
        return {};
    }
};
// Function to check if an employee has a valid certificate of any type
const hasValidCertificate = (employee, certType) => {
    const allCertificates = [
        ...employee.medicalCertificates,
        ...employee.trainingCertificates,
        ...employee.additionalCertificates,
    ];
    const certificate = allCertificates.find((cert) => {
        const certTypeValue = extractValue(cert.certificateType);
        const certNameValue = extractValue(cert.certificateName);
        // ADD THIS CASE-INSENSITIVE MATCHING:
        return (certTypeValue?.toUpperCase() === certType.toUpperCase() ||
            certNameValue?.toUpperCase() === certType.toUpperCase());
    });
    if (certificate) {
        const expiryDate = parseDate(extractValue(certificate.expiryDate));
        return {
            hasCert: true,
            isExpired: isExpired(expiryDate),
            expiresIn30Days: expiresIn30Days(expiryDate),
        };
    }
    return { hasCert: false, isExpired: false, expiresIn30Days: false };
};
// Calculate compliance ratings for a single compliance record
// const calculateComplianceRatings = (
//     compliance: DynamoDBComplianceRecord,
//     employees: DynamoDbEmployeeItem[],
//     additionals: DynamoDBComplianceAdditional[] = []
// ): {
//     complianceRating: number;
//     complianceRating30Days: number;
//     totalRequirements: number;
//     expiredRequirements: number;
//     expiringIn30Days: number;
//     additionalPenalty: number;
// } => {
//     const linkedEmployeeIds = extractArray(compliance.linkedEmployees);
//     const employeeLookup = parseEmployeeLookup(compliance.employeeLookup);
//     // Filter to only employees that are linked to this compliance
//     const relevantEmployees = employees.filter(emp => {
//         const employeeId = extractValue(emp.employee.id);
//         return employeeId && linkedEmployeeIds.includes(employeeId);
//     });
//     let totalRequirements = 0;
//     let expiredRequirements = 0;
//     let expiringIn30Days = 0;
//     // Check requirements from employeeLookup (includes dynamic additional certificates)
//     for (const employee of relevantEmployees) {
//         const employeeId = extractValue(employee.employee.id);
//         if (!employeeId) continue;
//         // Get all required certificate types for this employee from employeeLookup
//         const requiredCertTypes = employeeLookup[employeeId] || [];
//         for (const certType of requiredCertTypes) {
//             totalRequirements++;
//             const certStatus = hasValidCertificate(employee, certType);
//             if (!certStatus.hasCert || certStatus.isExpired) {
//                 expiredRequirements++;
//             } else if (certStatus.expiresIn30Days) {
//                 expiringIn30Days++;
//             }
//         }
//     }
//     // Calculate additional documents penalty (10% per expired/expiring document)
//     let additionalPenalty = 0;
//     for (const additional of additionals) {
//         const expiryDate = parseDate(extractValue(additional.expirey));
//         if (isExpired(expiryDate) || expiresIn30Days(expiryDate)) {
//             additionalPenalty += 0.1; // 10% penalty
//         }
//     }
//     // Calculate ratings (0-100%)
//     let complianceRating = 0;
//     let complianceRating30Days = 0;
//     if (totalRequirements > 0) {
//         complianceRating = ((totalRequirements - expiredRequirements) / totalRequirements) * 100;
//         complianceRating30Days = ((totalRequirements - expiringIn30Days) / totalRequirements) * 100;
//     }
//     // Apply additional penalty (can't go below 0%)
//     complianceRating = Math.max(0, complianceRating - (additionalPenalty * 100));
//     complianceRating30Days = Math.max(0, complianceRating30Days - (additionalPenalty * 100));
//     return {
//         complianceRating: Math.round(complianceRating),
//         complianceRating30Days: Math.round(complianceRating30Days),
//         totalRequirements,
//         expiredRequirements,
//         expiringIn30Days,
//         additionalPenalty: additionalPenalty * 100,
//     };
// };
const calculateComplianceRatings = (compliance, employees, allAdditionals = []) => {
    const complianceId = extractValue(compliance.id);
    const linkedEmployeeIds = extractArray(compliance.linkedEmployees);
    const employeeLookup = parseEmployeeLookup(compliance.employeeLookup);
    // ONLY check additionals that belong to THIS compliance
    const additionals = allAdditionals.filter((additional) => extractValue(additional.complianceid) === complianceId);
    // Filter to only employees that are linked to this compliance
    const relevantEmployees = employees.filter((emp) => {
        const employeeId = extractValue(emp.employee.id);
        return employeeId && linkedEmployeeIds.includes(employeeId);
    });
    let totalRequirements = 0;
    let expiredRequirements = 0;
    let expiringIn30Days = 0;
    logger.info(`=== Processing Compliance: ${complianceId} ===`);
    logger.info(`Linked Employees IDs: ${JSON.stringify(linkedEmployeeIds)}`);
    logger.info(`Relevant Employees found: ${relevantEmployees.length}`);
    logger.info(`Filtered ${additionals.length} of ${allAdditionals.length} additionals for this compliance`);
    // ========== COUNT EMPLOYEE REQUIREMENTS ==========
    for (const employee of relevantEmployees) {
        const employeeId = extractValue(employee.employee.id);
        if (!employeeId)
            continue;
        const requiredCertTypes = employeeLookup[employeeId] || [];
        const employeeName = extractValue(employee.employee.knownAs) ||
            `${extractValue(employee.employee.firstName)} ${extractValue(employee.employee.surname)}`.trim();
        logger.info(`Checking employee: ${employeeName} (ID: ${employeeId})`);
        logger.info(`Required cert types: ${JSON.stringify(requiredCertTypes)}`);
        for (const certType of requiredCertTypes) {
            totalRequirements++;
            const certStatus = hasValidCertificate(employee, certType);
            logger.info(`  Certificate: ${certType}`);
            logger.info(`    Has Cert: ${certStatus.hasCert}`);
            logger.info(`    Is Expired: ${certStatus.isExpired}`);
            logger.info(`    Expires in 30 Days: ${certStatus.expiresIn30Days}`);
            if (!certStatus.hasCert || certStatus.isExpired) {
                expiredRequirements++;
                logger.info(`    STATUS: EXPIRED/MISSING (Total expired: ${expiredRequirements})`);
            }
            else if (certStatus.expiresIn30Days) {
                expiringIn30Days++;
                logger.info(`    STATUS: EXPIRING IN 30 DAYS (Total expiring: ${expiringIn30Days})`);
            }
            else {
                logger.info(`    STATUS: VALID`);
            }
        }
    }
    // ========== COUNT SITE ADDITIONAL DOCUMENTS ==========
    let additionalExpired = 0;
    let additionalExpiringIn30Days = 0;
    let additionalPenalty = 0;
    logger.info(`--- CHECKING SITE ADDITIONAL DOCUMENTS (${additionals.length} total) ---`);
    for (const additional of additionals) {
        const expiryDate = parseDate(extractValue(additional.expirey));
        const docName = extractValue(additional.name) || "Unnamed";
        const isCritical = extractValue(additional.critical) === "true" ||
            extractValue(additional.critical) === "1" ||
            extractValue(additional.critical)?.toLowerCase() === "yes";
        totalRequirements++; // Site documents count in total requirements
        logger.info(`  Additional: ${docName}`);
        logger.info(`    Expiry Date: ${expiryDate ? expiryDate.toISOString().split("T")[0] : "None"}`);
        logger.info(`    Is Critical: ${isCritical}`);
        if (isExpired(expiryDate)) {
            additionalExpired++;
            logger.info(`    STATUS: EXPIRED`);
            if (isCritical) {
                additionalPenalty += 0.1; // 10% penalty for critical expired
                logger.info(`    CRITICAL - PENALTY APPLIED: +10%`);
            }
        }
        else if (expiresIn30Days(expiryDate)) {
            additionalExpiringIn30Days++;
            logger.info(`    STATUS: EXPIRING IN 30 DAYS`);
            if (isCritical) {
                additionalPenalty += 0.1; // 10% penalty for critical expiring
                logger.info(`    CRITICAL - PENALTY APPLIED: +10%`);
            }
        }
        else {
            logger.info(`    STATUS: VALID`);
        }
    }
    // Combine employee and additional counts
    expiredRequirements += additionalExpired;
    expiringIn30Days += additionalExpiringIn30Days;
    logger.info(`--- TOTALS ---`);
    logger.info(`Total Requirements: ${totalRequirements} (${relevantEmployees.length} employees + ${additionals.length} site docs)`);
    logger.info(`Expired/Missing: ${expiredRequirements}`);
    logger.info(`Expiring in 30 Days: ${expiringIn30Days}`);
    logger.info(`Valid for Current (total - expired): ${totalRequirements - expiredRequirements}`);
    logger.info(`Valid for 30-Day (total - expired - expiring): ${totalRequirements - expiredRequirements - expiringIn30Days}`);
    // Calculate ratings (0-100%)
    let complianceRating = 0;
    let complianceRating30Days = 0;
    if (totalRequirements > 0) {
        const validForCurrent = totalRequirements - expiredRequirements;
        const validFor30Days = totalRequirements - expiredRequirements - expiringIn30Days;
        complianceRating = (validForCurrent / totalRequirements) * 100;
        complianceRating30Days = (validFor30Days / totalRequirements) * 100;
        logger.info(`--- CALCULATION ---`);
        logger.info(`Valid for Current: ${totalRequirements} - ${expiredRequirements} = ${validForCurrent}`);
        logger.info(`Valid for 30-Day: ${totalRequirements} - ${expiredRequirements} - ${expiringIn30Days} = ${validFor30Days}`);
        logger.info(`Current Rating Formula: (${validForCurrent} / ${totalRequirements}) * 100`);
        logger.info(`Current Rating: ${complianceRating}%`);
        logger.info(`30-Day Rating Formula: (${validFor30Days} / ${totalRequirements}) * 100`);
        logger.info(`30-Day Rating: ${complianceRating30Days}%`);
    }
    // Apply additional penalty (can't go below 0%)
    const ratingBeforePenalty = complianceRating;
    const rating30BeforePenalty = complianceRating30Days;
    complianceRating = Math.max(0, complianceRating - additionalPenalty * 100);
    complianceRating30Days = Math.max(0, complianceRating30Days - additionalPenalty * 100);
    logger.info(`--- APPLYING PENALTIES ---`);
    logger.info(`Additional Penalty Total (CRITICAL docs only): ${additionalPenalty * 100}%`);
    logger.info(`Current: ${ratingBeforePenalty}% - ${additionalPenalty * 100}% = ${complianceRating}%`);
    logger.info(`30-Day: ${rating30BeforePenalty}% - ${additionalPenalty * 100}% = ${complianceRating30Days}%`);
    // Ensure 30-day rating never exceeds current rating
    complianceRating30Days = Math.min(complianceRating30Days, complianceRating);
    logger.info(`=== FINAL RESULTS ===`);
    logger.info(`Compliance Rating: ${Math.round(complianceRating)}%`);
    logger.info(`30-Day Compliance Rating: ${Math.round(complianceRating30Days)}%`);
    logger.info(`======================`);
    return {
        complianceRating: parseFloat(Number(complianceRating).toFixed(1)),
        complianceRating30Days: parseFloat(Number(complianceRating30Days).toFixed(1)),
        totalRequirements,
        expiredRequirements,
        expiringIn30Days,
        additionalPenalty: additionalPenalty * 100,
    };
};
// Process all compliances and return results
const processAllCompliances = (compliances, allEmployees, allAdditionals) => {
    return compliances.map((compliance) => {
        const complianceId = extractValue(compliance.id) || "";
        const customerSiteId = extractValue(compliance.customerSiteId) || "";
        // Filter additionals for this compliance
        const complianceAdditionals = allAdditionals.filter((additional) => extractValue(additional.complianceid) === complianceId);
        const ratings = calculateComplianceRatings(compliance, allEmployees, complianceAdditionals);
        return {
            complianceId,
            customerSiteId,
            ratings,
            compliance,
        };
    });
};
function checkExistingComplianceTask(tasks, complianceId, taskType) {
    const taskTypeValue = taskType === "breach" ? "COMPLIANCE_BREACH" : "COMPLIANCE_WARNING";
    const documentIdentifier = `${complianceId}_${taskTypeValue}`;
    return tasks.some((task) => extractValue(task.documentIdentifier) === documentIdentifier);
}
// Create ClickUp task for compliance (simplified from your HRD code)
async function createComplianceClickUpTask(siteName, complianceType, complianceRating, thirtyDayRating, compliance, employees, additionals = []) {
    try {
        const timestamp = getJhbTimestamp();
        const currentDate = new Date().toISOString().split("T")[0];
        const taskType = complianceType === "breach" ? "Compliance Breach" : "Compliance Warning";
        const taskName = `${siteName}, ${taskType}, ${currentDate} ,${timestamp}`;
        const { expired, expiringSoon } = getExpiredDocumentsForCompliance(compliance, employees, additionals);
        // Build description with expired documents
        let description = `Site Name: ${siteName}\n` +
            `Compliance Rating: ${complianceRating}%\n` +
            `30-Day Compliance Rating: ${thirtyDayRating}%\n\n`;
        if (expired.length > 0) {
            description += `Expired Documents:\n${expired.join("\n")}\n\n`;
        }
        else {
            description += `Expired Documents: None\n\n`;
        }
        if (expiringSoon.length > 0) {
            description += `Expiring in 30 Days:\n${expiringSoon.join("\n")}`;
        }
        else {
            description += `Expiring in 30 Days: None`;
        }
        const url = `https://api.clickup.com/api/v2/list/${CRM_LIST_ID}/task`;
        const body = {
            name: taskName,
            description: description,
            status: "to do",
            due_date: new Date().getTime() + 7 * 24 * 60 * 60 * 1000,
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
        logger.info(`Created ClickUp ${taskType} task: ${data.id} for site ${siteName}`);
        return data.id;
    }
    catch (error) {
        logger.error(`Error creating ClickUp ${complianceType} task:`, error);
        return null;
    }
}
// Get site name from customer sites data
function getSiteName(customerSiteId, customerSites) {
    // Find the customer site with matching ID
    const site = customerSites.find((site) => extractValue(site.id) === customerSiteId);
    if (site) {
        const siteName = extractValue(site.siteName);
        if (siteName) {
            return siteName;
        }
    }
    // Fallback if site not found or has no name
    return `Site-${customerSiteId.substring(0, 8)}`;
}
// Function to get list of expired documents for a compliance
function getExpiredDocumentsForCompliance(compliance, employees, additionals = []) {
    const expired = [];
    const expiringSoon = [];
    const linkedEmployeeIds = extractArray(compliance.linkedEmployees);
    const employeeLookup = parseEmployeeLookup(compliance.employeeLookup);
    // Check each employee's required certificates
    for (const employee of employees) {
        const employeeId = extractValue(employee.employee.id);
        if (!employeeId || !linkedEmployeeIds.includes(employeeId))
            continue;
        // Get employee name
        const firstName = extractValue(employee.employee.firstName) || "";
        const surname = extractValue(employee.employee.surname) || "";
        const knownAs = extractValue(employee.employee.knownAs) || "";
        // Use knownAs if available, otherwise firstName + surname
        const employeeName = knownAs || `${firstName} ${surname}`.trim() || "Unknown Employee";
        const requiredCertTypes = employeeLookup[employeeId] || [];
        for (const certType of requiredCertTypes) {
            const certStatus = hasValidCertificate(employee, certType);
            if (!certStatus.hasCert) {
                expired.push(`${employeeName} - ${certType}: MISSING`);
            }
            else if (certStatus.isExpired) {
                expired.push(`${employeeName} - ${certType}: EXPIRED`);
            }
            else if (certStatus.expiresIn30Days) {
                expiringSoon.push(`${employeeName} - ${certType}: EXPIRING SOON`);
            }
        }
    }
    // Check additionals (site documents)
    for (const additional of additionals) {
        const expiryDate = parseDate(extractValue(additional.expirey));
        const name = extractValue(additional.name) || "Additional Document";
        if (isExpired(expiryDate)) {
            expired.push(`SITE - ${name}: EXPIRED`);
        }
        else if (expiresIn30Days(expiryDate)) {
            expiringSoon.push(`SITE - ${name}: EXPIRING SOON`);
        }
    }
    return { expired, expiringSoon };
}
// Main CustomerRelations function
export const CustomerRelations = async (employees, compliance, additionals, tasks, customerSites // Add this parameter
) => {
    try {
        logger.info(`Processing ${compliance.length} compliance records, ${employees.length} employees, ${additionals.length} additionals`);
        const results = processAllCompliances(compliance, employees, additionals);
        for (const result of results) {
            try {
                // Update compliance ratings in DynamoDB
                await updateComplianceRating({
                    complianceId: result.complianceId,
                    complianceRating: result.ratings.complianceRating,
                    complianceRating30Days: result.ratings.complianceRating30Days,
                });
                logger.info(`Compliance ${result.complianceId}:`);
                logger.info(`  Rating: ${result.ratings.complianceRating}%`);
                logger.info(`  30-Day Rating: ${result.ratings.complianceRating30Days}%`);
                logger.info(`  Requirements: ${result.ratings.totalRequirements}`);
                logger.info(`  Expired: ${result.ratings.expiredRequirements}`);
                logger.info(`  Expiring soon: ${result.ratings.expiringIn30Days}`);
                // Get the actual site name from customer sites data
                const siteName = getSiteName(result.customerSiteId, customerSites);
                // Filter additionals for this specific compliance
                const complianceAdditionals = additionals.filter((additional) => extractValue(additional.complianceid) === result.complianceId);
                // Check for compliance breach (<90% current rating)
                if (result.ratings.complianceRating < 90) {
                    const breachTaskExists = checkExistingComplianceTask(tasks, result.complianceId, "breach");
                    if (!breachTaskExists) {
                        const clickupTaskId = await createComplianceClickUpTask(siteName, "breach", result.ratings.complianceRating, result.ratings.complianceRating30Days, result.compliance, employees, complianceAdditionals);
                        if (clickupTaskId) {
                            await insertEmployeeTaskService({
                                employeeId: result.complianceId,
                                employeeName: siteName,
                                taskType: "COMPLIANCE_BREACH",
                                documentType: "COMPLIANCE_REVIEW",
                                documentIdentifier: `${result.complianceId}_COMPLIANCE_BREACH`,
                                clickupTaskId: clickupTaskId,
                            });
                        }
                    }
                }
                // Check for compliance warning (<90% 30-day rating)
                if (result.ratings.complianceRating30Days < 90) {
                    const warningTaskExists = checkExistingComplianceTask(tasks, result.complianceId, "warning");
                    if (!warningTaskExists) {
                        const clickupTaskId = await createComplianceClickUpTask(siteName, "warning", result.ratings.complianceRating, result.ratings.complianceRating30Days, result.compliance, employees, complianceAdditionals);
                        if (clickupTaskId) {
                            await insertEmployeeTaskService({
                                employeeId: result.complianceId,
                                employeeName: siteName,
                                taskType: "COMPLIANCE_WARNING",
                                documentType: "COMPLIANCE_REVIEW",
                                documentIdentifier: `${result.complianceId}_COMPLIANCE_WARNING`,
                                clickupTaskId: clickupTaskId,
                            });
                        }
                    }
                }
            }
            catch (error) {
                logger.error(`Failed to process compliance ${result.complianceId}:`, error);
            }
        }
        return {
            success: true,
            processedCount: results.length,
        };
    }
    catch (error) {
        logger.error("Error in CustomerRelations:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
};

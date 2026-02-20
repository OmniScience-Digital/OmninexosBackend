import { updateComplianceRating } from '../repositories/dynamo.crm.repository';
import {
  DynamoDBComplianceAdditional,
  DynamoDBComplianceRecord,
  DynamoDBCustomerSite,
} from '../schema/crm.schema';
import { DynamoDbEmployeeItem } from '../schema/hrd.schema';
import { insertEmployeeTaskService } from '../repositories/dynamo.employee.repository';
import { getJhbTimestamp } from '../helper/time/time.helper';
import { DynamoDbEmployeeTaskItem } from '../schema/task.schema';
import logger from '../utils/logger';

const API_TOKEN = process.env.CLICKUP_API_TOKEN!;
const CRM_LIST_ID = process.env.CRM_LIST_ID!;

// Helper function to extract value from DynamoDB format
const extractValue = (obj: any): string | null => {
  if (!obj) return null;
  if (obj.S !== undefined) return obj.S;
  if (obj.N !== undefined) return obj.N;
  if (obj.BOOL !== undefined) return obj.BOOL.toString();
  if (obj.NULL !== undefined) return null;
  return null;
};

// Helper to extract array from DynamoDB List
const extractArray = (obj: any): string[] => {
  if (!obj || !obj.L) return [];
  return obj.L.map((item: any) => extractValue(item)).filter(Boolean) as string[];
};

// Helper to parse date safely
const parseDate = (dateStr: string | null): Date | null => {
  if (!dateStr) return null;
  try {
    return new Date(dateStr);
  } catch {
    return null;
  }
};

// Check if a date is expired
const isExpired = (date: Date | null): boolean => {
  if (!date) return true; // No date = expired
  return date < new Date();
};

// Check if a date expires in next 30 days
const expiresIn30Days = (date: Date | null): boolean => {
  if (!date) return false;
  const today = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(today.getDate() + 30);
  return date >= today && date <= thirtyDaysFromNow;
};

// Parse employeeLookup JSON
const parseEmployeeLookup = (employeeLookup: any): Record<string, string[]> => {
  try {
    const lookupStr = extractValue(employeeLookup);
    if (!lookupStr) return {};
    return JSON.parse(lookupStr);
  } catch {
    return {};
  }
};

// Function to check if an employee has a valid certificate of any type

const hasValidCertificate = (
  employee: DynamoDbEmployeeItem,
  certType: string
): { hasCert: boolean; isExpired: boolean; expiresIn30Days: boolean } => {
  const allCertificates = [
    ...employee.medicalCertificates,
    ...employee.trainingCertificates,
    ...employee.additionalCertificates,
  ];

  const certificate = allCertificates.find((cert) => {
    const certTypeValue = extractValue(cert.certificateType);
    const certNameValue = extractValue(cert.certificateName);

    // ADD THIS CASE-INSENSITIVE MATCHING:
    return (
      certTypeValue?.toUpperCase() === certType.toUpperCase() ||
      certNameValue?.toUpperCase() === certType.toUpperCase()
    );
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
const calculateComplianceRatings = (
  compliance: DynamoDBComplianceRecord,
  employees: DynamoDbEmployeeItem[],
  additionals: DynamoDBComplianceAdditional[] = []
): {
  complianceRating: number;
  complianceRating30Days: number;
  totalRequirements: number;
  expiredRequirements: number;
  expiringIn30Days: number;
  additionalPenalty: number;
} => {
  const linkedEmployeeIds = extractArray(compliance.linkedEmployees);
  const employeeLookup = parseEmployeeLookup(compliance.employeeLookup);

  // Filter to only employees that are linked to this compliance
  const relevantEmployees = employees.filter((emp) => {
    const employeeId = extractValue(emp.employee.id);
    return employeeId && linkedEmployeeIds.includes(employeeId);
  });

  let totalRequirements = 0;
  let expiredRequirements = 0;
  let expiringIn30Days = 0;

  // Check requirements from employeeLookup (includes dynamic additional certificates)
  for (const employee of relevantEmployees) {
    const employeeId = extractValue(employee.employee.id);
    if (!employeeId) continue;

    // Get all required certificate types for this employee from employeeLookup
    const requiredCertTypes = employeeLookup[employeeId] || [];

    for (const certType of requiredCertTypes) {
      totalRequirements++;
      const certStatus = hasValidCertificate(employee, certType);

      if (!certStatus.hasCert || certStatus.isExpired) {
        expiredRequirements++;
      } else if (certStatus.expiresIn30Days) {
        expiringIn30Days++;
      }
    }
  }

  // Calculate additional documents penalty (10% per expired/expiring document)
  let additionalPenalty = 0;

  for (const additional of additionals) {
    const expiryDate = parseDate(extractValue(additional.expirey));

    if (isExpired(expiryDate) || expiresIn30Days(expiryDate)) {
      additionalPenalty += 0.1; // 10% penalty
    }
  }

  // Calculate ratings (0-100%)
  let complianceRating = 0;
  let complianceRating30Days = 0;

  if (totalRequirements > 0) {
    complianceRating = ((totalRequirements - expiredRequirements) / totalRequirements) * 100;
    complianceRating30Days = ((totalRequirements - expiringIn30Days) / totalRequirements) * 100;
  }

  // Apply additional penalty (can't go below 0%)
  complianceRating = Math.max(0, complianceRating - additionalPenalty * 100);
  complianceRating30Days = Math.max(0, complianceRating30Days - additionalPenalty * 100);

  return {
    complianceRating: Math.round(complianceRating),
    complianceRating30Days: Math.round(complianceRating30Days),
    totalRequirements,
    expiredRequirements,
    expiringIn30Days,
    additionalPenalty: additionalPenalty * 100,
  };
};

// Process all compliances and return results
const processAllCompliances = (
  compliances: DynamoDBComplianceRecord[],
  allEmployees: DynamoDbEmployeeItem[],
  allAdditionals: DynamoDBComplianceAdditional[]
) => {
  return compliances.map((compliance) => {
    const complianceId = extractValue(compliance.id) || '';
    const customerSiteId = extractValue(compliance.customerSiteId) || '';

    // Filter additionals for this compliance
    const complianceAdditionals = allAdditionals.filter(
      (additional) => extractValue(additional.complianceid) === complianceId
    );

    const ratings = calculateComplianceRatings(compliance, allEmployees, complianceAdditionals);

    return {
      complianceId,
      customerSiteId,
      ratings,
      compliance,
    };
  });
};

function checkExistingComplianceTask(
  tasks: DynamoDbEmployeeTaskItem[],
  complianceId: string,
  taskType: 'breach' | 'warning'
): boolean {
  const taskTypeValue = taskType === 'breach' ? 'COMPLIANCE_BREACH' : 'COMPLIANCE_WARNING';
  const documentIdentifier = `${complianceId}_${taskTypeValue}`;

  return tasks.some((task) => extractValue(task.documentIdentifier) === documentIdentifier);
}

// Create ClickUp task for compliance (simplified from your HRD code)
async function createComplianceClickUpTask(
  siteName: string,
  complianceType: 'breach' | 'warning',
  complianceRating: number,
  thirtyDayRating: number,
  compliance: DynamoDBComplianceRecord,
  employees: DynamoDbEmployeeItem[],
  additionals: DynamoDBComplianceAdditional[] = []
): Promise<string | null> {
  try {
    const timestamp = getJhbTimestamp();
    const currentDate = new Date().toISOString().split('T')[0];
    const taskType = complianceType === 'breach' ? 'Compliance Breach' : 'Compliance Warning';
    const taskName = `${siteName}, ${taskType}, ${currentDate} ,${timestamp}`;

    const { expired, expiringSoon } = getExpiredDocumentsForCompliance(
      compliance,
      employees,
      additionals
    );

    // Build description with expired documents
    let description =
      `Site Name: ${siteName}\n` +
      `Compliance Rating: ${complianceRating}%\n` +
      `30-Day Compliance Rating: ${thirtyDayRating}%\n\n`;

    if (expired.length > 0) {
      description += `Expired Documents:\n${expired.join('\n')}\n\n`;
    } else {
      description += `Expired Documents: None\n\n`;
    }

    if (expiringSoon.length > 0) {
      description += `Expiring in 30 Days:\n${expiringSoon.join('\n')}`;
    } else {
      description += `Expiring in 30 Days: None`;
    }

    const url = `https://api.clickup.com/api/v2/list/${CRM_LIST_ID}/task`;
    const body = {
      name: taskName,
      description: description,
      status: 'to do',
      due_date: new Date().getTime() + 7 * 24 * 60 * 60 * 1000,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: API_TOKEN,
        'Content-Type': 'application/json',
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
  } catch (error) {
    logger.error(`Error creating ClickUp ${complianceType} task:`, error);
    return null;
  }
}

// Get site name from customer sites data
function getSiteName(customerSiteId: string, customerSites: DynamoDBCustomerSite[]): string {
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
function getExpiredDocumentsForCompliance(
  compliance: DynamoDBComplianceRecord,
  employees: DynamoDbEmployeeItem[],
  additionals: DynamoDBComplianceAdditional[] = []
): { expired: string[]; expiringSoon: string[] } {
  const expired: string[] = [];
  const expiringSoon: string[] = [];

  const linkedEmployeeIds = extractArray(compliance.linkedEmployees);
  const employeeLookup = parseEmployeeLookup(compliance.employeeLookup);

  // Check each employee's required certificates
  for (const employee of employees) {
    const employeeId = extractValue(employee.employee.id);
    if (!employeeId || !linkedEmployeeIds.includes(employeeId)) continue;

    // Get employee name
    const firstName = extractValue(employee.employee.firstName) || '';
    const surname = extractValue(employee.employee.surname) || '';
    const knownAs = extractValue(employee.employee.knownAs) || '';

    // Use knownAs if available, otherwise firstName + surname
    const employeeName = knownAs || `${firstName} ${surname}`.trim() || 'Unknown Employee';

    const requiredCertTypes = employeeLookup[employeeId] || [];

    for (const certType of requiredCertTypes) {
      const certStatus = hasValidCertificate(employee, certType);

      if (!certStatus.hasCert) {
        expired.push(`${employeeName} - ${certType}: MISSING`);
      } else if (certStatus.isExpired) {
        expired.push(`${employeeName} - ${certType}: EXPIRED`);
      } else if (certStatus.expiresIn30Days) {
        expiringSoon.push(`${employeeName} - ${certType}: EXPIRING SOON`);
      }
    }
  }

  // Check additionals (site documents)
  for (const additional of additionals) {
    const expiryDate = parseDate(extractValue(additional.expirey));
    const name = extractValue(additional.name) || 'Additional Document';

    if (isExpired(expiryDate)) {
      expired.push(`SITE - ${name}: EXPIRED`);
    } else if (expiresIn30Days(expiryDate)) {
      expiringSoon.push(`SITE - ${name}: EXPIRING SOON`);
    }
  }

  return { expired, expiringSoon };
}

// Main CustomerRelations function
export const CustomerRelations = async (
  employees: DynamoDbEmployeeItem[],
  compliance: DynamoDBComplianceRecord[],
  additionals: DynamoDBComplianceAdditional[],
  tasks: DynamoDbEmployeeTaskItem[],
  customerSites: DynamoDBCustomerSite[] // Add this parameter
) => {
  try {
    logger.info(
      `Processing ${compliance.length} compliance records, ${employees.length} employees, ${additionals.length} additionals`
    );
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
        const complianceAdditionals = additionals.filter(
          (additional) => extractValue(additional.complianceid) === result.complianceId
        );

        // Check for compliance breach (<90% current rating)
        if (result.ratings.complianceRating < 90) {
          const breachTaskExists = checkExistingComplianceTask(
            tasks,
            result.complianceId,
            'breach'
          );

          if (!breachTaskExists) {
            const clickupTaskId = await createComplianceClickUpTask(
              siteName,
              'breach',
              result.ratings.complianceRating,
              result.ratings.complianceRating30Days,
              result.compliance,
              employees,
              complianceAdditionals
            );

            if (clickupTaskId) {
              await insertEmployeeTaskService({
                employeeId: result.complianceId,
                employeeName: siteName,
                taskType: 'COMPLIANCE_BREACH',
                documentType: 'COMPLIANCE_REVIEW',
                documentIdentifier: `${result.complianceId}_COMPLIANCE_BREACH`,
                clickupTaskId: clickupTaskId,
              });
            }
          }
        }

        // Check for compliance warning (<90% 30-day rating)
        if (result.ratings.complianceRating30Days < 90) {
          const warningTaskExists = checkExistingComplianceTask(
            tasks,
            result.complianceId,
            'warning'
          );

          if (!warningTaskExists) {
            const clickupTaskId = await createComplianceClickUpTask(
              siteName,
              'warning',
              result.ratings.complianceRating,
              result.ratings.complianceRating30Days,
              result.compliance,
              employees,
              complianceAdditionals
            );

            if (clickupTaskId) {
              await insertEmployeeTaskService({
                employeeId: result.complianceId,
                employeeName: siteName,
                taskType: 'COMPLIANCE_WARNING',
                documentType: 'COMPLIANCE_REVIEW',
                documentIdentifier: `${result.complianceId}_COMPLIANCE_WARNING`,
                clickupTaskId: clickupTaskId,
              });
            }
          }
        }
      } catch (error) {
        logger.error(`Failed to process compliance ${result.complianceId}:`, error);
      }
    }

    return {
      success: true,
      processedCount: results.length,
    };
  } catch (error) {
    logger.error('Error in CustomerRelations:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

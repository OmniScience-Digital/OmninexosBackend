import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getJhbDate, getJhbTimestamp, parseDateInJhb } from '../helper/time/time.helper';
import { insertEmployeeTaskService } from '../repositories/dynamo.employee.repository';
import { DynamoDbEmployeeItem } from '../schema/hrd.schema';
import { DynamoDbEmployeeTaskItem } from '../schema/task.schema';
import logger from '../utils/logger';

const API_TOKEN = process.env.CLICKUP_API_TOKEN!;
const LIST_ID = process.env.HRD_LIST_ID!;
const BUCKET_NAME = 'amplify-d1nmjnbjfdtu8r-te-inspectionstoragebucketd-ljylm6b7tbbz';
const REGION = 'us-east-1';

// AWS SDK v3 S3 Client
const s3Client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Interfaces
interface Certificate {
  type: string;
  expiryDate: Date | null;
  expiryDateString?: string;
  certificateType?: string;
  certificateName?: string;
  attachment?: string;
}

interface ClickUpTaskResponse {
  id: string;
  name: string;
  [key: string]: any;
}

// Environment validation
const validateEnvironment = (): void => {
  const required = [
    'CLICKUP_API_TOKEN',
    'HRD_LIST_ID',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
  ];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
};

export const HrdController = async (
  employees: DynamoDbEmployeeItem[],
  tasks: DynamoDbEmployeeTaskItem[]
): Promise<void> => {
  try {
    validateEnvironment();
    await hrdHelper(employees, tasks);
  } catch (error: any) {
    logger.error('HRD Cron controller error:', error);
    throw error;
  }
};

const hrdHelper = async (
  employees: DynamoDbEmployeeItem[],
  tasks: DynamoDbEmployeeTaskItem[]
): Promise<void> => {
  const jhbCurrentDate = getJhbDate();
  const timestamp = getJhbTimestamp();

  const getStringValue = (
    attr: { S?: string } | { NULL?: boolean } | undefined
  ): string | undefined => {
    if (!attr) return undefined;
    return 'S' in attr ? attr.S : undefined;
  };

  await processEmployeesInBatches(employees, tasks, jhbCurrentDate, timestamp, getStringValue);
};

const processEmployeesInBatches = async (
  employees: DynamoDbEmployeeItem[],
  tasks: DynamoDbEmployeeTaskItem[],
  jhbCurrentDate: Date,
  timestamp: string,
  getStringValue: (attr: any) => string | undefined,
  batchSize = 3
): Promise<void> => {
  for (let i = 0; i < employees.length; i += batchSize) {
    const batch = employees.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (employeeData) => {
        try {
          await processSingleEmployee(
            employeeData,
            tasks,
            jhbCurrentDate,
            timestamp,
            getStringValue
          );
        } catch (error) {
          const employeeId = getStringValue(employeeData?.employee?.employeeId);
          logger.error(`Error processing employee ${employeeId}:`, error);
        }
      })
    );

    if (i + batchSize < employees.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
};

const processSingleEmployee = async (
  employeeData: DynamoDbEmployeeItem,
  tasks: DynamoDbEmployeeTaskItem[],
  jhbCurrentDate: Date,
  timestamp: string,
  getStringValue: (attr: any) => string | undefined
): Promise<void> => {
  const employee = employeeData.employee;

  const employeeId = getStringValue(employee.employeeId);
  const employeeNumber = getStringValue(employee.employeeNumber);
  const knownAs = getStringValue(employee.knownAs);
  const firstName = getStringValue(employee.firstName);
  const surname = getStringValue(employee.surname);

  if (!employeeId) {
    logger.error('Employee missing employeeId');
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

  const medicalCertificates = processCertificates(
    employeeData.medicalCertificates,
    'medical',
    getStringValue
  );
  const trainingCertificates = processCertificates(
    employeeData.trainingCertificates,
    'training',
    getStringValue
  );
  const additionalCertificates = processCertificates(
    employeeData.additionalCertificates,
    'additional',
    getStringValue
  );

  const documentChecks = [
    {
      type: 'passport',
      expiryDate: passportExpiryDate,
      attachment: getStringValue(employee.passportAttachment),
    },
    {
      type: 'drivers_license',
      expiryDate: driversLicenseExpiryDate,
      attachment: getStringValue(employee.driversLicenseAttachment),
    },
    {
      type: 'pdp',
      expiryDate: pdpExpiryDate,
      attachment: getStringValue(employee.pdpAttachment),
    },
    {
      type: 'ppe',
      expiryDate: ppeExpiryDate,
      attachment: getStringValue(employee.ppeListAttachment),
    },
  ];

  for (const doc of documentChecks) {
    await checkDateCondition(
      doc.type,
      doc.expiryDate,
      jhbCurrentDate,
      employee,
      existingTasks,
      timestamp,
      employeeId,
      employeeNumber,
      firstName,
      surname,
      doc.attachment
    );
  }

  await processCertificateArray(
    medicalCertificates,
    'medical',
    jhbCurrentDate,
    employee,
    existingTasks,
    timestamp,
    employeeId,
    employeeNumber,
    knownAs,
    firstName,
    surname
  );

  await processCertificateArray(
    trainingCertificates,
    'training',
    jhbCurrentDate,
    employee,
    existingTasks,
    timestamp,
    employeeId,
    employeeNumber,
    knownAs,
    firstName,
    surname
  );

  await processCertificateArray(
    additionalCertificates,
    'additional',
    jhbCurrentDate,
    employee,
    existingTasks,
    timestamp,
    employeeId,
    employeeNumber,
    knownAs,
    firstName,
    surname
  );
};

const processCertificates = (
  certificates: any[],
  type: 'medical' | 'training' | 'additional',
  getStringValue: (attr: any) => string | undefined
): Certificate[] => {
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

const processCertificateArray = async (
  certificates: Certificate[],
  prefix: string,
  jhbCurrentDate: Date,
  employee: any,
  existingTasks: DynamoDbEmployeeTaskItem[],
  timestamp: string,
  employeeId: string,
  employeeNumber: string | undefined,
  knownAs: string | undefined,
  firstName: string | undefined,
  surname: string | undefined
): Promise<void> => {
  for (const cert of certificates) {
    const documentType = `${prefix}_${cert.certificateType || cert.certificateName || cert.type}`;

    await checkDateCondition(
      documentType,
      cert.expiryDate,
      jhbCurrentDate,
      employee,
      existingTasks,
      timestamp,
      employeeId,
      employeeNumber,
      firstName,
      surname,
      cert.attachment
    );
  }
};

async function checkDateCondition(
  documentType: string,
  expiryDate: Date | null,
  currentDate: Date,
  employee: any,
  existingTasks: DynamoDbEmployeeTaskItem[],
  timestamp: string,
  employeeId: string,
  employeeNumber: string | undefined,
  firstName: string | undefined,
  surname: string | undefined,
  attachmentKey?: string
): Promise<boolean> {
  if (!expiryDate) {
    return false;
  }

  const warningDate = new Date(expiryDate.getTime() - 50 * 24 * 60 * 60 * 1000);
  const isExpiring = currentDate > warningDate;

  if (isExpiring) {
    const taskExists = existingTasks.some(
      (task) => task.taskType?.S === documentType && task.employeeId.S === employeeId
    );

    if (taskExists) {
      logger.info(`Task already exists for ${documentType} - ${employeeId}`);
      return false;
    }

    await createTask(
      documentType,
      expiryDate,
      attachmentKey,
      timestamp,
      employeeId,
      employeeNumber,
      firstName,
      surname
    );
    return true;
  }

  return false;
}

// async function createTask(
//   documentType: string,
//   expiryDate: Date,
//   attachmentKey: string | undefined,
//   timestamp: string,
//   employeeId: string,
//   employeeNumber: string | undefined,
//   firstName: string | undefined,
//   surname: string | undefined
// ): Promise<void> {
//   try {
//     const taskName = `${documentType?.toUpperCase()}, Certificate Expiry, ${timestamp}`;
//     const description = `Employee- ${(firstName?.toUpperCase() || '') + ' ' + (surname?.toUpperCase() || '')}\nEmployee ID- ${employeeId}\n${documentType} will require renewal\nCurrent Expiration Date- ${expiryDate.toISOString().split('T')[0]}`;

//     // Create ClickUp task with due date = expiry date
//     const clickUpTask = await createHrdTasks(
//       taskName,
//       description,
//       employeeNumber || 'N/A',
//       expiryDate,
//       attachmentKey
//     );

//     if (!clickUpTask || !clickUpTask.id) {
//       logger.error(`Failed to create ClickUp task for ${employeeId} - ${documentType}`);
//       return;
//     }

//     await insertEmployeeTaskService({
//       employeeId: employeeId,
//       employeeName: `${firstName} ${surname}`,
//       taskType: documentType,
//       documentType: documentType,
//       documentIdentifier: `${employeeId}_${documentType}`,
//       clickupTaskId: clickUpTask.id,
//     });

//     logger.info(`Created ${documentType} task for employee ${employeeId}`);
//   } catch (error) {
//     logger.error(`Error creating task for ${employeeId} - ${documentType}:`, error);
//     throw error;
//   }
// }

// Check if file exists and is accessible before generating signed URL

async function createTask(
  documentType: string,
  expiryDate: Date,
  attachmentKey: string | undefined,
  timestamp: string,
  employeeId: string,
  employeeNumber: string | undefined,
  firstName: string | undefined,
  surname: string | undefined
): Promise<void> {
  try {
    console.log(`🟡 START createTask for ${employeeId} - ${documentType}`);

    const taskName = `${documentType?.toUpperCase()}, Certificate Expiry, ${timestamp}`;
    const description = `Employee- ${(firstName?.toUpperCase() || '') + ' ' + (surname?.toUpperCase() || '')}\nEmployee ID- ${employeeId}\n${documentType} will require renewal\nCurrent Expiration Date- ${expiryDate.toISOString().split('T')[0]}`;

    // Create ClickUp task with due date = expiry date
    const clickUpTask = await createHrdTasks(
      taskName,
      description,
      employeeNumber || 'N/A',
      expiryDate,
      attachmentKey
    );

    console.log(`🟢 ClickUp task created: ${clickUpTask?.id} for ${employeeId} - ${documentType}`);

    if (!clickUpTask || !clickUpTask.id) {
      logger.error(`Failed to create ClickUp task for ${employeeId} - ${documentType}`);
      return;
    }

    console.log(`🟡 Attempting DB insertion for ${employeeId} - ${documentType}`);

    await insertEmployeeTaskService({
      employeeId: employeeId,
      employeeName: `${firstName} ${surname}`,
      taskType: documentType,
      documentType: documentType,
      documentIdentifier: `${employeeId}_${documentType}`,
      clickupTaskId: clickUpTask.id,
    });

    console.log(`🟢 DB insertion successful for ${employeeId} - ${documentType}`);

    logger.info(`Created ${documentType} task for employee ${employeeId}`);
  } catch (error) {
    console.log(`🔴 ERROR in createTask for ${employeeId} - ${documentType}:`, error);
    logger.error(`Error creating task for ${employeeId} - ${documentType}:`, error);
    throw error;
  }
}

async function checkS3FileAccess(key: string): Promise<boolean> {
  try {
    const command = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    return true;
  } catch (error: any) {
    logger.warn(`S3 file not accessible: ${key} - ${error.message}`);
    return false;
  }
}

// ClickUp task creation with file attachment upload and file existence check
async function createHrdTasks(
  taskName: string,
  description: string,
  employeeNumber: string,
  dueDate: Date,
  attachmentKey?: string
): Promise<ClickUpTaskResponse> {
  try {
    let finalDescription = description;

    // Check if file exists before creating the task
    if (attachmentKey) {
      const fileExists = await checkS3FileAccess(attachmentKey);
      if (!fileExists) {
        finalDescription = `${description}\n\n⚠️ Document Attachment: File does not exist at ${attachmentKey}`;
        logger.warn(`File does not exist, adding note to description: ${attachmentKey}`);
        attachmentKey = undefined;
      }
    }

    // Create the task
    const url = `https://api.clickup.com/api/v2/list/${LIST_ID}/task`;
    const body: any = {
      name: taskName,
      description: finalDescription,
      due_date: dueDate.getTime(),
      status: 'to do',
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
    logger.info(`Successfully created ClickUp task: ${data.id}`);

    // If there's an attachment and file exists, upload the actual file to ClickUp
    if (attachmentKey) {
      await uploadFileToClickUp(data.id, attachmentKey);
    }

    return data;
  } catch (error) {
    logger.error('Error creating ClickUp task:', error);
    throw error;
  }
}

// Upload actual file to ClickUp as attachment
async function uploadFileToClickUp(taskId: string, attachmentKey: string): Promise<void> {
  try {
    logger.info(`Uploading file to ClickUp task ${taskId}: ${attachmentKey}`);

    // Get the file from S3
    const getObjectCommand = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: attachmentKey,
    });

    const s3Response = await s3Client.send(getObjectCommand);

    // Convert the S3 stream to a buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of s3Response.Body as any) {
      chunks.push(chunk);
    }
    const fileBuffer = Buffer.concat(chunks);

    // Get filename from the key
    const filename = attachmentKey.split('/').pop() || 'document.pdf';

    // Create FormData for ClickUp attachment upload
    const formData = new FormData();
    formData.append('attachment', new Blob([fileBuffer]), filename);

    // Upload to ClickUp
    const uploadResponse = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/attachment`, {
      method: 'POST',
      headers: {
        Authorization: API_TOKEN,
      },
      body: formData,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`ClickUp attachment upload error: ${uploadResponse.status} - ${errorText}`);
    }

    const uploadData = await uploadResponse.json();
    logger.info(`Successfully uploaded file to ClickUp: ${filename}`);
  } catch (error: any) {
    // Catch specific S3 errors and log appropriately
    if (error.name === 'NoSuchKey') {
      logger.warn(`File not found in S3, cannot upload to ClickUp: ${attachmentKey}`);
    } else {
      logger.error(`Error uploading file to ClickUp: ${error.message}`);
    }
  }
}

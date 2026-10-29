// src/helper/jobcard/jobcard.config.ts
export const TABLE_ENV = {
  jobCard: 'JOBCARD_TABLE',
  scale: 'JOBCARD_SCALE_TABLE',
  module: 'JOBCARD_MODULE_TABLE',
  submission: 'JOBCARD_SUBMISSION_TABLE',
  timeEntry: 'JOBCARD_TIMEENTRY_TABLE',
  telegramGroup: 'TELEGRAM_GROUP_TABLE',
  certificate: 'CERTIFICATE_TABLE',
  certificateCounter: 'CERTIFICATE_COUNTER_TABLE',
} as const;
export type TableKey = keyof typeof TABLE_ENV;

export function table(key: TableKey): string {
  const name = process.env[TABLE_ENV[key]];
  if (!name) throw new Error(`${TABLE_ENV[key]} is not set`);
  return name;
}

export const INDEX = {
  submissionsByDeliveryState: 'jobCardSubmissionsByDeliveryStateAndSubmittedAt',
  submissionsByModule: 'jobCardSubmissionsByModuleIdAndSubmittedAt',
  modulesByJobCard: 'jobCardModulesByJobCardId',
  timeEntriesByJobCard: 'jobCardTimeEntriesByJobCardIdAndStartedAt',
  certificatesByScale: 'calibrationCertificatesByScaleIdAndIssuedAt',
  jobCardsByWrapUpPending: 'jobCardsByWrapUpPendingAndClosedAt',
} as const;

export const jobCardFlowEnabled = (): boolean =>
  Boolean(
    process.env.JOBCARD_TABLE &&
    process.env.JOBCARD_SUBMISSION_TABLE &&
    process.env.JOBCARD_MODULE_TABLE
  );

export const certificatesEnabled = (): boolean => process.env.CERTIFICATES_ENABLED === 'true';

export const CALIBRATION_TYPES = ['ZERO_CALIBRATION', 'SPAN_CALIBRATION'] as const;

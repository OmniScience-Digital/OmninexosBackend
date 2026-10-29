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
};
export function table(key) {
    const name = process.env[TABLE_ENV[key]];
    if (!name)
        throw new Error(`${TABLE_ENV[key]} is not set`);
    return name;
}
export const INDEX = {
    submissionsByDeliveryState: 'jobCardSubmissionsByDeliveryStateAndSubmittedAt',
    submissionsByModule: 'jobCardSubmissionsByModuleIdAndSubmittedAt',
    modulesByJobCard: 'jobCardModulesByJobCardId',
    timeEntriesByJobCard: 'jobCardTimeEntriesByJobCardIdAndStartedAt',
    certificatesByScale: 'calibrationCertificatesByScaleIdAndIssuedAt',
    jobCardsByWrapUpPending: 'jobCardsByWrapUpPendingAndClosedAt',
};
export const jobCardFlowEnabled = () => Boolean(process.env.JOBCARD_TABLE &&
    process.env.JOBCARD_SUBMISSION_TABLE &&
    process.env.JOBCARD_MODULE_TABLE);
export const certificatesEnabled = () => process.env.CERTIFICATES_ENABLED === 'true';
export const CALIBRATION_TYPES = ['ZERO_CALIBRATION', 'SPAN_CALIBRATION'];

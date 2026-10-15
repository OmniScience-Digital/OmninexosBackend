// src/helper/jobcard/jobcard.config.ts  (NEW FILE)
// Table names and index names for the job card tables created by the Amplify frontend project.
/** Table names come from .env (DynamoDB console -> Tables: names look like JobCard-xxxxxxxx-NONE). */
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
/**
 * Index names follow Amplify's default pattern (the same one your existing repositories use, e.g.
 * 'quotesByQuoteNumber'): <modelPlural>By<PartitionKey>[And<SortKey>]. If a query ever fails with
 * "index not found", compare these with DynamoDB console -> table -> Indexes.
 */
export const INDEX = {
    submissionsByDeliveryState: 'jobCardSubmissionsByDeliveryStateAndSubmittedAt',
    submissionsByModule: 'jobCardSubmissionsByModuleIdAndSubmittedAt',
    modulesByJobCard: 'jobCardModulesByJobCardId',
    timeEntriesByJobCard: 'jobCardTimeEntriesByJobCardIdAndStartedAt',
    certificatesByScale: 'calibrationCertificatesByScaleIdAndIssuedAt',
};
/** Handling of results (stop timer, certificates, ClickUp, Telegram) runs only when the main tables are configured. */
export const jobCardFlowEnabled = () => Boolean(process.env.JOBCARD_TABLE &&
    process.env.JOBCARD_SUBMISSION_TABLE &&
    process.env.JOBCARD_MODULE_TABLE);
/** Certificates stay OFF until the layout is approved (set CERTIFICATES_ENABLED=true to switch on). */
export const certificatesEnabled = () => process.env.CERTIFICATES_ENABLED === 'true';
export const CALIBRATION_TYPES = ['ZERO_CALIBRATION', 'SPAN_CALIBRATION'];

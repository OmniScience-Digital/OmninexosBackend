import logger from "../utils/logger.js";
function executiontime(app) {
    app.use((req, res, next) => {
        const start = Date.now();
        // Log request received
        logger.debug(`➡️  ${req.method} ${req.url} - Request received`);
        // Capture response finish event to log complete timing
        res.on("finish", () => {
            const duration = Date.now() - start;
            const status = res.statusCode;
            // Log with emoji based on status
            const statusEmoji = status >= 400 ? "\u274C" : status >= 300 ? "\u21AA\uFE0F" : "\u2705";
            logger.info(`${statusEmoji} ${req.method} ${req.url} - ` + `Status: ${status} - Duration: ${duration}ms`);
        });
        next();
    });
}
export default executiontime;

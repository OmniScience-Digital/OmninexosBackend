import logger from "../utils/logger.js";
function executiontime(app) {
    app.use((req, res, next) => {
        const start = Date.now();
        logger.debug(`➡️  ${req.method} ${req.url} - Request received`);
        res.on("finish", () => {
            const duration = Date.now() - start;
            const status = res.statusCode;
            // Skip logging noisy 404s (bot scans hitting random paths)
            if (status === 404)
                return;
            const statusEmoji = status >= 400 ? "\u274C" : status >= 300 ? "\u21AA\uFE0F" : "\u2705";
            logger.info(`${statusEmoji} ${req.method} ${req.url} - ` + `Status: ${status} - Duration: ${duration}ms`);
        });
        next();
    });
}
export default executiontime;

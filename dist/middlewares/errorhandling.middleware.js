import logger from "../utils/logger.js";
function errorhandling(app) {
    app.use((err, req, res, next) => {
        // Log full error details
        logger.error("\u274C Unhandled Error:", {
            message: err.message,
            stack: err.stack,
            url: req.url,
            method: req.method,
            body: req.body,
            query: req.query,
            params: req.params,
            headers: {
                "user-agent": req.headers["user-agent"],
                "content-type": req.headers["content-type"],
                "x-xero-signature": req.headers["x-xero-signature"] ? "present" : "missing",
            },
        });
        // Don't expose error details in production
        const errorMessage = process.env.NODE_ENV === "production" ? "Internal Server Error" : err.message;
        res.status(500).json({
            error: errorMessage,
            requestId: Date.now(), // For tracking in logs
        });
    });
}
export default errorhandling;

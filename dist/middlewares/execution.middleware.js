import logger from "../utils/logger.js";
function executiontime(app) {
    //logging middleware
    app.use((req, res, next) => {
        const start = Date.now();
        next();
        //after all action in the middleware
        const delta = Date.now() - start;
        logger.info(`Execution time :  ${req.method}   ${req.url}    ${delta}   ms`);
    });
}
export default executiontime;

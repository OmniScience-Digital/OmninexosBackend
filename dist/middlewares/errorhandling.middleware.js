import logger from "../utils/logger.js";
function errorhandling(app) {
    app.use((err, req, res, next) => {
        logger.error(err.stack);
        res.status(500).send("Something went wrong !");
    });
}
export default errorhandling;

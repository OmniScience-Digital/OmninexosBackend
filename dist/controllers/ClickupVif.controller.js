import { deleteTaskByClickupId } from "../repositories/dynamo.task.js";
import logger from "../utils/logger.js";
export const vifControllerRouter = async (req, res) => {
    try {
        logger.info("Executing Inspection control route.");
        logger.info(JSON.stringify(req.body, null, 2));
        const taskid = parseInspectionClickUpPayload(req.body);
        await deleteTaskByClickupId(taskid);
        console.log("Task deleted successfully");
        res.status(200).json({ success: true, message: "Task updated successfully" });
    }
    catch (error) {
        logger.error("Failed to insert inspection:", error);
        console.error(error);
        res.status(500).json({
            success: false,
            error: "Error inserting inspection",
            details: error.message,
        });
    }
};
function parseInspectionClickUpPayload(clickupPayload) {
    try {
        const { payload } = clickupPayload;
        const taskid = payload.id;
        return taskid;
    }
    catch (error) {
        logger.error("Error parsing inspection payload:", error);
        throw error;
    }
}

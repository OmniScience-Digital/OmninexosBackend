import logger from "../utils/logger.js";
import { DateTime } from "luxon";
const API_TOKEN = process.env.CLICKUP_API_TOKEN;
const LIST_ID = process.env.VIF_LIST_ID;
const USERNAME_FIELD_ID = "daf6f996-8096-473b-b9e4-9e20f4568d63";
// Store upload sessions by unique identifier
const uploadSessions = new Map();
// Generate a unique session ID for each upload (consistent across all photos)
const generateSessionId = (vehicleId, username) => {
    return `${vehicleId}_${username}`;
};
// Clean up old sessions
const cleanupOldSessions = () => {
    const now = Date.now();
    for (const [sessionId, session] of uploadSessions.entries()) {
        if (now - session.createdAt > 10 * 60 * 1000) { // 10 minutes
            uploadSessions.delete(sessionId);
        }
    }
};
export const vifClickUp = async (req, res) => {
    try {
        const files = req.files;
        const { vehicleId, vehicleReg, odometer, inspectionResults, username, photoIndex, totalPhotos, } = req.body;
        logger.info(`Processing photo ${parseInt(photoIndex) + 1} of ${totalPhotos}`);
        // Parse inspection results if it's a string
        const inspectionData = typeof inspectionResults === "string" ? JSON.parse(inspectionResults) : inspectionResults;
        const currentPhotoIndex = parseInt(photoIndex);
        const totalPhotosCount = parseInt(totalPhotos);
        // Create consistent session ID for this upload (same for all photos)
        const sessionId = generateSessionId(vehicleId, username);
        // Clean up old sessions before processing
        cleanupOldSessions();
        // Get or create session
        let session = uploadSessions.get(sessionId);
        // Create task on first photo only
        if (!session && currentPhotoIndex === 0) {
            logger.info(`Creating new task for Vehicle ID: ${vehicleId}, Odometer: ${odometer}, Vehicle Reg: ${vehicleReg}, Username: ${username}`);
            const questionLines = Array.isArray(inspectionData) && inspectionData.length > 0
                ? inspectionData
                    .map((item, index) => `${index + 1}. ${item.question}\nAnswer: ${item.answer === "true" ? "Yes" : " No"}`)
                    .join("\n\n")
                : "No inspection results provided.";
            const timestamp = getJhbTimestamp();
            const body = {
                name: `Vehicle Inspection - ${vehicleReg} ${timestamp}`,
                description: `Vehicle Reg: ${vehicleReg}\nVehicle ID: ${vehicleId}\nOdometer: ${odometer}\n\nInspection Results:\n\n${questionLines}`,
                custom_fields: [
                    {
                        id: USERNAME_FIELD_ID,
                        value: normalize(username),
                    },
                ],
                status: "to do",
            };
            const createTask = await fetch(`https://api.clickup.com/api/v2/list/${LIST_ID}/task`, {
                method: "POST",
                headers: {
                    Authorization: API_TOKEN,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
            });
            const taskData = await createTask.json();
            if (!taskData.id) {
                logger.error("Failed to create ClickUp task", taskData);
                res.status(500).json({ success: false, error: "Failed to create ClickUp task" });
                return;
            }
            // Create new session
            session = {
                taskId: taskData.id,
                createdAt: Date.now(),
                uploadedPhotos: 0,
                vehicleId: vehicleId,
                username: username
            };
            uploadSessions.set(sessionId, session);
            logger.info(`Created ClickUp task: ${taskData.id} for session: ${sessionId}`);
        }
        // If no session exists but this isn't the first photo, it's an error
        if (!session && currentPhotoIndex > 0) {
            logger.error(`No upload session found for photo upload. Session ID: ${sessionId}`);
            logger.error(`Available sessions: ${Array.from(uploadSessions.keys())}`);
            res.status(400).json({ success: false, error: "Upload session expired or not found" });
            return;
        }
        // Upload current photo to the task
        if (files && files.length > 0 && session) {
            const file = files[0];
            const formData = new FormData();
            formData.append("attachment", new Blob([file.buffer], { type: file.mimetype }), file.originalname);
            const response = await fetch(`https://api.clickup.com/api/v2/task/${session.taskId}/attachment`, {
                method: "POST",
                headers: {
                    Authorization: API_TOKEN,
                },
                body: formData,
            });
            await response.json();
            session.uploadedPhotos++;
            logger.info(`📎 Uploaded ${file.originalname} to ClickUp task ${session.taskId} (${session.uploadedPhotos}/${totalPhotosCount})`);
        }
        // If this is the last photo, send final response and cleanup
        if (session && currentPhotoIndex === totalPhotosCount - 1) {
            const finalTaskId = session.taskId;
            const uploadedCount = session.uploadedPhotos;
            logger.info(`Upload complete for session: ${sessionId}. Total photos: ${uploadedCount}`);
            // Clean up session
            uploadSessions.delete(sessionId);
            res.json({
                success: true,
                message: "VIF task created and all photos uploaded successfully",
                taskId: finalTaskId,
                uploadedCount: uploadedCount,
            });
        }
        else if (session) {
            // Intermediate response for ongoing upload
            res.json({
                success: true,
                message: `Photo ${currentPhotoIndex + 1} uploaded successfully`,
                taskId: session.taskId,
            });
        }
    }
    catch (error) {
        logger.error("Error uploading to ClickUp", error);
        // Clean up session on error
        if (req.body.vehicleId && req.body.username) {
            const sessionId = generateSessionId(req.body.vehicleId, req.body.username);
            uploadSessions.delete(sessionId);
        }
        res.status(500).json({ success: false, error: error.message });
    }
};
export function getJhbTimestamp() {
    return DateTime.now().setZone("Africa/Johannesburg").toFormat("yyyy-MM-dd HH:mm:ss");
}
function normalize(str) {
    if (typeof str !== "string")
        return String(str);
    return str.trim().replace(/^"+|"+$/g, "");
}

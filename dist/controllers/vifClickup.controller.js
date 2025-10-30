// import logger from '../utils/logger';
// import { Request, Response } from 'express';
// import { DateTime } from 'luxon';
// // ClickUp env variables
// const API_TOKEN = process.env.CLICKUP_API_TOKEN!;
// const LIST_ID = process.env.VIF_LIST_ID!;
// const USERNAME_FIELD_ID = 'daf6f996-8096-473b-b9e4-9e20f4568d63';
// export const vifClickUp = async (req: Request, res: Response): Promise<void> => {
//   try {
//     logger.info('Vif to ClickUp route triggered');
//     const { vehicleId, vehicleReg, odometer, inspectionResults, username } = req.body;
//     const files = (req as any).files;
//     logger.info(
//       `Vehicle ID: ${vehicleId}, Odometer: ${odometer},Vehicle Reg: ${vehicleReg}, Username: ${username}`
//     );
//     logger.info(`Received ${files?.length || 0} photos`);
//     if (!files || files.length === 0) {
//       res.status(400).json({ message: 'No photos uploaded' });
//       return;
//     }
//     // Format inspection questions nicely
//     const questionLines =
//       Array.isArray(inspectionResults) && inspectionResults.length > 0
//         ? inspectionResults
//             .map(
//               (item: any, index: number) =>
//                 `${index + 1}. ${item.question}\nAnswer: ${item.answer === 'true' ? 'Yes' : ' No'}`
//             )
//             .join('\n\n')
//         : 'No inspection results provided.';
//     // Create a new ClickUp task
//     const timestamp = getJhbTimestamp();
//     const body = {
//       name: `Vehicle Inspection - ${vehicleReg} ${timestamp}`,
//       description: `Vehicle Reg: ${vehicleReg}\nVehicle ID: ${vehicleId}\nOdometer: ${odometer}\n\nInspection Results:\n\n${questionLines}`,
//       custom_fields: [
//         {
//           id: USERNAME_FIELD_ID,
//           value: normalize(username),
//         },
//       ],
//       status: 'to do',
//     };
//     const createTask = await fetch(`https://api.clickup.com/api/v2/list/${LIST_ID}/task`, {
//       method: 'POST',
//       headers: {
//         Authorization: API_TOKEN,
//         'Content-Type': 'application/json',
//       },
//       body: JSON.stringify(body),
//     });
//     const taskData = (await createTask.json()) as any;
//     if (!taskData.id) {
//       logger.error('Failed to create ClickUp task', taskData);
//       res.status(500).json({ success: false, error: 'Failed to create ClickUp task' });
//       return;
//     }
//     const taskId = taskData.id;
//     logger.info(`Created ClickUp task: ${taskId}`);
//     // Upload all photos to that task using native FormData
//     const uploadedResults: any[] = [];
//     for (const file of files) {
//       const formData = new FormData();
//       formData.append(
//         'attachment',
//         new Blob([file.buffer], { type: file.mimetype }),
//         file.originalname
//       );
//       const response = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/attachment`, {
//         method: 'POST',
//         headers: {
//           Authorization: API_TOKEN,
//           // Let fetch set the Content-Type with boundary automatically
//         },
//         body: formData,
//       });
//       const result = await response.json();
//       uploadedResults.push(result);
//       logger.info(`📎 Uploaded ${file.originalname} to ClickUp task ${taskId}`);
//     }
//     res.json({
//       success: true,
//       message: 'VIF task created and photos uploaded successfully',
//       taskId,
//       uploadedCount: uploadedResults.length,
//       results: uploadedResults,
//     });
//   } catch (error: any) {
//     logger.error('Error uploading to ClickUp', error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// };
// export function getJhbTimestamp() {
//   return DateTime.now().setZone('Africa/Johannesburg').toFormat('yyyy-MM-dd HH:mm:ss');
// }
// function normalize(str: any) {
//   if (typeof str !== 'string') return String(str);
//   return str.trim().replace(/^"+|"+$/g, '');
// }
import logger from "../utils/logger.js";
import { DateTime } from "luxon";
import { redisService } from "../services/redis.service.js";
const API_TOKEN = process.env.CLICKUP_API_TOKEN;
const LIST_ID = process.env.VIF_LIST_ID;
const USERNAME_FIELD_ID = "daf6f996-8096-473b-b9e4-9e20f4568d63";
export const vifClickUp = async (req, res) => {
    try {
        const { vehicleId, vehicleReg, odometer, inspectionResults, username, photoIndex, totalPhotos } = req.body;
        const files = req.files;
        logger.info(`Processing photo ${parseInt(photoIndex) + 1} of ${totalPhotos}`);
        // Create session ID
        const sessionId = `${vehicleId}_${username}`;
        // Check if task already exists in Redis
        let taskId = await redisService.getTaskSession(sessionId);
        // If no task exists, create one
        if (!taskId) {
            logger.info("Vif to ClickUp route triggered");
            logger.info(`Vehicle ID: ${vehicleId}, Odometer: ${odometer}, Vehicle Reg: ${vehicleReg}, Username: ${username}`);
            // Format inspection questions nicely
            const questionLines = Array.isArray(inspectionResults) && inspectionResults.length > 0
                ? inspectionResults
                    .map((item, index) => `${index + 1}. ${item.question}\nAnswer: ${item.answer === "true" ? "Yes" : " No"}`)
                    .join("\n\n")
                : "No inspection results provided.";
            // Create a new ClickUp task
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
            else { }
            taskId = taskData.id;
            logger.info(`Created ClickUp task: ${taskId}`);
            // Store task ID in Redis for future photos
            await redisService.setTaskSession(sessionId, taskId);
        }
        // Upload current photo to the task
        if (files && files.length > 0) {
            const file = files[0];
            const formData = new FormData();
            formData.append("attachment", new Blob([file.buffer], { type: file.mimetype }), file.originalname);
            const response = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/attachment`, {
                method: "POST",
                headers: {
                    Authorization: API_TOKEN,
                },
                body: formData,
            });
            await response.json();
            logger.info(`📎 Uploaded ${file.originalname} to ClickUp task ${taskId}`);
        }
        // If this is the last photo, send final response and cleanup
        if (parseInt(photoIndex) === parseInt(totalPhotos) - 1) {
            res.json({
                success: true,
                message: "VIF task created and all photos uploaded successfully",
                taskId,
                uploadedCount: totalPhotos,
            });
            // Clean up Redis session
            await redisService.deleteTaskSession(sessionId);
        }
        else {
            // Intermediate response for ongoing upload
            res.json({
                success: true,
                message: `Photo ${parseInt(photoIndex) + 1} uploaded successfully`,
                taskId,
            });
        }
    }
    catch (error) {
        logger.error("Error uploading to ClickUp", error);
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

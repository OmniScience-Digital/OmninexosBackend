// import logger from '../utils/logger';
// import { Request, Response } from 'express';
// import { DateTime } from 'luxon';

// const API_TOKEN = process.env.CLICKUP_API_TOKEN!;
// const LIST_ID = process.env.VIF_LIST_ID!;
// const USERNAME_FIELD_ID = 'daf6f996-8096-473b-b9e4-9e20f4568d63';

// let currentTaskId: string | null = null;

// export const vifClickUp = async (req: Request, res: Response): Promise<void> => {
//   try {
//     const files = (req as any).files;
//     const {
//       vehicleId,
//       vehicleReg,
//       odometer,
//       inspectionResults,
//       username,
//       photoIndex,
//       totalPhotos,
//     } = req.body;

//     logger.info(`Processing photo ${parseInt(photoIndex) + 1} of ${totalPhotos}`);

//     // Parse inspection results if it's a string
//     const inspectionData =
//       typeof inspectionResults === 'string' ? JSON.parse(inspectionResults) : inspectionResults;

//     // Create task on first photo only
//     if (!currentTaskId) {
//       logger.info(
//         `Creating new task for Vehicle ID: ${vehicleId}, Odometer: ${odometer}, Vehicle Reg: ${vehicleReg}, Username: ${username}`
//       );

//       const questionLines =
//         Array.isArray(inspectionData) && inspectionData.length > 0
//           ? inspectionData
//               .map(
//                 (item: any, index: number) =>
//                   `${index + 1}. ${item.question}\nAnswer: ${item.answer === 'true' ? 'Yes' : ' No'}`
//               )
//               .join('\n\n')
//           : 'No inspection results provided.';

//       const timestamp = getJhbTimestamp();

//       const body = {
//         name: `Vehicle Inspection - ${vehicleReg} ${timestamp}`,
//         description: `Vehicle Reg: ${vehicleReg}\nVehicle ID: ${vehicleId}\nOdometer: ${odometer}\n\nInspection Results:\n\n${questionLines}`,
//         custom_fields: [
//           {
//             id: USERNAME_FIELD_ID,
//             value: normalize(username),
//           },
//         ],
//         status: 'to do',
//       };

//       const createTask = await fetch(`https://api.clickup.com/api/v2/list/${LIST_ID}/task`, {
//         method: 'POST',
//         headers: {
//           Authorization: API_TOKEN,
//           'Content-Type': 'application/json',
//         },
//         body: JSON.stringify(body),
//       });

//       const taskData = await createTask.json();

//       if (!taskData.id) {
//         logger.error('Failed to create ClickUp task', taskData);
//         res.status(500).json({ success: false, error: 'Failed to create ClickUp task' });
//         return;
//       }

//       currentTaskId = taskData.id;
//       logger.info(`Created ClickUp task: ${currentTaskId}`);
//     }

//     // Upload current photo to the task
//     if (files && files.length > 0) {
//       const file = files[0];
//       const formData = new FormData();
//       formData.append(
//         'attachment',
//         new Blob([file.buffer], { type: file.mimetype }),
//         file.originalname
//       );

//       const response = await fetch(
//         `https://api.clickup.com/api/v2/task/${currentTaskId}/attachment`,
//         {
//           method: 'POST',
//           headers: {
//             Authorization: API_TOKEN,
//           },
//           body: formData,
//         }
//       );

//       await response.json();
//       logger.info(`📎 Uploaded ${file.originalname} to ClickUp task ${currentTaskId}`);
//     }

//     // If this is the last photo, send final response and reset
//     if (parseInt(photoIndex) === parseInt(totalPhotos) - 1) {
//       res.json({
//         success: true,
//         message: 'VIF task created and all photos uploaded successfully',
//         taskId: currentTaskId,
//         uploadedCount: totalPhotos,
//       });
//       currentTaskId = null; // Reset for next submission
//     } else {
//       // Intermediate response for ongoing upload
//       res.json({
//         success: true,
//         message: `Photo ${parseInt(photoIndex) + 1} uploaded successfully`,
//         taskId: currentTaskId,
//       });
//     }
//   } catch (error: any) {
//     logger.error('Error uploading to ClickUp', error);
//     currentTaskId = null; // Reset on error
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

import logger from '../utils/logger';
import { Request, Response } from 'express';
import { DateTime } from 'luxon';

const API_TOKEN = process.env.CLICKUP_API_TOKEN!;
const LIST_ID = process.env.VIF_LIST_ID!;
const USERNAME_FIELD_ID = 'daf6f996-8096-473b-b9e4-9e20f4568d63';

// Simple session storage - reset after 10 minutes
const sessions = new Map();

export const vifClickUp = async (req: Request, res: Response): Promise<void> => {
  try {
    const files = (req as any).files;
    const {
      vehicleId,
      vehicleReg,
      odometer,
      inspectionResults,
      username,
      photoIndex,
      totalPhotos,
    } = req.body;

    logger.info(`Processing photo ${parseInt(photoIndex) + 1} of ${totalPhotos}`);

    // Parse inspection results if it's a string
    const inspectionData =
      typeof inspectionResults === 'string' ? JSON.parse(inspectionResults) : inspectionResults;

    const sessionId = `${vehicleId}_${username}`;
    let currentTaskId = sessions.get(sessionId);

    // Create task on first photo only
    if (!currentTaskId) {
      logger.info(
        `Creating new task for Vehicle ID: ${vehicleId}, Odometer: ${odometer}, Vehicle Reg: ${vehicleReg}, Username: ${username}`
      );

      const questionLines =
        Array.isArray(inspectionData) && inspectionData.length > 0
          ? inspectionData
              .map(
                (item: any, index: number) =>
                  `${index + 1}. ${item.question}\nAnswer: ${item.answer === 'true' ? 'Yes' : ' No'}`
              )
              .join('\n\n')
          : 'No inspection results provided.';

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
        status: 'to do',
      };

      const createTask = await fetch(`https://api.clickup.com/api/v2/list/${LIST_ID}/task`, {
        method: 'POST',
        headers: {
          Authorization: API_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const taskData = await createTask.json();

      if (!taskData.id) {
        logger.error('Failed to create ClickUp task', taskData);
        res.status(500).json({ success: false, error: 'Failed to create ClickUp task' });
        return;
      }

      currentTaskId = taskData.id;
      sessions.set(sessionId, currentTaskId);
      logger.info(`Created ClickUp task: ${currentTaskId}`);
    }

    // Upload current photo to the task
    if (files && files.length > 0) {
      const file = files[0];
      const formData = new FormData();
      formData.append(
        'attachment',
        new Blob([file.buffer], { type: file.mimetype }),
        file.originalname
      );

      const response = await fetch(
        `https://api.clickup.com/api/v2/task/${currentTaskId}/attachment`,
        {
          method: 'POST',
          headers: {
            Authorization: API_TOKEN,
          },
          body: formData,
        }
      );

      await response.json();
      logger.info(`📎 Uploaded ${file.originalname} to ClickUp task ${currentTaskId}`);
    }

    // If this is the last photo, send final response and reset
    if (parseInt(photoIndex) === parseInt(totalPhotos) - 1) {
      res.json({
        success: true,
        message: 'VIF task created and all photos uploaded successfully',
        taskId: currentTaskId,
        uploadedCount: totalPhotos,
      });
      sessions.delete(sessionId); // Clean up session
    } else {
      // Intermediate response for ongoing upload
      res.json({
        success: true,
        message: `Photo ${parseInt(photoIndex) + 1} uploaded successfully`,
        taskId: currentTaskId,
      });
    }
  } catch (error: any) {
    logger.error('Error uploading to ClickUp', error);
    // Clean up session on error
    if (req.body.vehicleId && req.body.username) {
      sessions.delete(`${req.body.vehicleId}_${req.body.username}`);
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

export function getJhbTimestamp() {
  return DateTime.now().setZone('Africa/Johannesburg').toFormat('yyyy-MM-dd HH:mm:ss');
}

function normalize(str: any) {
  if (typeof str !== 'string') return String(str);
  return str.trim().replace(/^"+|"+$/g, '');
}

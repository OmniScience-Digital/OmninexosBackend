import fetch from "node-fetch";
import logger from "../utils/logger.js";
import { getJhbTimestamp } from "../helper/time/time.helper.js";
// ClickUp env variables
const API_TOKEN = process.env.CLICKUP_API_TOKEN;
const LIST_ID = process.env.CLICKUP_LIST_ID;
// Custom field IDs in ClickUp (replace with your actual field IDs)
const INTAKE_WITHDRAWAL_FIELD_ID = "0714e91c-fb89-43b7-b8f0-deb3d1b4d973";
const USERNAME_FIELD_ID = "daf6f996-8096-473b-b9e4-9e20f4568d63";
export const clickUpRouter = async (req, res) => {
    try {
        logger.info("Click Up POST router called");
        const payload = req.body;
        const username = req.body.username || "Unknown User"; // get user from form
        const status = { message: "ok", received: payload };
        // Loop through payload and create tasks
        await createTasks(payload, username);
        res.status(200).json({
            success: true,
            data: status,
        });
    }
    catch (error) {
        console.error("Error posting to ClickUp:", error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        });
    }
};
// Create a task for each subcomponent in payload
// async function createTasks(payload: any, username: string) {
//   const url = `https://api.clickup.com/api/v2/list/${LIST_ID}/task`;
//   const result = payload.result;
//   console.log(result);
//   for (const categoryName of Object.keys(result)) {
//     const category = result[categoryName];
//     // Loop subcategories
//     for (const subCategoryName of Object.keys(category)) {
//       const subCategory = category[subCategoryName];
//       // Handle subComponents whether it's an array or object
//       const subComponents = subCategory.subComponents || {};
//       const descriptionLines = Array.isArray(subComponents)
//         ? subComponents.map(
//           (sub: any) => `Key: ${sub.key}\nValue: ${sub.value}`
//         )
//         : Object.entries(subComponents).map(
//           ([key, sub]: [string, any]) => `Key: ${key}\nValue: ${sub.value}`
//         );
//       const hasWithdrawal = subCategory.isWithdrawal === true;
//       const datetime = getJhbTimestamp();
//       const heading = hasWithdrawal ? "Withdrawal" : "Intake";
//       const topic = `Stock Action, ${heading} @ ${datetime}`;
//       const body = {
//         name: `${topic}`,
//         description: `${categoryName}, ${subCategoryName}\n${descriptionLines.join("\n\n")}`,
//         priority: 3,
//         custom_fields: [
//           {
//             id: INTAKE_WITHDRAWAL_FIELD_ID,
//             value: hasWithdrawal ? "Withdrawal" : "Intake",
//           },
//           {
//             id: USERNAME_FIELD_ID,
//             value: username
//           },
//         ],
//         status: "to do",
//       };
//       // Uncomment to send
//       const res = await fetch(url, {
//         method: "POST",
//         headers: {
//           Authorization: API_TOKEN,
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify(body),
//       });
//       const data = await res.json();
//       console.log("Task created with custom fields:", data);
//     }
//   }
// }
async function createTasks(payload, username) {
    const url = `https://api.clickup.com/api/v2/list/${LIST_ID}/task`;
    const result = payload.result;
    let descriptionLines = [];
    let anyWithdrawal = false;
    const datetime = getJhbTimestamp();
    let topic = `Stock Action @ ${datetime}`;
    for (const categoryName of Object.keys(result)) {
        const category = result[categoryName];
        for (const subCategoryName of Object.keys(category)) {
            const subCategory = category[subCategoryName];
            const subComponents = subCategory.subComponents || {};
            const subLines = Array.isArray(subComponents)
                ? subComponents.map((sub) => `Key: ${sub.key}\nValue: ${sub.value}`)
                : Object.entries(subComponents).map(([key, sub]) => `Key: ${key}\nValue: ${sub.value}`);
            // Add each subcategory to description
            descriptionLines.push(`${categoryName}, ${subCategoryName}\n${subLines.join("\n")}`);
            if (subCategory.isWithdrawal)
                anyWithdrawal = true;
        }
    }
    // Add Withdrawal/Intake to topic
    topic = anyWithdrawal ? `Stock Action, Withdrawal @ ${datetime}` : `Stock Action, Intake @ ${datetime}`;
    const body = {
        name: topic,
        description: descriptionLines.join("\n\n"),
        priority: 3,
        custom_fields: [
            {
                id: INTAKE_WITHDRAWAL_FIELD_ID,
                value: anyWithdrawal ? "Withdrawal" : "Intake",
            },
            {
                id: USERNAME_FIELD_ID,
                value: username,
            },
        ],
        status: "to do",
    };
    // Send task
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: API_TOKEN,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log("Task created with custom fields:", data);
}

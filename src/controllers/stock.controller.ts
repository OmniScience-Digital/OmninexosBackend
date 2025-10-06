import { updateComponents } from '../repositories/dynamo.repository';
import logger from '../utils/logger';
import { Request, Response } from 'express';

export const stockControllerRouter = async (req: Request, res: Response) => {
  try {
    logger.info('Executing stock control route.');

    // console.log('Full request body:');
    // console.log(JSON.stringify(req.body, null, 2));

    const payload = parseClickUpPayload(req.body);

    await updateComponents(payload);

    res.status(200).json({ success: true, message: 'Report Generated' });
  } catch (error: any) {
    logger.error('Failed to generate report:', error);
    console.error(error);

    res.status(500).json({
      success: false,
      error: 'Error generating report',
      details: (error as Error).message,
    });
  }
};



function parseClickUpPayload(clickupPayload: any) {
  const { payload } = clickupPayload;

  const description = payload.text_content;
  const lines = description.split("\n").filter(Boolean);

  const result: Record<string, any> = {};
  let username = "Unknown";

  // Detect Withdrawal field dynamically
  const withdrawalField = payload.fields.find((f: any) =>
    typeof f.value === "string" && f.value.toLowerCase().includes("withdrawal")
  );

  // Detect user field dynamically (assuming it’s an email or anything not "Intake"/"Withdrawal")
  const userField = payload.fields.find((f: any) =>
    typeof f.value === "string" &&
    !["withdrawal", "intake"].includes(f.value.toLowerCase().trim())
  );

  if (userField) username = userField.value;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect "Category, Subcategory" line
    if (line.includes(",")) {
      const [categoryName, subCategoryName] = line.split(",").map((s: string) => s.trim());

      if (!result[categoryName]) result[categoryName] = {};
      if (!result[categoryName][subCategoryName]) {
        result[categoryName][subCategoryName] = {
          isWithdrawal: withdrawalField ? true : false,
          subComponents: {},
        };
      }

      const keyLine = lines[i + 1]?.replace("Key: ", "").trim();
      const valueLine = lines[i + 2]?.replace("Value: ", "").trim();

      if (keyLine && valueLine) {
        result[categoryName][subCategoryName].subComponents[keyLine] = {
          value: Number(valueLine),
        };
      }

      i += 2; // Skip Key/Value lines
    }
  }

  return {
    ...result,
    username,
  };
}

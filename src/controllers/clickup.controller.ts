import { Request, Response } from 'express';
import fetch from 'node-fetch';
import logger from '../utils/logger';

// ClickUp env variables
const API_TOKEN = process.env.CLICKUP_API_TOKEN!;
const LIST_ID = process.env.CLICKUP_LIST_ID!;

// Custom field IDs in ClickUp (replace with your actual field IDs)
const INTAKE_WITHDRAWAL_FIELD_ID = '0714e91c-fb89-43b7-b8f0-deb3d1b4d973';
const USERNAME_FIELD_ID = 'daf6f996-8096-473b-b9e4-9e20f4568d63';

export const clickUpRouter = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info('Click Up POST router called');

    const payload = req.body;
    const username = req.body.username || 'Unknown User'; // get user from form

    const status = { message: 'ok', received: payload };

    // Loop through payload and create tasks
    await createTasks(payload, username);

    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('Error posting to ClickUp:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// Create a task for each subcomponent in payload

async function createTasks(payload: any, username: string) {
  const url = `https://api.clickup.com/api/v2/list/${LIST_ID}/task`;
  const result = payload.result;

  for (const componentName of Object.keys(result)) {
    const component = result[componentName];

    // Correctly pull subComponents
    const subComponents = component.subComponents || {};

    // Build description lines
    const descriptionLines = Object.entries(subComponents).map(
      ([subName, sub]: [string, any]) => `Key: ${subName}\nValue: ${sub.value}`
    );

    // Pull withdrawal flag from the component
    const hasWithdrawal = component.isWithdrawal === true;

    const body = {
      name: componentName,
      description: descriptionLines.join('\n\n'),
      priority: 3,
      custom_fields: [
        {
          id: INTAKE_WITHDRAWAL_FIELD_ID,
          value: hasWithdrawal ? 'Withdrawal' : 'Intake',
        },
        {
          id: USERNAME_FIELD_ID,
          value: username,
        },
      ],
      status: 'to do',
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: API_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    console.log('Task created with custom fields:', data);
  }
}

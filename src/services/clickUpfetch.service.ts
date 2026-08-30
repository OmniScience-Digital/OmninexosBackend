import 'dotenv/config';
import { businessUnit_FIELD_ID } from '../controllers/xero.businessUnit.controller';
const CLICKUP_API_KEY = process.env.CLICKUP_API_TOKEN;

export const getClickUpTask = async (taskId: string) => {
  const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    method: 'GET',
    headers: {
      Authorization: CLICKUP_API_KEY!,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch task: ${res.statusText}`);
  }

  return res.json();
};

export const updateClickUpBusinessUnit = async (taskId: string, value: string) => {
  const res = await fetch(
    `https://api.clickup.com/api/v2/task/${taskId}/field/${businessUnit_FIELD_ID}`,
    {
      method: 'POST',
      headers: {
        Authorization: CLICKUP_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        value: value,
      }),
    }
  );

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to update ClickUp Business Unit: ${res.status} ${error}`);
  }
};

const CLICKUP_API_KEY = process.env.CLICKUP_API_TOKEN;
export const getClickUpTask = async (taskId) => {
    const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
        method: 'GET',
        headers: {
            Authorization: CLICKUP_API_KEY,
            'Content-Type': 'application/json',
        },
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch task: ${res.statusText}`);
    }
    return res.json();
};

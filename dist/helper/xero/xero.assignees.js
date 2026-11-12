// src/helper/xero/xero.assignees.ts  (NEW FILE)
// XERO ESCALATION: the ClickUp users tagged on every Xero escalation task.
// Set xero_excalation_a and xero_excalation_b in .env to their ClickUp user ids. The correctly
// spelled xero_escalation_a / _b are accepted too. Missing or invalid values are ignored.
export function xeroEscalationAssignees(env = process.env) {
    const raw = [
        env.xero_excalation_a,
        env.xero_excalation_b,
        env.xero_escalation_a,
        env.xero_escalation_b,
    ];
    const ids = raw
        .map((v) => Number(String(v ?? '').trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
    return [...new Set(ids)];
}
/** The ClickUp comment that tags everyone: "@A @B Xero escalation: please take a look." */
export function xeroTagComment(userIds) {
    const blocks = [];
    for (const id of userIds)
        blocks.push({ type: 'tag', user: { id } }, { text: ' ' });
    blocks.push({ text: 'Xero escalation: please take a look.' });
    return blocks;
}

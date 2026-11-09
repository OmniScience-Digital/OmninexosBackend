const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
export function matchMember(name, members) {
    const wanted = name.trim().toLowerCase();
    if (!wanted)
        return { member: null, reason: 'none' };
    const hits = members.filter((m) => words(m.username).includes(wanted) || (m.email ?? '').toLowerCase().split('@')[0] === wanted);
    if (hits.length === 1)
        return { member: hits[0] };
    return { member: null, reason: hits.length === 0 ? 'none' : 'ambiguous' };
}
export function resolveAssignees(names, members, overrides, gleedName) {
    const warnings = [];
    const gleedMatch = matchMember(gleedName, members);
    const gleed = gleedMatch.member;
    if (!gleed)
        warnings.push(`Fallback assignee "${gleedName}" was not found on the ClickUp list (${gleedMatch.reason})`);
    const seen = new Set();
    const assignees = [];
    for (const raw of names) {
        const name = raw.trim();
        const key = name.toLowerCase();
        if (!name || seen.has(key))
            continue;
        seen.add(key);
        const pinned = overrides[key] !== undefined ? members.find((m) => m.id === overrides[key]) : undefined;
        const found = pinned ? { member: pinned } : matchMember(name, members);
        if (found.member) {
            assignees.push({ name, clickupUserId: found.member.id, fallback: false });
        }
        else {
            const why = 'reason' in found ? found.reason : 'none';
            warnings.push(`"${name}" ${why === 'ambiguous' ? 'matches several ClickUp users' : 'is not on ClickUp'}; assigned to ${gleedName}`);
            assignees.push({ name, clickupUserId: gleed?.id ?? null, fallback: true });
        }
    }
    // Nobody selected (the form requires one, but never create an unowned task if it slips through).
    if (assignees.length === 0) {
        assignees.push({ name: gleedName, clickupUserId: gleed?.id ?? null, fallback: false });
    }
    return { assignees, gleed, warnings };
}
/** Distinct ClickUp user ids to assign the task to. */
export const assigneeIds = (a) => [
    ...new Set(a.map((x) => x.clickupUserId).filter((id) => id !== null)),
];

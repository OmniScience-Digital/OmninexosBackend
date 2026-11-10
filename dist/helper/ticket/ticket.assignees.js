const words = (s) => s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
export function matchMember(name, members) {
    const wanted = name.trim().toLowerCase();
    if (!wanted)
        return { member: null, reason: 'none' };
    const hits = members.filter((m) => words(m.username).includes(wanted) || (m.email ?? '').toLowerCase().split('@')[0] === wanted);
    if (hits.length === 1)
        return { member: hits[0] };
    return { member: null, reason: hits.length === 0 ? 'none' : 'ambiguous' };
}
export function resolveAssignees(names, members, overrides, gleedName, fallbackId) {
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
            assignees.push({
                name,
                clickupUserId: fallbackId !== undefined ? fallbackId : (gleed?.id ?? null),
                fallback: true,
            });
        }
    }
    // Nobody selected (the form requires one, but never create an unowned task if it slips through).
    if (assignees.length === 0) {
        assignees.push({
            name: gleedName,
            clickupUserId: fallbackId !== undefined ? fallbackId : (gleed?.id ?? null),
            fallback: false,
        });
    }
    return { assignees, gleed, warnings };
}
/** Distinct ClickUp user ids to assign the task to. */
export const assigneeIds = (a) => [
    ...new Set(a.map((x) => x.clickupUserId).filter((id) => id !== null)),
];
const covers = (m, name) => {
    const n = name.trim().toLowerCase();
    return m.username.trim().toLowerCase() === n || words(m.username).includes(n);
};
/**
 * Who a ticket is assigned to. The form saves two lists: `names` (everyone picked) and `clickupIds`
 * (only those who have a ClickUp account). Names with no ClickUp account (for example Gleed) and
 * ids that have since left ClickUp go to the fallback user, so a task is never created unowned.
 *
 * How many people lack an account is taken from the counts (names minus ids), not from guessing
 * which name belongs to which id, so an alias like "Conraad" for "Conrad Botha" can never cause
 * a wrong assignment. Name matching is only used to label them in the description.
 * Tickets saved without ids (older ones) are resolved by name instead.
 */
export function resolveTicketAssignees(names, clickupIds, members, fallbackId, overrides, gleedName) {
    const ids = [...new Set(clickupIds.map(String).filter(Boolean))];
    if (ids.length === 0)
        return resolveAssignees(names, members, overrides, gleedName, fallbackId);
    const warnings = [];
    const assignees = [];
    const found = [];
    for (const id of ids) {
        const m = members.find((x) => String(x.id) === id);
        if (m) {
            found.push(m);
            assignees.push({ name: m.username, clickupUserId: m.id, fallback: false });
        }
        else {
            warnings.push(`ClickUp user ${id} is no longer on the list`);
            assignees.push({ name: `ClickUp user ${id}`, clickupUserId: fallbackId, fallback: true });
        }
    }
    const picked = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    const missing = picked.length - ids.length; // people picked who have no ClickUp account
    if (missing > 0) {
        const uncovered = picked.filter((n) => !found.some((m) => covers(m, n)));
        if (uncovered.length === missing) {
            for (const n of uncovered) {
                warnings.push(`"${n}" is not on ClickUp; assigned to the fallback user`);
                assignees.push({ name: n, clickupUserId: fallbackId, fallback: true });
            }
        }
        else {
            warnings.push(`${missing} picked person(s) have no ClickUp account; assigned to the fallback user`);
            assignees.push({
                name: `${missing} without a ClickUp account`,
                clickupUserId: fallbackId,
                fallback: true,
            });
        }
    }
    return { assignees, warnings };
}
/** The user tagged at 70% and used as fallback: the configured id, else the member named Gleed. */
export function escalationTarget(configuredId, members, gleedName) {
    if (configuredId !== null)
        return configuredId;
    const m = matchMember(gleedName, members);
    return m.member ? m.member.id : null;
}

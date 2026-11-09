// src/helper/ticket/ticket.assignees.ts
// TICKETING: matches the names ticked on the form to ClickUp users. Pure.
//
// A name counts as "on ClickUp" when exactly one list member matches it (a whole word of their
// ClickUp name, or the start of their email). No match, or more than one match, falls back to
// Gleed, as agreed in the meeting. TICKET_ASSIGNEE_MAP can pin a name to a ClickUp user id.
import type { ClickUpMember } from '../../services/ticket.clickup.service';
import type { ResolvedAssignee } from './ticket.format';

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

export type MatchResult =
  { member: ClickUpMember } | { member: null; reason: 'none' | 'ambiguous' };

export function matchMember(name: string, members: ClickUpMember[]): MatchResult {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return { member: null, reason: 'none' };
  const hits = members.filter(
    (m) =>
      words(m.username).includes(wanted) || (m.email ?? '').toLowerCase().split('@')[0] === wanted
  );
  if (hits.length === 1) return { member: hits[0] };
  return { member: null, reason: hits.length === 0 ? 'none' : 'ambiguous' };
}

export interface AssigneeResolution {
  assignees: ResolvedAssignee[];
  gleed: ClickUpMember | null;
  warnings: string[];
}

export function resolveAssignees(
  names: string[],
  members: ClickUpMember[],
  overrides: Record<string, number>,
  gleedName: string
): AssigneeResolution {
  const warnings: string[] = [];
  const gleedMatch = matchMember(gleedName, members);
  const gleed = gleedMatch.member;
  if (!gleed)
    warnings.push(
      `Fallback assignee "${gleedName}" was not found on the ClickUp list (${gleedMatch.reason})`
    );

  const seen = new Set<string>();
  const assignees: ResolvedAssignee[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);

    const pinned =
      overrides[key] !== undefined ? members.find((m) => m.id === overrides[key]) : undefined;
    const found = pinned ? { member: pinned } : matchMember(name, members);
    if (found.member) {
      assignees.push({ name, clickupUserId: found.member.id, fallback: false });
    } else {
      const why = 'reason' in found ? found.reason : 'none';
      warnings.push(
        `"${name}" ${why === 'ambiguous' ? 'matches several ClickUp users' : 'is not on ClickUp'}; assigned to ${gleedName}`
      );
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
export const assigneeIds = (a: ResolvedAssignee[]): number[] => [
  ...new Set(a.map((x) => x.clickupUserId).filter((id): id is number => id !== null)),
];

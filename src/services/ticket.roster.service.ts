// src/services/ticket.roster.service.ts
// TICKETING: keeps the ClickUpMember table (what the Task Form's people picker reads) equal to the
// people in the ClickUp workspace (plus the list's members). To add someone to the picker, add them to
// ClickUp; they show up within a few minutes. Someone removed from ClickUp is switched off (isActive = false), not deleted,
// so old tickets keep their names.
import type * as Repo from '../repositories/dynamo.ticket.repository';
import type { TicketClickUp } from './ticket.clickup.service';

export interface RosterDeps {
  repo: Pick<typeof Repo, 'listMembers' | 'putMember'>;
  clickup: Pick<TicketClickUp, 'getListMembers'>;
}

export async function refreshRoster(deps: RosterDeps) {
  const members = await deps.clickup.getListMembers();
  const existing = new Map((await deps.repo.listMembers()).map((r) => [String(r.id), r]));
  let saved = 0;

  for (const m of members) {
    const id = String(m.id);
    const cur = existing.get(id);
    const same =
      cur &&
      cur.name === m.username &&
      (cur.email ?? undefined) === m.email &&
      (cur.avatarUrl ?? undefined) === m.avatarUrl &&
      cur.isActive === true;
    if (!same) {
      await deps.repo.putMember({
        id,
        name: m.username,
        email: m.email,
        avatarUrl: m.avatarUrl,
        isActive: true,
      });
      saved++;
    }
  }

  // An empty answer is far more likely a ClickUp hiccup than "everyone left": never switch people off for it.
  if (members.length > 0) {
    const live = new Set(members.map((m) => String(m.id)));
    for (const [id, cur] of existing) {
      if (!live.has(id) && cur.isActive !== false) {
        await deps.repo.putMember({
          id,
          name: cur.name,
          email: cur.email,
          avatarUrl: cur.avatarUrl,
          isActive: false,
        });
        saved++;
      }
    }
  }
  return saved;
}

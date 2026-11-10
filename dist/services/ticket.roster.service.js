export async function refreshRoster(deps) {
    const members = await deps.clickup.getListMembers();
    const existing = new Map((await deps.repo.listMembers()).map((r) => [String(r.id), r]));
    let saved = 0;
    for (const m of members) {
        const id = String(m.id);
        const cur = existing.get(id);
        const same = cur &&
            cur.name === m.username &&
            (cur.email ?? undefined) === m.email &&
            (cur.avatarUrl ?? undefined) === m.avatarUrl &&
            cur.isActive === true;
        if (!same) {
            await deps.repo.putMember({ id, name: m.username, email: m.email, avatarUrl: m.avatarUrl, isActive: true });
            saved++;
        }
    }
    // An empty answer is far more likely a ClickUp hiccup than "everyone left": never switch people off for it.
    if (members.length > 0) {
        const live = new Set(members.map((m) => String(m.id)));
        for (const [id, cur] of existing) {
            if (!live.has(id) && cur.isActive !== false) {
                await deps.repo.putMember({ id, name: cur.name, email: cur.email, avatarUrl: cur.avatarUrl, isActive: false });
                saved++;
            }
        }
    }
    return saved;
}

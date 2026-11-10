// src/services/ticket.clickup.service.ts  (MODIFIED - search "WORKSPACE-MEMBERS")
// TICKETING: the ClickUp calls the ticket flow needs. Goes through clickupFetch so it shares the
// backend's per-minute ClickUp budget and 429 retry handling.
import "dotenv/config";
import logger from "../utils/logger.js";
import { clickupFetch } from "./clickup.throttle.js";
const API = "https://api.clickup.com/api/v2";
const headers = () => ({
    Authorization: process.env.CLICKUP_API_TOKEN,
    "Content-Type": "application/json",
});
async function fail(what, res) {
    throw new Error(`ClickUp ${what} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
}
/**
 * WORKSPACE-MEMBERS: turns ClickUp's "GET /team" answer into members. Uses every workspace the
 * token can see, or only TICKET_CLICKUP_TEAM_ID when that is set. Skips entries with no usable id
 * or name (for example an invite nobody accepted yet).
 */
export function membersFromWorkspaces(body, teamId) {
    const teams = (body?.teams ?? []).filter((t) => !teamId || String(t.id) === teamId);
    const out = [];
    for (const team of teams) {
        for (const entry of team.members ?? []) {
            const u = entry?.user ?? entry;
            const id = Number(u?.id);
            const email = u?.email ? String(u.email) : undefined;
            const username = String(u?.username ?? "").trim() || (email ? email.split("@")[0] : "");
            if (!Number.isFinite(id) || !username)
                continue;
            out.push({
                id,
                username,
                email,
                avatarUrl: u?.profilePicture ? String(u.profilePicture) : undefined,
            });
        }
    }
    return out;
}
/** One entry per ClickUp user id. The first list wins; later lists only fill in what is missing. */
export function mergeMembers(...lists) {
    const byId = new Map();
    for (const m of lists.flat()) {
        const cur = byId.get(m.id);
        byId.set(m.id, cur
            ? { ...m, ...cur, email: cur.email ?? m.email, avatarUrl: cur.avatarUrl ?? m.avatarUrl }
            : m);
    }
    return [...byId.values()];
}
const MEMBERS_TTL_MS = 10 * 60000;
let membersCache = null;
export const clickUpTicketApi = {
    async getListMembers() {
        if (membersCache && Date.now() - membersCache.at < MEMBERS_TTL_MS)
            return membersCache.list;
        const res = await clickupFetch(`${API}/list/${process.env.TICKET_CLICKUP_LIST_ID}/member`, {
            method: "GET",
            headers: headers(),
        });
        if (!res.ok)
            await fail("get list members", res);
        const body = await res.json();
        const listMembers = (body.members ?? []).map((m) => ({
            id: Number(m.id),
            username: String(m.username ?? ""),
            email: m.email ? String(m.email) : undefined,
            avatarUrl: m.profilePicture ? String(m.profilePicture) : undefined,
        }));
        // WORKSPACE-MEMBERS: the list call only returns people with access to that one list, so add the
        // rest of the workspace. If this call fails, carry on with the list's members rather than
        // breaking ticket intake.
        let workspaceMembers = [];
        try {
            const wsRes = await clickupFetch(`${API}/team`, { method: "GET", headers: headers() });
            if (!wsRes.ok)
                throw new Error(`${wsRes.status} ${(await wsRes.text()).slice(0, 200)}`);
            workspaceMembers = membersFromWorkspaces(await wsRes.json(), process.env.TICKET_CLICKUP_TEAM_ID);
        }
        catch (err) {
            logger.warn(`[ticket] could not read ClickUp workspace members, using the list's members only: ${err}`);
        }
        const list = mergeMembers(listMembers, workspaceMembers);
        membersCache = { at: Date.now(), list };
        return list;
    },
    async createTask({ name, description, assigneeIds, dueAt }) {
        const res = await clickupFetch(`${API}/list/${process.env.TICKET_CLICKUP_LIST_ID}/task`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({
                name,
                description,
                assignees: assigneeIds,
                due_date: dueAt.getTime(),
                due_date_time: true,
            }),
        });
        if (!res.ok)
            await fail("create task", res);
        const body = await res.json();
        if (!body?.id)
            throw new Error("ClickUp create task returned no id");
        return { id: String(body.id), url: body.url ? String(body.url) : null };
    },
    async getTask(taskId) {
        const res = await clickupFetch(`${API}/task/${taskId}`, { method: "GET", headers: headers() });
        if (res.status === 404)
            return null;
        if (!res.ok)
            await fail("get task", res);
        const body = await res.json();
        return { id: String(body.id), statusType: String(body.status?.type ?? "") };
    },
    async listComments(taskId, sinceMs) {
        const PAGE = 25; // ClickUp returns the 25 most recent comments per request
        const found = [];
        let start;
        let startId;
        for (let page = 0; page < 10; page++) {
            const qs = start
                ? `?start=${encodeURIComponent(start)}&start_id=${encodeURIComponent(startId)}`
                : "";
            const res = await clickupFetch(`${API}/task/${taskId}/comment${qs}`, {
                method: "GET",
                headers: headers(),
            });
            if (!res.ok)
                await fail("get comments", res);
            const body = await res.json();
            const batch = body.comments ?? [];
            for (const c of batch) {
                found.push({
                    id: String(c.id),
                    text: String(c.comment_text ?? ""),
                    userId: c.user?.id != null ? Number(c.user.id) : null,
                    userName: String(c.user?.username ?? "Someone"),
                    dateMs: Number(c.date),
                });
            }
            if (batch.length < PAGE)
                break;
            const oldest = batch.reduce((a, b) => (Number(b.date) < Number(a.date) ? b : a));
            if (Number(oldest.date) <= sinceMs)
                break; // reached comments we already handled
            start = String(oldest.date);
            startId = String(oldest.id);
        }
        return found.filter((c) => c.dateMs > sinceMs).sort((a, b) => a.dateMs - b.dateMs);
    },
    async postComment(taskId, blocks) {
        const res = await clickupFetch(`${API}/task/${taskId}/comment`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ comment: blocks, notify_all: false }),
        });
        if (!res.ok)
            await fail("post comment", res);
        const body = await res.json();
        return { id: String(body.id ?? "") };
    },
};

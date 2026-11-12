export function createQuoteSyncEscalator(deps) {
    let raised = false;
    return {
        async raise(err) {
            if (raised)
                return false;
            // The token escalation already covers this outage: do not open a second task for it.
            if (deps.tokenOutageActive())
                return false;
            raised = true;
            const reason = String(err?.message ?? err).slice(0, 500);
            const at = (deps.now?.() ?? new Date()).toISOString();
            await deps.create('Xero quotes are failing to sync', `The quote poll failed at ${at}.\n\nReason: ${reason}\n\n` +
                `Quotes will not reach ClickUp until this is fixed. Check the Xero connection ` +
                `(/api/v1/xero/connect) and the server logs. One task is raised per outage; ` +
                `a new one is raised only after quotes have synced successfully again.`, deps.assignees());
            return true;
        },
        markHealthy() {
            raised = false;
        },
    };
}

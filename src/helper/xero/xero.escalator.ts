// src/helper/xero/xero.escalator.ts
// XERO ESCALATION: raises ONE ClickUp escalation task per outage when quotes fail to sync, instead
// of one every poll (every 3 minutes). A successful poll ends the outage, so the next failure
// escalates again. Kept free of heavy imports so it can be tested on its own.
export interface QuoteEscalatorDeps {
  create(title: string, description: string, assigneeIds: number[]): Promise<void>;
  /** True while the separate "Xero refresh token is invalid" escalation is already open. */
  tokenOutageActive(): boolean;
  assignees(): number[];
  now?: () => Date;
}

export function createQuoteSyncEscalator(deps: QuoteEscalatorDeps) {
  let raised = false;
  return {
    async raise(err: unknown): Promise<boolean> {
      if (raised) return false;
      // The token escalation already covers this outage: do not open a second task for it.
      if (deps.tokenOutageActive()) return false;
      raised = true;
      const reason = String((err as { message?: string })?.message ?? err).slice(0, 500);
      const at = (deps.now?.() ?? new Date()).toISOString();
      await deps.create(
        'Xero quotes are failing to sync',
        `The quote poll failed at ${at}.\n\nReason: ${reason}\n\n` +
          `Quotes will not reach ClickUp until this is fixed. Check the Xero connection ` +
          `(/api/v1/xero/connect) and the server logs. One task is raised per outage; ` +
          `a new one is raised only after quotes have synced successfully again.`,
        deps.assignees()
      );
      return true;
    },
    markHealthy() {
      raised = false;
    },
  };
}

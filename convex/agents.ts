import { api } from "./_generated/api";
import { action } from "./_generated/server";
import { defaultLeadAgentWorkflowId, dograhClient, integrationStatus, twentyClient } from "./lib/integrations";
import { TwentyError } from "./lib/twentyRest";

type ConnectionStatus = { ok: boolean; detail: string; reason?: "missing" | "expired" | "unauthorized" | "unreachable" };

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

/** Dograh agents (workflows) the owner can pick to call their leads. */
export const list = action({
  args: {},
  handler: async (ctx) => {
    const workspace = await ctx.runQuery(api.workspace.current, {});
    if (!workspace) throw new Error("Sign in first");
    const quickCallWorkflowId = Number(process.env.DOGRAH_QUICK_CALL_WORKFLOW_ID ?? 0) || null;
    const workflows = await dograhClient().listWorkflows();
    return {
      agents: workflows.map((workflow) => ({ ...workflow, isQuickCallAgent: workflow.id === quickCallWorkflowId })),
      defaultLeadAgentWorkflowId: defaultLeadAgentWorkflowId() ?? null,
      quickCallWorkflowId,
    };
  },
});

/** Live connectivity check shown on the Settings page. */
export const checkConnections = action({
  args: {},
  handler: async (ctx) => {
    const workspace = await ctx.runQuery(api.workspace.current, {});
    if (!workspace) throw new Error("Sign in first");
    const status = integrationStatus();
    const result: { dograh: ConnectionStatus; twenty: ConnectionStatus; quickCall: ConnectionStatus; webhook: ConnectionStatus } = {
      dograh: { ok: false, detail: "Not configured" },
      twenty: { ok: false, detail: "No API key configured", reason: "missing" },
      quickCall: { ok: status.quickCall, detail: status.quickCall ? "Ready" : "Run scripts/setup-dograh-agents.mjs" },
      webhook: { ok: status.webhook, detail: status.webhook ? "Receiving call results" : "Polling only (no webhook secret)" },
    };
    if (status.dograh) {
      try {
        const workflows = await dograhClient().listWorkflows();
        result.dograh = { ok: true, detail: `${workflows.length} agent${workflows.length === 1 ? "" : "s"} available` };
      } catch (error) {
        result.dograh = { ok: false, detail: message(error) };
      }
    }
    const twenty = twentyClient();
    if (twenty) {
      try {
        await twenty.ping();
        result.twenty = { ok: true, detail: "Connected" };
      } catch (error) {
        if (error instanceof TwentyError && error.status === 401) {
          const expired = /expired/i.test(error.message);
          result.twenty = {
            ok: false,
            detail: expired ? "API key expired" : "API key was rejected",
            reason: expired ? "expired" : "unauthorized",
          };
        } else {
          result.twenty = { ok: false, detail: "Twenty could not be reached", reason: "unreachable" };
        }
      }
    }
    return result;
  },
});

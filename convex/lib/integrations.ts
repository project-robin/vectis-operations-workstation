import { DograhAdapter } from "./dograhAdapter";
import { TwentyRestClient } from "./twentyRest";

/**
 * Deployment-level integration configuration. Secrets live only in the Convex
 * environment (`npx convex env set ...`); they are never stored in tables or
 * returned to the browser.
 */
function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function positiveInt(name: string): number | undefined {
  const value = env(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function integrationStatus() {
  return {
    dograh: Boolean(env("DOGRAH_API_KEY")),
    leadAgentWorkflowId: positiveInt("DOGRAH_LEAD_WORKFLOW_ID") ?? null,
    quickCall: Boolean(positiveInt("DOGRAH_QUICK_CALL_WORKFLOW_ID") && env("DOGRAH_QUICK_CALL_TRIGGER_PATH")),
    twenty: Boolean(env("TWENTY_API_KEY")),
    webhook: Boolean(env("VECTIS_DOGRAH_WEBHOOK_SECRET")),
  };
}

export function dograhClient(): DograhAdapter {
  const key = env("DOGRAH_API_KEY");
  if (!key) throw new Error("Dograh is not connected: set DOGRAH_API_KEY in the Convex environment");
  return new DograhAdapter(env("DOGRAH_API_URL") ?? "https://api.dograh.com", key);
}

export function quickCallAgent(): { workflowId: number; triggerPath: string } {
  const workflowId = positiveInt("DOGRAH_QUICK_CALL_WORKFLOW_ID");
  const triggerPath = env("DOGRAH_QUICK_CALL_TRIGGER_PATH");
  if (!workflowId || !triggerPath) {
    throw new Error("Quick call agent is not configured: run `node scripts/setup-dograh-agents.mjs`");
  }
  return { workflowId, triggerPath };
}

export function defaultLeadAgentWorkflowId(): number | undefined {
  return positiveInt("DOGRAH_LEAD_WORKFLOW_ID");
}

export function twentyClient(): TwentyRestClient | null {
  const key = env("TWENTY_API_KEY");
  if (!key) return null;
  return new TwentyRestClient(env("TWENTY_API_URL") ?? "https://api.twenty.com", key);
}

export function webhookSecret(): string | undefined {
  return env("VECTIS_DOGRAH_WEBHOOK_SECRET");
}

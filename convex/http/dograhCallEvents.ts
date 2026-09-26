import { internal } from "../_generated/api";
import { httpAction } from "../_generated/server";
import { webhookSecret } from "../lib/integrations";

const MAX_BODY_BYTES = 64 * 1024;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function runIdFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d{1,15}$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

/**
 * Post-call notification from the Dograh Webhook node. The payload only
 * identifies the run; the authoritative result is re-read from the Dograh API,
 * so a forged or partial body can never write call outcomes.
 */
export const handle = httpAction(async (ctx, request) => {
  const secret = webhookSecret();
  if (!secret) return new Response("webhook not configured", { status: 503 });
  const provided = request.headers.get("x-vectis-secret") ?? "";
  if (!constantTimeEqual(provided, secret)) return new Response("unauthorized", { status: 401 });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 });
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const vectisCallId = typeof body.vectis_call_id === "string" && body.vectis_call_id.length <= 64 ? body.vectis_call_id : undefined;
  const runId = runIdFrom(body.workflow_run_id);
  if (!vectisCallId && runId === undefined) return new Response("missing run identifiers", { status: 400 });

  await ctx.scheduler.runAfter(0, internal.calls.handleWebhook, { vectisCallId, runId });
  return Response.json({ ok: true });
});

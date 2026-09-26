import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";

export const DOGRAH_WEBHOOK_HEADER = "X-Dograh-Webhook-Secret";
export const MAX_DOGRAH_WEBHOOK_BYTES = 64 * 1024;
const MAX_CORRELATION_LENGTH = 256;

function constantTimeEqual(expected: string, provided: string) {
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(provided);
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) diff |= (a[i % (a.length || 1)] ?? 0) ^ (b[i % (b.length || 1)] ?? 0);
  return diff === 0;
}

async function boundedBody(request: Request) {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_DOGRAH_WEBHOOK_BYTES) throw new Error("too large");
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_DOGRAH_WEBHOOK_BYTES) throw new Error("too large");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function contextObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return object(JSON.parse(value)); } catch { throw new Error("invalid context"); }
  }
  return object(value);
}
function nonEmptyId(value: unknown, name: string) {
  const result = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!result || result.length > MAX_CORRELATION_LENGTH) throw new Error(`invalid ${name}`);
  return result;
}
function optionalUrl(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length > 2_048) throw new Error("invalid artifact reference");
  if (/^(javascript|data|file):/i.test(value)) throw new Error("invalid artifact reference");
  if (!/^(https?:\/\/[^\s]+|(?:recordings|transcripts)\/[^\s]+)$/i.test(value)) throw new Error("invalid artifact reference");
  return value;
}
function optionalNumber(value: unknown, name: string) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`invalid ${name}`);
  return number;
}
function timeValue(value: unknown, name: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return optionalNumber(value, name);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  throw new Error(`invalid ${name}`);
}

function parsePayload(payload: unknown) {
  const body = object(payload);
  const providerRunId = nonEmptyId(body.workflow_run_id ?? body.run_id, "workflow_run_id");
  const initialContext = contextObject(body.initial_context);
  const gatheredContext = contextObject(body.gathered_context);
  const extractedVariables = contextObject(body.extracted_variables);
  const workstationRunId = nonEmptyId(
    body.workstation_provider_run_id ?? body.workstation_run_id ?? body.workstationRunId ??
      initialContext.workstation_provider_run_id ?? initialContext.workstation_run_id ?? initialContext.workstationRunId,
    "workstationRunId",
  );
  const state = typeof body.state === "string" && body.state.trim() ? body.state.trim() : "completed";
  if (state.length > 64) throw new Error("invalid state");
  const context = { ...gatheredContext, ...extractedVariables };
  const callTime = timeValue(body.call_time, "call_time");
  const startedAt = timeValue(body.started_at, "started_at") ?? callTime;
  const endedAt = timeValue(body.ended_at, "ended_at");
  const durationMs = optionalNumber(body.duration_ms ?? body.duration, "durationMs");
  if (durationMs !== undefined && durationMs > 86_400_000) throw new Error("invalid durationMs");
  return {
    providerRunId,
    workstationRunId,
    state,
    gatheredContext: JSON.stringify({ ...context, initial_context: initialContext }),
    recordingUrl: optionalUrl(body.recording_url ?? body.recording),
    transcriptUrl: optionalUrl(body.transcript_url ?? body.transcript),
    startedAt,
    endedAt,
    durationMs,
    providerCampaignId: optionalNumber(body.campaign_id, "campaignId"),
    providerWorkflowId: optionalNumber(body.workflow_id, "workflowId"),
    callbackAt: callTime,
    sequenceNumber: optionalNumber(body.sequence_number, "sequenceNumber"),
  };
}

export const handle = httpAction(async (ctx, request) => {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const configured = process.env.DOGRAH_WEBHOOK_SECRET;
  if (!configured) return new Response("Webhook unavailable", { status: 503 });
  const provided = request.headers.get(DOGRAH_WEBHOOK_HEADER) ?? request.headers.get(DOGRAH_WEBHOOK_HEADER.toLowerCase()) ?? "";
  if (!constantTimeEqual(configured, provided)) return new Response("Unauthorized", { status: 401 });
  let body: string;
  try { body = await boundedBody(request); } catch { return new Response("Request too large", { status: 413 }); }
  if (!body) return new Response("Invalid payload", { status: 400 });
  let parsed: ReturnType<typeof parsePayload>;
  try {
    parsed = parsePayload(JSON.parse(body));
  } catch { return new Response("Invalid payload", { status: 400 }); }
  const run = await ctx.runQuery(internal.providerRuns.lookupByWorkstationId, { workstationRunId: parsed.workstationRunId });
  if (!run) return new Response("Unknown correlation", { status: 404 });
  try {
    const result = await ctx.runMutation(internal.dograhCallback.ingest, {
      organizationId: run.organizationId,
      workstationRunId: parsed.workstationRunId,
      providerRunId: parsed.providerRunId,
      campaignId: run.campaignId ?? undefined,
      customerId: run.customerId ?? undefined,
      direction: run.direction,
      state: parsed.state,
      gatheredContext: parsed.gatheredContext,
      recordingUrl: parsed.recordingUrl,
      transcriptUrl: parsed.transcriptUrl,
      durationMs: parsed.durationMs,
      providerCampaignId: parsed.providerCampaignId,
      providerWorkflowId: parsed.providerWorkflowId,
      startedAt: parsed.startedAt,
      endedAt: parsed.endedAt,
      callbackAt: parsed.callbackAt,
      sequenceNumber: parsed.sequenceNumber,
      now: Date.now(),
    });
    return Response.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/collision|mismatch|unknown|customer|correlation/i.test(message)) return new Response("Correlation rejected", { status: 409 });
    return new Response("Callback rejected", { status: 422 });
  }
});

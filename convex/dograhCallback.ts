import { internalMutation, type MutationCtx } from "./_generated/server";
import { v, type GenericId } from "convex/values";
import { appendEvent } from "./lib/events";
import { sanitizeDograhJson, normalizeDograhContext, outcomeIsHandoff } from "./lib/normalizeDograhOutcome";
import { oneByProviderRun, oneByWorkstation } from "./providerRuns";
import { projectOutcomeWorkItem } from "./workItems";
import { projectOutcomeAppointment } from "./appointments";
import { reserveDelivery } from "./deliveries";
import { findCampaignMember } from "./lib/lookup";

const TERMINAL_STATES = new Set(["completed", "complete", "ended", "failed", "cancelled", "canceled", "no_answer", "voicemail", "terminated"]);
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

function isTerminal(state: string) {
  return TERMINAL_STATES.has(state.trim().toLowerCase());
}
function assertTime(value: number | undefined, name: string) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`${name} is invalid`);
}
function assertDuration(value: number | undefined) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > MAX_DURATION_MS)) throw new Error("durationMs is invalid");
}

function assertArtifactReference(value: string | undefined) {
  if (value === undefined) return;
  if (value.length > 2_048 || /^(javascript|data|file):/i.test(value) || !/^(https?:\/\/[^\s]+|(?:recordings|transcripts)\/[^\s]+)$/i.test(value)) {
    throw new Error("Invalid artifact reference");
  }
}

export const ingest = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    workstationRunId: v.string(),
    providerRunId: v.string(),
    campaignId: v.optional(v.id("campaigns")),
    providerCampaignId: v.optional(v.number()),
    providerWorkflowId: v.optional(v.number()),
    customerId: v.optional(v.id("customers")),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    state: v.string(),
    gatheredContext: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
    transcriptUrl: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    callbackAt: v.optional(v.number()),
    sequenceNumber: v.optional(v.number()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    if (!args.providerRunId || args.providerRunId.length > 256 || args.workstationRunId.length > 256) throw new Error("Correlation identifier is invalid");
    if (!Number.isSafeInteger(args.now) || args.now <= 0) throw new Error("Invalid callback clock");
    assertTime(args.startedAt, "startedAt");
    assertTime(args.endedAt, "endedAt");
    assertDuration(args.durationMs);
    assertArtifactReference(args.recordingUrl);
    assertArtifactReference(args.transcriptUrl);
    const run = await oneByWorkstation(ctx, args.workstationRunId);
    if (!run) throw new Error("Unknown workstation run");
    if (run.organizationId !== args.organizationId || run.direction !== args.direction) throw new Error("Callback correlation mismatch");
    if (args.campaignId !== undefined && run.campaignId !== args.campaignId) throw new Error("Callback campaign mismatch");
    if (args.providerCampaignId !== undefined && run.providerCampaignId !== undefined && args.providerCampaignId !== run.providerCampaignId) throw new Error("Callback provider campaign mismatch");
    if (args.providerWorkflowId !== undefined && run.providerWorkflowId !== undefined && args.providerWorkflowId !== run.providerWorkflowId) throw new Error("Callback provider workflow mismatch");
    if (args.customerId !== undefined && run.customerId !== args.customerId) throw new Error("Callback customer mismatch");
    const byProvider = await oneByProviderRun(ctx, args.providerRunId);
    if (byProvider && byProvider._id !== run._id) throw new Error("Provider run correlation collision");
    if (run.providerRunId && run.providerRunId !== args.providerRunId) throw new Error("Provider run correlation collision");

    const callbackAt = args.callbackAt ?? args.now;
    assertTime(callbackAt, "callbackAt");
    if (run.lastCallbackAt !== undefined && callbackAt < run.lastCallbackAt) return { replayed: true, stale: true, providerRunId: run._id, outcomeId: run.outcomeId };
    if (run.lastSequenceNumber !== undefined && args.sequenceNumber !== undefined && args.sequenceNumber < run.lastSequenceNumber) {
      return { replayed: true, stale: true, providerRunId: run._id, outcomeId: run.outcomeId };
    }
    if (run.outcomeId || (run.terminalAt !== undefined && isTerminal(run.state))) {
      return { replayed: true, stale: true, providerRunId: run._id, outcomeId: run.outcomeId };
    }

    const rawObject = parseRawContext(args.gatheredContext);
    const rawContext = sanitizeDograhJson(rawObject);
    const state = args.state.trim().toLowerCase();
    const patch: Record<string, unknown> = {
      providerRunId: args.providerRunId,
      state: args.state,
      rawContext,
      rawContextVersion: 1,
      lastCallbackAt: callbackAt,
      updatedAt: args.now,
    };
    if (args.sequenceNumber !== undefined) patch.lastSequenceNumber = args.sequenceNumber;
    if (args.recordingUrl !== undefined) patch.recordingUrl = args.recordingUrl;
    if (args.transcriptUrl !== undefined) patch.transcriptUrl = args.transcriptUrl;
    if (args.startedAt !== undefined) patch.startedAt = args.startedAt;
    if (args.endedAt !== undefined) patch.endedAt = args.endedAt;
    if (args.durationMs !== undefined) patch.durationMs = args.durationMs;

    if (!isTerminal(state)) {
      await ctx.db.patch(run._id, patch);
      await syncCampaignMember(ctx, run.organizationId, run.campaignId, run.customerId, args.providerRunId, args.callbackAt ?? args.now, false, state);
      return { replayed: false, terminal: false, providerRunId: run._id };
    }

    const customerId = run.customerId ?? args.customerId;
    if (!customerId) throw new Error("Callback has no pre-registered customer");
    const customer = await ctx.db.get(customerId);
    if (!customer || customer.organizationId !== args.organizationId || customer.mergedInto) throw new Error("Callback customer does not belong to organization");
    const normalized = normalizeDograhContext(rawObject);
    const conversationId = await upsertConversation(ctx, args.organizationId, customerId, args.direction, args.startedAt ?? args.now, normalized.fields.summary);
    const outcomeId = await ctx.db.insert("callOutcomes", {
      organizationId: args.organizationId,
      providerRunId: args.providerRunId,
      customerId,
      conversationId,
      version: normalized.version,
      outcomeType: normalized.outcomeType,
      fields: normalized.fields,
      customFields: normalized.customFields.length > 0 ? normalized.customFields : undefined,
      createdAt: args.now,
    });
    const interactionId = await ctx.db.insert("interactions", {
      organizationId: args.organizationId,
      conversationId,
      customerId,
      providerRunId: args.providerRunId,
      direction: args.direction,
      at: args.startedAt ?? args.now,
      durationMs: args.durationMs,
      summary: normalized.fields.summary,
      outcomeId,
      recordingUrl: args.recordingUrl,
      transcriptUrl: args.transcriptUrl,
    });
    await ctx.db.patch(outcomeId, { interactionId });
    patch.outcomeId = outcomeId;
    patch.terminalAt = args.endedAt ?? args.now;
    patch.endedAt = args.endedAt ?? args.now;
    await ctx.db.patch(run._id, patch);
    await syncCampaignMember(ctx, run.organizationId, run.campaignId, customerId, args.providerRunId, args.callbackAt ?? args.now, true, state);

    await appendEvent(ctx, {
      organizationId: args.organizationId,
      type: "dograh.callback",
      targetType: "providerRuns",
      targetId: run._id,
      correlationId: args.providerRunId,
      payload: JSON.stringify({ outcomeType: normalized.outcomeType, interactionId }),
    });
    await projectOutcomeWorkItem(ctx, { organizationId: args.organizationId, outcomeId, now: args.now });
    await projectOutcomeAppointment(ctx, { organizationId: args.organizationId, outcomeId, now: args.now });
    await reserveDelivery(ctx, {
      organizationId: args.organizationId,
      idempotencyKey: `dograh-callback:${args.providerRunId}`,
      target: "twenty_note",
      payload: JSON.stringify({ customerId, providerRunId: args.providerRunId, summary: normalized.fields.summary ?? "", outcomeType: normalized.outcomeType }),
      providerRunId: args.providerRunId,
      customerId,
      now: args.now,
    });
    return { replayed: false, terminal: true, providerRunId: run._id, outcomeId, handoff: outcomeIsHandoff(normalized.outcomeType) };
  },
});

async function syncCampaignMember(
  ctx: MutationCtx,
  organizationId: GenericId<"organizations">,
  campaignId: GenericId<"campaigns"> | undefined,
  customerId: GenericId<"customers"> | undefined,
  providerRunId: string,
  callbackAt: number,
  terminal: boolean,
  state: string,
) {
  if (!campaignId || !customerId) return;
  const member = await findCampaignMember(ctx, organizationId, campaignId, customerId);
  if (!member || (member.lastCallbackAt !== undefined && callbackAt < member.lastCallbackAt)) return;
  await ctx.db.patch(member._id, {
    providerRunId,
    dograhProviderRunId: providerRunId,
    lastCallbackAt: callbackAt,
    callDisposition: terminal ? state.trim().toLowerCase() : "in_progress",
    status: terminal ? "processed" : "called",
    updatedAt: callbackAt,
  });
}

function parseRawContext(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("context must be an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Invalid gathered context");
  }
}

async function upsertConversation(
  ctx: MutationCtx,
  organizationId: GenericId<"organizations">,
  customerId: GenericId<"customers">,
  direction: "inbound" | "outbound",
  startedAt: number,
  summary?: string,
) {
  const rows = await ctx.db.query("conversations")
    .withIndex("by_organization_customer_time", (q) => q.eq("organizationId", organizationId).eq("customerId", customerId))
    .order("desc").take(2);
  const existing = rows.find((row) => row.direction === direction);
  if (existing) {
    await ctx.db.patch(existing._id, { lastActivityAt: startedAt, lastSummary: summary ?? existing.lastSummary });
    return existing._id;
  }
  return ctx.db.insert("conversations", { organizationId, customerId, channel: "voice", direction, startedAt, lastActivityAt: startedAt, lastSummary: summary });
}


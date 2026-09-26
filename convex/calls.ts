import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { requireMembership } from "./lib/auth";
import { buildCampaignCsv } from "./lib/campaignCsv";
import { mapDograhRun, type CallResult } from "./lib/callResult";
import { crmNoteMarkdown, crmNoteTitle } from "./lib/crmNote";
import { DograhAmbiguousError } from "./lib/dograhAdapter";
import {
  defaultLeadAgentWorkflowId,
  dograhClient,
  integrationStatus,
  quickCallAgent,
  twentyClient,
} from "./lib/integrations";
import { normalizePhone } from "./lib/phone";
import { findWorkspaceConfig } from "./workspace";

const MAX_BRIEF = 2000;
const MAX_BATCH = 500;
const CALL_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const CRM_CLAIM_MS = 2 * 60 * 1000;
const COUNT_CAP = 10_000;

type CallDoc = Doc<"calls">;
const isTerminal = (status: CallDoc["status"]) => status === "completed" || status === "no_answer" || status === "failed";

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

// ---------------------------------------------------------------------------
// Owner actions
// ---------------------------------------------------------------------------

/** "Call this number and ask these questions" — one outbound call with a custom brief. */
export const startQuickCall = mutation({
  args: { phone: v.string(), contactName: v.optional(v.string()), brief: v.string() },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireMembership(ctx, "operator");
    const phone = normalizePhone(args.phone);
    if (!phone) throw new Error("Enter a valid phone number with country code, e.g. +91 98765 43210");
    const brief = args.brief.trim();
    if (brief.length < 5) throw new Error("Describe what the agent should ask (at least a few words)");
    if (brief.length > MAX_BRIEF) throw new Error(`Keep the brief under ${MAX_BRIEF} characters`);
    const { workflowId } = quickCallAgent();
    const lead = await ctx.db
      .query("leads")
      .withIndex("by_organization_phone", (q) => q.eq("organizationId", organizationId).eq("phone", phone))
      .first();
    const now = Date.now();
    const callId = await ctx.db.insert("calls", {
      organizationId,
      kind: "quick",
      leadId: lead?._id,
      phone,
      contactName: args.contactName?.trim().slice(0, 120) || lead?.name,
      brief,
      agentWorkflowId: workflowId,
      status: "queued",
      crmStatus: "pending",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
      pollCount: 0,
    });
    await ctx.scheduler.runAfter(0, internal.calls.dispatchQuickCall, { callId });
    return callId;
  },
});

/** Send selected leads (or every remaining lead) to Dograh as one campaign. */
export const callLeads = mutation({
  args: { leadIds: v.optional(v.array(v.id("leads"))), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireMembership(ctx, "operator");
    const config = await findWorkspaceConfig(ctx, organizationId);
    const agentWorkflowId = config?.leadAgentWorkflowId ?? defaultLeadAgentWorkflowId();
    if (!agentWorkflowId) throw new Error("Choose the agent that calls your leads in Settings first");

    let leads: Doc<"leads">[] = [];
    if (args.leadIds) {
      if (args.leadIds.length > MAX_BATCH) throw new Error(`Call at most ${MAX_BATCH} leads at a time`);
      for (const leadId of new Set(args.leadIds)) {
        const lead = await ctx.db.get(leadId);
        if (lead && lead.organizationId === organizationId && (lead.status === "new" || lead.status === "failed")) leads.push(lead);
      }
    } else {
      leads = await ctx.db
        .query("leads")
        .withIndex("by_organization_status", (q) => q.eq("organizationId", organizationId).eq("status", "new"))
        .take(MAX_BATCH);
      if (leads.length < MAX_BATCH) {
        const retry = await ctx.db
          .query("leads")
          .withIndex("by_organization_status", (q) => q.eq("organizationId", organizationId).eq("status", "failed"))
          .take(MAX_BATCH - leads.length);
        leads.push(...retry);
      }
    }
    if (leads.length === 0) throw new Error("No leads left to call");

    const now = Date.now();
    const name = args.name?.trim().slice(0, 120) || `Lead calls ${new Date(now).toISOString().slice(0, 16).replace("T", " ")}`;
    const batchId = await ctx.db.insert("callBatches", {
      organizationId,
      name,
      agentWorkflowId,
      status: "creating",
      totalCalls: leads.length,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    for (const lead of leads) {
      await ctx.db.insert("calls", {
        organizationId,
        kind: "campaign",
        leadId: lead._id,
        batchId,
        phone: lead.phone,
        contactName: lead.name,
        agentWorkflowId,
        status: "queued",
        crmStatus: "pending",
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
        pollCount: 0,
      });
      await ctx.db.patch(lead._id, { status: "queued", updatedAt: now });
    }
    await ctx.scheduler.runAfter(0, internal.calls.dispatchBatch, { batchId });
    return { batchId, count: leads.length };
  },
});

export const retryCrmSync = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMembership(ctx, "operator");
    const call = await ctx.db.get(args.callId);
    if (!call || call.organizationId !== organizationId) throw new Error("Call not found");
    if (!isTerminal(call.status)) throw new Error("The call has not finished yet");
    if (call.crmStatus === "synced") return;
    await ctx.db.patch(call._id, { crmStatus: "pending", crmError: undefined, crmClaimedAt: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.calls.syncToCrm, { callId: call._id });
  },
});

/** Ask Dograh for the latest state of a call right now instead of waiting for the next poll. */
export const refreshNow = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMembership(ctx);
    const call = await ctx.db.get(args.callId);
    if (!call || call.organizationId !== organizationId) throw new Error("Call not found");
    if (!isTerminal(call.status)) await ctx.scheduler.runAfter(0, internal.calls.pollActiveCalls, {});
  },
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    const { organizationId } = await requireMembership(ctx);
    const leadCounts = { new: 0, queued: 0, called: 0, failed: 0 };
    for (const status of Object.keys(leadCounts) as (keyof typeof leadCounts)[]) {
      leadCounts[status] = (
        await ctx.db
          .query("leads")
          .withIndex("by_organization_status", (q) => q.eq("organizationId", organizationId).eq("status", status))
          .take(COUNT_CAP)
      ).length;
    }
    const callCounts = { queued: 0, in_progress: 0, completed: 0, no_answer: 0, failed: 0 };
    for (const status of Object.keys(callCounts) as (keyof typeof callCounts)[]) {
      callCounts[status] = (
        await ctx.db
          .query("calls")
          .withIndex("by_organization_status", (q) => q.eq("organizationId", organizationId).eq("status", status))
          .take(COUNT_CAP)
      ).length;
    }
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const last24h = (
      await ctx.db
        .query("calls")
        .withIndex("by_organization_created", (q) => q.eq("organizationId", organizationId).gte("createdAt", since))
        .take(COUNT_CAP)
    ).length;
    const recentCalls = await ctx.db
      .query("calls")
      .withIndex("by_organization_created", (q) => q.eq("organizationId", organizationId))
      .order("desc")
      .take(8);
    const followUps = (
      await ctx.db
        .query("calls")
        .withIndex("by_organization_status", (q) => q.eq("organizationId", organizationId).eq("status", "completed"))
        .take(COUNT_CAP)
    ).filter((call) => call.followUpRequired).length;
    return {
      leads: {
        ...leadCounts,
        total: leadCounts.new + leadCounts.queued + leadCounts.called + leadCounts.failed,
        remaining: leadCounts.new + leadCounts.failed,
      },
      calls: { ...callCounts, last24h, followUps },
      recentCalls,
      integrations: integrationStatus(),
    };
  },
});

/** Calling-console analytics. These facts come from the same calls shown in Dashboard and Calls. */
export const callingAnalytics = query({
  args: { startAt: v.number(), endAt: v.number() },
  handler: async (ctx, { startAt, endAt }) => {
    const { organizationId } = await requireMembership(ctx);
    const span = endAt - startAt;
    if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt) || startAt < 0 || span <= 0 || span > 90 * 24 * 60 * 60 * 1000) {
      throw new Error("Analytics range must be between 1 and 90 days");
    }

    const rows = await ctx.db
      .query("calls")
      .withIndex("by_organization_created", (q) =>
        q.eq("organizationId", organizationId).gte("createdAt", startAt).lt("createdAt", endAt),
      )
      .take(COUNT_CAP + 1);
    if (rows.length > COUNT_CAP) throw new Error("Too many calls in this range. Choose a shorter period.");

    const status = { queued: 0, in_progress: 0, completed: 0, no_answer: 0, failed: 0 };
    const crm = { pending: 0, synced: 0, failed: 0, skipped: 0 };
    const kind = { quick: 0, campaign: 0 };
    const bucketCount = span <= 8 * 24 * 60 * 60 * 1000 ? 7 : span <= 31 * 24 * 60 * 60 * 1000 ? 5 : 9;
    const bucketWidth = span / bucketCount;
    const activity = Array.from({ length: bucketCount }, (_, index) => ({
      startAt: Math.round(startAt + index * bucketWidth),
      endAt: Math.round(index === bucketCount - 1 ? endAt : startAt + (index + 1) * bucketWidth),
      calls: 0,
      completed: 0,
    }));
    let followUps = 0;
    let totalDurationSeconds = 0;
    let timedCalls = 0;
    for (const row of rows) {
      status[row.status] += 1;
      crm[row.crmStatus] += 1;
      kind[row.kind] += 1;
      if (row.followUpRequired) followUps += 1;
      if (row.status === "completed" && row.durationSeconds !== undefined) {
        totalDurationSeconds += row.durationSeconds;
        timedCalls += 1;
      }
      const index = Math.min(bucketCount - 1, Math.floor((row.createdAt - startAt) / bucketWidth));
      activity[index].calls += 1;
      if (row.status === "completed") activity[index].completed += 1;
    }
    const finished = status.completed + status.no_answer + status.failed;
    return {
      totalCalls: rows.length,
      status,
      crm,
      kind,
      followUps,
      completionRate: finished > 0 ? Math.round((status.completed / finished) * 100) : null,
      averageDurationSeconds: timedCalls > 0 ? Math.round(totalDurationSeconds / timedCalls) : null,
      activity,
    };
  },
});

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMembership(ctx);
    return ctx.db
      .query("calls")
      .withIndex("by_organization_created", (q) => q.eq("organizationId", organizationId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const get = query({
  args: { callId: v.string() },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMembership(ctx);
    const callId = ctx.db.normalizeId("calls", args.callId);
    if (!callId) return null;
    const call = await ctx.db.get(callId);
    if (!call || call.organizationId !== organizationId) return null;
    const lead = call.leadId ? await ctx.db.get(call.leadId) : null;
    const batch = call.batchId ? await ctx.db.get(call.batchId) : null;
    return { call, lead, batch };
  },
});

export const batches = query({
  args: {},
  handler: async (ctx) => {
    const { organizationId } = await requireMembership(ctx);
    const rows = await ctx.db
      .query("callBatches")
      .withIndex("by_organization_created", (q) => q.eq("organizationId", organizationId))
      .order("desc")
      .take(20);
    return Promise.all(
      rows.map(async (batch) => {
        const calls = await ctx.db.query("calls").withIndex("by_batch", (q) => q.eq("batchId", batch._id)).take(MAX_BATCH);
        const done = calls.filter((call) => isTerminal(call.status)).length;
        const reached = calls.filter((call) => call.status === "completed").length;
        return { ...batch, done, reached };
      }),
    );
  },
});

// ---------------------------------------------------------------------------
// Dispatch (internal)
// ---------------------------------------------------------------------------

export const quickCallForDispatch = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) return null;
    const config = await findWorkspaceConfig(ctx, call.organizationId);
    return { call, businessName: config?.businessName ?? "our business" };
  },
});

export const dispatchQuickCall = internalAction({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.calls.quickCallForDispatch, args);
    if (!data || data.call.status !== "queued" || data.call.dograhRunId) return;
    const { call, businessName } = data;
    try {
      const { triggerPath } = quickCallAgent();
      const result = await dograhClient().triggerCall({
        triggerPath,
        phoneNumber: call.phone,
        initialContext: {
          vectis_call_id: call._id,
          business_name: businessName,
          contact_name: call.contactName ?? "",
          first_name: call.contactName?.split(/\s+/)[0] ?? "",
          call_brief: call.brief ?? "",
        },
      });
      await ctx.runMutation(internal.calls.markDispatched, { callId: call._id, runId: result.runId, runName: result.runName });
    } catch (error) {
      if (error instanceof DograhAmbiguousError) {
        // The call may have been placed; polling reconciles it by vectis_call_id.
        await ctx.runMutation(internal.calls.markDispatched, { callId: call._id });
        return;
      }
      await ctx.runMutation(internal.calls.markFailed, { callId: call._id, error: message(error) });
    }
  },
});

export const markDispatched = internalMutation({
  args: { callId: v.id("calls"), runId: v.optional(v.number()), runName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call || isTerminal(call.status)) return;
    const now = Date.now();
    await ctx.db.patch(call._id, {
      status: "in_progress",
      dograhRunId: args.runId ?? call.dograhRunId,
      dograhRunName: args.runName ?? call.dograhRunName,
      startedAt: call.startedAt ?? now,
      updatedAt: now,
    });
  },
});

export const markFailed = internalMutation({
  args: { callId: v.id("calls"), error: v.string() },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call || isTerminal(call.status)) return;
    const now = Date.now();
    await ctx.db.patch(call._id, { status: "failed", error: args.error, crmStatus: "skipped", completedAt: now, updatedAt: now });
    await settleLead(ctx, call, "failed", "Call failed", now);
    if (call.batchId) await settleBatchIfDone(ctx, call.batchId);
  },
});

export const batchForDispatch = internalQuery({
  args: { batchId: v.id("callBatches") },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) return null;
    const config = await findWorkspaceConfig(ctx, batch.organizationId);
    const calls = await ctx.db.query("calls").withIndex("by_batch", (q) => q.eq("batchId", batch._id)).take(MAX_BATCH);
    const rows = await Promise.all(
      calls.map(async (call) => {
        const lead = call.leadId ? await ctx.db.get(call.leadId) : null;
        return { callId: call._id as string, phone: call.phone, name: call.contactName, email: lead?.email };
      }),
    );
    return { batch, rows, businessName: config?.businessName ?? "our business" };
  },
});

export const dispatchBatch = internalAction({
  args: { batchId: v.id("callBatches") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.calls.batchForDispatch, args);
    if (!data || data.batch.status !== "creating") return;
    const dograh = dograhClient();
    let campaignId = data.batch.dograhCampaignId;
    try {
      if (!campaignId) {
        const csv = buildCampaignCsv(data.rows, data.businessName);
        const { uploadUrl, fileKey } = await dograh.requestUploadUrl({
          fileName: `vectis-${args.batchId}.csv`,
          fileSize: new TextEncoder().encode(csv).byteLength,
        });
        await dograh.uploadCsv(uploadUrl, csv);
        const created = await dograh.create({ name: data.batch.name, workflowId: data.batch.agentWorkflowId, fileKey });
        campaignId = created.campaignId;
        await ctx.runMutation(internal.calls.batchCreated, { batchId: args.batchId, campaignId });
      }
      await dograh.start(campaignId);
      await ctx.runMutation(internal.calls.batchStarted, { batchId: args.batchId });
    } catch (error) {
      if (campaignId && error instanceof DograhAmbiguousError) {
        // Start may have succeeded; the poller reconciles runs against the campaign.
        await ctx.runMutation(internal.calls.batchStarted, { batchId: args.batchId });
        return;
      }
      await ctx.runMutation(internal.calls.batchFailed, { batchId: args.batchId, error: message(error) });
    }
  },
});

export const batchCreated = internalMutation({
  args: { batchId: v.id("callBatches"), campaignId: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.batchId, { dograhCampaignId: args.campaignId, updatedAt: Date.now() });
  },
});

export const batchStarted = internalMutation({
  args: { batchId: v.id("callBatches") },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.status !== "creating") return;
    const now = Date.now();
    await ctx.db.patch(batch._id, { status: "running", updatedAt: now });
    const calls = await ctx.db.query("calls").withIndex("by_batch", (q) => q.eq("batchId", batch._id)).take(MAX_BATCH);
    for (const call of calls) {
      if (call.status === "queued") await ctx.db.patch(call._id, { status: "in_progress", startedAt: now, updatedAt: now });
    }
  },
});

export const batchFailed = internalMutation({
  args: { batchId: v.id("callBatches"), error: v.string() },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) return;
    const now = Date.now();
    await ctx.db.patch(batch._id, { status: "failed", error: args.error, updatedAt: now });
    const calls = await ctx.db.query("calls").withIndex("by_batch", (q) => q.eq("batchId", batch._id)).take(MAX_BATCH);
    for (const call of calls) {
      if (isTerminal(call.status) || call.dograhRunId) continue;
      await ctx.db.patch(call._id, { status: "failed", error: `Could not start calls: ${args.error}`, crmStatus: "skipped", completedAt: now, updatedAt: now });
      const lead = call.leadId ? await ctx.db.get(call.leadId) : null;
      // Nothing was dialed: put the lead back where it was.
      if (lead && lead.status === "queued") await ctx.db.patch(lead._id, { status: lead.attempts > 0 ? "failed" : "new", updatedAt: now });
    }
  },
});

// ---------------------------------------------------------------------------
// Results: webhook + polling converge on applyResult
// ---------------------------------------------------------------------------

export const activeCalls = internalQuery({
  args: {},
  handler: async (ctx) => {
    const queued = await ctx.db.query("calls").withIndex("by_status_updated", (q) => q.eq("status", "queued")).take(100);
    const running = await ctx.db.query("calls").withIndex("by_status_updated", (q) => q.eq("status", "in_progress")).take(200);
    const batches = new Map<Id<"callBatches">, Doc<"callBatches">>();
    for (const call of running) {
      if (call.batchId && !batches.has(call.batchId)) {
        const batch = await ctx.db.get(call.batchId);
        if (batch) batches.set(batch._id, batch);
      }
    }
    return { queued, running, batches: [...batches.values()] };
  },
});

export const attachRun = internalMutation({
  args: { callId: v.id("calls"), runId: v.number(), runName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call || call.dograhRunId) return;
    await ctx.db.patch(call._id, { dograhRunId: args.runId, dograhRunName: args.runName, updatedAt: Date.now() });
  },
});

export const touch = internalMutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call || isTerminal(call.status)) return;
    await ctx.db.patch(call._id, { pollCount: call.pollCount + 1, updatedAt: Date.now() });
  },
});

const resultValidator = {
  status: v.union(v.literal("completed"), v.literal("no_answer"), v.literal("failed")),
  disposition: v.optional(v.string()),
  durationSeconds: v.optional(v.number()),
  summary: v.optional(v.string()),
  answers: v.optional(v.string()),
  followUpRequired: v.optional(v.boolean()),
  extracted: v.optional(v.string()),
  recordingUrl: v.optional(v.string()),
  transcriptUrl: v.optional(v.string()),
  error: v.optional(v.string()),
  transcript: v.optional(v.string()),
};

export const applyResult = internalMutation({
  args: { callId: v.id("calls"), ...resultValidator },
  handler: async (ctx, { callId, ...result }) => {
    const call = await ctx.db.get(callId);
    if (!call || isTerminal(call.status)) return; // idempotent: webhook and poller may both deliver
    const now = Date.now();
    const config = await findWorkspaceConfig(ctx, call.organizationId);
    const crmEnabled = (config?.crmSyncEnabled ?? true) && integrationStatus().twenty;
    await ctx.db.patch(call._id, { ...result, crmStatus: crmEnabled ? "pending" : "skipped", completedAt: now, updatedAt: now });
    const outcome = result.status === "completed" ? "called" : "failed";
    await settleLead(ctx, call, outcome, result.disposition ?? result.status, now);
    if (call.batchId) await settleBatchIfDone(ctx, call.batchId);
    if (crmEnabled) await ctx.scheduler.runAfter(0, internal.calls.syncToCrm, { callId });
  },
});

async function settleLead(ctx: MutationCtx, call: CallDoc, outcome: "called" | "failed", lastOutcome: string, now: number) {
  if (!call.leadId) return;
  const lead = await ctx.db.get(call.leadId);
  if (!lead) return;
  // A quick call never downgrades a lead that already had a real conversation.
  const status = call.kind === "quick" && lead.status === "called" ? "called" : call.kind === "quick" && lead.status === "queued" ? "queued" : outcome;
  await ctx.db.patch(lead._id, {
    status,
    attempts: lead.attempts + 1,
    lastCallId: call._id,
    lastOutcome,
    lastCalledAt: now,
    updatedAt: now,
  });
}

async function settleBatchIfDone(ctx: MutationCtx, batchId: Id<"callBatches">) {
  const batch = await ctx.db.get(batchId);
  if (!batch || batch.status === "completed" || batch.status === "failed") return;
  const calls = await ctx.db.query("calls").withIndex("by_batch", (q) => q.eq("batchId", batchId)).take(MAX_BATCH);
  if (calls.every((call) => isTerminal(call.status))) {
    await ctx.db.patch(batchId, { status: "completed", updatedAt: Date.now() });
  }
}

function contextOf(run: Record<string, unknown>): Record<string, unknown> {
  const value = run.initial_context ?? run.context_variables;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function runIdOf(run: Record<string, unknown>): number | undefined {
  const value = run.id ?? run.workflow_run_id ?? run.run_id;
  return typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : undefined;
}

function runPhone(run: Record<string, unknown>): string | undefined {
  const context = contextOf(run);
  const value = run.called_number ?? run.phone_number ?? context.phone_number ?? context.called_number;
  return typeof value === "string" ? normalizePhone(value) ?? undefined : undefined;
}

async function refreshCall(ctx: ActionCtx, call: CallDoc) {
  if (!call.dograhRunId) return;
  const dograh = dograhClient();
  const run = await dograh.getRun(call.agentWorkflowId, call.dograhRunId);
  const result: CallResult = mapDograhRun(run);
  if (result.status === "in_progress") {
    if (Date.now() - call.createdAt > CALL_TIMEOUT_MS) {
      await ctx.runMutation(internal.calls.markFailed, { callId: call._id, error: "No result from Dograh after 3 hours" });
    } else {
      await ctx.runMutation(internal.calls.touch, { callId: call._id });
    }
    return;
  }
  const transcript = result.transcriptUrl ? await dograh.fetchPublicText(result.transcriptUrl) : undefined;
  await ctx.runMutation(internal.calls.applyResult, { callId: call._id, ...result, status: result.status, transcript });
}

/** Cron + on-demand reconciliation: attach Dograh runs to calls and pull results. */
export const pollActiveCalls = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!integrationStatus().dograh) return;
    const { queued, running, batches }: { queued: CallDoc[]; running: CallDoc[]; batches: Doc<"callBatches">[] } =
      await ctx.runQuery(internal.calls.activeCalls, {});
    const dograh = dograhClient();
    const now = Date.now();

    // Queued quick calls that never dispatched (e.g. action crash) get another attempt.
    for (const call of queued) {
      if (call.kind === "quick" && now - call.updatedAt > 60_000) {
        await ctx.runAction(internal.calls.dispatchQuickCall, { callId: call._id });
      }
    }

    // Campaign calls: find each call's Dograh run inside its campaign.
    for (const batch of batches) {
      if (!batch.dograhCampaignId) continue;
      const pending = running.filter((call) => call.batchId === batch._id && !call.dograhRunId);
      if (pending.length === 0) continue;
      try {
        const byCallId = new Map<string, Record<string, unknown>>();
        const byPhone = new Map<string, Record<string, unknown>>();
        for (let page = 1; page <= 10; page += 1) {
          const { runs, totalPages } = await dograh.campaignRuns(batch.dograhCampaignId, page);
          for (const run of runs) {
            const callId = contextOf(run).vectis_call_id;
            if (typeof callId === "string") byCallId.set(callId, run);
            const phone = runPhone(run);
            if (phone) byPhone.set(phone, run);
          }
          if (page >= totalPages) break;
        }
        for (const call of pending) {
          const run = byCallId.get(call._id) ?? byPhone.get(call.phone);
          const runId = run ? runIdOf(run) : undefined;
          if (run && runId) {
            await ctx.runMutation(internal.calls.attachRun, { callId: call._id, runId, runName: typeof run.name === "string" ? run.name : undefined });
            call.dograhRunId = runId;
          }
        }
        const campaign = await dograh.get(batch.dograhCampaignId);
        if (["completed", "failed", "cancelled"].includes(campaign.state)) {
          for (const call of pending) {
            if (!call.dograhRunId) {
              await ctx.runMutation(internal.calls.markFailed, { callId: call._id, error: `Dograh finished the campaign without calling this number (${campaign.state})` });
            }
          }
        }
      } catch (error) {
        console.error(`campaign ${batch.dograhCampaignId} reconciliation failed: ${message(error)}`);
      }
    }

    // Quick calls whose trigger response did not include a run id.
    const orphanQuick = running.filter((call) => call.kind === "quick" && !call.dograhRunId);
    if (orphanQuick.length > 0) {
      const workflowIds = [...new Set(orphanQuick.map((call) => call.agentWorkflowId))];
      for (const workflowId of workflowIds) {
        try {
          const runs = await dograh.listWorkflowRuns(workflowId, 50);
          for (const call of orphanQuick.filter((c) => c.agentWorkflowId === workflowId)) {
            const run = runs.find((r) => contextOf(r).vectis_call_id === call._id);
            const runId = run ? runIdOf(run) : undefined;
            if (runId) {
              await ctx.runMutation(internal.calls.attachRun, { callId: call._id, runId, runName: typeof run?.name === "string" ? run.name : undefined });
              call.dograhRunId = runId;
            } else if (now - call.createdAt > 15 * 60_000) {
              await ctx.runMutation(internal.calls.markFailed, { callId: call._id, error: "Dograh never started this call" });
            }
          }
        } catch (error) {
          console.error(`workflow ${workflowId} run lookup failed: ${message(error)}`);
        }
      }
    }

    for (const call of running) {
      if (!call.dograhRunId) continue;
      try {
        await refreshCall(ctx, call);
      } catch (error) {
        console.error(`refresh of call ${call._id} failed: ${message(error)}`);
      }
    }
  },
});

export const findForWebhook = internalQuery({
  args: { vectisCallId: v.optional(v.string()), runId: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const callId = args.vectisCallId ? ctx.db.normalizeId("calls", args.vectisCallId) : null;
    if (callId) return ctx.db.get(callId);
    if (args.runId === undefined) return null;
    const runId = args.runId;
    return ctx.db.query("calls").withIndex("by_dograh_run", (q) => q.eq("dograhRunId", runId)).first();
  },
});

/** Dograh's post-call Webhook node landed: fetch the authoritative run and apply it. */
export const handleWebhook = internalAction({
  args: { vectisCallId: v.optional(v.string()), runId: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const call: CallDoc | null = await ctx.runQuery(internal.calls.findForWebhook, args);
    if (!call || isTerminal(call.status)) return;
    if (!call.dograhRunId && args.runId !== undefined) {
      await ctx.runMutation(internal.calls.attachRun, { callId: call._id, runId: args.runId });
      call.dograhRunId = args.runId;
    }
    await refreshCall(ctx, call);
  },
});

// ---------------------------------------------------------------------------
// Twenty CRM sync
// ---------------------------------------------------------------------------

export const claimCrm = internalMutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call || !isTerminal(call.status) || call.crmStatus !== "pending" || call.crmNoteId) return null;
    const now = Date.now();
    if (call.crmClaimedAt && now - call.crmClaimedAt < CRM_CLAIM_MS) return null;
    await ctx.db.patch(call._id, { crmClaimedAt: now });
    const lead = call.leadId ? await ctx.db.get(call.leadId) : null;
    const config = await findWorkspaceConfig(ctx, call.organizationId);
    return { call, lead, businessName: config?.businessName ?? "our business" };
  },
});

export const crmFinished = internalMutation({
  args: {
    callId: v.id("calls"),
    personId: v.optional(v.string()),
    noteId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const call = await ctx.db.get(args.callId);
    if (!call) return;
    const now = Date.now();
    if (args.error) {
      // Keep a created person id so a retry attaches to it instead of duplicating the contact.
      await ctx.db.patch(call._id, { crmStatus: "failed", crmError: args.error, crmPersonId: args.personId ?? call.crmPersonId, crmClaimedAt: undefined, updatedAt: now });
      return;
    }
    await ctx.db.patch(call._id, {
      crmStatus: "synced",
      crmError: undefined,
      crmPersonId: args.personId,
      crmNoteId: args.noteId,
      crmClaimedAt: undefined,
      updatedAt: now,
    });
    if (call.leadId && args.personId) {
      const lead = await ctx.db.get(call.leadId);
      if (lead && !lead.twentyPersonId) await ctx.db.patch(lead._id, { twentyPersonId: args.personId, updatedAt: now });
    }
  },
});

export const syncToCrm = internalAction({
  args: { callId: v.id("calls") },
  handler: async (ctx, args) => {
    const claim = await ctx.runMutation(internal.calls.claimCrm, args);
    if (!claim) return;
    const { call, lead, businessName } = claim;
    const client = twentyClient();
    if (!client) {
      await ctx.runMutation(internal.calls.crmFinished, { callId: call._id, error: "Twenty CRM is not connected" });
      return;
    }
    let personId = call.crmPersonId ?? lead?.twentyPersonId;
    try {
      if (!personId) {
        const person = await client.upsertPerson({ name: call.contactName ?? lead?.name ?? "Unknown caller", phone: call.phone, email: lead?.email });
        personId = person.id;
      }
      const note = {
        kind: call.kind,
        status: call.status,
        disposition: call.disposition,
        contactName: call.contactName,
        phone: call.phone,
        brief: call.brief,
        summary: call.summary,
        answers: call.answers,
        extracted: call.extracted,
        durationSeconds: call.durationSeconds,
        recordingUrl: call.recordingUrl,
        transcriptUrl: call.transcriptUrl,
        transcript: call.transcript,
        completedAt: call.completedAt,
        businessName,
      };
      const noteId = await client.createNoteForPerson(personId, crmNoteTitle(note), crmNoteMarkdown(note));
      if (call.followUpRequired) {
        await client.createTaskForPerson(
          personId,
          `Follow up with ${call.contactName ?? call.phone}`,
          `Vectis flagged this call for follow-up.\n\n${call.summary ?? ""}`,
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        );
      }
      await ctx.runMutation(internal.calls.crmFinished, { callId: call._id, personId, noteId });
    } catch (error) {
      await ctx.runMutation(internal.calls.crmFinished, { callId: call._id, personId, error: message(error) });
    }
  },
});

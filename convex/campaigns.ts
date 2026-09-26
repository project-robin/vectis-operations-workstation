import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v, type GenericId } from "convex/values";
import { requireMember, requireRole } from "./lib/auth";
import { appendEvent } from "./lib/events";
import { findCampaignMember } from "./lib/lookup";
import { buildCampaignCsv, campaignTransition, canonicalBusinessStatus, providerStateIsTerminal, type CampaignBusinessStatus, type Transition } from "./lib/campaignState";

const MAX_BATCH = 100;
const MAX_CAMPAIGN_ROWS = 500;
const paginationOpts = v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) });
const transition = v.union(v.literal("start"), v.literal("pause"), v.literal("resume"));
const campaignStatus = v.union(v.literal("draft"), v.literal("approved"), v.literal("starting"), v.literal("running"), v.literal("pausing"), v.literal("paused"), v.literal("resuming"), v.literal("failed"), v.literal("completed"), v.literal("reconciliation_required"));

function boundedPage(opts: { numItems: number }) {
  if (!Number.isSafeInteger(opts.numItems) || opts.numItems < 1 || opts.numItems > MAX_BATCH) throw new Error(`Pagination must request between 1 and ${MAX_BATCH} items`);
}
function boundedId(value: string, name: string) {
  if (!value || value.length > 256) throw new Error(`${name} is invalid`);
}
function workflowNumber(value: string) {
  if (!/^\d+$/.test(value)) throw new Error("Dograh workflow binding is not numeric");
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error("Dograh workflow binding is invalid");
  return n;
}
async function ownedCampaign(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">, campaignId: GenericId<"campaigns">) {
  const campaign = await ctx.db.get(campaignId);
  if (!campaign || campaign.organizationId !== organizationId) throw new Error("Campaign not found");
  return campaign;
}
async function ownedBinding(ctx: MutationCtx, organizationId: GenericId<"organizations">, bindingId: GenericId<"integrationBindings">) {
  const binding = await ctx.db.get(bindingId);
  if (!binding || binding.organizationId !== organizationId || binding.provider !== "dograh" || binding.status !== "active" || !binding.dograhOrganizationId || !binding.dograhWorkflowId) throw new Error("Active Dograh binding not found");
  return binding;
}
async function findDraft(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">, key: string) {
  const rows = await ctx.db.query("campaigns").withIndex("by_organization_draft_idempotency", (q) => q.eq("organizationId", organizationId).eq("draftIdempotencyKey", key)).take(2);
  if (rows.length > 1) throw new Error("Integrity error: duplicate campaign draft idempotency key");
  return rows[0] ?? null;
}

export const listCampaigns = query({
  args: { paginationOpts: v.optional(paginationOpts) },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMember(ctx);
    const opts = args.paginationOpts ?? { numItems: 50, cursor: null };
    boundedPage(opts);
    return ctx.db.query("campaigns").withIndex("by_organization_updated", (q) => q.eq("organizationId", organizationId)).order("desc").paginate(opts);
  },
});

export const getCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMember(ctx);
    return ownedCampaign(ctx, organizationId, args.campaignId);
  },
});

export const createCampaignDraft = mutation({
  args: { name: v.string(), batchId: v.id("importBatches"), bindingId: v.id("integrationBindings"), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireRole(ctx, "operate");
    boundedId(args.name, "campaign name"); boundedId(args.idempotencyKey, "idempotencyKey");
    const existing = await findDraft(ctx, organizationId, args.idempotencyKey);
    if (existing) return existing._id;
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.organizationId !== organizationId || batch.status !== "approved") throw new Error("Campaign requires one approved import batch");
    const binding = await ownedBinding(ctx, organizationId, args.bindingId);
    const providerOrganizationId = binding.dograhOrganizationId;
    const providerWorkflowId = binding.dograhWorkflowId;
    if (!providerOrganizationId || !providerWorkflowId) throw new Error("Active Dograh binding is incomplete");
    const rows = await ctx.db.query("importRows").withIndex("by_organization_batch", (q) => q.eq("organizationId", organizationId).eq("batchId", args.batchId)).filter((q) => q.and(q.eq(q.field("eligible"), true), q.eq(q.field("consent"), "consented"), q.eq(q.field("validationStatus"), "valid"))).take(MAX_CAMPAIGN_ROWS + 1);
    if (rows.length > MAX_CAMPAIGN_ROWS) throw new Error("Campaign row bound exceeded");
    const eligible = rows.filter((row) => row.customerId !== undefined);
    if (eligible.length === 0) throw new Error("Approved batch has no eligible campaign rows");
    const workflowId = workflowNumber(providerWorkflowId);
    const now = Date.now();
    const campaignId = await ctx.db.insert("campaigns", {
      organizationId, name: args.name, status: "draft", businessStatus: "draft", providerExecutionState: "not_created",
      workflowId, agentWorkflowBinding: { organizationId: providerOrganizationId, workflowId: providerWorkflowId },
      bindingId: binding._id, providerOrganizationId, providerWorkflowId,
      approvedBatchId: batch._id, draftIdempotencyKey: args.idempotencyKey, totalRows: eligible.length, processedRows: 0, failedRows: 0,
      reconciliationRequired: false, createdBy: userId, updatedBy: userId, createdAt: now, updatedAt: now,
    });
    for (const row of eligible) {
      const workstationRunId = `campaign:${campaignId}:member:${row._id}`;
      const existingMember = await findCampaignMember(ctx, organizationId, campaignId, row.customerId!);
      if (existingMember) continue;
      await ctx.db.insert("campaignMembers", {
        organizationId, campaignId, customerId: row.customerId!, sourceImportRowId: row._id, consent: "consented", callDisposition: "not_called",
        status: "pending", workstationRunId, createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("providerRuns", {
        organizationId, workstationRunId, campaignId, customerId: row.customerId!, providerWorkflowId: workflowId,
        direction: "outbound", state: "pending", createdAt: now, updatedAt: now,
      });
    }
    await appendEvent(ctx, { organizationId, actor: userId, type: "campaign.drafted", targetType: "campaign", targetId: campaignId, correlationId: args.idempotencyKey, payload: JSON.stringify({ batchId: batch._id, rows: eligible.length }) });
    return campaignId;
  },
});

export const approveCampaign = mutation({
  args: { campaignId: v.id("campaigns"), correlationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireRole(ctx, "approve");
    const campaign = await ownedCampaign(ctx, organizationId, args.campaignId);
    if (canonicalBusinessStatus(campaign) !== "draft") throw new Error("Campaign approval is only legal from draft");
    const now = Date.now();
    await ctx.db.patch(campaign._id, { businessStatus: "approved", status: "approved", approvedBy: userId, approvedAt: now, updatedAt: now, updatedBy: userId });
    await appendEvent(ctx, { organizationId, actor: userId, type: "campaign.approved", targetType: "campaign", targetId: campaign._id, correlationId: args.correlationId });
    return campaign._id;
  },
});

async function claimTransition(ctx: MutationCtx, args: { campaignId: GenericId<"campaigns">; organizationId: GenericId<"organizations">; userId: GenericId<"users">; operation: Transition; idempotencyKey: string; now: number }) {
  boundedId(args.idempotencyKey, "idempotencyKey");
  const campaign = await ownedCampaign(ctx, args.organizationId, args.campaignId);
  const current = canonicalBusinessStatus(campaign);
  const target = ({ start: "starting", pause: "pausing", resume: "resuming" } as const)[args.operation];
  if (campaign.lastCommand === args.operation && campaign.lastCommandIdempotencyKey === args.idempotencyKey && current === target) return { campaign, claimed: false, claimToken: campaign.claimToken! };
  if (["starting", "pausing", "resuming"].includes(current)) throw new Error(`Campaign transition already in progress: ${current}`);
  campaignTransition(current, target);
  const claimToken = `${String(campaign._id)}:${args.operation}:${args.now}:${Math.random().toString(36).slice(2)}`;
  await ctx.db.patch(campaign._id, { businessStatus: target, status: target, claimToken, claimType: args.operation, claimStartedAt: args.now, claimExpiresAt: args.now + 5 * 60_000, lastCommand: args.operation, lastCommandIdempotencyKey: args.idempotencyKey, updatedAt: args.now, updatedBy: args.userId });
  await appendEvent(ctx, { organizationId: args.organizationId, actor: args.userId, type: "campaign.transition.claimed", targetType: "campaign", targetId: campaign._id, correlationId: args.idempotencyKey, payload: JSON.stringify({ operation: args.operation, claimToken }) });
  return { campaign, claimed: true, claimToken };
}

export const startCampaign = mutation({
  args: { campaignId: v.id("campaigns"), idempotencyKey: v.string() },
  handler: async (ctx, args) => { const { organizationId, userId } = await requireRole(ctx, "operate"); const result = await claimTransition(ctx, { ...args, organizationId, userId, operation: "start", now: Date.now() }); if (result.claimed) await ctx.scheduler.runAfter(0, internal.actions.dograh.executeTransition, { campaignId: args.campaignId, operation: "start", claimToken: result.claimToken }); return args.campaignId; },
});
export const pauseCampaign = mutation({
  args: { campaignId: v.id("campaigns"), idempotencyKey: v.string() },
  handler: async (ctx, args) => { const { organizationId, userId } = await requireRole(ctx, "operate"); const result = await claimTransition(ctx, { ...args, organizationId, userId, operation: "pause", now: Date.now() }); if (result.claimed) await ctx.scheduler.runAfter(0, internal.actions.dograh.executeTransition, { campaignId: args.campaignId, operation: "pause", claimToken: result.claimToken }); return args.campaignId; },
});
export const resumeCampaign = mutation({
  args: { campaignId: v.id("campaigns"), idempotencyKey: v.string() },
  handler: async (ctx, args) => { const { organizationId, userId } = await requireRole(ctx, "operate"); const result = await claimTransition(ctx, { ...args, organizationId, userId, operation: "resume", now: Date.now() }); if (result.claimed) await ctx.scheduler.runAfter(0, internal.actions.dograh.executeTransition, { campaignId: args.campaignId, operation: "resume", claimToken: result.claimToken }); return args.campaignId; },
});

export const actionContext = internalQuery({
  args: { campaignId: v.id("campaigns"), claimToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || (args.claimToken !== undefined && campaign.claimToken !== args.claimToken)) return null;
    const binding = campaign.bindingId ? await ctx.db.get(campaign.bindingId) : null;
    const members = await ctx.db.query("campaignMembers").withIndex("by_organization_campaign", (q) => q.eq("organizationId", campaign.organizationId).eq("campaignId", campaign._id)).take(MAX_CAMPAIGN_ROWS + 1);
    const customers = await Promise.all(members.map((member) => ctx.db.get(member.customerId)));
    return { campaign, binding, members, customers };
  },
});

export const recordProviderCampaign = internalMutation({
  args: { campaignId: v.id("campaigns"), claimToken: v.string(), providerCampaignId: v.number(), providerState: v.string() },
  handler: async (ctx, args) => { const campaign = await ctx.db.get(args.campaignId); if (!campaign || campaign.claimToken !== args.claimToken) throw new Error("Campaign claim is stale"); if (campaign.dograhCampaignId !== undefined && campaign.dograhCampaignId !== args.providerCampaignId) throw new Error("Provider campaign correlation collision"); await ctx.db.patch(campaign._id, { dograhCampaignId: args.providerCampaignId, providerExecutionState: args.providerState, providerState: args.providerState, updatedAt: Date.now() }); return campaign._id; },
});

export const completeTransition = internalMutation({
  args: { campaignId: v.id("campaigns"), claimToken: v.string(), operation: transition, providerState: v.string() },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId); if (!campaign || campaign.claimToken !== args.claimToken) return null;
    const next: CampaignBusinessStatus = args.operation === "pause" ? "paused" : args.operation === "resume" || args.operation === "start" ? (providerStateIsTerminal(args.providerState) ? "completed" : "running") : "failed";
    await ctx.db.patch(campaign._id, { businessStatus: next, status: next, providerExecutionState: args.providerState, providerState: args.providerState, claimToken: undefined, claimType: undefined, claimStartedAt: undefined, claimExpiresAt: undefined, lastSyncedAt: Date.now(), updatedAt: Date.now() });
    await appendEvent(ctx, { organizationId: campaign.organizationId, type: "campaign.transition.completed", targetType: "campaign", targetId: campaign._id, payload: JSON.stringify({ operation: args.operation, providerState: args.providerState }) });
    return next;
  },
});

export const markReconciliationRequired = internalMutation({
  args: { campaignId: v.id("campaigns"), claimToken: v.string(), operation: transition, error: v.string(), category: v.union(v.literal("provider"), v.literal("timeout"), v.literal("transport"), v.literal("malformed"), v.literal("reconciliation")) },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId); if (!campaign || campaign.claimToken !== args.claimToken) return null;
    const existing = await ctx.db.query("campaignReconciliationItems").withIndex("by_organization_campaign_status", (q) => q.eq("organizationId", campaign.organizationId).eq("campaignId", campaign._id).eq("status", "open")).take(2);
    if (existing.length > 1) throw new Error("Integrity error: duplicate campaign reconciliation item");
    const itemId = existing[0]?._id ?? await ctx.db.insert("campaignReconciliationItems", { organizationId: campaign.organizationId, campaignId: campaign._id, status: "open", reason: args.error, createdAt: Date.now() });
    await ctx.db.patch(campaign._id, { businessStatus: "reconciliation_required", status: "reconciliation_required", providerExecutionState: "unknown", lastError: args.error.slice(0, 1000), errorCategory: args.category, reconciliationRequired: true, reconciliationWorkItemId: itemId, claimToken: undefined, claimType: undefined, claimStartedAt: undefined, claimExpiresAt: undefined, updatedAt: Date.now() });
    await appendEvent(ctx, { organizationId: campaign.organizationId, type: "campaign.reconciliation_required", targetType: "campaign", targetId: campaign._id, payload: JSON.stringify({ operation: args.operation, itemId, category: args.category }) });
    return itemId;
  },
});

export const failTransition = internalMutation({
  args: { campaignId: v.id("campaigns"), claimToken: v.string(), operation: transition, error: v.string() },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.claimToken !== args.claimToken) return null;
    await ctx.db.patch(campaign._id, { businessStatus: "failed", status: "failed", lastError: args.error.slice(0, 1000), errorCategory: "provider", claimToken: undefined, claimType: undefined, claimStartedAt: undefined, claimExpiresAt: undefined, updatedAt: Date.now() });
    await appendEvent(ctx, { organizationId: campaign.organizationId, type: "campaign.failed", targetType: "campaign", targetId: campaign._id, payload: JSON.stringify({ operation: args.operation, error: args.error.slice(0, 1000) }) });
    return campaign._id;
  },
});

export const markPollReconciliationRequired = internalMutation({
  args: { campaignId: v.id("campaigns"), error: v.string(), category: v.union(v.literal("provider"), v.literal("timeout"), v.literal("transport"), v.literal("malformed"), v.literal("reconciliation")) },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || ["completed", "failed"].includes(canonicalBusinessStatus(campaign))) return null;
    const existing = await ctx.db.query("campaignReconciliationItems").withIndex("by_organization_campaign_status", (q) => q.eq("organizationId", campaign.organizationId).eq("campaignId", campaign._id).eq("status", "open")).take(2);
    if (existing.length > 1) throw new Error("Integrity error: duplicate campaign reconciliation item");
    const itemId = existing[0]?._id ?? await ctx.db.insert("campaignReconciliationItems", { organizationId: campaign.organizationId, campaignId: campaign._id, status: "open", reason: args.error.slice(0, 1000), createdAt: Date.now() });
    await ctx.db.patch(campaign._id, { businessStatus: "reconciliation_required", status: "reconciliation_required", providerExecutionState: "unknown", reconciliationRequired: true, reconciliationWorkItemId: itemId, lastError: args.error.slice(0, 1000), errorCategory: args.category, lastReconciledAt: Date.now(), updatedAt: Date.now() });
    await appendEvent(ctx, { organizationId: campaign.organizationId, type: "campaign.reconciliation_required", targetType: "campaign", targetId: campaign._id, payload: JSON.stringify({ category: args.category, reason: args.error.slice(0, 1000) }) });
    return itemId;
  },
});

export const applyReconciliation = internalMutation({
  args: { campaignId: v.id("campaigns"), providerState: v.string(), totalRows: v.number(), processedRows: v.number(), failedRows: v.number(), evidence: v.string(), runs: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId); if (!campaign) return null;
    const current = canonicalBusinessStatus(campaign);
    const currentTerminal = current === "completed" || current === "failed";
    const next = currentTerminal ? current : providerStateIsTerminal(args.providerState) && args.processedRows >= args.totalRows ? "completed" : args.providerState.toLowerCase() === "paused" ? "paused" : "running";
    if (current === "completed" && next !== "completed") return campaign._id;
    await ctx.db.patch(campaign._id, { businessStatus: next as CampaignBusinessStatus, status: next as CampaignBusinessStatus, providerExecutionState: args.providerState, providerState: args.providerState, totalRows: Math.max(0, args.totalRows), processedRows: Math.max(0, args.processedRows), failedRows: Math.max(0, args.failedRows), progressPercentage: args.totalRows > 0 ? Math.min(100, Math.round((args.processedRows / args.totalRows) * 10000) / 100) : 0, reconciliationRequired: false, lastReconciledAt: Date.now(), lastSyncedAt: Date.now(), auditRef: args.evidence.slice(0, 4000), updatedAt: Date.now() });
    const items = await ctx.db.query("campaignReconciliationItems").withIndex("by_organization_campaign_status", (q) => q.eq("organizationId", campaign.organizationId).eq("campaignId", campaign._id).eq("status", "open")).take(MAX_BATCH);
    for (const item of items) await ctx.db.patch(item._id, { status: "resolved", resolvedAt: Date.now() });
    if (args.runs) {
      let rawRuns: unknown = [];
      try { rawRuns = JSON.parse(args.runs); } catch { rawRuns = []; }
      if (Array.isArray(rawRuns)) {
        for (const raw of rawRuns.slice(0, MAX_CAMPAIGN_ROWS)) {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
          const value = raw as Record<string, unknown>;
          const workstationRunId = value.workstation_provider_run_id ?? value.workstation_run_id ?? value.workstationRunId;
          const providerRunId = value.provider_run_id ?? value.workflow_run_id ?? value.run_id;
          if (typeof workstationRunId !== "string" || typeof providerRunId !== "string" && typeof providerRunId !== "number") continue;
          const providerRunRows = await ctx.db.query("providerRuns").withIndex("by_workstation_run", (q) => q.eq("workstationRunId", workstationRunId)).take(2);
          const providerRun = providerRunRows.find((row) => row.organizationId === campaign.organizationId && row.campaignId === campaign._id);
          if (!providerRun) continue;
          const providerRunValue = String(providerRunId);
          await ctx.db.patch(providerRun._id, { providerRunId: providerRunValue, state: typeof value.state === "string" ? value.state : providerRun.state, updatedAt: Date.now() });
          const memberRows = await ctx.db.query("campaignMembers").withIndex("by_workstation_run", (q) => q.eq("workstationRunId", workstationRunId)).take(2);
          const member = memberRows.find((row) => row.organizationId === campaign.organizationId && row.campaignId === campaign._id);
          if (member) await ctx.db.patch(member._id, { providerRunId: providerRunValue, dograhProviderRunId: providerRunValue, callDisposition: typeof value.state === "string" ? value.state : member.callDisposition, status: providerStateIsTerminal(typeof value.state === "string" ? value.state : undefined) ? "processed" : member.status, updatedAt: Date.now() });
        }
      }
    }
    await appendEvent(ctx, { organizationId: campaign.organizationId, type: "campaign.reconciled", targetType: "campaign", targetId: campaign._id, payload: args.evidence });
    return campaign._id;
  },
});

export const reconcileCampaign = mutation({
  args: { campaignId: v.id("campaigns"), decision: v.union(v.literal("retry"), v.literal("confirm"), v.literal("fail")), reason: v.string() },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireRole(ctx, "operate");
    const campaign = await ownedCampaign(ctx, organizationId, args.campaignId);
    if (canonicalBusinessStatus(campaign) !== "reconciliation_required") throw new Error("Campaign is not awaiting reconciliation");
    boundedId(args.reason, "reconciliation reason");
    if (args.decision === "retry") {
      const target = campaign.dograhCampaignId === undefined ? "approved" : "paused";
      await ctx.db.patch(campaign._id, { businessStatus: target, status: target, reconciliationRequired: false, errorCategory: undefined, lastError: undefined, updatedAt: Date.now(), updatedBy: userId });
    } else if (args.decision === "fail") {
      await ctx.db.patch(campaign._id, { businessStatus: "failed", status: "failed", reconciliationRequired: false, errorCategory: "reconciliation", lastError: args.reason, updatedAt: Date.now(), updatedBy: userId });
    }
    await appendEvent(ctx, { organizationId, actor: userId, type: `campaign.reconcile.${args.decision}`, targetType: "campaign", targetId: campaign._id, payload: args.reason });
    return campaign._id;
  },
});

export const reconcileCandidates = internalQuery({
  args: { batchSize: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.batchSize) || args.batchSize < 1 || args.batchSize > MAX_BATCH) throw new Error("batchSize is invalid");
    const rows = await ctx.db.query("campaigns").withIndex("by_organization_reconciliation").take(args.batchSize * 2);
    const active = await ctx.db.query("campaigns").withIndex("by_organization_status", (q) => q.eq("organizationId", rows[0]?.organizationId as never)).take(args.batchSize);
    return [...rows, ...active.filter((row) => ["running", "starting", "pausing", "resuming"].includes(canonicalBusinessStatus(row)) && !rows.some((item) => item._id === row._id))].slice(0, args.batchSize);
  },
});

export const sweepReconciliation = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 25;
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH) throw new Error("batchSize is invalid");
    const cursorRows = await ctx.db.query("maintenanceState").withIndex("by_key", (q) => q.eq("key", "campaign-reconciliation-sweep")).take(2);
    if (cursorRows.length > 1) throw new Error("Integrity error: duplicate reconciliation cursor");
    const allOrganizations = await ctx.db.query("organizations").withIndex("by_created_at").order("asc").take(batchSize + 1);
    const cursor = cursorRows[0]?.cursor;
    const cursorIndex = cursor ? allOrganizations.findIndex((organization) => String(organization._id) === cursor) : -1;
    const organizations = cursorIndex >= 0 ? [...allOrganizations.slice(cursorIndex + 1), ...allOrganizations.slice(0, cursorIndex + 1)].slice(0, batchSize) : allOrganizations.slice(0, batchSize);
    let scheduled = 0;
    for (const organization of organizations) {
      if (scheduled >= batchSize) break;
      const rows = await ctx.db.query("campaigns").withIndex("by_organization_reconciliation", (q) => q.eq("organizationId", organization._id).eq("reconciliationRequired", true)).take(batchSize - scheduled);
      for (const row of rows) { if (row.dograhCampaignId !== undefined) { await ctx.scheduler.runAfter(0, internal.actions.dograh.reconcile, { campaignId: row._id }); scheduled += 1; } }
      const active = await ctx.db.query("campaigns").withIndex("by_organization_status", (q) => q.eq("organizationId", organization._id).eq("businessStatus", "running")).take(batchSize - scheduled);
      for (const row of active) { if (scheduled >= batchSize || row.dograhCampaignId === undefined) break; await ctx.scheduler.runAfter(0, internal.actions.dograh.reconcile, { campaignId: row._id }); scheduled += 1; }
    }
    if (organizations.length > 0) {
      const nextCursor = String(organizations[organizations.length - 1]!._id);
      if (cursorRows[0]) await ctx.db.patch(cursorRows[0]._id, { cursor: nextCursor });
      else await ctx.db.insert("maintenanceState", { key: "campaign-reconciliation-sweep", cursor: nextCursor });
    }
    return scheduled;
  },
});

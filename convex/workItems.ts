import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v, type GenericId } from "convex/values";
import { requireMember, requireRole } from "./lib/auth";
import { appendEvent } from "./lib/events";
import { assertResolution, assertWorkItemTransition, type WorkItemStatus } from "../lib/contracts/workItem";

const status = v.union(v.literal("open"), v.literal("assigned"), v.literal("investigating"), v.literal("waiting_for_customer"), v.literal("resolved"));
const type = v.union(v.literal("dispute"), v.literal("handoff"), v.literal("follow_up"), v.literal("escalation"));
const priority = v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("urgent"));
const paginationOpts = v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) });
const MAX_PAGE = 100;
const MAX_TEXT = 4_000;

function pageArgs(args: { numItems: number; cursor: string | null }) {
  if (!Number.isSafeInteger(args.numItems) || args.numItems < 1 || args.numItems > MAX_PAGE) throw new Error(`Pagination must request between 1 and ${MAX_PAGE} items`);
  const offset = args.cursor ? Number(args.cursor) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid work item cursor");
  return { limit: args.numItems, offset };
}

async function customerInTenant(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">, customerId: GenericId<"customers">) {
  const customer = await ctx.db.get(customerId);
  if (!customer || customer.organizationId !== organizationId || customer.mergedInto) throw new Error("Customer not found");
  return customer;
}

async function activeAssignee(ctx: MutationCtx, organizationId: GenericId<"organizations">, userId: GenericId<"users">) {
  const user = await ctx.db.get(userId);
  if (!user || user.active === false || user.deletedAt !== undefined) throw new Error("Assignee is not active");
  const rows = await ctx.db.query("memberships").withIndex("by_organization_user", (q) => q.eq("organizationId", organizationId).eq("userId", userId)).take(2);
  if (rows.length > 1) throw new Error("Integrity error: duplicate assignee membership");
  if (!rows[0] || rows[0].active === false || rows[0].deletedAt !== undefined) throw new Error("Assignee must be an active member of this organization");
}

async function getScoped(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">, workItemId: GenericId<"workItems">) {
  const item = await ctx.db.get(workItemId);
  if (!item || item.organizationId !== organizationId) throw new Error("Work item not found");
  return item;
}

function canAccess(item: { assignee?: GenericId<"users"> }, userId: GenericId<"users">, role: "owner" | "operator" | "staff") {
  return role !== "staff" || item.assignee === undefined || item.assignee === userId;
}

export const createWorkItem = mutation({
  args: {
    customerId: v.id("customers"),
    conversationId: v.optional(v.id("conversations")),
    type,
    priority: v.optional(priority),
    assignee: v.optional(v.id("users")),
    team: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    slaDueAt: v.optional(v.number()),
    sentiment: v.optional(v.string()),
    aiSummary: v.optional(v.string()),
    evidenceLinks: v.optional(v.array(v.object({ table: v.string(), id: v.string(), label: v.optional(v.string()) }))),
    dedupeKey: v.optional(v.string()),
    correlationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireRole(ctx, "operate");
    await customerInTenant(ctx, organizationId, args.customerId);
    if (args.conversationId) {
      const conversation = await ctx.db.get(args.conversationId);
      if (!conversation || conversation.organizationId !== organizationId || conversation.customerId !== args.customerId) throw new Error("Conversation does not belong to organization/customer");
    }
    if (args.assignee) await activeAssignee(ctx, organizationId, args.assignee);
    if (args.dedupeKey) {
      const existing = await findByDedupe(ctx, organizationId, args.dedupeKey);
      if (existing) return existing._id;
    }
    const now = Date.now();
    const id = await ctx.db.insert("workItems", { organizationId, customerId: args.customerId, conversationId: args.conversationId, type: args.type, status: args.assignee ? "assigned" : "open", priority: args.priority ?? "medium", assignee: args.assignee, team: args.team, dueAt: args.dueAt, slaDueAt: args.slaDueAt, sentiment: args.sentiment, aiSummary: args.aiSummary, evidenceLinks: args.evidenceLinks, dedupeKey: args.dedupeKey, createdAt: now, updatedAt: now });
    await appendEvent(ctx, { organizationId, actor: userId, type: "work_item.created", targetType: "workItems", targetId: id, correlationId: args.correlationId });
    return id;
  },
});

export const assignWorkItem = mutation({
  args: { workItemId: v.id("workItems"), assignee: v.id("users"), correlationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireRole(ctx, "operate");
    const item = await getScoped(ctx, organizationId, args.workItemId);
    if (item.status === "resolved") throw new Error("Resolved work items cannot be reassigned");
    await activeAssignee(ctx, organizationId, args.assignee);
    const nextStatus = item.status === "open" ? "assigned" : item.status;
    await ctx.db.patch(item._id, { assignee: args.assignee, status: nextStatus, updatedAt: Date.now() });
    await appendEvent(ctx, { organizationId, actor: userId, type: "work_item.assigned", targetType: "workItems", targetId: item._id, correlationId: args.correlationId });
    return item._id;
  },
});

export const setWorkItemStatus = mutation({
  args: { workItemId: v.id("workItems"), status, resolution: v.optional(v.string()), followUpProposal: v.optional(v.object({ note: v.string(), dueAt: v.optional(v.number()) })), correlationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const item = await getScoped(ctx, member.organizationId, args.workItemId);
    if (!canAccess(item, member.userId, member.role)) throw new Error("Forbidden: work item is assigned to another staff member");
    assertWorkItemTransition(item.status as WorkItemStatus, args.status as WorkItemStatus);
    if (args.status === "resolved") assertResolution(args.resolution);
    if (args.followUpProposal && (!args.followUpProposal.note || args.followUpProposal.note.length > MAX_TEXT)) throw new Error("Follow-up proposal note is invalid");
    const now = Date.now();
    const proposal = args.followUpProposal ? { ...args.followUpProposal, proposedAt: now, proposedBy: member.userId } : undefined;
    await ctx.db.patch(item._id, { status: args.status, resolution: args.status === "resolved" ? args.resolution!.trim() : item.resolution, followUpProposal: proposal ?? item.followUpProposal, updatedAt: now });
    await appendEvent(ctx, { organizationId: member.organizationId, actor: member.userId, type: `work_item.${args.status}`, targetType: "workItems", targetId: item._id, correlationId: args.correlationId, payload: args.resolution ? JSON.stringify({ resolution: args.resolution, followUpProposal: proposal }) : undefined });
    return item._id;
  },
});

export const updateWorkItem = mutation({
  args: { workItemId: v.id("workItems"), priority: v.optional(priority), team: v.optional(v.string()), dueAt: v.optional(v.number()), slaDueAt: v.optional(v.number()), sentiment: v.optional(v.string()), aiSummary: v.optional(v.string()), evidenceLinks: v.optional(v.array(v.object({ table: v.string(), id: v.string(), label: v.optional(v.string()) }))), correlationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const member = await requireMember(ctx);
    const item = await getScoped(ctx, member.organizationId, args.workItemId);
    if (!canAccess(item, member.userId, member.role)) throw new Error("Forbidden: work item is assigned to another staff member");
    const patch = { priority: args.priority, team: args.team, dueAt: args.dueAt, slaDueAt: args.slaDueAt, sentiment: args.sentiment, aiSummary: args.aiSummary, evidenceLinks: args.evidenceLinks, updatedAt: Date.now() };
    await ctx.db.patch(item._id, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)));
    await appendEvent(ctx, { organizationId: member.organizationId, actor: member.userId, type: "work_item.updated", targetType: "workItems", targetId: item._id, correlationId: args.correlationId });
    return item._id;
  },
});

export const listWorkItems = query({
  args: { status: v.optional(status), customerId: v.optional(v.id("customers")), assignee: v.optional(v.id("users")), dueBefore: v.optional(v.number()), paginationOpts: v.optional(paginationOpts) },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMember(ctx);
    if (args.customerId) await customerInTenant(ctx, organizationId, args.customerId);
    const opts = pageArgs(args.paginationOpts ?? { numItems: MAX_PAGE, cursor: null });
    let rows = args.status
      ? await ctx.db.query("workItems").withIndex("by_organization_status", (q) => q.eq("organizationId", organizationId).eq("status", args.status!)).order("desc").take(MAX_PAGE * 5)
      : args.assignee
        ? await ctx.db.query("workItems").withIndex("by_organization_assignee", (q) => q.eq("organizationId", organizationId).eq("assignee", args.assignee!)).order("desc").take(MAX_PAGE * 5)
        : await ctx.db.query("workItems").withIndex("by_organization_due", (q) => q.eq("organizationId", organizationId)).order("asc").take(MAX_PAGE * 5);
    rows = rows.filter((row) => (!args.customerId || row.customerId === args.customerId) && (!args.assignee || row.assignee === args.assignee) && (args.dueBefore === undefined || (row.dueAt ?? Number.MAX_SAFE_INTEGER) <= args.dueBefore));
    const page = rows.slice(opts.offset, opts.offset + opts.limit);
    const next = opts.offset + page.length;
    return { page, isDone: next >= rows.length, continueCursor: next >= rows.length ? null : String(next) };
  },
});

export const getWorkItem = query({ args: { workItemId: v.id("workItems") }, handler: async (ctx, args) => { const { organizationId } = await requireMember(ctx); return getScoped(ctx, organizationId, args.workItemId); } });

async function findByDedupe(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">, dedupeKey: string) {
  const rows = await ctx.db.query("workItems").withIndex("by_organization_dedupe", (q) => q.eq("organizationId", organizationId).eq("dedupeKey", dedupeKey)).take(2);
  if (rows.length > 1) throw new Error("Integrity error: duplicate work item dedupe key");
  return rows[0] ?? null;
}

export async function projectOutcomeWorkItem(ctx: MutationCtx, args: { organizationId: GenericId<"organizations">; outcomeId: GenericId<"callOutcomes">; now?: number }) {
  const outcome = await ctx.db.get(args.outcomeId);
  if (!outcome || outcome.organizationId !== args.organizationId) throw new Error("Outcome not found");
  const itemType = outcome.outcomeType === "dispute" ? "dispute" : outcome.outcomeType === "human_handoff_requested" ? "handoff" : outcome.outcomeType === "follow_up_required" ? "follow_up" : null;
  if (!itemType) return null;
  const dedupeKey = `outcome:${outcome._id}`;
  const existing = await findByDedupe(ctx, args.organizationId, dedupeKey);
  if (existing) return existing._id;
  const now = args.now ?? Date.now();
  const id = await ctx.db.insert("workItems", { organizationId: args.organizationId, customerId: outcome.customerId, conversationId: outcome.conversationId, type: itemType, status: "open", priority: itemType === "dispute" ? "high" : "medium", sentiment: outcome.fields.sentiment, aiSummary: outcome.fields.summary, evidenceLinks: [{ table: "callOutcomes", id: outcome._id }], resolution: undefined, sourceProviderRunId: outcome.providerRunId, sourceOutcomeId: outcome._id, sourceType: "call_outcome", dedupeKey, createdAt: now, updatedAt: now });
  await appendEvent(ctx, { organizationId: args.organizationId, type: "work_item.projected", targetType: "workItems", targetId: id, correlationId: outcome.providerRunId, payload: JSON.stringify({ sourceOutcomeId: outcome._id }) });
  return id;
}

export const projectFromOutcome = internalMutation({ args: { organizationId: v.id("organizations"), outcomeId: v.id("callOutcomes") }, handler: async (ctx, args) => projectOutcomeWorkItem(ctx, args) });

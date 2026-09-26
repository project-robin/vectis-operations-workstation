import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v, type GenericId } from "convex/values";
import { requireMember, requireRole } from "./lib/auth";
import { appendEvent } from "./lib/events";
import { assertCurrency, assertMinorAmount } from "./lib/policy";

const paginationOpts = v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) });
const MAX_PAGE = 100;

function assertPage(opts: { numItems: number }) {
  if (!Number.isSafeInteger(opts.numItems) || opts.numItems < 1 || opts.numItems > MAX_PAGE) throw new Error(`Pagination must request between 1 and ${MAX_PAGE} items`);
}

async function organizationCurrency(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">) {
  const settings = await ctx.db.query("organizationSettings").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).take(2);
  if (settings.length > 1) throw new Error("Integrity error: duplicate organization settings");
  return settings[0]?.defaultCurrency ?? "INR";
}

async function ownCustomer(ctx: MutationCtx | QueryCtx, organizationId: GenericId<"organizations">, customerId: GenericId<"customers">) {
  const customer = await ctx.db.get(customerId);
  if (!customer || customer.organizationId !== organizationId || customer.mergedInto) throw new Error("Customer not found");
  return customer;
}

async function ownOpportunity(ctx: MutationCtx | QueryCtx, organizationId: GenericId<"organizations">, opportunityId: GenericId<"opportunities">) {
  const opportunity = await ctx.db.get(opportunityId);
  if (!opportunity || opportunity.organizationId !== organizationId) throw new Error("Opportunity not found");
  return opportunity;
}

export const createOpportunity = mutation({
  args: {
    customerId: v.id("customers"),
    sourceType: v.string(),
    sourcePursuitId: v.string(),
    sourceRowId: v.optional(v.id("importRows")),
    title: v.string(),
    stage: v.string(),
    expectedValueMinor: v.optional(v.number()),
    currency: v.optional(v.string()),
    ownerOverride: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { organizationId, userId, role } = await requireRole(ctx, "operate");
    if (!args.sourceType || !args.sourcePursuitId || !args.title || !args.stage) throw new Error("Opportunity source, title, and stage are required");
    await ownCustomer(ctx, organizationId, args.customerId);
    let sourceRow;
    if (args.sourceRowId) {
      sourceRow = await ctx.db.get(args.sourceRowId);
      if (!sourceRow || sourceRow.organizationId !== organizationId) throw new Error("Import row does not belong to this organization");
      if (sourceRow.customerId !== args.customerId) throw new Error("Opportunity customer does not match source row");
      if (!sourceRow.eligible && !(role === "owner" && args.ownerOverride === true)) throw new Error("Source row is not campaign eligible; owner override is required");
    }
    const existing = await ctx.db.query("opportunities").withIndex("by_organization_source_pursuit", (q) => q.eq("organizationId", organizationId).eq("sourceType", args.sourceType).eq("sourcePursuitId", args.sourcePursuitId)).take(2);
    if (existing.length > 1) throw new Error("Integrity error: duplicate opportunity source pursuit");
    if (existing[0]) return { opportunityId: existing[0]._id, created: false as const };
    const policyCurrency = await organizationCurrency(ctx, organizationId);
    const currency = args.currency ?? policyCurrency;
    if (currency !== policyCurrency) throw new Error("Opportunity currency must match the organization policy");
    assertCurrency(currency);
    if (args.expectedValueMinor !== undefined) assertMinorAmount(args.expectedValueMinor, currency);
    const opportunityId = await ctx.db.insert("opportunities", { organizationId, customerId: args.customerId, sourceType: args.sourceType, sourcePursuitId: args.sourcePursuitId, sourceRowId: args.sourceRowId, title: args.title, stage: args.stage, expectedValueMinor: args.expectedValueMinor, currency, status: "open", createdAt: Date.now(), updatedAt: Date.now() });
    await appendEvent(ctx, { organizationId, actor: userId, type: "opportunity.created", targetType: "opportunity", targetId: opportunityId, payload: JSON.stringify({ sourceType: args.sourceType, sourcePursuitId: args.sourcePursuitId }) });
    return { opportunityId, created: true as const };
  },
});

export const listOpportunities = query({
  args: { paginationOpts, customerId: v.optional(v.id("customers")) },
  handler: async (ctx, args) => {
    assertPage(args.paginationOpts);
    const { organizationId } = await requireMember(ctx);
    return ctx.db.query("opportunities").withIndex("by_organization_updated_at", (q) => q.eq("organizationId", organizationId)).filter((q) => args.customerId ? q.eq(q.field("customerId"), args.customerId) : q.eq(q.field("organizationId"), organizationId)).order("desc").paginate(args.paginationOpts);
  },
});

export const getOpportunity = query({
  args: { opportunityId: v.id("opportunities") },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMember(ctx);
    return ownOpportunity(ctx, organizationId, args.opportunityId);
  },
});

export const updateOpportunity = mutation({
  args: { opportunityId: v.id("opportunities"), title: v.optional(v.string()), stage: v.optional(v.string()), status: v.optional(v.union(v.literal("open"), v.literal("won"), v.literal("lost"))), expectedValueMinor: v.optional(v.number()), currency: v.optional(v.string()), terminalOutcome: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireRole(ctx, "operate");
    const current = await ownOpportunity(ctx, organizationId, args.opportunityId);
    if (current.status !== "open" && args.status !== undefined && args.status !== current.status) throw new Error("Terminal opportunity cannot be reopened or changed");
    const policyCurrency = await organizationCurrency(ctx, organizationId);
    const currency = args.currency ?? current.currency ?? policyCurrency;
    if (currency !== policyCurrency) throw new Error("Opportunity currency must match the organization policy");
    assertCurrency(currency);
    if (args.expectedValueMinor !== undefined) assertMinorAmount(args.expectedValueMinor, currency);
    if (args.status === "won" || args.status === "lost") {
      if (!args.terminalOutcome) throw new Error("Terminal outcome is required");
    }
    await ctx.db.patch(current._id, { title: args.title ?? current.title, stage: args.stage ?? current.stage, status: args.status ?? current.status, expectedValueMinor: args.expectedValueMinor ?? current.expectedValueMinor, currency, terminalOutcome: args.terminalOutcome ?? current.terminalOutcome, updatedAt: Date.now() });
    await appendEvent(ctx, { organizationId, actor: userId, type: "opportunity.updated", targetType: "opportunity", targetId: current._id });
    return ctx.db.get(current._id);
  },
});

import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { findCampaignMember } from "./lib/lookup";

const MAX_CORRELATION_LENGTH = 256;
function assertCorrelation(value: string, name: string) {
  if (value.length === 0 || value.length > MAX_CORRELATION_LENGTH) throw new Error(`${name} is invalid`);
}

async function oneByWorkstation(ctx: Parameters<typeof findCampaignMember>[0], workstationRunId: string) {
  const rows = await ctx.db.query("providerRuns").withIndex("by_workstation_run", (q) => q.eq("workstationRunId", workstationRunId)).take(2);
  if (rows.length > 1) throw new Error("Integrity error: duplicate workstation run correlation");
  return rows[0] ?? null;
}

async function oneByProviderRun(ctx: Parameters<typeof findCampaignMember>[0], providerRunId: string) {
  const rows = await ctx.db.query("providerRuns").withIndex("by_provider_run", (q) => q.eq("providerRunId", providerRunId)).take(2);
  if (rows.length > 1) throw new Error("Integrity error: duplicate provider run correlation");
  return rows[0] ?? null;
}

export const lookupByWorkstationId = internalQuery({
  args: { workstationRunId: v.string() },
  handler: async (ctx, args) => {
    assertCorrelation(args.workstationRunId, "workstationRunId");
    const run = await oneByWorkstation(ctx, args.workstationRunId);
    if (!run) return null;
    return {
      providerRunId: run.providerRunId,
      organizationId: run.organizationId,
      campaignId: run.campaignId,
      providerCampaignId: run.providerCampaignId,
      providerWorkflowId: run.providerWorkflowId,
      customerId: run.customerId,
      direction: run.direction,
      state: run.state,
    };
  },
});

/** Pre-register a call before Dograh starts it. Correlation identifiers are globally unique. */
export const register = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    providerRunId: v.optional(v.string()),
    workstationRunId: v.string(),
    campaignId: v.optional(v.id("campaigns")),
    providerCampaignId: v.optional(v.number()),
    providerWorkflowId: v.optional(v.number()),
    customerId: v.id("customers"),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
  },
  handler: async (ctx, args) => {
    assertCorrelation(args.workstationRunId, "workstationRunId");
    if (args.providerRunId !== undefined) assertCorrelation(args.providerRunId, "providerRunId");
    for (const [value, name] of [[args.providerCampaignId, "providerCampaignId"], [args.providerWorkflowId, "providerWorkflowId"]] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`${name} is invalid`);
    }
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.organizationId !== args.organizationId || customer.mergedInto) {
      throw new Error("Customer does not belong to organization");
    }
    if (args.campaignId) {
      const campaign = await ctx.db.get(args.campaignId);
      if (!campaign || campaign.organizationId !== args.organizationId) throw new Error("Campaign does not belong to organization");
      const member = await findCampaignMember(ctx, args.organizationId, args.campaignId, args.customerId);
      if (!member) throw new Error("Campaign customer relation is missing");
    }

    const now = Date.now();
    const byWorkstation = await oneByWorkstation(ctx, args.workstationRunId);
    if (byWorkstation) {
      const same = byWorkstation.organizationId === args.organizationId &&
        byWorkstation.customerId === args.customerId &&
        byWorkstation.direction === args.direction &&
        (args.campaignId === undefined || byWorkstation.campaignId === args.campaignId) &&
        (args.providerCampaignId === undefined || byWorkstation.providerCampaignId === args.providerCampaignId) &&
        (args.providerWorkflowId === undefined || byWorkstation.providerWorkflowId === args.providerWorkflowId);
      if (!same) throw new Error("Workstation run correlation collision");
      if (args.providerRunId && byWorkstation.providerRunId && byWorkstation.providerRunId !== args.providerRunId) {
        throw new Error("Workstation run provider correlation collision");
      }
      if (args.providerRunId && !byWorkstation.providerRunId) {
        const byProvider = await oneByProviderRun(ctx, args.providerRunId);
        if (byProvider && byProvider._id !== byWorkstation._id) throw new Error("Provider run correlation collision");
        await ctx.db.patch(byWorkstation._id, { providerRunId: args.providerRunId, updatedAt: now });
      }
      return byWorkstation._id;
    }
    if (args.providerRunId) {
      const byProvider = await oneByProviderRun(ctx, args.providerRunId);
      if (byProvider) throw new Error("Provider run correlation collision");
    }
    return ctx.db.insert("providerRuns", {
      organizationId: args.organizationId,
      providerRunId: args.providerRunId,
      workstationRunId: args.workstationRunId,
      campaignId: args.campaignId,
      providerCampaignId: args.providerCampaignId,
      providerWorkflowId: args.providerWorkflowId,
      customerId: args.customerId,
      direction: args.direction,
      state: "pending",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export { oneByProviderRun, oneByWorkstation };

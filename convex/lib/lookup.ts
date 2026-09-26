import type { GenericId } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export async function findCustomerByPhone(
  ctx: QueryCtx | MutationCtx,
  organizationId: GenericId<"organizations">,
  phone: string,
) {
  const rows = await ctx.db
    .query("customers")
    .withIndex("by_organization_phone", (q) => q.eq("organizationId", organizationId).eq("phone", phone))
    .take(2);
  if (rows.length > 1) throw new Error(`Integrity error: duplicate customer phone ${phone}`);
  return rows[0] ?? null;
}

export async function findCustomerByEmail(
  ctx: QueryCtx | MutationCtx,
  organizationId: GenericId<"organizations">,
  email: string,
) {
  const rows = await ctx.db
    .query("customers")
    .withIndex("by_organization_email", (q) => q.eq("organizationId", organizationId).eq("email", email))
    .take(2);
  if (rows.length > 1) throw new Error(`Integrity error: duplicate customer email ${email}`);
  return rows[0] ?? null;
}

export async function findCommercialOutcome(
  ctx: MutationCtx,
  organizationId: GenericId<"organizations">,
  sourceType: string,
  sourceExternalId: string,
) {
  const rows = await ctx.db.query("commercialOutcomes").withIndex("by_organization_source", (q) => q.eq("organizationId", organizationId).eq("sourceType", sourceType).eq("sourceExternalId", sourceExternalId)).take(2);
  if (rows.length > 1) throw new Error("Integrity error: duplicate commercial outcome source");
  return rows[0] ?? null;
}

export async function findCampaignMember(
  ctx: QueryCtx | MutationCtx,
  organizationId: GenericId<"organizations">,
  campaignId: GenericId<"campaigns">,
  customerId: GenericId<"customers">,
) {
  const rows = await ctx.db
    .query("campaignMembers")
    .withIndex("by_organization_campaign_customer", (q) => q.eq("organizationId", organizationId).eq("campaignId", campaignId).eq("customerId", customerId))
    .take(2);
  if (rows.length > 1) throw new Error("Integrity error: duplicate campaign member");
  return rows[0] ?? null;
}

export async function findProviderRun(
  ctx: MutationCtx,
  organizationId: GenericId<"organizations">,
  providerRunId: string,
) {
  const rows = await ctx.db.query("providerRuns").withIndex("by_organization_provider_run", (q) => q.eq("organizationId", organizationId).eq("providerRunId", providerRunId)).take(2);
  if (rows.length > 1) throw new Error("Integrity error: duplicate provider run");
  return rows[0] ?? null;
}
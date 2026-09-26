import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireMember, requireRole } from "./lib/auth";
import { appendEvent } from "./lib/events";
import {
  DEFAULT_ORGANIZATION_POLICY,
  assertOrganizationPolicy,
} from "./lib/policy";
import type { OrganizationPolicy } from "../lib/contracts/organizationSettings";
import type { GenericId } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { publicationReadiness } from "./lib/commercialPolicy";

const attributionWindow = v.object({
  value: v.number(),
  unit: v.union(v.literal("hours"), v.literal("days")),
  semantics: v.literal("interaction_to_outcome"),
});
const expectedBookingValuePolicy = v.object({
  mode: v.union(v.literal("none"), v.literal("org_wide"), v.literal("service"), v.literal("opportunity")),
  amountMinor: v.optional(v.number()),
  currency: v.optional(v.string()),
  serviceValues: v.optional(v.array(v.object({ service: v.string(), amountMinor: v.number(), currency: v.string() }))),
});
const healthFreshnessPolicy = v.object({
  warningAfterMinutes: v.number(),
  criticalAfterMinutes: v.number(),
});

const commercialMetricsMode = v.union(v.literal("shadow"), v.literal("published"));
const bookingAuthorityPolicy = v.object({ sourceType: v.string(), requireReadback: v.boolean() });
const paymentAuthorityPolicy = v.object({ sourceTypes: v.array(v.string()), requireReadback: v.boolean() });
const recoveryPolicy = v.object({
  enabled: v.boolean(),
  window: v.object({ value: v.number(), unit: v.union(v.literal("hours"), v.literal("days")) }),
  priorStateTypes: v.array(v.union(v.literal("missed"), v.literal("stale"), v.literal("no_show"), v.literal("overdue"))),
});

export const organizationPolicyArgs = {
  timezone: v.optional(v.string()),
  defaultCurrency: v.optional(v.string()),
  attributionWindow: v.optional(attributionWindow),
  businessVertical: v.optional(v.string()),
  expectedBookingValuePolicy: v.optional(expectedBookingValuePolicy),
  commercialMetricsMode: v.optional(commercialMetricsMode),
  bookingAuthorityPolicy: v.optional(bookingAuthorityPolicy),
  paymentAuthorityPolicy: v.optional(paymentAuthorityPolicy),
  recoveryPolicy: v.optional(recoveryPolicy),
  healthFreshnessPolicy: v.optional(healthFreshnessPolicy),
  correlationId: v.optional(v.string()),
};

async function findSettings(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">) {
  const rows = await ctx.db
    .query("organizationSettings")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(2);
  if (rows.length > 1) throw new Error(`Integrity error: duplicate organization settings for ${organizationId}`);
  return rows[0] ?? null;
}

function completePolicy(value: Partial<OrganizationPolicy>): OrganizationPolicy {
  const policy = {
    ...DEFAULT_ORGANIZATION_POLICY,
    ...value,
    attributionWindow: { ...DEFAULT_ORGANIZATION_POLICY.attributionWindow, ...value.attributionWindow },
    expectedBookingValuePolicy: value.expectedBookingValuePolicy ?? DEFAULT_ORGANIZATION_POLICY.expectedBookingValuePolicy,
    commercialMetricsMode: value.commercialMetricsMode ?? DEFAULT_ORGANIZATION_POLICY.commercialMetricsMode,
    bookingAuthorityPolicy: value.bookingAuthorityPolicy ?? DEFAULT_ORGANIZATION_POLICY.bookingAuthorityPolicy,
    paymentAuthorityPolicy: value.paymentAuthorityPolicy ?? DEFAULT_ORGANIZATION_POLICY.paymentAuthorityPolicy,
    recoveryPolicy: value.recoveryPolicy ?? DEFAULT_ORGANIZATION_POLICY.recoveryPolicy,
    healthFreshnessPolicy: { ...DEFAULT_ORGANIZATION_POLICY.healthFreshnessPolicy, ...value.healthFreshnessPolicy },
  } as OrganizationPolicy;
  assertOrganizationPolicy(policy);
  return policy;
}

/** Internal lifecycle provisioning. The read-before-insert is part of the Convex OCC transaction. */
export async function ensureDefaultOrganizationSettings(
  ctx: MutationCtx,
  organizationId: GenericId<"organizations">,
  actor?: GenericId<"users">,
) {
  const organization = await ctx.db.get(organizationId);
  if (!organization || organization.active === false || organization.deletedAt !== undefined) {
    throw new Error("Cannot initialize settings for an unknown or inactive organization");
  }
  const existing = await findSettings(ctx, organizationId);
  if (existing) return existing;
  const now = Date.now();
  const id = await ctx.db.insert("organizationSettings", {
    organizationId,
    ...DEFAULT_ORGANIZATION_POLICY,
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
  });
  return ctx.db.get(id);
}

export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    const { organizationId } = await requireMember(ctx);
    const settings = await findSettings(ctx, organizationId);
    if (!settings) throw new Error("Organization settings are not initialized");
    return { ...settings, ...completePolicy(settings as unknown as Partial<OrganizationPolicy>) };
  },
});

export const initializeDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    const { organizationId, userId } = await requireRole(ctx, "manage_members");
    const settings = await ensureDefaultOrganizationSettings(ctx, organizationId, userId);
    if (!settings) throw new Error("Failed to initialize organization settings");
    await appendEvent(ctx, {
      organizationId,
      actor: userId,
      type: "organizationSettings.initialized",
      targetType: "organizationSettings",
      targetId: settings._id,
    });
    return settings;
  },
});

export const update = mutation({
  args: organizationPolicyArgs,
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireRole(ctx, "manage_members");
    const existing = await findSettings(ctx, organizationId);
    const current = existing ?? (await ensureDefaultOrganizationSettings(ctx, organizationId, userId));
    if (!current) throw new Error("Failed to initialize organization settings");
    if (args.commercialMetricsMode === "published") throw new Error("Use the owner-only commercial metrics publication toggle after readiness checks");
    const policy = completePolicy({
      timezone: args.timezone ?? current.timezone,
      defaultCurrency: args.defaultCurrency ?? current.defaultCurrency,
      attributionWindow: args.attributionWindow ?? current.attributionWindow,
      businessVertical: args.businessVertical ?? current.businessVertical,
      expectedBookingValuePolicy: (args.expectedBookingValuePolicy ?? current.expectedBookingValuePolicy) as OrganizationPolicy["expectedBookingValuePolicy"],
      commercialMetricsMode: args.commercialMetricsMode ?? current.commercialMetricsMode ?? "shadow",
      bookingAuthorityPolicy: args.bookingAuthorityPolicy ?? current.bookingAuthorityPolicy ?? DEFAULT_ORGANIZATION_POLICY.bookingAuthorityPolicy,
      paymentAuthorityPolicy: args.paymentAuthorityPolicy ?? current.paymentAuthorityPolicy ?? DEFAULT_ORGANIZATION_POLICY.paymentAuthorityPolicy,
      recoveryPolicy: args.recoveryPolicy ?? current.recoveryPolicy ?? DEFAULT_ORGANIZATION_POLICY.recoveryPolicy,
      healthFreshnessPolicy: args.healthFreshnessPolicy ?? current.healthFreshnessPolicy,
    });
    const now = Date.now();
    await ctx.db.patch(current._id, {
      ...policy,
      updatedAt: now,
      updatedBy: userId,
    });
    await appendEvent(ctx, {
      organizationId,
      actor: userId,
      type: "organizationSettings.updated",
      targetType: "organizationSettings",
      targetId: current._id,
      correlationId: args.correlationId,
    });
    return { ...(await ctx.db.get(current._id))!, ...policy, updatedAt: now, updatedBy: userId };
  },
});

export const publishCommercialMetrics = mutation({
  args: { correlationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireRole(ctx, "manage_members");
    const current = await findSettings(ctx, organizationId);
    if (!current) throw new Error("Organization settings are not initialized");
    const readiness = await publicationReadiness(ctx, organizationId);
    if (!readiness.ready) throw new Error(`Commercial metrics publication blocked: ${readiness.blockers.join("; ")}`);
    const now = Date.now();
    await ctx.db.patch(current._id, { commercialMetricsMode: "published", updatedAt: now, updatedBy: userId });
    await appendEvent(ctx, { organizationId, actor: userId, type: "commercialMetrics.published", targetType: "organizationSettings", targetId: current._id, correlationId: args.correlationId });
    return { ...(await ctx.db.get(current._id))!, commercialMetricsMode: "published" as const };
  },
});

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { GenericId } from "convex/values";
import { DEFAULT_ORGANIZATION_POLICY, assertOrganizationPolicy } from "./policy";
import type { OrganizationPolicy } from "../../lib/contracts/organizationSettings";

export type PublicationReadiness = {
  ready: boolean;
  blockers: string[];
  checks: {
    policyComplete: boolean;
    sourceMappingVerified: boolean;
    noDiscrepancies: boolean;
    currencyComplete: boolean;
    evidenceFresh: boolean;
  };
  latestComparison: unknown;
};

export function normalizePolicy(row: Partial<OrganizationPolicy>): OrganizationPolicy {
  return {
    ...DEFAULT_ORGANIZATION_POLICY,
    ...row,
    attributionWindow: { ...DEFAULT_ORGANIZATION_POLICY.attributionWindow, ...row.attributionWindow },
    expectedBookingValuePolicy: row.expectedBookingValuePolicy ?? DEFAULT_ORGANIZATION_POLICY.expectedBookingValuePolicy,
    bookingAuthorityPolicy: row.bookingAuthorityPolicy ?? DEFAULT_ORGANIZATION_POLICY.bookingAuthorityPolicy,
    paymentAuthorityPolicy: row.paymentAuthorityPolicy ?? DEFAULT_ORGANIZATION_POLICY.paymentAuthorityPolicy,
    recoveryPolicy: row.recoveryPolicy ?? DEFAULT_ORGANIZATION_POLICY.recoveryPolicy,
    healthFreshnessPolicy: { ...DEFAULT_ORGANIZATION_POLICY.healthFreshnessPolicy, ...row.healthFreshnessPolicy },
  };
}

export async function publicationReadiness(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">): Promise<PublicationReadiness> {
  const settings = await ctx.db.query("organizationSettings").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).take(2);
  if (settings.length > 1) throw new Error("Integrity error: duplicate organization settings");
  const policy = normalizePolicy((settings[0] ?? {}) as Partial<OrganizationPolicy>);
  let policyComplete = true;
  try { assertOrganizationPolicy(policy); } catch { policyComplete = false; }
  const latest = await ctx.db.query("commercialComparisons").withIndex("by_organization_time", (q) => q.eq("organizationId", organizationId)).order("desc").take(1);
  const comparison = latest[0];
  const checks = {
    policyComplete,
    sourceMappingVerified: comparison?.sourceMappingVerified === true,
    noDiscrepancies: comparison?.discrepancyCount === 0,
    currencyComplete: comparison?.missingCurrency === false,
    evidenceFresh: comparison?.staleEvidence === false,
  };
  const blockers: string[] = [];
  if (!checks.policyComplete || comparison?.policyComplete !== true) blockers.push("commercial policy is incomplete");
  if (!checks.sourceMappingVerified) blockers.push("authoritative source mapping is unverified");
  if (!checks.noDiscrepancies) blockers.push("authoritative comparison has discrepancies");
  if (!checks.currencyComplete) blockers.push("currency coverage is missing");
  if (!checks.evidenceFresh) blockers.push("commercial evidence is stale");
  return { ready: blockers.length === 0, blockers, checks, latestComparison: comparison ?? null };
}

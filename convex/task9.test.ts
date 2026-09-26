import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { chooseAttribution, type AttributionInteraction } from "./lib/attribution";
import { startOfOrganizationDay, startOfNextOrganizationDay } from "./lib/date";

const modules = import.meta.glob("./**/*.*s");
const ownerClaims = { subject: "task9-owner", org_id: "org_task9", org_role: "org:admin" };
const operatorClaims = { subject: "task9-operator", org_id: "org_task9", org_role: "org:operator" };
const rivalClaims = { subject: "task9-rival", org_id: "org_task9_rival", org_role: "org:admin" };

type TestContext = ReturnType<typeof convexTest>;

async function event(t: TestContext, eventId: string, eventType: string, data: object) {
  return t.mutation(internal.http.clerkWebhook.processEvent, {
    eventId,
    eventType,
    payload: JSON.stringify({ id: eventId, type: eventType, data }),
    eventTimestamp: 1_000,
  });
}

async function provision(claims = ownerClaims) {
  const t = convexTest(schema, modules);
  await event(t, `${claims.org_id}-org`, "organization.created", { id: claims.org_id, name: claims.org_id });
  await event(t, `${claims.subject}-user`, "user.created", { id: claims.subject });
  await event(t, `${claims.subject}-${claims.org_id}-membership`, "organizationMembership.created", {
    id: `${claims.subject}-${claims.org_id}-membership`,
    organization: { id: claims.org_id },
    public_user_data: { user_id: claims.subject },
    role: "org:admin",
  });
  const identity = t.withIdentity(claims);
  const organizationId = await t.run(async (ctx) => (await ctx.db.query("organizations").withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", claims.org_id)).unique())!._id);
  const customerId = await identity.mutation(api.customers.createCustomer, { displayName: "Commercial customer", email: `${claims.subject}@example.test` });
  return { t, identity, organizationId, customerId };
}

async function seedOpportunity(t: TestContext, organizationId: any, customerId: any, createdAt = 10_000) {
  return t.run(async (ctx) => ctx.db.insert("opportunities", {
    organizationId,
    customerId,
    sourceType: "crm",
    sourcePursuitId: `opp-${createdAt}`,
    title: "Service opportunity",
    stage: "qualified",
    status: "open",
    createdAt,
    updatedAt: createdAt,
  }));
}

async function seedInteraction(t: TestContext, organizationId: any, customerId: any, at: number, opportunityId?: any) {
  return t.run(async (ctx) => {
    const conversationId = await ctx.db.insert("conversations", {
      organizationId,
      customerId,
      channel: "voice",
      direction: "outbound",
      startedAt: at,
      lastActivityAt: at,
    });
    return ctx.db.insert("interactions", {
      organizationId,
      conversationId,
      customerId,
      opportunityId,
      direction: "outbound",
      at,
      summary: "Vectis interaction",
    });
  });
}

test("commercial facts use integer minor units, are shadow by default, and deduplicate tenant source IDs", async () => {
  const { identity, t, organizationId, customerId } = await provision();
  const opportunityId = await seedOpportunity(t, organizationId, customerId);
  const args = {
    customerId,
    opportunityId,
    kind: "booking" as const,
    status: "estimated" as const,
    amountMinor: 12500,
    currency: "INR",
    sourceType: "manual",
    sourceExternalId: "booking-1",
    evidenceAt: 20_000,
    coverageState: "verified" as const,
    confidence: 0.8,
  };
  const first = await identity.mutation(api.commercialOutcomes.ingest, args);
  const second = await identity.mutation(api.commercialOutcomes.ingest, args);
  expect(second).toEqual(first);
  const row = await identity.query(api.commercialOutcomes.get, { commercialOutcomeId: first });
  expect(row).toMatchObject({ amountMinor: 12500, currency: "INR", publicationState: "shadow", recovered: false });
  await expect(identity.mutation(api.commercialOutcomes.ingest, { ...args, amountMinor: 12501 })).rejects.toThrow(/duplicate|conflict/i);
  await expect(identity.mutation(api.commercialOutcomes.ingest, { ...args, sourceExternalId: "bad-major", amountMinor: 1.5 })).rejects.toThrow(/minor|integer/i);
});

test("concurrent identical source facts converge idempotently without duplicate rows", async () => {
  const { identity, t, organizationId, customerId } = await provision();
  const args = { customerId, kind: "booking" as const, status: "estimated" as const, sourceType: "provider", sourceExternalId: "concurrent-1", evidenceAt: 20_000, coverageState: "verified" as const };
  const results = await Promise.allSettled([identity.mutation(api.commercialOutcomes.ingest, args), identity.mutation(api.commercialOutcomes.ingest, args)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
  expect(new Set(results.map((result) => result.status === "fulfilled" ? result.value : "error"))).toHaveLength(1);
  expect(await t.run(async (ctx) => ctx.db.query("commercialOutcomes").collect())).toHaveLength(1);
});

test("booking confirmation and collected payment require authoritative evidence; calls never create revenue", async () => {
  const { identity, t, organizationId, customerId } = await provision();
  const opportunityId = await seedOpportunity(t, organizationId, customerId);
  const common = { customerId, opportunityId, amountMinor: 10000, currency: "INR", evidenceAt: 20_000, coverageState: "verified" as const, confidence: 1 };
  await expect(identity.mutation(api.commercialOutcomes.ingest, { ...common, kind: "booking", status: "confirmed", sourceType: "call_outcome", sourceExternalId: "call-1" })).rejects.toThrow(/authoritative/i);
  await expect(identity.mutation(api.commercialOutcomes.ingest, { ...common, kind: "payment", status: "collected", sourceType: "call_outcome", sourceExternalId: "call-2" })).rejects.toThrow(/authoritative/i);
  const confirmed = await identity.mutation(api.commercialOutcomes.ingest, { ...common, kind: "booking", status: "confirmed", sourceType: "twenty", sourceExternalId: "appt-1", authoritativeExternalId: "appt-1", readbackEvidence: '{"id":"appt-1"}', verifiedAt: 21_000 });
  expect(await identity.query(api.commercialOutcomes.get, { commercialOutcomeId: confirmed })).toMatchObject({ status: "confirmed", sourceType: "twenty" });
  const payment = await identity.mutation(api.commercialOutcomes.ingest, { ...common, kind: "payment", status: "collected", sourceType: "twenty", sourceExternalId: "payment-1", authoritativeExternalId: "payment-1", readbackEvidence: '{"id":"payment-1"}', verifiedAt: 21_000 });
  expect(await identity.query(api.commercialOutcomes.get, { commercialOutcomeId: payment })).toMatchObject({ status: "collected" });
});

test("attribution selects the latest preceding interaction with a stable tie-break and never crosses the window", () => {
  const rows: AttributionInteraction[] = [
    { id: "interaction-z", customerId: "customer-1", opportunityId: "opp-1", at: 90_000 },
    { id: "interaction-a", customerId: "customer-1", opportunityId: "opp-1", at: 90_000 },
    { id: "interaction-newer-but-after", customerId: "customer-1", opportunityId: "opp-1", at: 110_000 },
    { id: "other-customer", customerId: "customer-2", opportunityId: "opp-1", at: 99_000 },
  ];
  expect(chooseAttribution({ factAt: 100_000, customerId: "customer-1", opportunityId: "opp-1", windowMs: 20_000, interactions: rows })).toMatchObject({ interactionId: "interaction-a", influenced: true });
  expect(chooseAttribution({ factAt: 100_000, customerId: "customer-1", opportunityId: "opp-1", windowMs: 5_000, interactions: rows })).toMatchObject({ rule: "unattributed", influenced: false });
});

test("recovered is a persisted subset and requires prior-state evidence before the selected interaction", async () => {
  const { identity, t, organizationId, customerId } = await provision();
  const opportunityId = await seedOpportunity(t, organizationId, customerId);
  const interactionId = await seedInteraction(t, organizationId, customerId, 90_000, opportunityId);
  const recovered = await identity.mutation(api.commercialOutcomes.ingest, {
    customerId,
    opportunityId,
    interactionId,
    kind: "sale",
    status: "confirmed",
    amountMinor: 20000,
    currency: "INR",
    sourceType: "manual",
    sourceExternalId: "sale-recovered",
    evidenceAt: 100_000,
    coverageState: "verified",
    priorStateEvidence: { state: "stale", evidencedAt: 80_000, sourceType: "crm", sourceExternalId: "opp-stale" },
  });
  const row = await identity.query(api.commercialOutcomes.get, { commercialOutcomeId: recovered });
  expect(row).toMatchObject({ recovered: true, interactionId });
  const attribution = await identity.query(api.commercialOutcomes.getAttribution, { commercialOutcomeId: recovered });
  expect(attribution).toMatchObject({ influenced: true, recovered: true, priorStateEvidence: { state: "stale" } });
  await expect(identity.mutation(api.commercialOutcomes.ingest, {
    customerId, opportunityId, interactionId, kind: "sale", status: "confirmed", amountMinor: 1, currency: "INR", sourceType: "manual", sourceExternalId: "sale-bad-order", evidenceAt: 100_000, coverageState: "verified", priorStateEvidence: { state: "overdue", evidencedAt: 95_000, sourceType: "crm", sourceExternalId: "late" },
  })).rejects.toThrow(/before|prior/i);
});

test("analytics keeps statuses separate, reports funnel denominators and coverage, and card totals equal drilldowns", async () => {
  const { identity, t, organizationId, customerId } = await provision();
  const opportunityId = await seedOpportunity(t, organizationId, customerId);
  for (const [sourceExternalId, status, kind, amountMinor] of [["estimate", "estimated", "booking", 1000], ["confirmed", "confirmed", "sale", 2000], ["collected", "collected", "payment", 3000]] as const) {
    await identity.mutation(api.commercialOutcomes.ingest, { customerId, opportunityId, kind, status, amountMinor, currency: "INR", sourceType: status === "collected" ? "twenty" : "manual", sourceExternalId, evidenceAt: 20_000, coverageState: "verified", authoritativeExternalId: status === "collected" ? sourceExternalId : undefined, readbackEvidence: status === "collected" ? `{\"id\":\"${sourceExternalId}\"}` : undefined, verifiedAt: status === "collected" ? 21_000 : undefined });
  }
  const summary = await identity.query(api.analytics.getHomeSummary, { startAt: 0, endAt: 30_000 });
  expect(summary.totals).toMatchObject({ estimated: { amountMinor: 1000 }, confirmed: { amountMinor: 2000 }, collected: { amountMinor: 3000 } });
  expect(summary.funnel.qualified).toMatchObject({ denominator: expect.any(Number), conversionRate: expect.any(Number) });
  expect(summary.coverageWarnings.length).toBeGreaterThan(0);
  const page = await identity.query(api.analytics.getCommercialDrilldown, { drilldownId: "all", startAt: 0, endAt: 30_000, paginationOpts: { numItems: 2, cursor: null } });
  const estimated = await identity.query(api.analytics.getCommercialDrilldown, { drilldownId: "estimated", startAt: 0, endAt: 30_000, paginationOpts: { numItems: 100, cursor: null } });
  expect(summary.totalsByCurrency.INR.estimated.amountMinor).toBe(estimated.page.reduce((sum: number, item: { amountMinor?: number }) => sum + (item.amountMinor ?? 0), 0));
  expect(page.page.length).toBe(2);
  expect(summary.drilldown.query).toMatchObject({ drilldownId: "all" });
  expect(t).toBeDefined();
});

test("multi-currency facts are segregated and publishing is owner-only and readiness-gated", async () => {
  const { identity, organizationId, customerId, t } = await provision();
  const opportunityId = await seedOpportunity(t, organizationId, customerId);
  await identity.mutation(api.commercialOutcomes.ingest, { customerId, opportunityId, kind: "quote", status: "estimated", amountMinor: 100, currency: "USD", sourceType: "manual", sourceExternalId: "usd-1", evidenceAt: 20_000, coverageState: "unverified" });
  await event(t, "task9-operator-user", "user.created", { id: operatorClaims.subject });
  await event(t, "task9-operator-membership", "organizationMembership.created", { id: "task9-operator-membership", organization: { id: ownerClaims.org_id }, public_user_data: { user_id: operatorClaims.subject }, role: "org:operator" });
  await expect(identity.mutation(api.organizationSettings.publishCommercialMetrics, {})).rejects.toThrow(/blocked|coverage|mapping|shadow/i);
  await expect(t.withIdentity(operatorClaims).mutation(api.organizationSettings.publishCommercialMetrics, {})).rejects.toThrow(/owner/i);
  await identity.mutation(api.commercialOutcomes.recordShadowComparison, { sourceType: "twenty", comparedAt: 25_000, sourceMappingVerified: true, discrepancyCount: 0, missingCurrency: false, staleEvidence: false, policyComplete: true });
  await expect(identity.mutation(api.organizationSettings.publishCommercialMetrics, {})).resolves.toMatchObject({ commercialMetricsMode: "published" });
  expect((await identity.query(api.organizationSettings.getCurrent, {})).commercialMetricsMode).toBe("published");
});

test("organization day boundaries use the configured timezone across DST", () => {
  const policy = { timezone: "America/New_York" } as const;
  const day = Date.parse("2026-03-08T12:00:00Z");
  const start = startOfOrganizationDay(day, policy);
  const end = startOfNextOrganizationDay(day, policy);
  expect(end - start).toBe(23 * 60 * 60 * 1000);
});

test("commercial facts and analytics are tenant scoped", async () => {
  const first = await provision();
  const rival = await provision(rivalClaims);
  const opportunityId = await seedOpportunity(first.t, first.organizationId, first.customerId);
  const factId = await first.identity.mutation(api.commercialOutcomes.ingest, { customerId: first.customerId, opportunityId, kind: "booking", status: "estimated", sourceType: "manual", sourceExternalId: "tenant-fact", evidenceAt: 20_000, coverageState: "verified" });
  await expect(rival.identity.query(api.commercialOutcomes.get, { commercialOutcomeId: factId })).rejects.toThrow(/not found|tenant/i);
  await expect(rival.identity.query(api.analytics.getHomeSummary, { startAt: 0, endAt: 30_000 })).resolves.toMatchObject({ totals: { estimated: { count: 0 } } });
});

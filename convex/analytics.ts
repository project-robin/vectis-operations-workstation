import { query, type QueryCtx } from "./_generated/server";
import { v, type GenericId } from "convex/values";
import { requireMember } from "./lib/auth";
import { normalizePolicy, publicationReadiness } from "./lib/commercialPolicy";

const paginationOpts = v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) });
const rangeArgs = { startAt: v.number(), endAt: v.number() };
const MAX_PAGE = 100;
const MAX_SCAN = 5000;

type Row = { kind: "booking" | "quote" | "sale" | "closed_won" | "payment_promise" | "payment" | "estimated_booking"; amountMinor?: number; currency?: string; status: "estimated" | "confirmed" | "collected"; recovered: boolean; interactionId?: GenericId<"interactions">; verifiedAt?: number; _id: GenericId<"commercialOutcomes">; evidenceAt: number; publicationState: "shadow" | "published" | "withheld"; coverageState: "verified" | "partial" | "unverified" | "unknown" };

function assertRange(startAt: number, endAt: number) {
  if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt) || startAt < 0 || endAt <= startAt) throw new Error("Analytics date range is invalid");
  if (endAt - startAt > 366 * 24 * 60 * 60 * 1000) throw new Error("Analytics date range exceeds one year");
}

function emptyMetric() { return { count: 0, amountMinor: 0 }; }

async function scopedFacts(ctx: QueryCtx, organizationId: GenericId<"organizations">, startAt: number, endAt: number): Promise<Row[]> {
  const rows = await ctx.db.query("commercialOutcomes").withIndex("by_organization_time", (q) => q.eq("organizationId", organizationId)).order("asc").take(MAX_SCAN + 1);
  if (rows.length > MAX_SCAN) throw new Error("Analytics result bound exceeded");
  return rows.filter((row) => row.evidenceAt >= startAt && row.evidenceAt < endAt) as Row[];
}

function metric(rows: Row[], selected: Row["status"]) {
  return rows.filter((row) => row.status === selected).reduce((result, row) => ({ count: result.count + 1, amountMinor: result.amountMinor + (row.amountMinor ?? 0) }), emptyMetric());
}

function conversion(numerator: number, denominator: number) { return { numerator, denominator, conversionRate: denominator === 0 ? 0 : numerator / denominator }; }

async function funnel(ctx: QueryCtx, organizationId: GenericId<"organizations">, startAt: number, endAt: number) {
  const imports = await ctx.db.query("importRows").withIndex("by_organization_eligible", (q) => q.eq("organizationId", organizationId)).take(MAX_SCAN + 1);
  const sourceRows = imports.filter((row) => row.createdAt >= startAt && row.createdAt < endAt);
  const eligible = sourceRows.filter((row) => row.eligible);
  const interactions = await ctx.db.query("interactions").withIndex("by_organization_customer_time", (q) => q.eq("organizationId", organizationId)).take(MAX_SCAN + 1);
  const calls = interactions.filter((row) => row.at >= startAt && row.at < endAt);
  const outcomes = await ctx.db.query("callOutcomes").withIndex("by_organization_customer", (q) => q.eq("organizationId", organizationId)).take(MAX_SCAN + 1);
  const callOutcomes = outcomes.filter((row) => row.createdAt >= startAt && row.createdAt < endAt);
  const facts = await scopedFacts(ctx, organizationId, startAt, endAt);
  const requested = callOutcomes.filter((row) => row.outcomeType === "booking_requested").length;
  const confirmed = facts.filter((row) => row.kind === "booking" && row.status === "confirmed").length;
  const collected = facts.filter((row) => row.status === "collected").length;
  const reached = callOutcomes.filter((row) => row.fields.reached === true || row.outcomeType === "reached" || row.outcomeType === "qualified").length;
  const qualified = callOutcomes.filter((row) => row.fields.qualified === true || row.outcomeType === "qualified").length;
  return {
    imported: { count: sourceRows.length, ...conversion(sourceRows.length, sourceRows.length) },
    eligible: { count: eligible.length, ...conversion(eligible.length, sourceRows.length) },
    called: { count: calls.length, ...conversion(calls.length, eligible.length) },
    reached: { count: reached, ...conversion(reached, calls.length) },
    qualified: { count: qualified, ...conversion(qualified, reached) },
    bookingRequested: { count: requested, ...conversion(requested, qualified) },
    bookingConfirmed: { count: confirmed, ...conversion(confirmed, requested) },
    collected: { count: collected, ...conversion(collected, confirmed) },
  };
}

function definitions() {
  return {
    estimated: "Pipeline or booking value without authoritative confirmation; not revenue.",
    confirmed: "Commercial value with authoritative confirmation, displayed separately from collected.",
    collected: "Payment value with authoritative payment evidence.",
    influenced: "A commercial fact linked by the stored deterministic attribution rule to a preceding Vectis interaction.",
    recovered: "A strict subset of influenced value with prior missed/stale/no_show/overdue evidence before the interaction.",
  };
}

async function summary(ctx: QueryCtx, organizationId: GenericId<"organizations">, startAt: number, endAt: number) {
  assertRange(startAt, endAt);
  const policy = normalizePolicy((await ctx.db.query("organizationSettings").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).take(1))[0] as never);
  const facts = await scopedFacts(ctx, organizationId, startAt, endAt);
  const byCurrency: Record<string, { currency: string; totalCount: number; estimated: ReturnType<typeof emptyMetric>; confirmed: ReturnType<typeof emptyMetric>; collected: ReturnType<typeof emptyMetric> }> = {};
  for (const row of facts) {
    const currency = row.currency ?? "MISSING";
    const entry = byCurrency[currency] ?? { currency, totalCount: 0, estimated: emptyMetric(), confirmed: emptyMetric(), collected: emptyMetric() };
    entry.totalCount += 1;
    entry[row.status].count += 1;
    entry[row.status].amountMinor += row.amountMinor ?? 0;
    byCurrency[currency] = entry;
  }
  const coverageWarnings = new Set<string>();
  if (policy.commercialMetricsMode === "shadow") coverageWarnings.add("Commercial metrics are in shadow mode pending owner publication.");
  if (facts.some((row) => row.coverageState !== "verified")) coverageWarnings.add("Some commercial facts have unverified or partial source coverage.");
  if (facts.some((row) => !row.currency)) coverageWarnings.add("Some commercial facts are missing currency and are withheld from currency totals.");
  if (Object.keys(byCurrency).filter((value) => value !== policy.defaultCurrency).length > 0) coverageWarnings.add("Multiple currencies are segregated; no cross-currency total is calculated.");
  const comparison = (await ctx.db.query("commercialComparisons").withIndex("by_organization_time", (q) => q.eq("organizationId", organizationId)).order("desc").take(1))[0];
  if (!comparison || !comparison.sourceMappingVerified || comparison.discrepancyCount > 0) coverageWarnings.add("Authoritative Twenty/business comparison is not verified or has discrepancies.");
  const verifiedAt = facts.reduce<number | undefined>((max, row) => row.verifiedAt !== undefined && (max === undefined || row.verifiedAt > max) ? row.verifiedAt : max, comparison?.comparedAt);
  const totals = { estimated: metric(facts.filter((row) => row.currency === policy.defaultCurrency), "estimated"), confirmed: metric(facts.filter((row) => row.currency === policy.defaultCurrency), "confirmed"), collected: metric(facts.filter((row) => row.currency === policy.defaultCurrency), "collected") };
  const defaultTotals = byCurrency[policy.defaultCurrency];
  const aggregatePublicationState = policy.commercialMetricsMode === "published" && facts.every((row) => row.coverageState === "verified") ? "published" : "shadow";
  return {
    definitions: definitions(),
    currency: policy.defaultCurrency,
    coverageWarnings: [...coverageWarnings],
    lastVerification: verifiedAt ?? null,
    shadowPublishedState: policy.commercialMetricsMode,
    publicationState: aggregatePublicationState,
    totals,
    totalsByCurrency: byCurrency,
    influenced: { byCurrency: facts.filter((row) => row.interactionId !== undefined).reduce<Record<string, number>>((result, row) => { const currency = row.currency ?? "MISSING"; result[currency] = (result[currency] ?? 0) + (row.amountMinor ?? 0); return result; }, {}), recoveredByCurrency: facts.filter((row) => row.recovered).reduce<Record<string, number>>((result, row) => { const currency = row.currency ?? "MISSING"; result[currency] = (result[currency] ?? 0) + (row.amountMinor ?? 0); return result; }, {}) },
    defaultCurrencyTotals: defaultTotals ?? { currency: policy.defaultCurrency, totalCount: 0, estimated: emptyMetric(), confirmed: emptyMetric(), collected: emptyMetric() },
    funnel: await funnel(ctx, organizationId, startAt, endAt),
    drilldown: { id: "all", query: { drilldownId: "all", startAt, endAt } },
  };
}

export const getHomeSummary = query({ args: rangeArgs, handler: async (ctx, args) => { const { organizationId } = await requireMember(ctx); return summary(ctx, organizationId, args.startAt, args.endAt); } });
export const getAnalytics = query({ args: rangeArgs, handler: async (ctx, args) => { const { organizationId } = await requireMember(ctx); return summary(ctx, organizationId, args.startAt, args.endAt); } });

export const getCommercialDrilldown = query({ args: { ...rangeArgs, drilldownId: v.string(), paginationOpts }, handler: async (ctx, args) => {
  assertRange(args.startAt, args.endAt);
  if (!Number.isSafeInteger(args.paginationOpts.numItems) || args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > MAX_PAGE) throw new Error("Pagination must request between 1 and 100 items");
  const { organizationId } = await requireMember(ctx);
  const facts = await scopedFacts(ctx, organizationId, args.startAt, args.endAt);
  const policy = normalizePolicy((await ctx.db.query("organizationSettings").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).take(1))[0] as never);
  const statusId = ["estimated", "confirmed", "collected"].includes(args.drilldownId);
  const filtered = args.drilldownId === "all" ? facts : statusId ? facts.filter((row) => row.status === args.drilldownId && row.currency === policy.defaultCurrency) : facts.filter((row) => row.currency === args.drilldownId || (args.drilldownId === "recovered" && row.recovered));
  const offset = args.paginationOpts.cursor ? Number(args.paginationOpts.cursor) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid analytics cursor");
  const page = filtered.slice(offset, offset + args.paginationOpts.numItems);
  const next = offset + page.length;
  const comparison = (await ctx.db.query("commercialComparisons").withIndex("by_organization_time", (q) => q.eq("organizationId", organizationId)).order("desc").take(1))[0];
  const warnings = new Set<string>();
  if (policy.commercialMetricsMode === "shadow") warnings.add("Commercial metrics are in shadow mode pending owner publication.");
  if (filtered.some((row) => row.coverageState !== "verified")) warnings.add("Some rows have unverified or partial coverage.");
  if (filtered.some((row) => row.currency !== undefined && row.currency !== policy.defaultCurrency)) warnings.add("Multiple currencies are segregated; no cross-currency total is calculated.");
  if (!comparison || !comparison.sourceMappingVerified || comparison.discrepancyCount > 0) warnings.add("Authoritative comparison is not verified or has discrepancies.");
  return { page, isDone: next >= filtered.length, continueCursor: next >= filtered.length ? null : String(next), definitions: definitions(), currency: policy.defaultCurrency, coverageWarnings: [...warnings], lastVerification: filtered.reduce<number | undefined>((max, row) => row.verifiedAt !== undefined && (max === undefined || row.verifiedAt > max) ? row.verifiedAt : max, comparison?.comparedAt) ?? null, shadowPublishedState: policy.commercialMetricsMode, publicationState: policy.commercialMetricsMode === "published" && filtered.every((row) => row.coverageState === "verified") ? "published" : "shadow", drilldownId: args.drilldownId };
} });

export const getPublicationReadiness = query({ args: {}, handler: async (ctx) => { const { organizationId } = await requireMember(ctx); return publicationReadiness(ctx, organizationId); } });

export const getSummary = getHomeSummary;

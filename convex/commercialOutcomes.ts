import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v, type GenericId } from "convex/values";
import { requireMember, requireRole } from "./lib/auth";
import { appendEvent } from "./lib/events";
import { assertCurrency, assertMinorAmount } from "./lib/policy";
import { chooseAttribution, type PriorStateEvidence } from "./lib/attribution";
import { normalizePolicy } from "./lib/commercialPolicy";

const kind = v.union(v.literal("booking"), v.literal("quote"), v.literal("sale"), v.literal("closed_won"), v.literal("payment_promise"), v.literal("payment"), v.literal("estimated_booking"));
const status = v.union(v.literal("estimated"), v.literal("confirmed"), v.literal("collected"));
const coverageState = v.union(v.literal("verified"), v.literal("partial"), v.literal("unverified"), v.literal("unknown"));
const priorState = v.union(v.literal("missed"), v.literal("stale"), v.literal("no_show"), v.literal("overdue"));
const priorStateEvidence = v.object({ state: priorState, evidencedAt: v.number(), sourceType: v.string(), sourceExternalId: v.string(), evidenceReference: v.optional(v.string()) });
const paginationOpts = v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) });
const MAX_PAGE = 100;
const MAX_SCAN = 5000;

export const factArgs = {
  customerId: v.id("customers"),
  opportunityId: v.optional(v.id("opportunities")),
  interactionId: v.optional(v.id("interactions")),
  providerRunId: v.optional(v.string()),
  kind,
  status,
  amountMinor: v.optional(v.number()),
  currency: v.optional(v.string()),
  sourceType: v.string(),
  sourceExternalId: v.string(),
  evidenceAt: v.number(),
  verifiedAt: v.optional(v.number()),
  evidenceReference: v.optional(v.string()),
  evidenceHash: v.optional(v.string()),
  coverageState,
  authoritativeExternalId: v.optional(v.string()),
  readbackEvidence: v.optional(v.string()),
  confidence: v.optional(v.number()),
  priorStateEvidence: v.optional(priorStateEvidence),
  note: v.optional(v.string()),
};

type FactInput = {
  customerId: GenericId<"customers">;
  opportunityId?: GenericId<"opportunities">;
  interactionId?: GenericId<"interactions">;
  providerRunId?: string;
  kind: "booking" | "quote" | "sale" | "closed_won" | "payment_promise" | "payment" | "estimated_booking";
  status: "estimated" | "confirmed" | "collected";
  amountMinor?: number;
  currency?: string;
  sourceType: string;
  sourceExternalId: string;
  evidenceAt: number;
  verifiedAt?: number;
  evidenceReference?: string;
  evidenceHash?: string;
  coverageState: "verified" | "partial" | "unverified" | "unknown";
  authoritativeExternalId?: string;
  readbackEvidence?: string;
  confidence?: number;
  priorStateEvidence?: PriorStateEvidence;
  note?: string;
};

async function settings(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">) {
  const rows = await ctx.db.query("organizationSettings").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).take(2);
  if (rows.length > 1) throw new Error("Integrity error: duplicate organization settings");
  return normalizePolicy((rows[0] ?? {}) as never);
}

async function ownCustomer(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">, customerId: GenericId<"customers">) {
  const row = await ctx.db.get(customerId);
  if (!row || row.organizationId !== organizationId || row.mergedInto) throw new Error("Customer not found");
  return row;
}

async function ownOpportunity(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">, customerId: GenericId<"customers">, opportunityId?: GenericId<"opportunities">) {
  if (!opportunityId) return undefined;
  const row = await ctx.db.get(opportunityId);
  if (!row || row.organizationId !== organizationId || row.customerId !== customerId) throw new Error("Opportunity does not belong to organization/customer");
  return row;
}

async function ownInteraction(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">, customerId: GenericId<"customers">, interactionId?: GenericId<"interactions">) {
  if (!interactionId) return undefined;
  const row = await ctx.db.get(interactionId);
  if (!row || row.organizationId !== organizationId || row.customerId !== customerId) throw new Error("Interaction does not belong to organization/customer");
  return row;
}

function assertFactInput(args: FactInput, policy: ReturnType<typeof normalizePolicy>) {
  if (!args.sourceType || !args.sourceExternalId || args.sourceExternalId.length > 512) throw new Error("Commercial source type and external ID are required");
  if (!Number.isSafeInteger(args.evidenceAt) || args.evidenceAt < 0) throw new Error("Commercial evidence timestamp is invalid");
  if (args.verifiedAt !== undefined && (!Number.isSafeInteger(args.verifiedAt) || args.verifiedAt < args.evidenceAt)) throw new Error("verifiedAt must be after evidenceAt");
  if (args.amountMinor !== undefined) {
    if (!args.currency) throw new Error("Currency is required with amountMinor");
    assertMinorAmount(args.amountMinor, args.currency);
  }
  if (args.currency) assertCurrency(args.currency);
  if (args.confidence !== undefined && (!Number.isFinite(args.confidence) || args.confidence < 0 || args.confidence > 1)) throw new Error("Confidence must be between 0 and 1");
  if (args.kind === "booking" && args.status === "collected") throw new Error("Booking cannot be collected revenue");
  if (args.status === "confirmed" && args.kind === "booking") {
    if (args.sourceType !== policy.bookingAuthorityPolicy.sourceType || !args.authoritativeExternalId || !args.readbackEvidence) throw new Error("Confirmed booking requires authoritative read-back evidence");
  }
  if (args.status === "collected") {
    if (args.kind !== "payment" || !args.amountMinor || !args.currency) throw new Error("Collected status requires an authoritative payment amount");
    if (!policy.paymentAuthorityPolicy.sourceTypes.includes(args.sourceType) || (policy.paymentAuthorityPolicy.requireReadback && (!args.authoritativeExternalId || !args.readbackEvidence))) throw new Error("Collected payment requires authoritative payment evidence");
  }
  if (args.sourceType === "call_outcome" && (args.status !== "estimated" || args.kind === "payment" || args.kind === "sale" || args.kind === "closed_won")) throw new Error("Call evidence cannot be authoritative revenue");
  if (args.priorStateEvidence && args.priorStateEvidence.evidencedAt >= args.evidenceAt) throw new Error("Prior-state evidence must predate the commercial fact");
}

async function existingSource(ctx: MutationCtx, organizationId: GenericId<"organizations">, sourceType: string, sourceExternalId: string) {
  const rows = await ctx.db.query("commercialOutcomes").withIndex("by_organization_source", (q) => q.eq("organizationId", organizationId).eq("sourceType", sourceType).eq("sourceExternalId", sourceExternalId)).take(2);
  if (rows.length > 1) throw new Error("Integrity error: duplicate commercial source fact");
  return rows[0];
}

async function writeFact(ctx: MutationCtx, organizationId: GenericId<"organizations">, args: FactInput, actor?: GenericId<"users">) {
  const policy = await settings(ctx, organizationId);
  assertFactInput(args, policy);
  await ownCustomer(ctx, organizationId, args.customerId);
  const opportunity = await ownOpportunity(ctx, organizationId, args.customerId, args.opportunityId);
  await ownInteraction(ctx, organizationId, args.customerId, args.interactionId);
  if (args.providerRunId) {
    const runs = await ctx.db.query("providerRuns").withIndex("by_organization_provider_run", (q) => q.eq("organizationId", organizationId).eq("providerRunId", args.providerRunId)).take(2);
    if (runs.length > 1 || !runs[0]) throw new Error("Provider run does not belong to organization");
  }
  const duplicate = await existingSource(ctx, organizationId, args.sourceType, args.sourceExternalId);
  if (duplicate) {
    const same = duplicate.customerId === args.customerId && duplicate.amountMinor === args.amountMinor && duplicate.currency === args.currency && duplicate.status === args.status && duplicate.kind === args.kind;
    if (!same) throw new Error("Duplicate commercial source fact conflicts with existing evidence");
    return duplicate._id;
  }

  const interactions = await ctx.db.query("interactions").withIndex("by_organization_customer_time", (q) => q.eq("organizationId", organizationId).eq("customerId", args.customerId)).take(MAX_SCAN);
  const attributionWindowMs = (policy.attributionWindow.unit === "days" ? policy.attributionWindow.value * 24 : policy.attributionWindow.value) * 60 * 60 * 1000;
  const recoveryWindowMs = (policy.recoveryPolicy.window.unit === "days" ? policy.recoveryPolicy.window.value * 24 : policy.recoveryPolicy.window.value) * 60 * 60 * 1000;
  const selection = chooseAttribution({
    factAt: args.evidenceAt,
    customerId: args.customerId,
    opportunityId: args.opportunityId,
    windowMs: attributionWindowMs,
    recoveryWindowMs,
    recoveryPriorStateTypes: policy.recoveryPolicy.priorStateTypes,
    interactions: interactions.map((row) => ({ id: row._id, customerId: row.customerId, opportunityId: row.opportunityId, at: row.at, providerRunId: row.providerRunId })),
    priorStateEvidence: policy.recoveryPolicy.enabled ? args.priorStateEvidence : undefined,
  });
  if (args.priorStateEvidence && selection.interactionId) {
    const selected = interactions.find((row) => row._id === selection.interactionId);
    if (selected && args.priorStateEvidence.evidencedAt >= selected.at) throw new Error("Prior-state evidence must predate the selected Vectis interaction");
  }
  const now = Date.now();
  const id = await ctx.db.insert("commercialOutcomes", {
    organizationId,
    customerId: args.customerId,
    opportunityId: opportunity?._id,
    interactionId: selection.interactionId as GenericId<"interactions"> | undefined,
    providerRunId: args.providerRunId ?? selection.providerRunId,
    kind: args.kind,
    status: args.status,
    amountMinor: args.amountMinor,
    currency: args.currency,
    sourceType: args.sourceType,
    sourceExternalId: args.sourceExternalId,
    evidenceAt: args.evidenceAt,
    verifiedAt: args.verifiedAt,
    evidenceReference: args.evidenceReference,
    evidenceHash: args.evidenceHash,
    coverageState: args.coverageState,
    publicationState: policy.commercialMetricsMode === "published" && args.coverageState === "verified" ? "published" : "shadow",
    authoritativeExternalId: args.authoritativeExternalId,
    readbackEvidence: args.readbackEvidence,
    recovered: selection.recovered,
    priorState: selection.priorStateEvidence?.state,
    confidence: args.confidence ?? selection.confidence,
    note: args.note,
    createdAt: now,
  });
  if (args.priorStateEvidence) {
    const evidenceRows = await ctx.db.query("opportunityStateEvidence").withIndex("by_organization_source", (q) => q.eq("organizationId", organizationId).eq("sourceType", args.priorStateEvidence!.sourceType).eq("sourceExternalId", args.priorStateEvidence!.sourceExternalId)).take(2);
    if (evidenceRows.length > 1) throw new Error("Integrity error: duplicate prior-state evidence");
    if (!evidenceRows[0]) await ctx.db.insert("opportunityStateEvidence", { organizationId, customerId: args.customerId, opportunityId: opportunity?._id, ...args.priorStateEvidence, createdAt: now });
  }
  await ctx.db.insert("attributions", {
    organizationId,
    commercialOutcomeId: id,
    opportunityId: opportunity?._id,
    interactionId: selection.interactionId as GenericId<"interactions"> | undefined,
    providerRunId: args.providerRunId ?? selection.providerRunId,
    rule: selection.rule,
    ruleVersion: selection.ruleVersion,
    windowMs: attributionWindowMs,
    influenced: selection.influenced,
    recovered: selection.recovered,
    priorStateEvidence: selection.priorStateEvidence,
    confidence: selection.confidence,
    explanation: selection.explanation,
    attributedAt: now,
    createdAt: now,
  });
  await appendEvent(ctx, { organizationId, actor, type: "commercialOutcome.ingested", targetType: "commercialOutcome", targetId: id, payload: JSON.stringify({ sourceType: args.sourceType, sourceExternalId: args.sourceExternalId, status: args.status }) });
  return id;
}

export const ingest = mutation({ args: factArgs, handler: async (ctx, args) => { const { organizationId, userId } = await requireRole(ctx, "operate"); return writeFact(ctx, organizationId, args as FactInput, userId); } });
export const ingestInternal = internalMutation({ args: { organizationId: v.id("organizations"), ...factArgs }, handler: async (ctx, args) => writeFact(ctx, args.organizationId, args as FactInput, undefined) });

export const get = query({ args: { commercialOutcomeId: v.id("commercialOutcomes") }, handler: async (ctx, args) => {
  const { organizationId } = await requireMember(ctx);
  const row = await ctx.db.get(args.commercialOutcomeId);
  if (!row || row.organizationId !== organizationId) throw new Error("Commercial outcome not found");
  return row;
} });

export const getAttribution = query({ args: { commercialOutcomeId: v.id("commercialOutcomes") }, handler: async (ctx, args) => {
  const { organizationId } = await requireMember(ctx);
  const outcome = await ctx.db.get(args.commercialOutcomeId);
  if (!outcome || outcome.organizationId !== organizationId) throw new Error("Commercial outcome not found");
  const rows = await ctx.db.query("attributions").withIndex("by_organization_outcome", (q) => q.eq("organizationId", organizationId).eq("commercialOutcomeId", args.commercialOutcomeId)).take(2);
  if (rows.length > 1) throw new Error("Integrity error: duplicate attribution");
  return rows[0] ?? null;
} });

export const list = query({ args: { paginationOpts, startAt: v.optional(v.number()), endAt: v.optional(v.number()), status: v.optional(status) }, handler: async (ctx, args) => {
  if (!Number.isSafeInteger(args.paginationOpts.numItems) || args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > MAX_PAGE) throw new Error("Pagination must request between 1 and 100 items");
  const { organizationId } = await requireMember(ctx);
  const offset = args.paginationOpts.cursor ? Number(args.paginationOpts.cursor) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid commercial cursor");
  const rows = await ctx.db.query("commercialOutcomes").withIndex("by_organization_time", (q) => q.eq("organizationId", organizationId)).order("desc").take(MAX_SCAN + 1);
  if (rows.length > MAX_SCAN) throw new Error("Commercial result bound exceeded");
  const filtered = rows.filter((row) => (args.startAt === undefined || row.evidenceAt >= args.startAt) && (args.endAt === undefined || row.evidenceAt < args.endAt) && (!args.status || row.status === args.status));
  const page = filtered.slice(offset, offset + args.paginationOpts.numItems);
  const next = offset + page.length;
  return { page, isDone: next >= filtered.length, continueCursor: next >= filtered.length ? null : String(next) };
} });

export const recordShadowComparison = mutation({ args: { sourceType: v.string(), comparedAt: v.number(), sourceMappingVerified: v.boolean(), discrepancyCount: v.number(), missingCurrency: v.boolean(), staleEvidence: v.boolean(), policyComplete: v.boolean(), detail: v.optional(v.string()) }, handler: async (ctx, args) => {
  const { organizationId, userId } = await requireRole(ctx, "manage_members");
  if (!Number.isSafeInteger(args.comparedAt) || args.comparedAt < 0 || !Number.isSafeInteger(args.discrepancyCount) || args.discrepancyCount < 0) throw new Error("Comparison metadata is invalid");
  const id = await ctx.db.insert("commercialComparisons", { organizationId, ...args });
  await appendEvent(ctx, { organizationId, actor: userId, type: "commercialMetrics.shadowCompared", targetType: "commercialComparison", targetId: id });
  return id;
} });

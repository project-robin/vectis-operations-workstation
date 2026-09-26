import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v, type GenericId } from "convex/values";
import { requireMember, requireRole } from "./lib/auth";
import { appendEvent } from "./lib/events";
import { findIdentity, normalizeEmail, normalizePhone } from "./lib/customerResolver";

const paginationOpts = v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) });
const MAX_PAGE = 100;

function assertPage(opts: { numItems: number }) {
  if (!Number.isSafeInteger(opts.numItems) || opts.numItems < 1 || opts.numItems > MAX_PAGE) throw new Error(`Pagination must request between 1 and ${MAX_PAGE} items`);
}

async function ownCustomer(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">, customerId: GenericId<"customers">) {
  const customer = await ctx.db.get(customerId);
  if (!customer || customer.organizationId !== organizationId || customer.mergedInto) throw new Error("Customer not found");
  return customer;
}

export const createCustomer = mutation({
  args: { displayName: v.string(), phone: v.optional(v.string()), email: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { organizationId } = await requireRole(ctx, "operate");
    const phone = normalizePhone(args.phone);
    const email = normalizeEmail(args.email);
    if (args.phone !== undefined && !phone) throw new Error("Invalid phone identity");
    if (args.email !== undefined && !email) throw new Error("Invalid email identity");
    if (phone && await findIdentity(ctx, organizationId, "phone", phone)) throw new Error("Identity already belongs to a customer");
    if (email && await findIdentity(ctx, organizationId, "email", email)) throw new Error("Identity already belongs to a customer");
    const customerId = await ctx.db.insert("customers", { organizationId, displayName: args.displayName, phone, email, createdAt: Date.now() });
    if (phone) await ctx.db.insert("customerIdentities", { organizationId, kind: "phone", normalizedValue: phone, customerId, createdAt: Date.now() });
    if (email) await ctx.db.insert("customerIdentities", { organizationId, kind: "email", normalizedValue: email, customerId, createdAt: Date.now() });
    return customerId;
  },
});

export const listCustomers = query({
  args: { paginationOpts, search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    assertPage(args.paginationOpts);
    const { organizationId } = await requireMember(ctx);
    const search = args.search?.trim().toLowerCase();
    if (search) {
      return ctx.db.query("customers")
        .withSearchIndex("search_name", (q) => q.search("displayName", search).eq("organizationId", organizationId))
        .filter((q) => q.eq(q.field("mergedInto"), undefined))
        .paginate(args.paginationOpts);
    }
    return ctx.db.query("customers")
      .withIndex("by_organization_name", (q) => q.eq("organizationId", organizationId))
      .filter((q) => q.eq(q.field("mergedInto"), undefined))
      .order("asc")
      .paginate(args.paginationOpts);
  },
});

export const getCustomer = query({
  args: { customerId: v.id("customers"), paginationOpts: v.optional(paginationOpts) },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMember(ctx);
    const customer = await ownCustomer(ctx, organizationId, args.customerId);
    const rows = await ctx.db.query("importRows")
      .withIndex("by_organization_customer", (q) => q.eq("organizationId", organizationId).eq("customerId", args.customerId))
      .order("desc");
    if (args.paginationOpts) {
      assertPage(args.paginationOpts);
      const page = await rows.paginate(args.paginationOpts);
      return { customer, provenance: page };
    }
    const bounded = await rows.take(MAX_PAGE);
    const provenance = [];
    for (const row of bounded) {
      const batch = await ctx.db.get(row.batchId);
      provenance.push({ batchName: batch?.name ?? "unknown batch", rowIndex: row.rowIndex, rawName: row.rawName, rawPhone: row.rawPhone, rawEmail: row.rawEmail, consent: row.consent, consentSource: row.consentSource, consentEvidenceAt: row.consentEvidenceAt, mappingVersion: row.mappingVersion, validationStatus: row.validationStatus, exclusionReason: row.exclusionReason, resolutionExclusionReason: row.resolutionExclusionReason });
    }
    return { customer, provenance };
  },
});

export const listIdentityReviews = query({
  args: { paginationOpts },
  handler: async (ctx, args) => {
    assertPage(args.paginationOpts);
    const { organizationId } = await requireMember(ctx);
    return ctx.db.query("identityReviewItems").withIndex("by_organization_status", (q) => q.eq("organizationId", organizationId).eq("status", "open")).order("desc").paginate(args.paginationOpts);
  },
});

export const resolveIdentityReview = mutation({
  args: { reviewId: v.id("identityReviewItems"), customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireRole(ctx, "approve");
    const review = await ctx.db.get(args.reviewId);
    if (!review || review.organizationId !== organizationId || review.status !== "open") throw new Error("Identity review not found");
    if (!review.candidateCustomerIds.includes(args.customerId)) throw new Error("Customer is not a review candidate");
    await ownCustomer(ctx, organizationId, args.customerId);
    const row = await ctx.db.get(review.importRowId);
    if (!row || row.organizationId !== organizationId) throw new Error("Import row not found");
    const batch = await ctx.db.get(row.batchId);
    const eligible = batch?.status === "approved" && row.validationStatus === "valid" && row.consent === "consented";
    await ctx.db.patch(row._id, { customerId: args.customerId, eligible, resolutionExclusionReason: eligible ? undefined : row.resolutionExclusionReason, committedAt: row.committedAt ?? Date.now() });
    await ctx.db.patch(review._id, { status: "resolved", resolvedCustomerId: args.customerId, resolvedBy: userId, resolvedAt: Date.now() });
    await appendEvent(ctx, { organizationId, actor: userId, type: "identityReview.resolved", targetType: "identityReviewItem", targetId: review._id, payload: JSON.stringify({ customerId: args.customerId, importRowId: row._id }) });
    return review._id;
  },
});

export const mergeCustomers = mutation({
  args: { sourceCustomerId: v.id("customers"), targetCustomerId: v.id("customers") },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireRole(ctx, "approve");
    if (args.sourceCustomerId === args.targetCustomerId) throw new Error("Cannot merge a customer into itself");
    const source = await ownCustomer(ctx, organizationId, args.sourceCustomerId);
    await ownCustomer(ctx, organizationId, args.targetCustomerId);
    const identities = await ctx.db.query("customerIdentities").withIndex("by_organization_customer", (q) => q.eq("organizationId", organizationId).eq("customerId", args.sourceCustomerId)).take(MAX_PAGE + 1);
    if (identities.length > MAX_PAGE) throw new Error("Customer identity bound exceeded");
    for (const identity of identities) {
      const existing = await findIdentity(ctx, organizationId, identity.kind, identity.normalizedValue);
      if (existing && existing._id !== identity._id && existing.customerId === args.targetCustomerId) await ctx.db.delete(identity._id);
      else if (existing && existing._id !== identity._id) throw new Error("Cannot merge customers with an identity conflict");
      else await ctx.db.patch(identity._id, { customerId: args.targetCustomerId });
    }
    const rows = await ctx.db.query("importRows").withIndex("by_organization_customer", (q) => q.eq("organizationId", organizationId).eq("customerId", args.sourceCustomerId)).take(MAX_PAGE + 1);
    if (rows.length > MAX_PAGE) throw new Error("Customer provenance bound exceeded");
    for (const row of rows) await ctx.db.patch(row._id, { customerId: args.targetCustomerId });
    const opportunities = await ctx.db.query("opportunities").withIndex("by_organization_customer", (q) => q.eq("organizationId", organizationId).eq("customerId", args.sourceCustomerId)).take(MAX_PAGE + 1);
    if (opportunities.length > MAX_PAGE) throw new Error("Customer opportunity bound exceeded");
    for (const opportunity of opportunities) await ctx.db.patch(opportunity._id, { customerId: args.targetCustomerId, updatedAt: Date.now() });
    await ctx.db.patch(source._id, { mergedInto: args.targetCustomerId });
    const record = await ctx.db.insert("customerMergeRecords", { organizationId, sourceCustomerId: args.sourceCustomerId, targetCustomerId: args.targetCustomerId, mergedBy: userId, createdAt: Date.now() });
    await appendEvent(ctx, { organizationId, actor: userId, type: "customer.merged", targetType: "customer", targetId: args.targetCustomerId, payload: JSON.stringify({ sourceCustomerId: args.sourceCustomerId, mergeRecordId: record }) });
    return { status: "merged" as const, sourceCustomerId: args.sourceCustomerId, targetCustomerId: args.targetCustomerId, mergeRecordId: record };
  },
});

import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireMember } from "./lib/auth";

const paginationOpts = v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) });
const MAX_PAGE = 100;
function assertPage(value: { numItems: number }) {
  if (!Number.isSafeInteger(value.numItems) || value.numItems < 1 || value.numItems > MAX_PAGE) throw new Error(`Pagination must request between 1 and ${MAX_PAGE} items`);
}

export const listCustomerConversations = query({
  args: { customerId: v.id("customers"), paginationOpts: v.optional(paginationOpts) },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMember(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.organizationId !== organizationId || customer.mergedInto) throw new Error("Customer not found");
    const rows = ctx.db.query("conversations")
      .withIndex("by_organization_customer_time", (q) => q.eq("organizationId", organizationId).eq("customerId", args.customerId))
      .order("desc");
    if (args.paginationOpts) {
      assertPage(args.paginationOpts);
      return rows.paginate(args.paginationOpts);
    }
    return rows.take(MAX_PAGE);
  },
});

export const listRecentConversations = query({
  args: { paginationOpts: v.optional(paginationOpts), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMember(ctx);
    if (args.paginationOpts) {
      assertPage(args.paginationOpts);
      return ctx.db.query("conversations")
        .withIndex("by_organization_customer_time", (q) => q.eq("organizationId", organizationId))
        .order("desc")
        .paginate(args.paginationOpts);
    }
    const limit = args.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) throw new Error(`Limit must be between 1 and ${MAX_PAGE}`);
    return ctx.db.query("conversations")
      .withIndex("by_organization_customer_time", (q) => q.eq("organizationId", organizationId))
      .order("desc")
      .take(limit);
  },
});

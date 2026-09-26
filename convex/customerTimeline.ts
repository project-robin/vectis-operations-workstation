import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireMember } from "./lib/auth";

const paginationOpts = v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) });
const MAX_PAGE = 100;
const SOURCE_LIMIT = 200;
function assertPage(value: { numItems: number }) {
  if (!Number.isSafeInteger(value.numItems) || value.numItems < 1 || value.numItems > MAX_PAGE) throw new Error(`Pagination must request between 1 and ${MAX_PAGE} items`);
}
function offset(cursor: string | null | undefined) {
  if (!cursor) return 0;
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid timeline cursor");
  return value;
}

type TimelineEvent = {
  at: number;
  kind: "import" | "call" | "outcome" | "opportunity" | "appointment" | "work" | "commercial";
  title: string;
  detail?: string;
  evidence: { table: string; id: string };
};

export const getCustomerTimeline = query({
  args: { customerId: v.id("customers"), paginationOpts: v.optional(paginationOpts) },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMember(ctx);
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.organizationId !== organizationId || customer.mergedInto) throw new Error("Customer not found");
    if (args.paginationOpts) assertPage(args.paginationOpts);

    const [imports, interactions, outcomes, opportunities, appointments, workItems, commercial] = await Promise.all([
      ctx.db.query("importRows").withIndex("by_organization_customer", (q) => q.eq("organizationId", organizationId).eq("customerId", args.customerId)).order("desc").take(SOURCE_LIMIT),
      ctx.db.query("interactions").withIndex("by_organization_customer_time", (q) => q.eq("organizationId", organizationId).eq("customerId", args.customerId)).order("desc").take(SOURCE_LIMIT),
      ctx.db.query("callOutcomes").withIndex("by_organization_customer", (q) => q.eq("organizationId", organizationId).eq("customerId", args.customerId)).order("desc").take(SOURCE_LIMIT),
      ctx.db.query("opportunities").withIndex("by_organization_customer", (q) => q.eq("organizationId", organizationId).eq("customerId", args.customerId)).order("desc").take(SOURCE_LIMIT),
      ctx.db.query("appointments").withIndex("by_organization_customer", (q) => q.eq("organizationId", organizationId).eq("customerId", args.customerId)).order("desc").take(SOURCE_LIMIT),
      ctx.db.query("workItems").withIndex("by_organization_customer", (q) => q.eq("organizationId", organizationId).eq("customerId", args.customerId)).order("desc").take(SOURCE_LIMIT),
      ctx.db.query("commercialOutcomes").withIndex("by_organization_customer", (q) => q.eq("organizationId", organizationId).eq("customerId", args.customerId)).order("desc").take(SOURCE_LIMIT),
    ]);
    const events: TimelineEvent[] = [];
    for (const row of imports) events.push({ at: row.createdAt, kind: "import", title: "Imported customer source row", evidence: { table: "importRows", id: row._id } });
    for (const row of interactions) events.push({ at: row.at, kind: "call", title: `${row.direction === "inbound" ? "Inbound" : "Outbound"} call`, detail: row.summary, evidence: { table: "interactions", id: row._id } });
    for (const row of outcomes) events.push({ at: row.createdAt, kind: "outcome", title: `Business outcome: ${row.outcomeType}`, detail: row.fields.summary, evidence: { table: "callOutcomes", id: row._id } });
    for (const row of opportunities) events.push({ at: row.updatedAt, kind: "opportunity", title: `Opportunity: ${row.stage}`, detail: row.title, evidence: { table: "opportunities", id: row._id } });
    for (const row of appointments) events.push({ at: row.scheduledFor ?? row.createdAt, kind: "appointment", title: `Appointment ${row.status}`, detail: row.title, evidence: { table: "appointments", id: row._id } });
    for (const row of workItems) events.push({ at: row.dueAt ?? row.createdAt, kind: "work", title: `Work item: ${row.type}`, detail: row.aiSummary, evidence: { table: "workItems", id: row._id } });
    for (const row of commercial) events.push({ at: row.evidenceAt, kind: "commercial", title: `${row.kind} (${row.status})`, detail: row.note, evidence: { table: "commercialOutcomes", id: row._id } });
    events.sort((a, b) => b.at - a.at || b.evidence.id.localeCompare(a.evidence.id));

    const pageSize = args.paginationOpts?.numItems ?? Math.min(events.length, SOURCE_LIMIT);
    const start = offset(args.paginationOpts?.cursor);
    const page = events.slice(start, start + pageSize);
    const next = start + page.length;
    const isDone = next >= events.length;
    return {
      customer: { id: customer._id, name: customer.displayName, phone: customer.phone, email: customer.email },
      events: page,
      items: page,
      isDone,
      continueCursor: isDone ? null : String(next),
      // These are bounded authoritative projections, retained for detail panes.
      outcomes,
      appointments,
      workItems,
      commercial,
      interactions,
      opportunities,
      imports,
    };
  },
});

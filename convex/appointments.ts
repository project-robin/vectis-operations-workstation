import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v, type GenericId } from "convex/values";
import { requireMember, requireRole } from "./lib/auth";
import { appendEvent } from "./lib/events";
import { assertAppointmentTransition, assertAuthoritativeReadback, type AppointmentStatus } from "../lib/contracts/appointment";

const appointmentStatus = v.union(v.literal("requested"), v.literal("confirmed"), v.literal("cancelled"), v.literal("no_show"), v.literal("completed"));
const paginationOpts = v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) });
const MAX_PAGE = 100;

function pageArgs(value: { numItems: number; cursor: string | null }) {
  if (!Number.isSafeInteger(value.numItems) || value.numItems < 1 || value.numItems > MAX_PAGE) throw new Error(`Pagination must request between 1 and ${MAX_PAGE} items`);
  const offset = value.cursor ? Number(value.cursor) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid appointment cursor");
  return { offset, limit: value.numItems };
}

async function customerInTenant(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">, customerId: GenericId<"customers">) {
  const customer = await ctx.db.get(customerId);
  if (!customer || customer.organizationId !== organizationId || customer.mergedInto) throw new Error("Customer not found");
  return customer;
}

async function linkedInTenant(ctx: MutationCtx, organizationId: GenericId<"organizations">, customerId: GenericId<"customers">, id: GenericId<"conversations"> | GenericId<"callOutcomes"> | GenericId<"opportunities"> | undefined, table: "conversations" | "callOutcomes" | "opportunities") {
  if (!id) return;
  const row = await ctx.db.get(id);
  if (!row || row.organizationId !== organizationId || ("customerId" in row && row.customerId !== customerId)) throw new Error(`${table} does not belong to organization/customer`);
}

async function scoped(ctx: QueryCtx | MutationCtx, organizationId: GenericId<"organizations">, appointmentId: GenericId<"appointments">) {
  const appointment = await ctx.db.get(appointmentId);
  if (!appointment || appointment.organizationId !== organizationId) throw new Error("Appointment not found");
  return appointment;
}

export const requestAppointment = mutation({
  args: { customerId: v.id("customers"), conversationId: v.optional(v.id("conversations")), outcomeId: v.optional(v.id("callOutcomes")), opportunityId: v.optional(v.id("opportunities")), title: v.optional(v.string()), note: v.optional(v.string()), scheduledFor: v.optional(v.number()), sourceType: v.optional(v.string()), sourceExternalId: v.optional(v.string()), bindingId: v.optional(v.id("integrationBindings")), correlationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireRole(ctx, "operate");
    await customerInTenant(ctx, organizationId, args.customerId);
    await linkedInTenant(ctx, organizationId, args.customerId, args.conversationId, "conversations");
    await linkedInTenant(ctx, organizationId, args.customerId, args.outcomeId, "callOutcomes");
    await linkedInTenant(ctx, organizationId, args.customerId, args.opportunityId, "opportunities");
    if (args.bindingId) {
      const binding = await ctx.db.get(args.bindingId);
      if (!binding || binding.organizationId !== organizationId) throw new Error("Integration binding does not belong to organization");
    }
    if (args.sourceType && args.sourceExternalId) {
      const existing = await ctx.db.query("appointments").withIndex("by_organization_source", (q) => q.eq("organizationId", organizationId).eq("sourceType", args.sourceType).eq("sourceExternalId", args.sourceExternalId)).take(2);
      if (existing.length > 1) throw new Error("Integrity error: duplicate appointment source fact");
      if (existing[0]) return existing[0]._id;
    }
    const now = Date.now();
    const id = await ctx.db.insert("appointments", { organizationId, customerId: args.customerId, conversationId: args.conversationId, outcomeId: args.outcomeId, opportunityId: args.opportunityId, status: "requested", requestedAt: now, scheduledFor: args.scheduledFor, title: args.title, note: args.note, sourceType: args.sourceType, sourceExternalId: args.sourceExternalId, bindingId: args.bindingId, createdAt: now, updatedAt: now });
    await appendEvent(ctx, { organizationId, actor: userId, type: "appointment.requested", targetType: "appointments", targetId: id, correlationId: args.correlationId });
    return id;
  },
});

export const recordAppointmentStatus = mutation({
  args: { appointmentId: v.id("appointments"), status: appointmentStatus, scheduledFor: v.optional(v.number()), note: v.optional(v.string()), correlationId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { organizationId, userId } = await requireRole(ctx, "operate");
    const appointment = await scoped(ctx, organizationId, args.appointmentId);
    if (args.status === "confirmed") throw new Error("Appointment confirmation is only valid after authoritative Twenty/calendar read-back");
    assertAppointmentTransition(appointment.status as AppointmentStatus, args.status as AppointmentStatus);
    const now = Date.now();
    await ctx.db.patch(appointment._id, { status: args.status, scheduledFor: args.scheduledFor ?? appointment.scheduledFor, note: args.note ?? appointment.note, updatedAt: now });
    await appendEvent(ctx, { organizationId, actor: userId, type: `appointment.${args.status}`, targetType: "appointments", targetId: appointment._id, correlationId: args.correlationId });
    return appointment._id;
  },
});

export const listCustomerAppointments = query({
  args: { customerId: v.id("customers"), status: v.optional(appointmentStatus), includeHistory: v.optional(v.boolean()), paginationOpts: v.optional(paginationOpts) },
  handler: async (ctx, args) => {
    const { organizationId } = await requireMember(ctx);
    await customerInTenant(ctx, organizationId, args.customerId);
    const opts = pageArgs(args.paginationOpts ?? { numItems: MAX_PAGE, cursor: null });
    const rows = await ctx.db.query("appointments").withIndex("by_organization_customer", (q) => q.eq("organizationId", organizationId).eq("customerId", args.customerId)).order("desc").take(MAX_PAGE * 5);
    const filtered = rows.filter((row) => (!args.status || row.status === args.status) && (args.status ? true : args.includeHistory || row.status === "requested" || row.status === "confirmed"));
    const page = filtered.slice(opts.offset, opts.offset + opts.limit);
    const next = opts.offset + page.length;
    return { page, isDone: next >= filtered.length, continueCursor: next >= filtered.length ? null : String(next) };
  },
});

export async function projectOutcomeAppointment(ctx: MutationCtx, args: { organizationId: GenericId<"organizations">; outcomeId: GenericId<"callOutcomes">; now?: number }) {
  const outcome = await ctx.db.get(args.outcomeId);
  if (!outcome || outcome.organizationId !== args.organizationId) throw new Error("Outcome not found");
  if (outcome.outcomeType !== "booking_requested" || !outcome.fields.bookingRequested) return null;
  const sourceType = "call_outcome";
  const sourceExternalId = String(outcome._id);
  const existing = await ctx.db.query("appointments").withIndex("by_organization_source", (q) => q.eq("organizationId", args.organizationId).eq("sourceType", sourceType).eq("sourceExternalId", sourceExternalId)).take(2);
  if (existing.length > 1) throw new Error("Integrity error: duplicate appointment source fact");
  if (existing[0]) return existing[0]._id;
  const now = args.now ?? Date.now();
  const id = await ctx.db.insert("appointments", { organizationId: args.organizationId, customerId: outcome.customerId, conversationId: outcome.conversationId, outcomeId: outcome._id, status: "requested", requestedAt: now, title: "Appointment requested", note: outcome.fields.summary, sourceType, sourceExternalId, createdAt: now, updatedAt: now });
  await appendEvent(ctx, { organizationId: args.organizationId, type: "appointment.requested", targetType: "appointments", targetId: id, correlationId: outcome.providerRunId, payload: JSON.stringify({ sourceOutcomeId: outcome._id }) });
  return id;
}

export const projectFromOutcome = internalMutation({ args: { organizationId: v.id("organizations"), outcomeId: v.id("callOutcomes") }, handler: async (ctx, args) => projectOutcomeAppointment(ctx, args) });

export const confirmFromReadback = internalMutation({
  args: { appointmentId: v.id("appointments"), externalId: v.string(), readbackEvidence: v.string(), bindingId: v.optional(v.id("integrationBindings")), now: v.number() },
  handler: async (ctx, args) => {
    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) throw new Error("Appointment not found");
    assertAuthoritativeReadback(args.externalId, args.readbackEvidence);
    assertAppointmentTransition(appointment.status as AppointmentStatus, "confirmed");
    await ctx.db.patch(appointment._id, { status: "confirmed", authoritativeExternalId: args.externalId, sourceExternalId: args.externalId, readbackEvidence: args.readbackEvidence, bindingId: args.bindingId ?? appointment.bindingId, updatedAt: args.now });
    await appendEvent(ctx, { organizationId: appointment.organizationId, type: "appointment.confirmed", targetType: "appointments", targetId: appointment._id, correlationId: args.externalId, payload: args.readbackEvidence });
    return appointment._id;
  },
});

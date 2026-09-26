import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const ownerClaims = { subject: "task7-owner", org_id: "org_task7", org_role: "org:admin" };
const rivalClaims = { subject: "task7-rival", org_id: "org_task7-rival", org_role: "org:admin" };

async function provision(claims = ownerClaims) {
  const t = convexTest(schema, modules);
  const identity = t.withIdentity(claims);
  const event = (eventId: string, eventType: string, data: object) => t.mutation(internal.http.clerkWebhook.processEvent, { eventId, eventType, payload: JSON.stringify({ id: eventId, type: eventType, data }), eventTimestamp: 1_000 });
  await event(`${claims.subject}-user`, "user.created", { id: claims.subject });
  await event(`${claims.org_id}-org`, "organization.created", { id: claims.org_id, name: claims.org_id });
  await event(`${claims.subject}-${claims.org_id}-membership`, "organizationMembership.created", { id: `${claims.subject}-${claims.org_id}-membership`, organization: { id: claims.org_id }, public_user_data: { user_id: claims.subject }, role: "org:admin" });
  const customerId = await identity.mutation(api.customers.createCustomer, { displayName: "Task 7 Customer", phone: "+919000000007" });
  const organizationId = await t.run(async (ctx) => (await ctx.db.query("organizations").withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", claims.org_id)).unique())!._id);
  return { t, identity, customerId, organizationId };
}

test("work item lifecycle enforces roles, legal transitions, assignees, resolution, and proposal-only follow-up", async () => {
  const { identity, customerId, t } = await provision();
  const itemId = await identity.mutation(api.workItems.createWorkItem, { customerId, type: "handoff", aiSummary: "Needs a human", dedupeKey: "handoff-1" });
  await expect(identity.mutation(api.workItems.setWorkItemStatus, { workItemId: itemId, status: "resolved" })).rejects.toThrow(/Illegal/i);
  await expect(identity.mutation(api.workItems.setWorkItemStatus, { workItemId: itemId, status: "investigating" })).rejects.toThrow(/Illegal/i);
  const ownerId = await t.run(async (ctx) => (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", ownerClaims.subject)).unique())!._id);
  await identity.mutation(api.workItems.assignWorkItem, { workItemId: itemId, assignee: ownerId });
  await identity.mutation(api.workItems.setWorkItemStatus, { workItemId: itemId, status: "investigating" });
  await expect(identity.mutation(api.workItems.setWorkItemStatus, { workItemId: itemId, status: "resolved" })).rejects.toThrow(/resolution/i);
  await identity.mutation(api.workItems.setWorkItemStatus, { workItemId: itemId, status: "waiting_for_customer" });
  await identity.mutation(api.workItems.setWorkItemStatus, { workItemId: itemId, status: "investigating" });
  await identity.mutation(api.workItems.setWorkItemStatus, { workItemId: itemId, status: "resolved", resolution: "Customer received a human response", followUpProposal: { note: "Check back next week" } });
  const item = await identity.query(api.workItems.getWorkItem, { workItemId: itemId });
  expect(item).toMatchObject({ status: "resolved", resolution: "Customer received a human response", followUpProposal: { note: "Check back next week" } });
  expect(await t.run(async (ctx) => (await ctx.db.query("deliveries").collect()).length)).toBe(0);
  expect(await t.run(async (ctx) => (await ctx.db.query("operationEvents").collect()).filter((row) => row.targetId === itemId).length)).toBeGreaterThanOrEqual(5);
});

test("outcome projection is idempotent and tenant scoped", async () => {
  const first = await provision();
  const outcomeId = await first.t.run(async (ctx) => ctx.db.insert("callOutcomes", { organizationId: first.organizationId, customerId: first.customerId, version: 1, outcomeType: "dispute", fields: { dispute: true, bookingConfirmed: false, summary: "Billing dispute" }, createdAt: 2_000 }));
  await Promise.all([first.t.mutation(internal.workItems.projectFromOutcome, { organizationId: first.organizationId, outcomeId }), first.t.mutation(internal.workItems.projectFromOutcome, { organizationId: first.organizationId, outcomeId })]);
  const items = await first.t.run(async (ctx) => ctx.db.query("workItems").collect());
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ type: "dispute", sourceOutcomeId: outcomeId, dedupeKey: `outcome:${outcomeId}` });
  const rival = await provision(rivalClaims);
  await expect(rival.identity.query(api.workItems.getWorkItem, { workItemId: items[0]._id })).rejects.toThrow(/not found/i);
});

test("booking outcome creates requested appointment, never provider-confirmed, and read-back confirms it", async () => {
  const { identity, t, customerId, organizationId } = await provision();
  const outcomeId = await t.run(async (ctx) => ctx.db.insert("callOutcomes", { organizationId, customerId, version: 1, outcomeType: "booking_requested", fields: { bookingRequested: true, bookingConfirmed: false, summary: "Tomorrow" }, createdAt: 3_000 }));
  const appointmentId = await t.mutation(internal.appointments.projectFromOutcome, { organizationId, outcomeId });
  expect(await identity.query(api.appointments.listCustomerAppointments, { customerId, includeHistory: true, paginationOpts: { numItems: 10, cursor: null } })).toMatchObject({ page: [expect.objectContaining({ status: "requested" })] });
  await expect(identity.mutation(api.appointments.recordAppointmentStatus, { appointmentId: appointmentId!, status: "confirmed" })).rejects.toThrow(/authoritative/i);
  await t.mutation(internal.appointments.confirmFromReadback, { appointmentId: appointmentId!, externalId: "twenty-appt-7", readbackEvidence: '{"id":"twenty-appt-7"}', now: 4_000 });
  const timeline = await identity.query(api.customerTimeline.getCustomerTimeline, { customerId });
  expect(timeline.events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "appointment", title: "Appointment confirmed" })]));
});

test("delivery reservation is tenant-idempotent and only one concurrent caller gets a lease", async () => {
  const { t, organizationId, customerId } = await provision();
  const args = { organizationId, idempotencyKey: "same-key", target: "twenty_person" as const, payload: JSON.stringify({ input: { name: "Asha" } }), customerId, now: 10_000 };
  const [one, two] = await Promise.all([t.mutation(internal.deliveries.reserve, args), t.mutation(internal.deliveries.reserve, args)]);
  expect(one).toBe(two);
  const deliveryId = one;
  const claims = await Promise.all([t.mutation(internal.deliveries.claim, { deliveryId, now: 11_000 }), t.mutation(internal.deliveries.claim, { deliveryId, now: 11_001 })]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const row = await t.run(async (ctx) => ctx.db.get(deliveryId));
  expect((row as { target: string }).target).toBe("twenty_person");
});

test("stale lease recovery, ambiguous failures, bounded retries, and matching completion are enforced", async () => {
  const { t, organizationId } = await provision();
  const deliveryId = await t.mutation(internal.deliveries.reserve, { organizationId, idempotencyKey: "lease-key", target: "twenty_note", payload: "{}", now: 20_000, maxAttempts: 2 });
  const first = (await t.mutation(internal.deliveries.claim, { deliveryId, now: 20_001 }))!;
  await expect(t.mutation(internal.deliveries.finish, { deliveryId, leaseToken: "wrong", ok: true, externalIds: ["x"], readbackEvidence: "{}", now: 20_002 })).rejects.toThrow(/lease/i);
  const recovered = (await t.mutation(internal.deliveries.claim, { deliveryId, now: 80_002 }))!;
  expect(recovered.leaseToken).not.toBe(first.leaseToken);
  const ambiguous = await t.mutation(internal.deliveries.finish, { deliveryId, leaseToken: recovered.leaseToken, ok: false, error: "timeout", now: 80_003 });
  expect(ambiguous.status).toBe("reconciliation_required");
  await expect(t.mutation(internal.deliveries.retryDue, { organizationId, now: 100_000 })).resolves.toBe(0);
  const row = await t.run(async (ctx) => ctx.db.get(deliveryId));
  expect(row).toMatchObject({ status: "reconciliation_required", attempts: 2, maxAttempts: 2 });
});

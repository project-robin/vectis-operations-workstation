import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const ownerClaims = { subject: "opp-owner", org_id: "opp-org", org_role: "org:admin" };
const operatorClaims = { subject: "opp-operator", org_id: "opp-org", org_role: "org:operator" };

async function event(t: ReturnType<typeof convexTest>, id: string, type: string, data: object) {
  return t.mutation(internal.http.clerkWebhook.processEvent, {
    eventId: id, eventType: type, payload: JSON.stringify({ id, type, data }), eventTimestamp: Date.now(),
  });
}

async function setup(t: ReturnType<typeof convexTest>) {
  await event(t, "opp-owner-user", "user.created", { id: ownerClaims.subject });
  await event(t, "opp-operator-user", "user.created", { id: operatorClaims.subject });
  await event(t, "opp-org-created", "organization.created", { id: ownerClaims.org_id, name: "Opportunities" });
  for (const [id, subject, role] of [["opp-owner-membership", ownerClaims.subject, "org:admin"], ["opp-operator-membership", operatorClaims.subject, "org:operator"]] as const) {
    await event(t, id, "organizationMembership.created", { id: `${id}-id`, organization: { id: ownerClaims.org_id }, public_user_data: { user_id: subject }, role });
  }
  return { owner: t.withIdentity(ownerClaims), operator: t.withIdentity(operatorClaims) };
}

test("one opportunity is idempotent per organization and source pursuit, with integer policy currency", async () => {
  const t = convexTest(schema, modules);
  const { owner, operator } = await setup(t);
  const customerId = await operator.mutation(api.customers.createCustomer, { displayName: "Asha", email: "asha@example.com" });
  const first = await operator.mutation(api.opportunities.createOpportunity, {
    customerId, sourceType: "crm", sourcePursuitId: "deal-1", title: "Consultation", stage: "qualified", expectedValueMinor: 125000,
  });
  const replay = await operator.mutation(api.opportunities.createOpportunity, {
    customerId, sourceType: "crm", sourcePursuitId: "deal-1", title: "Changed title", stage: "proposal", expectedValueMinor: 999,
  });
  expect(replay.opportunityId).toBe(first.opportunityId);
  expect(replay.created).toBe(false);
  const concurrent = await Promise.all([
    operator.mutation(api.opportunities.createOpportunity, { customerId, sourceType: "crm", sourcePursuitId: "deal-concurrent", title: "Concurrent", stage: "lead" }),
    operator.mutation(api.opportunities.createOpportunity, { customerId, sourceType: "crm", sourcePursuitId: "deal-concurrent", title: "Concurrent", stage: "lead" }),
  ]);
  expect(concurrent[0].opportunityId).toBe(concurrent[1].opportunityId);
  expect(concurrent.filter((result) => result.created)).toHaveLength(1);
  expect((await operator.query(api.opportunities.listOpportunities, { paginationOpts: { numItems: 20, cursor: null } })).page).toHaveLength(2);
  await expect(operator.mutation(api.opportunities.updateOpportunity, { opportunityId: first.opportunityId, status: "won", terminalOutcome: "paid" })).resolves.toMatchObject({ status: "won", terminalOutcome: "paid" });
  await expect(operator.mutation(api.opportunities.updateOpportunity, { opportunityId: first.opportunityId, status: "open" })).rejects.toThrow(/terminal|won|closed/i);
  await expect(owner.mutation(api.opportunities.updateOpportunity, { opportunityId: first.opportunityId, expectedValueMinor: -1 })).rejects.toThrow(/amount|minor/i);
});

test("opportunity source-row links are cross-validated and excluded rows require explicit owner action", async () => {
  const t = convexTest(schema, modules);
  const { owner, operator } = await setup(t);
  const batchId = await operator.mutation(api.imports.stageImport, { name: "excluded", rows: [{ name: "Asha", phone: "9000000042", consent: "unconsented" }] });
  await operator.mutation(api.imports.commitBatch, { batchId });
  const row = await t.run(async (ctx) => (await ctx.db.query("importRows").collect())[0]!);
  const customerId = row.customerId!;
  await expect(operator.mutation(api.opportunities.createOpportunity, { customerId, sourceRowId: row._id, sourceType: "import", sourcePursuitId: "row-1", title: "Blocked", stage: "lead" })).rejects.toThrow(/eligible|consent|owner/i);
  await expect(owner.mutation(api.opportunities.createOpportunity, { customerId, sourceRowId: row._id, sourceType: "import", sourcePursuitId: "row-1", title: "Approved override", stage: "lead", ownerOverride: true })).resolves.toMatchObject({ created: true });
  const wrongCustomer = await owner.mutation(api.customers.createCustomer, { displayName: "Wrong" });
  await expect(owner.mutation(api.opportunities.createOpportunity, { customerId: wrongCustomer, sourceRowId: row._id, sourceType: "import", sourcePursuitId: "row-2", title: "Wrong customer", stage: "lead", ownerOverride: true })).rejects.toThrow(/customer|row|belong/i);
});

test("opportunity reads are tenant-scoped and pagination is bounded", async () => {
  const t = convexTest(schema, modules);
  const { owner } = await setup(t);
  const customerId = await owner.mutation(api.customers.createCustomer, { displayName: "Private" });
  const opportunity = await owner.mutation(api.opportunities.createOpportunity, { customerId, sourceType: "manual", sourcePursuitId: "private-1", title: "Private", stage: "lead" });
  const rival = t.withIdentity({ subject: "opp-rival", org_id: "opp-other", org_role: "org:admin" });
  await event(t, "opp-rival-user", "user.created", { id: "opp-rival" });
  await event(t, "opp-other-org", "organization.created", { id: "opp-other", name: "Other" });
  await event(t, "opp-rival-membership", "organizationMembership.created", { id: "opp-rival-membership-id", organization: { id: "opp-other" }, public_user_data: { user_id: "opp-rival" }, role: "org:admin" });
  await expect(rival.query(api.opportunities.listOpportunities, { paginationOpts: { numItems: 1, cursor: null } })).resolves.toMatchObject({ page: [] });
  await expect(rival.query(api.opportunities.getOpportunity, { opportunityId: opportunity.opportunityId })).rejects.toThrow(/not found|tenant|organization/i);
});

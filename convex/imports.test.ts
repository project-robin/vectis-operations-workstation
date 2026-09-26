import { convexTest } from "convex-test";
import { createHash } from "node:crypto"
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const ownerClaims = { subject: "task5-owner", org_id: "task5-org", org_role: "org:admin" };
const operatorClaims = { subject: "task5-operator", org_id: "task5-org", org_role: "org:operator" };
const rivalClaims = { subject: "task5-rival", org_id: "task5-rival-org", org_role: "org:admin" };

async function event(t: ReturnType<typeof convexTest>, id: string, type: string, data: object) {
  return t.mutation(internal.http.clerkWebhook.processEvent, {
    eventId: id,
    eventType: type,
    payload: JSON.stringify({ id, type, data }),
    eventTimestamp: Date.now(),
  });
}

async function setup(t: ReturnType<typeof convexTest>) {
  for (const [id, type, data] of [
    ["task5-owner-user", "user.created", { id: ownerClaims.subject }],
    ["task5-operator-user", "user.created", { id: operatorClaims.subject }],
    ["task5-rival-user", "user.created", { id: rivalClaims.subject }],
    ["task5-org", "organization.created", { id: ownerClaims.org_id, name: "Task 5" }],
    ["task5-rival-org", "organization.created", { id: rivalClaims.org_id, name: "Rival" }],
  ] as const) await event(t, id, type, data);
  await event(t, "task5-owner-membership", "organizationMembership.created", {
    id: "task5-owner-membership-id", organization: { id: ownerClaims.org_id },
    public_user_data: { user_id: ownerClaims.subject }, role: "org:admin",
  });
  await event(t, "task5-operator-membership", "organizationMembership.created", {
    id: "task5-operator-membership-id", organization: { id: ownerClaims.org_id },
    public_user_data: { user_id: operatorClaims.subject }, role: "org:operator",
  });
  await event(t, "task5-rival-membership", "organizationMembership.created", {
    id: "task5-rival-membership-id", organization: { id: rivalClaims.org_id },
    public_user_data: { user_id: rivalClaims.subject }, role: "org:admin",
  });
  return {
    owner: t.withIdentity(ownerClaims),
    operator: t.withIdentity(operatorClaims),
    rival: t.withIdentity(rivalClaims),
  };
}

async function storedArtifact(t: ReturnType<typeof convexTest>, content = "name,phone\nAsha,+919876543210\n") {
  return { storageId: await t.run(async (ctx) => ctx.storage.store(new Blob([content], { type: "text/csv" }))), checksum: createHash("sha256").update(content).digest("hex") };
}

test("artifact upload URL is authenticated and finalize validates metadata, tenant ownership, and checksum dedupe", async () => {
  const t = convexTest(schema, modules);
  const { owner, rival } = await setup(t);
  await expect(t.mutation(api.imports.generateArtifactUploadUrl, {})).rejects.toThrow(/unauthenticated/i);
  await expect(owner.mutation(api.imports.generateArtifactUploadUrl, {})).resolves.toMatch(/^https?:\/\//);

  const stored = await storedArtifact(t);
  const first = await owner.mutation(api.imports.finalizeArtifact, {
    storageId: stored.storageId,
    filename: "leads.csv",
    mimeType: "text/csv",
    sha256: stored.checksum,
  });
  expect(first).toMatchObject({ status: "ready", byteSize: 30, originalFilename: "leads.csv" });
  await expect(owner.mutation(api.imports.finalizeArtifact, {
    storageId: stored.storageId,
    filename: "leads.csv",
    mimeType: "text/csv",
    sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  })).rejects.toThrow(/checksum/i);
  await expect(owner.mutation(api.imports.finalizeArtifact, {
    storageId: stored.storageId,
    filename: "../leads.csv",
    mimeType: "text/csv",
    sha256: stored.checksum,
  })).resolves.toMatchObject({ artifactId: first.artifactId, deduplicated: true });
  await expect(rival.mutation(api.imports.finalizeArtifact, {
    storageId: stored.storageId,
    filename: "leads.csv",
    mimeType: "text/csv",
    sha256: stored.checksum,
  })).rejects.toThrow(/storage|tenant|organization|metadata/i);
});

test("staged import preserves immutable raw provenance and only approved consented valid rows are eligible", async () => {
  const t = convexTest(schema, modules);
  const { owner, operator } = await setup(t);
  const stored = await storedArtifact(t);
  const artifact = await operator.mutation(api.imports.finalizeArtifact, {
    storageId: stored.storageId, filename: "leads.csv", mimeType: "text/csv",
    sha256: stored.checksum,
  });
  const batchId = await operator.mutation(api.imports.stageImport, {
    name: "verified leads", artifactId: artifact.artifactId, mappingVersion: "contacts-v2",
    rows: [
      { name: "Asha", phone: "+91 98765 43210", email: "ASHA@example.com", consent: "consented", consentSource: "web-form", evidenceAt: 1000 },
      { name: "No", phone: "9000000002", consent: "unconsented" },
      { name: "Bad", email: "not-an-email", consent: "unknown" },
    ],
  });
  await operator.mutation(api.imports.commitBatch, { batchId });
  await owner.mutation(api.imports.approveBatch, { batchId });
  const eligible = await operator.query(api.imports.listEligibleRows, { batchId, paginationOpts: { numItems: 10, cursor: null } });
  expect(eligible.page).toHaveLength(1);
  expect(eligible.page[0]).toMatchObject({ rawName: "Asha", consent: "consented", mappingVersion: "contacts-v2" });
  const rows = await t.run(async (ctx) => ctx.db.query("importRows").collect());
  expect(rows).toHaveLength(3);
  expect(rows.map((row) => row.rawName)).toEqual(["Asha", "No", "Bad"]);
  expect(rows.find((row) => row.rawName === "Bad")?.exclusionReason).toMatch(/invalid|identity/i);
});

test("same identity resolves across batches; phone/email conflict creates review and owner resolution is explicit", async () => {
  const t = convexTest(schema, modules);
  const { owner, operator } = await setup(t);
  const first = await operator.mutation(api.imports.stageImport, { name: "one", rows: [{ name: "Phone person", phone: "9000000001", consent: "consented" }] });
  const second = await operator.mutation(api.imports.stageImport, { name: "two", rows: [{ name: "Email person", email: "email@example.com", consent: "consented" }] });
  await operator.mutation(api.imports.commitBatch, { batchId: first });
  await operator.mutation(api.imports.commitBatch, { batchId: second });
  const customers = await operator.query(api.customers.listCustomers, { paginationOpts: { numItems: 20, cursor: null } });
  expect(customers.page).toHaveLength(2);
  const conflict = await operator.mutation(api.imports.stageImport, { name: "conflict", rows: [{ name: "Ambiguous", phone: "9000000001", email: "email@example.com", consent: "consented" }] });
  await operator.mutation(api.imports.commitBatch, { batchId: conflict });
  const reviews = await operator.query(api.customers.listIdentityReviews, { paginationOpts: { numItems: 20, cursor: null } });
  expect(reviews.page).toHaveLength(1);
  expect(reviews.page[0].status).toBe("open");
  await owner.mutation(api.imports.approveBatch, { batchId: conflict });
  const target = customers.page.find((customer: { email?: string }) => customer.email === "email@example.com")!;
  await owner.mutation(api.customers.resolveIdentityReview, { reviewId: reviews.page[0]._id, customerId: target._id });
  const eligible = await operator.query(api.imports.listEligibleRows, { batchId: conflict, paginationOpts: { numItems: 10, cursor: null } });
  expect(eligible.page).toHaveLength(1);
  expect(eligible.page[0].customerId).toBe(target._id);
});

test("owner merge is explicit, audited, tenant-scoped, and duplicate identity data fails closed", async () => {
  const t = convexTest(schema, modules);
  const { owner, rival } = await setup(t);
  const a = await owner.mutation(api.customers.createCustomer, { displayName: "A", email: "a@example.com" });
  const b = await owner.mutation(api.customers.createCustomer, { displayName: "B", phone: "9000000009" });
  await expect(rival.mutation(api.customers.mergeCustomers, { sourceCustomerId: a, targetCustomerId: b })).rejects.toThrow(/not found|tenant|organization/i);
  await expect(owner.mutation(api.customers.mergeCustomers, { sourceCustomerId: a, targetCustomerId: b })).resolves.toMatchObject({ status: "merged" });
  await expect(t.run(async (ctx) => (await ctx.db.query("customerMergeRecords").collect()).length)).resolves.toBe(1);

  await t.run(async (ctx) => {
    const org = (await ctx.db.query("organizations").withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", ownerClaims.org_id)).unique())!;
    const customer = (await ctx.db.query("customers").withIndex("by_organization_name", (q) => q.eq("organizationId", org._id)).first())!;
    await ctx.db.insert("customerIdentities", { organizationId: org._id, kind: "email", normalizedValue: "duplicate@example.com", customerId: customer._id, createdAt: 1 });
    await ctx.db.insert("customerIdentities", { organizationId: org._id, kind: "email", normalizedValue: "duplicate@example.com", customerId: customer._id, createdAt: 2 });
  });
  await expect(owner.mutation(api.customers.createCustomer, { displayName: "C", email: "duplicate@example.com" })).rejects.toThrow(/duplicate|integrity/i);
});

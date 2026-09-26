import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const ownerClaims = {
  subject: "user_owner",
  name: "Owner",
  org_id: "org_vectis",
  org_role: "org:admin",
};
const memberClaims = {
  subject: "user_member",
  name: "Member",
  org_id: "org_vectis",
  org_role: "org:member",
};
const rivalClaims = {
  subject: "user_rival",
  name: "Rival",
  org_id: "org_other",
  org_role: "org:admin",
};

async function setup(t: ReturnType<typeof convexTest>) {
  const owner = t.withIdentity(ownerClaims);
  const member = t.withIdentity(memberClaims);
  const rival = t.withIdentity(rivalClaims);
  const lifecycle = async (eventId: string, eventType: string, data: object, eventTimestamp: number) =>
    t.mutation(internal.http.clerkWebhook.processEvent, {
      eventId,
      eventType,
      payload: JSON.stringify({ id: eventId, type: eventType, data }),
      eventTimestamp,
    });
  await lifecycle("customer-owner-created", "user.created", { id: ownerClaims.subject }, 1_000);
  await lifecycle("customer-member-created", "user.created", { id: memberClaims.subject }, 1_000);
  await lifecycle("customer-rival-created", "user.created", { id: rivalClaims.subject }, 1_000);
  await lifecycle("customer-org-created", "organization.created", { id: ownerClaims.org_id, name: "Vectis" }, 1_000);
  await lifecycle("customer-rival-org-created", "organization.created", { id: rivalClaims.org_id, name: "Rival" }, 1_000);
  await lifecycle("customer-owner-membership", "organizationMembership.created", {
    id: "customer-owner-membership",
    organization: { id: ownerClaims.org_id },
    public_user_data: { user_id: ownerClaims.subject },
    role: "org:admin",
  }, 1_000);
  await lifecycle("customer-rival-membership", "organizationMembership.created", {
    id: "customer-rival-membership",
    organization: { id: rivalClaims.org_id },
    public_user_data: { user_id: rivalClaims.subject },
    role: "org:admin",
  }, 1_000);
  await owner.mutation(api.organizations.addMember, { clerkId: memberClaims.subject, role: "operator" });
  return { owner, member, rival };
}

const pageOf = async (
  identity: { query: Function },
  apiRef: typeof api,
): Promise<{ page: { _id: string; phone?: string }[] }> => {
  const result = await identity.query(apiRef.customers.listCustomers, {
    paginationOpts: { numItems: 50, cursor: null },
  });
  return result as { page: { _id: string; phone?: string }[] };
};

test("same phone across two batches resolves to one customer; provenance is traceable", async () => {
  const t = convexTest(schema, modules);
  const { member } = await setup(t);

  const batch1 = await member.mutation(api.imports.stageImport, {
    name: "july leads",
    rows: [
      { name: "Asha", phone: "+9198765-43210", email: "asha@example.com", consent: "consented" },
    ],
  });
  const batch2 = await member.mutation(api.imports.stageImport, {
    name: "august leads",
    rows: [
      { name: "Asha R", phone: "+919876543210", email: "asha.r@other.com", consent: "consented" },
    ],
  });
  const r1 = await member.mutation(api.imports.commitBatch, { batchId: batch1 });
  const r2 = await member.mutation(api.imports.commitBatch, { batchId: batch2 });
  expect(r1.customersCreated).toBe(1);
  expect(r2.customersCreated).toBe(0);

  const page = await pageOf(member, api);
  expect(page.page).toHaveLength(1);
  expect(page.page[0].phone).toBe("+919876543210");

  const detail = await member.query(api.customers.getCustomer, {
    customerId: page.page[0]._id as Id<"customers">,
  });
  const provenance = detail.provenance as { batchName: string }[];
  expect(new Set(provenance.map((p) => p.batchName))).toEqual(
    new Set(["july leads", "august leads"]),
  );
});
test("identity ambiguity never merges: rows without a shared identity stay separate", async () => {
  const t = convexTest(schema, modules);
  const { member } = await setup(t);

  const batch = await member.mutation(api.imports.stageImport, {
    name: "mixed",
    rows: [
      { name: "Asha", phone: "9876543210", consent: "consented" },
      { name: "Asha R", email: "asha@example.com", consent: "consented" },
      { name: "No identity", consent: "unknown" },
    ],
  });
  const result = await member.mutation(api.imports.commitBatch, { batchId: batch });
  expect(result.customersCreated).toBe(3);

  const page = await pageOf(member, api);
  expect(page.page).toHaveLength(3);
});

test("phone takes precedence over email when they resolve to different customers", async () => {
  const t = convexTest(schema, modules);
  const { member } = await setup(t);

  const batch1 = await member.mutation(api.imports.stageImport, {
    name: "first",
    rows: [{ name: "Asha", phone: "9876543210", consent: "consented" }],
  });
  const batch2 = await member.mutation(api.imports.stageImport, {
    name: "second",
    rows: [
      { name: "Ravi", phone: "9000000001", email: "asha@example.com", consent: "consented" },
    ],
  });
  await member.mutation(api.imports.commitBatch, { batchId: batch1 });
  await member.mutation(api.imports.commitBatch, { batchId: batch2 });

  const page = await pageOf(member, api);
  expect(page.page).toHaveLength(2);
});

test("tenants are isolated: the same phone in another org creates that org's own customer", async () => {
  const t = convexTest(schema, modules);
  const { member, rival } = await setup(t);

  const batch1 = await member.mutation(api.imports.stageImport, {
    name: "mine",
    rows: [{ name: "Asha", phone: "9876543210", consent: "consented" }],
  });
  await member.mutation(api.imports.commitBatch, { batchId: batch1 });

  const batch2 = await rival.mutation(api.imports.stageImport, {
    name: "theirs",
    rows: [{ name: "Asha", phone: "9876543210", consent: "consented" }],
  });
  const result = await rival.mutation(api.imports.commitBatch, { batchId: batch2 });
  expect(result.customersCreated).toBe(1);

  const mine = await pageOf(member, api);
  const theirs = await pageOf(rival, api);
  expect(mine.page[0]._id).not.toBe(theirs.page[0]._id);

  // rival cannot read my customer by id
  await expect(
    rival.query(api.customers.getCustomer, { customerId: mine.page[0]._id as Id<"customers"> }),
  ).rejects.toThrow(/not found/i);
});
test("consent is durable evidence per source row", async () => {
  const t = convexTest(schema, modules);
  const { member } = await setup(t);

  const batch = await member.mutation(api.imports.stageImport, {
    name: "consent mix",
    rows: [
      { name: "Yes", phone: "9000000001", consent: "consented" },
      { name: "No", phone: "9000000002", consent: "unconsented" },
      { name: "Maybe", phone: "9000000003", consent: "unknown" },
    ],
  });
  await member.mutation(api.imports.commitBatch, { batchId: batch });

  const page = await pageOf(member, api);
  expect(page.page).toHaveLength(3);
  for (const customer of page.page) {
    const detail = await member.query(api.customers.getCustomer, {
      customerId: customer._id as Id<"customers">,
    });
    expect(["consented", "unconsented", "unknown"]).toContain(detail.provenance[0].consent);
  }
});

test("commit is one-way; approval is owner-only", async () => {
  const t = convexTest(schema, modules);
  const { owner, member } = await setup(t);

  const batch = await member.mutation(api.imports.stageImport, {
    name: "gate",
    rows: [{ name: "Asha", phone: "9876543210", consent: "consented" }],
  });
  await member.mutation(api.imports.commitBatch, { batchId: batch });
  await expect(member.mutation(api.imports.approveBatch, { batchId: batch })).rejects.toThrow(
    /owner/i,
  );
  await owner.mutation(api.imports.approveBatch, { batchId: batch });
  await expect(member.mutation(api.imports.commitBatch, { batchId: batch })).rejects.toThrow(
    /approved/,
  );
  const batches = await member.query(api.imports.listImportBatches, {});
  expect(batches[0].status).toBe("approved");
});

test("invalid phone is kept as raw provenance but does not create identity", async () => {
  const t = convexTest(schema, modules);
  const { member } = await setup(t);

  const batch = await member.mutation(api.imports.stageImport, {
    name: "dirty",
    rows: [{ name: "Weird", phone: "call me maybe", consent: "consented" }],
  });
  await member.mutation(api.imports.commitBatch, { batchId: batch });

  const page = await pageOf(member, api);
  expect(page.page[0].phone).toBeUndefined();
  const detail = await member.query(api.customers.getCustomer, {
    customerId: page.page[0]._id as Id<"customers">,
  });
  expect(detail.provenance[0].rawPhone).toBe("call me maybe");
});
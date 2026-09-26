import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

type TestContext = ReturnType<typeof convexTest>;
type Caller = ReturnType<TestContext["withIdentity"]>;

async function event(
  t: TestContext,
  eventId: string,
  eventType: string,
  data: object,
  eventTimestamp = Date.now(),
) {
  return t.mutation(internal.http.clerkWebhook.processEvent, {
    eventId,
    eventType,
    payload: JSON.stringify({ id: eventId, type: eventType, data }),
    eventTimestamp,
  });
}

async function provisionOrganization(
  t: TestContext,
  organizationId: string,
  members: Array<{ subject: string; role: "org:admin" | "org:operator" | "org:staff" }>,
) {
  await event(t, `${organizationId}-created`, "organization.created", {
    id: organizationId,
    name: organizationId,
  });
  for (const member of members) {
    const userExists = await t.run(async (ctx) =>
      (await ctx.db.query("users").collect()).some((user) => user.clerkId === member.subject),
    );
    if (!userExists) {
      await event(t, `${member.subject}-created`, "user.created", { id: member.subject });
    }
    await event(
      t,
      `${member.subject}-${organizationId}-membership-created`,
      "organizationMembership.created",
      {
        id: `${member.subject}-${organizationId}-membership`,
        organization: { id: organizationId },
        public_user_data: { user_id: member.subject },
        role: member.role,
      },
    );
  }
}

function identity(subject: string, organizationId: string, claimedRole = "org:admin") {
  return { subject, org_id: organizationId, org_role: claimedRole };
}

async function seedInactiveFixture(
  kind: "user" | "organization" | "membership",
): Promise<{ t: TestContext; caller: Caller }> {
  const t = convexTest(schema, modules);
  await provisionOrganization(t, "org_inactive", [{ subject: "user_inactive", role: "org:admin" }]);
  const caller = t.withIdentity(identity("user_inactive", "org_inactive"));
  const ids = await t.run(async (ctx) => ({
    user: (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", "user_inactive")).unique())!._id,
    organization: (await ctx.db
      .query("organizations")
      .withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", "org_inactive"))
      .unique())!._id,
    membership: (await ctx.db.query("memberships").collect())[0]!._id,
  }));
  await t.run(async (ctx) => {
    const id = ids[kind];
    await ctx.db.patch(id, { active: false, deletedAt: Date.now() });
  });
  return { t, caller };
}

test.each([
  ["user", "users.getCurrent"],
  ["organization", "organizations.getCurrent"],
  ["membership", "toolchain.probeCount"],
] as const)("explicit inactive %s denies %s", async (kind, _functionName) => {
  const { caller } = await seedInactiveFixture(kind);
  const operation =
    kind === "user"
      ? caller.query(api.users.getCurrent, {})
      : kind === "organization"
        ? caller.query(api.organizations.getCurrent, {})
        : caller.query(api.toolchain.probeCount, {});
  await expect(operation).rejects.toThrow(/inactive|deleted|member/i);
});

test("a user with memberships in two organizations follows the active Clerk org selector", async () => {
  const t = convexTest(schema, modules);
  await event(t, "shared-user-created", "user.created", { id: "shared-user" });
  await provisionOrganization(t, "org-left", [{ subject: "shared-user", role: "org:operator" }]);
  await provisionOrganization(t, "org-right", [{ subject: "shared-user", role: "org:staff" }]);

  const left = t.withIdentity(identity("shared-user", "org-left", "org:admin"));
  const right = t.withIdentity(identity("shared-user", "org-right", "org:admin"));
  await left.mutation(api.toolchain.recordProbe, { label: "left-only" });
  const rightProbe = await right.mutation(api.toolchain.recordProbe, { label: "right-only" }).catch(() => null);
  expect(rightProbe).toBeNull();
  await expect(left.query(api.organizations.getCurrent, {})).resolves.toMatchObject({
    organizationId: expect.any(String),
    name: "org-left",
    role: "operator",
  });
  await expect(right.query(api.organizations.getCurrent, {})).resolves.toMatchObject({
    name: "org-right",
    role: "staff",
  });
});

test("the client cannot substitute a resource id from the other active tenant", async () => {
  const t = convexTest(schema, modules);
  await provisionOrganization(t, "org-a", [{ subject: "user-a", role: "org:admin" }]);
  await provisionOrganization(t, "org-b", [{ subject: "user-b", role: "org:admin" }]);
  const a = t.withIdentity(identity("user-a", "org-a"));
  const b = t.withIdentity(identity("user-b", "org-b"));
  const probe = await a.mutation(api.toolchain.recordProbe, { label: "tenant-a" });
  await expect(b.mutation(api.toolchain.removeProbe, { probeId: probe })).rejects.toThrow(
    /forbidden|not belong|not found/i,
  );
  await expect(a.query(api.toolchain.probeCount, {})).resolves.toBe(1);
});

test("staff, operator, and owner satisfy every Task 2/3 permission cell", async () => {
  const t = convexTest(schema, modules);
  await provisionOrganization(t, "org-matrix", [
    { subject: "matrix-owner", role: "org:admin" },
    { subject: "matrix-operator", role: "org:operator" },
    { subject: "matrix-staff", role: "org:staff" },
    { subject: "matrix-target", role: "org:staff" },
  ]);
  const owner = t.withIdentity(identity("matrix-owner", "org-matrix", "org:staff"));
  const operator = t.withIdentity(identity("matrix-operator", "org-matrix", "org:admin"));
  const staff = t.withIdentity(identity("matrix-staff", "org-matrix", "org:admin"));

  for (const caller of [owner, operator, staff]) {
    await expect(caller.query(api.users.getCurrent, {})).resolves.toBeDefined();
    await expect(caller.query(api.organizations.getCurrent, {})).resolves.toBeDefined();
    await expect(caller.query(api.toolchain.probeCount, {})).resolves.toBeDefined();
  }

  const seededProbes = await t.run(async (ctx) => {
    const organization = (await ctx.db
      .query("organizations")
      .withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", "org-matrix"))
      .unique())!;
    return Promise.all(
      ["staff", "operator", "owner"].map((label) =>
        ctx.db.insert("toolchainProbes", { organizationId: organization._id, label, createdAt: Date.now() }),
      ),
    );
  });
  await expect(staff.mutation(api.toolchain.recordProbe, { label: "denied" })).rejects.toThrow(/requires operator/i);
  await expect(operator.mutation(api.toolchain.recordProbe, { label: "allowed" })).resolves.toBeDefined();
  await expect(owner.mutation(api.toolchain.recordProbe, { label: "allowed" })).resolves.toBeDefined();
  await expect(staff.mutation(api.toolchain.scheduleEcho, { payload: "denied" })).rejects.toThrow(/requires operator/i);
  await expect(operator.mutation(api.toolchain.scheduleEcho, { payload: "allowed" })).resolves.toBeDefined();
  await expect(owner.mutation(api.toolchain.scheduleEcho, { payload: "allowed" })).resolves.toBeDefined();
  await expect(staff.mutation(api.toolchain.removeProbe, { probeId: seededProbes[0] })).rejects.toThrow(/requires operator/i);
  await expect(operator.mutation(api.toolchain.removeProbe, { probeId: seededProbes[1] })).resolves.toBeNull();
  await expect(owner.mutation(api.toolchain.removeProbe, { probeId: seededProbes[2] })).resolves.toBeNull();

  const batchId = await t.run(async (ctx) => {
    const organization = (await ctx.db
      .query("organizations")
      .withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", "org-matrix"))
      .unique())!;
    const ownerUser = (await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", "matrix-owner"))
      .unique())!;
    return ctx.db.insert("importBatches", {
      organizationId: organization._id,
      name: "matrix batch",
      status: "committed",
      createdBy: ownerUser._id,
      createdAt: Date.now(),
    });
  });
  await expect(staff.mutation(api.imports.approveBatch, { batchId })).rejects.toThrow(/requires owner/i);
  await expect(operator.mutation(api.imports.approveBatch, { batchId })).rejects.toThrow(/requires owner/i);
  await expect(owner.mutation(api.imports.approveBatch, { batchId })).resolves.toBe(batchId);
});

test("duplicate legacy user, organization, and membership rows fail closed", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const user = await ctx.db.insert("users", { clerkId: "legacy-user", createdAt: 1 });
    const organization = await ctx.db.insert("organizations", { clerkOrgId: "legacy-org", name: "Legacy", createdAt: 1 });
    await ctx.db.insert("users", { clerkId: "legacy-user", createdAt: 2 });
    await ctx.db.insert("organizations", { clerkOrgId: "legacy-org", name: "Legacy duplicate", createdAt: 2 });
    await ctx.db.insert("memberships", {
      userId: user,
      organizationId: organization,
      role: "staff",
      createdAt: 1,
    });
    await ctx.db.insert("memberships", {
      userId: user,
      organizationId: organization,
      role: "staff",
      createdAt: 2,
    });
    return { user, organization };
  });
  const caller = t.withIdentity(identity("legacy-user", "legacy-org"));
  await expect(caller.query(api.users.getCurrent, {})).rejects.toThrow(/more than one user|duplicate user/i);
  await expect(caller.query(api.organizations.getCurrent, {})).rejects.toThrow(/more than one user|duplicate user|duplicate organization/i);
  await expect(t.run(async (ctx) => ctx.db.get(ids.user))).resolves.toBeDefined();
});

test("distinct event ids apply monotonic same-resource changes under concurrent delivery", async () => {
  const t = convexTest(schema, modules);
  await event(t, "ordered-user-created", "user.created", { id: "ordered-user", first_name: "Initial" }, 1_000);
  await Promise.all([
    event(t, "ordered-user-new", "user.updated", { id: "ordered-user", first_name: "New" }, 3_000),
    event(t, "ordered-user-stale", "user.updated", { id: "ordered-user", first_name: "Stale" }, 2_000),
  ]);
  await expect(t.run(async (ctx) => (await ctx.db.query("users").collect())[0])).resolves.toMatchObject({
    name: "New",
    lifecycleAt: 3_000,
  });
});

test("a duplicate event id with a conflicting payload fails closed", async () => {
  const t = convexTest(schema, modules);
  await event(t, "same-event-id", "user.created", { id: "same-event-user", first_name: "First" }, 1_000);
  await expect(
    event(t, "same-event-id", "user.created", { id: "same-event-user", first_name: "Attacker" }, 2_000),
  ).rejects.toThrow(/duplicate webhook event/i);
});

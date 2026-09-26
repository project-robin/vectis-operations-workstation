import { convexTest } from "convex-test";
import type { FunctionReference } from "convex/server";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { requireRole, type Permission } from "./lib/auth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

async function lifecycle(
  t: ReturnType<typeof convexTest>,
  eventId: string,
  eventType: string,
  data: object,
  eventTimestamp: number,
) {
  return t.mutation(internal.http.clerkWebhook.processEvent, {
    eventId,
    eventType,
    payload: JSON.stringify({ id: eventId, type: eventType, data }),
    eventTimestamp,
  });
}

async function provision(
  t: ReturnType<typeof convexTest>,
  subject: string,
  organization: string,
  role: string,
  timestamp = 1_000,
) {
  await lifecycle(t, `${subject}-created`, "user.created", { id: subject }, timestamp);
  await lifecycle(t, `${organization}-created`, "organization.created", { id: organization, name: organization }, timestamp);
  await lifecycle(
    t,
    `${subject}-${organization}-membership-created`,
    "organizationMembership.created",
    {
      id: `${subject}-${organization}-membership`,
      organization: { id: organization },
      public_user_data: { user_id: subject },
      role,
    },
    timestamp,
  );
}

test("public identity and bootstrap writers are absent", async () => {
  const t = convexTest(schema, modules);
  const identity = t.withIdentity({ subject: "user_public", org_id: "org_public", org_role: "org:admin" });
  const legacyApi = api as unknown as typeof api & {
    users: typeof api.users & {
      ensureUser: FunctionReference<"mutation">;
      updateProfile: FunctionReference<"mutation">;
    };
    organizations: typeof api.organizations & {
      bootstrapOrganization: FunctionReference<"mutation">;
    };
  };

  await expect(identity.mutation(legacyApi.users.ensureUser, {})).rejects.toThrow();
  await expect(identity.mutation(legacyApi.users.updateProfile, { name: "attacker" })).rejects.toThrow();
  await expect(identity.mutation(legacyApi.organizations.bootstrapOrganization, {})).rejects.toThrow();
});

test("organizations.addMember rejects an unknown Clerk user without creating one", async () => {
  const t = convexTest(schema, modules);
  await provision(t, "owner", "org", "org:admin");
  const owner = t.withIdentity({ subject: "owner", org_id: "org", org_role: "org:admin" });

  await expect(owner.mutation(api.organizations.addMember, { clerkId: "never-seen", role: "staff" })).rejects.toThrow(
    /unknown.*user|lifecycle webhook/i,
  );
  expect(await t.run(async (ctx) => ctx.db.query("users").collect())).toHaveLength(1);
});

test("official Clerk role keys map to the application role matrix and unknown keys fail closed", async () => {
  const t = convexTest(schema, modules);
  await provision(t, "admin", "org", "org:admin", 1_000);
  await provision(t, "operator", "org", "org:operator", 2_000);
  await provision(t, "staff", "org", "org:staff", 3_000);
  await provision(t, "member", "org", "org:member", 4_000);

  await expect(t.withIdentity({ subject: "admin", org_id: "org" }).query(api.organizations.getCurrent, {})).resolves.toMatchObject({ role: "owner" });
  await expect(t.withIdentity({ subject: "operator", org_id: "org" }).query(api.organizations.getCurrent, {})).resolves.toMatchObject({ role: "operator" });
  await expect(t.withIdentity({ subject: "staff", org_id: "org" }).query(api.organizations.getCurrent, {})).resolves.toMatchObject({ role: "staff" });
  await expect(t.withIdentity({ subject: "member", org_id: "org" }).query(api.organizations.getCurrent, {})).resolves.toMatchObject({ role: "staff" });

  const unknown = convexTest(schema, modules);
  await provision(unknown, "unknown", "unknown-org", "org:admin");
  await expect(
    lifecycle(unknown, "unknown-role", "organizationMembership.updated", {
      id: "unknown-unknown-org-membership",
      organization: { id: "unknown-org" },
      public_user_data: { user_id: "unknown" },
      role: "org:superuser",
    }, 2_000),
  ).rejects.toThrow(/unsupported|unknown/i);
});

test("user and organization lifecycle events ignore stale updates and require newer created events to recreate", async () => {
  const t = convexTest(schema, modules);
  await lifecycle(t, "user-created", "user.created", { id: "user", first_name: "First" }, 1_000);
  await lifecycle(t, "user-updated-new", "user.updated", { id: "user", first_name: "New" }, 2_000);
  await lifecycle(t, "user-updated-stale", "user.updated", { id: "user", first_name: "Stale" }, 1_500);
  await lifecycle(t, "user-deleted", "user.deleted", { id: "user" }, 3_000);
  await lifecycle(t, "user-updated-after-delete", "user.updated", { id: "user", first_name: "Resurrected" }, 4_000);

  let user = await t.run(async (ctx) => (await ctx.db.query("users").collect())[0]);
  expect(user).toMatchObject({ name: "New", active: false });
  await lifecycle(t, "user-created-recreation", "user.created", { id: "user", first_name: "Recreated" }, 5_000);
  user = await t.run(async (ctx) => (await ctx.db.query("users").collect())[0]);
  expect(user).toMatchObject({ name: "Recreated", active: true, lifecycleAt: 5_000 });

  await lifecycle(t, "org-created", "organization.created", { id: "org", name: "First" }, 1_000);
  await lifecycle(t, "org-deleted", "organization.deleted", { id: "org" }, 2_000);
  await lifecycle(t, "org-updated-after-delete", "organization.updated", { id: "org", name: "Stale" }, 3_000);
  await lifecycle(t, "org-created-recreation", "organization.created", { id: "org", name: "Recreated" }, 4_000);
  await expect(t.run(async (ctx) => (await ctx.db.query("organizations").collect())[0])).resolves.toMatchObject({
    name: "Recreated",
    active: true,
    lifecycleAt: 4_000,
  });
});

test("membership lifecycle is monotonic, parent-ordered, and resolves deletes by membership id", async () => {
  const t = convexTest(schema, modules);
  await lifecycle(t, "user-created", "user.created", { id: "user" }, 1_000);
  await lifecycle(t, "org-created", "organization.created", { id: "org" }, 1_000);
  await lifecycle(t, "membership-created", "organizationMembership.created", {
    id: "membership",
    organization: { id: "org" },
    public_user_data: { user_id: "user" },
    role: "org:staff",
  }, 2_000);
  await lifecycle(t, "membership-updated-new", "organizationMembership.updated", {
    id: "membership",
    organization: { id: "org" },
    public_user_data: { user_id: "user" },
    role: "org:operator",
  }, 3_000);
  await lifecycle(t, "membership-updated-stale", "organizationMembership.updated", {
    id: "membership",
    organization: { id: "org" },
    public_user_data: { user_id: "user" },
    role: "org:admin",
  }, 2_500);
  await expect(t.run(async (ctx) => (await ctx.db.query("memberships").collect())[0])).resolves.toMatchObject({
    role: "operator",
    lifecycleAt: 3_000,
  });

  await lifecycle(t, "org-deleted", "organization.deleted", { id: "org" }, 4_000);
  await expect(
    lifecycle(t, "membership-deleted-after-parent", "organizationMembership.deleted", { id: "membership" }, 5_000),
  ).resolves.toBeDefined();
  await expect(t.run(async (ctx) => (await ctx.db.query("memberships").collect())[0])).resolves.toMatchObject({
    active: false,
    lifecycleAt: 5_000,
  });
});

test("membership create/update fails closed for missing parents and mismatched identity pairs", async () => {
  const t = convexTest(schema, modules);
  await lifecycle(t, "user-created", "user.created", { id: "user" }, 1_000);
  await lifecycle(t, "org-created", "organization.created", { id: "org" }, 1_000);
  await expect(
    lifecycle(t, "membership-before-parent", "organizationMembership.created", {
      id: "missing-parent-membership",
      organization: { id: "other-org" },
      public_user_data: { user_id: "user" },
      role: "org:member",
    }, 2_000),
  ).rejects.toThrow(/unknown or inactive/i);
  await lifecycle(t, "membership-created", "organizationMembership.created", {
    id: "membership",
    organization: { id: "org" },
    public_user_data: { user_id: "user" },
    role: "org:member",
  }, 3_000);
  await expect(
    lifecycle(t, "membership-id-pair-mismatch", "organizationMembership.updated", {
      id: "membership",
      organization: { id: "org" },
      public_user_data: { user_id: "other-user" },
      role: "org:staff",
    }, 4_000),
  ).rejects.toThrow(/does not match|mismatch|unknown/i);
  await expect(
    lifecycle(t, "membership-pair-id-mismatch", "organizationMembership.created", {
      id: "other-membership",
      organization: { id: "org" },
      public_user_data: { user_id: "user" },
      role: "org:staff",
    }, 5_000),
  ).rejects.toThrow(/does not match|mismatch/i);
});

test("membership delete fails closed when the supplied user parent is unknown", async () => {
  const t = convexTest(schema, modules);
  await lifecycle(t, "user-created", "user.created", { id: "user" }, 1_000);
  await lifecycle(t, "org-created", "organization.created", { id: "org" }, 1_000);
  await lifecycle(t, "membership-created", "organizationMembership.created", {
    id: "membership",
    organization: { id: "org" },
    public_user_data: { user_id: "user" },
    role: "org:staff",
  }, 2_000);

  await expect(
    lifecycle(t, "membership-delete-unknown-user", "organizationMembership.deleted", {
      id: "membership",
      user_id: "missing-user",
    }, 3_000),
  ).rejects.toThrow(/unknown.*user/i);
  await expect(t.run(async (ctx) => (await ctx.db.query("memberships").collect())[0])).resolves.toMatchObject({
    active: true,
  });
});

test("membership delete fails closed when the supplied organization parent is unknown", async () => {
  const t = convexTest(schema, modules);
  await lifecycle(t, "user-created", "user.created", { id: "user" }, 1_000);
  await lifecycle(t, "org-created", "organization.created", { id: "org" }, 1_000);
  await lifecycle(t, "membership-created", "organizationMembership.created", {
    id: "membership",
    organization: { id: "org" },
    public_user_data: { user_id: "user" },
    role: "org:staff",
  }, 2_000);

  await expect(
    lifecycle(t, "membership-delete-unknown-org", "organizationMembership.deleted", {
      id: "membership",
      organization_id: "missing-org",
    }, 3_000),
  ).rejects.toThrow(/unknown.*organization/i);
  await expect(t.run(async (ctx) => (await ctx.db.query("memberships").collect())[0])).resolves.toMatchObject({
    active: true,
  });
});

test.each([
  ["user", { user_id: "other-user" }, "Membership user mismatch"],
  ["organization", { organization_id: "other-org" }, "Membership organization mismatch"],
] as const)("membership delete fails closed for a known mismatched %s parent", async (_kind, parent, message) => {
  const t = convexTest(schema, modules);
  await lifecycle(t, "user-created", "user.created", { id: "user" }, 1_000);
  await lifecycle(t, "other-user-created", "user.created", { id: "other-user" }, 1_000);
  await lifecycle(t, "org-created", "organization.created", { id: "org" }, 1_000);
  await lifecycle(t, "other-org-created", "organization.created", { id: "other-org" }, 1_000);
  await lifecycle(t, "membership-created", "organizationMembership.created", {
    id: "membership",
    organization: { id: "org" },
    public_user_data: { user_id: "user" },
    role: "org:staff",
  }, 2_000);

  await expect(
    lifecycle(t, `membership-delete-mismatched-${_kind}`, "organizationMembership.deleted", {
      id: "membership",
      ...parent,
    }, 3_000),
  ).rejects.toThrow(message);
  await expect(t.run(async (ctx) => (await ctx.db.query("memberships").collect())[0])).resolves.toMatchObject({
    active: true,
  });
});

test("membership delete by id only still works after a parent is deleted", async () => {
  const t = convexTest(schema, modules);
  await lifecycle(t, "user-created", "user.created", { id: "user" }, 1_000);
  await lifecycle(t, "org-created", "organization.created", { id: "org" }, 1_000);
  await lifecycle(t, "membership-created", "organizationMembership.created", {
    id: "membership",
    organization: { id: "org" },
    public_user_data: { user_id: "user" },
    role: "org:staff",
  }, 2_000);
  await lifecycle(t, "user-deleted", "user.deleted", { id: "user" }, 3_000);

  await expect(
    lifecycle(t, "membership-delete-after-user", "organizationMembership.deleted", { id: "membership" }, 4_000),
  ).resolves.toBeDefined();
  await expect(t.run(async (ctx) => (await ctx.db.query("memberships").collect())[0])).resolves.toMatchObject({
    active: false,
    lifecycleAt: 4_000,
  });
});

test("requireRole rejects an unknown runtime permission explicitly", async () => {
  const t = convexTest(schema, modules);
  await lifecycle(t, "user-created", "user.created", { id: "user" }, 1_000);
  await lifecycle(t, "org-created", "organization.created", { id: "org" }, 1_000);
  await lifecycle(t, "membership-created", "organizationMembership.created", {
    id: "membership",
    organization: { id: "org" },
    public_user_data: { user_id: "user" },
    role: "org:staff",
  }, 2_000);

  await expect(
    t.withIdentity({ subject: "user", org_id: "org" }).query(async (ctx) =>
      requireRole(ctx, "not-a-permission" as unknown as Permission),
    ),
  ).rejects.toThrow(/unknown permission/i);
});

test("terminal lifecycle watermarks advance across ignored user, organization, and membership events", async () => {
  const t = convexTest(schema, modules);

  await lifecycle(t, "watermark-user-created", "user.created", { id: "watermark-user", first_name: "Before" }, 1_000);
  await lifecycle(t, "watermark-user-deleted", "user.deleted", { id: "watermark-user" }, 2_000);
  const deletedUser = await t.run(async (ctx) => (await ctx.db.query("users").collect())[0]);
  await lifecycle(t, "watermark-user-updated-after-delete", "user.updated", { id: "watermark-user", first_name: "Ignored" }, 3_000);
  await lifecycle(t, "watermark-user-deleted-again", "user.deleted", { id: "watermark-user" }, 4_000);
  await expect(t.run(async (ctx) => (await ctx.db.query("users").collect())[0])).resolves.toMatchObject({
    active: false,
    deletedAt: deletedUser.deletedAt,
    lifecycleAt: 4_000,
  });
  await lifecycle(t, "watermark-user-created-old", "user.created", { id: "watermark-user", first_name: "Too Old" }, 3_500);
  await expect(t.run(async (ctx) => (await ctx.db.query("users").collect())[0])).resolves.toMatchObject({
    active: false,
    name: "Before",
    lifecycleAt: 4_000,
  });
  await lifecycle(t, "watermark-user-created-new", "user.created", { id: "watermark-user", first_name: "Recreated" }, 5_000);
  await expect(t.run(async (ctx) => (await ctx.db.query("users").collect())[0])).resolves.toMatchObject({
    active: true,
    name: "Recreated",
    lifecycleAt: 5_000,
  });

  await lifecycle(t, "watermark-org-created", "organization.created", { id: "watermark-org", name: "Before" }, 1_000);
  await lifecycle(t, "watermark-org-deleted", "organization.deleted", { id: "watermark-org" }, 2_000);
  const deletedOrganization = await t.run(async (ctx) => (await ctx.db.query("organizations").collect()).find((row) => row.clerkOrgId === "watermark-org"));
  await lifecycle(t, "watermark-org-updated-after-delete", "organization.updated", { id: "watermark-org", name: "Ignored" }, 3_000);
  await lifecycle(t, "watermark-org-deleted-again", "organization.deleted", { id: "watermark-org" }, 4_000);
  await expect(
    t.run(async (ctx) => (await ctx.db.query("organizations").withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", "watermark-org")).unique())),
  ).resolves.toMatchObject({
    active: false,
    deletedAt: deletedOrganization?.deletedAt,
    lifecycleAt: 4_000,
  });
  await lifecycle(t, "watermark-org-created-old", "organization.created", { id: "watermark-org", name: "Too Old" }, 3_500);
  await expect(
    t.run(async (ctx) => (await ctx.db.query("organizations").withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", "watermark-org")).unique())),
  ).resolves.toMatchObject({ active: false, name: "Before", lifecycleAt: 4_000 });
  await lifecycle(t, "watermark-org-created-new", "organization.created", { id: "watermark-org", name: "Recreated" }, 5_000);
  await expect(
    t.run(async (ctx) => (await ctx.db.query("organizations").withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", "watermark-org")).unique())),
  ).resolves.toMatchObject({ active: true, name: "Recreated", lifecycleAt: 5_000 });

  await lifecycle(t, "watermark-membership-user-created", "user.created", { id: "watermark-membership-user" }, 1_000);
  await lifecycle(t, "watermark-membership-org-created", "organization.created", { id: "watermark-membership-org" }, 1_000);
  const membershipData = {
    id: "watermark-membership",
    organization: { id: "watermark-membership-org" },
    public_user_data: { user_id: "watermark-membership-user" },
    role: "org:staff",
  };
  await lifecycle(t, "watermark-membership-created", "organizationMembership.created", membershipData, 1_000);
  await lifecycle(t, "watermark-membership-deleted", "organizationMembership.deleted", { id: "watermark-membership" }, 2_000);
  const deletedMembership = await t.run(async (ctx) => (await ctx.db.query("memberships").collect())[0]);
  await lifecycle(t, "watermark-membership-updated-after-delete", "organizationMembership.updated", { ...membershipData, role: "org:operator" }, 3_000);
  await lifecycle(t, "watermark-membership-deleted-again", "organizationMembership.deleted", { id: "watermark-membership" }, 4_000);
  await expect(t.run(async (ctx) => (await ctx.db.query("memberships").collect())[0])).resolves.toMatchObject({
    active: false,
    deletedAt: deletedMembership.deletedAt,
    lifecycleAt: 4_000,
  });
  await lifecycle(t, "watermark-membership-created-old", "organizationMembership.created", { ...membershipData, role: "org:operator" }, 3_500);
  await expect(t.run(async (ctx) => (await ctx.db.query("memberships").collect())[0])).resolves.toMatchObject({
    active: false,
    role: "staff",
    lifecycleAt: 4_000,
  });
  await lifecycle(t, "watermark-membership-created-new", "organizationMembership.created", { ...membershipData, role: "org:operator" }, 5_000);
  await expect(t.run(async (ctx) => (await ctx.db.query("memberships").collect())[0])).resolves.toMatchObject({
    active: true,
    role: "operator",
    lifecycleAt: 5_000,
  });
});

test("the webhook ledger stores bounded metadata, not the raw identity payload", async () => {
  const t = convexTest(schema, modules);
  const payload = { id: "private-user-event", email_addresses: [{ email_address: "secret@example.test" }] };
  await lifecycle(t, "private-user-event", "user.created", payload, 1_000);
  await expect(t.run(async (ctx) => (await ctx.db.query("webhookEvents").collect())[0])).resolves.toEqual(
    expect.objectContaining({ eventId: "private-user-event", eventType: "user.created", eventTimestamp: 1_000 }),
  );
  const ledger = await t.run(async (ctx) => (await ctx.db.query("webhookEvents").collect())[0]);
  expect(JSON.stringify(ledger)).not.toContain("secret@example.test");
  expect(ledger).not.toHaveProperty("payload");
});

test("same-timestamp lifecycle events use deterministic event versions for reverse delivery", async () => {
  async function run(order: Array<[string, string, object]>) {
    const t = convexTest(schema, modules);
    await lifecycle(t, "same-second-user-created", "user.created", { id: "same-second-user" }, 1_000);
    for (const [eventId, eventType, data] of order) {
      await lifecycle(t, eventId, eventType, data, 2_000);
    }
    return t.run(async (ctx) => (await ctx.db.query("users")).unique());
  }

  const updateA: [string, string, object] = [
    "same-second-update-a",
    "user.updated",
    { id: "same-second-user", first_name: "A" },
  ];
  const updateZ: [string, string, object] = [
    "same-second-update-z",
    "user.updated",
    { id: "same-second-user", first_name: "Z" },
  ];
  const forward = await run([updateA, updateZ]);
  const reverse = await run([updateZ, updateA]);
  expect(forward).toMatchObject({ name: "Z", lifecycleAt: 2_000 });
  expect(reverse).toMatchObject({ name: "Z", lifecycleAt: 2_000 });
  expect(forward?.lifecycleVersion).toBe(reverse?.lifecycleVersion);
  expect(forward?.lifecycleVersion).toContain("same-second-update-z");
});

test("same-timestamp delete and membership role changes are deterministic and stale events cannot win", async () => {
  async function runMembership(order: Array<[string, string]>) {
    const t = convexTest(schema, modules);
    await lifecycle(t, "same-role-user-created", "user.created", { id: "same-role-user" }, 1_000);
    await lifecycle(t, "same-role-org-created", "organization.created", { id: "same-role-org" }, 1_000);
    await lifecycle(t, "same-role-membership-created", "organizationMembership.created", {
      id: "same-role-membership",
      organization: { id: "same-role-org" },
      public_user_data: { user_id: "same-role-user" },
      role: "org:staff",
    }, 2_000);
    for (const [eventId, role] of order) {
      await lifecycle(t, eventId, "organizationMembership.updated", {
        id: "same-role-membership",
        organization: { id: "same-role-org" },
        public_user_data: { user_id: "same-role-user" },
        role,
      }, 3_000);
    }
    return t.run(async (ctx) => (await ctx.db.query("memberships")).unique());
  }

  const roleA: [string, string] = ["same-role-a", "org:staff"];
  const roleZ: [string, string] = ["same-role-z", "org:operator"];
  const forward = await runMembership([roleA, roleZ]);
  const reverse = await runMembership([roleZ, roleA]);
  expect(forward).toMatchObject({ role: "operator", lifecycleAt: 3_000 });
  expect(reverse).toMatchObject({ role: "operator", lifecycleAt: 3_000 });
  expect(forward?.lifecycleVersion).toBe(reverse?.lifecycleVersion);

  const t = convexTest(schema, modules);
  await lifecycle(t, "same-delete-user-created", "user.created", { id: "same-delete-user" }, 1_000);
  await lifecycle(t, "same-delete-update-z", "user.updated", { id: "same-delete-user", first_name: "Updated" }, 2_000);
  await lifecycle(t, "same-z-delete", "user.deleted", { id: "same-delete-user" }, 2_000);
  await lifecycle(t, "same-delete-update-a", "user.updated", { id: "same-delete-user", first_name: "Stale" }, 2_000);
  await expect(t.run(async (ctx) => (await ctx.db.query("users")).unique())).resolves.toMatchObject({
    active: false,
    name: "Updated",
    lifecycleAt: 2_000,
  });
});

test("trusted Clerk resource timestamps outrank a later-arriving fallback webhook timestamp", async () => {
  const t = convexTest(schema, modules);
  await lifecycle(t, "trusted-user-created", "user.created", { id: "trusted-user", created_at: 1_000 }, 1_000);
  await lifecycle(
    t,
    "trusted-user-updated",
    "user.updated",
    { id: "trusted-user", first_name: "Authoritative", updated_at: 10_000 },
    2_000,
  );
  await lifecycle(t, "trusted-user-stale", "user.updated", { id: "trusted-user", first_name: "Stale" }, 9_000);

  await expect(t.run(async (ctx) => (await ctx.db.query("users")).unique())).resolves.toMatchObject({
    name: "Authoritative",
    lifecycleAt: 10_000,
    lifecycleVersion: expect.stringContaining("trusted-user-updated"),
  });
});

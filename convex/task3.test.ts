import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const owner = { subject: "user_owner", org_id: "org_main", org_role: "org:admin" };
const operator = { subject: "user_operator", org_id: "org_main", org_role: "org:operator" };
const staff = { subject: "user_staff", org_id: "org_main", org_role: "org:staff" };
const wrongClaim = { subject: "user_operator", org_id: "org_other", org_role: "org:admin" };

async function lifecycle(
  t: ReturnType<typeof convexTest>,
  id: string,
  type: string,
  data: object,
  eventTimestamp = Date.now(),
) {
  return t.mutation(internal.http.clerkWebhook.processEvent, {
    eventId: id,
    eventType: type,
    payload: JSON.stringify({ id, type, data }),
    eventTimestamp,
  });
}

async function provision(t: ReturnType<typeof convexTest>) {
  await lifecycle(t, "user-owner", "user.created", {
    id: "user_owner",
    first_name: "Owner",
    last_name: "One",
  });
  await lifecycle(t, "org-main", "organization.created", {
    id: "org_main",
    name: "Main",
    slug: "main",
  });
  await lifecycle(t, "membership-owner", "organizationMembership.created", {
    id: "membership-owner",
    organization: { id: "org_main" },
    public_user_data: { user_id: "user_owner" },
    role: "org:admin",
  });
}

test("every public identity and tenant function rejects unauthenticated callers", async () => {
  const t = convexTest(schema, modules);
  await expect(t.query(api.users.getCurrent, {})).rejects.toThrow(/unauthenticated/i);
  await expect(t.query(api.organizations.getCurrent, {})).rejects.toThrow(/unauthenticated/i);
  await expect(t.query(api.toolchain.probeCount, {})).rejects.toThrow(/unauthenticated/i);
});

test("authoritative Convex membership rejects a substituted Clerk organization claim", async () => {
  const t = convexTest(schema, modules);
  await provision(t);
  await lifecycle(t, "org-other", "organization.created", { id: "org_other", name: "Other" });
  await lifecycle(t, "user-operator", "user.created", { id: "user_operator", first_name: "Op" });
  await lifecycle(t, "membership-operator", "organizationMembership.created", {
    id: "membership-operator",
    organization: { id: "org_main" },
    public_user_data: { user_id: "user_operator" },
    role: "org:operator",
  });
  await expect(t.withIdentity(wrongClaim).query(api.organizations.getCurrent, {})).rejects.toThrow(
    /unknown organization|active.*member|not a member/i,
  );
});

test("inactive users, organizations, and memberships fail closed", async () => {
  const t = convexTest(schema, modules);
  await provision(t);
  await lifecycle(t, "membership-owner-delete", "organizationMembership.deleted", {
    id: "membership-owner",
    organization: { id: "org_main" },
    public_user_data: { user_id: "user_owner" },
  });
  await expect(t.withIdentity(owner).query(api.organizations.getCurrent, {})).rejects.toThrow(
    /inactive|active.*member|not a member/i,
  );
});

test("staff, operator, and owner have distinct permissions", async () => {
  const t = convexTest(schema, modules);
  await provision(t);
  await lifecycle(t, "user-operator", "user.created", { id: "user_operator", first_name: "Op" });
  await lifecycle(t, "user-staff", "user.created", { id: "user_staff", first_name: "Staff" });
  await lifecycle(t, "membership-operator", "organizationMembership.created", {
    id: "membership-operator",
    organization: { id: "org_main" },
    public_user_data: { user_id: "user_operator" },
    role: "org:operator",
  });
  await lifecycle(t, "membership-staff", "organizationMembership.created", {
    id: "membership-staff",
    organization: { id: "org_main" },
    public_user_data: { user_id: "user_staff" },
    role: "org:staff",
  });
  const staffIdentity = t.withIdentity(staff);
  const operatorIdentity = t.withIdentity(operator);
  expect((await staffIdentity.query(api.organizations.getCurrent, {})).role).toBe("staff");
  await expect(staffIdentity.mutation(api.toolchain.recordProbe, { label: "nope" })).rejects.toThrow(
    /requires operator/i,
  );
  await expect(
    operatorIdentity.mutation(api.organizations.addMember, { clerkId: "another", role: "staff" }),
  ).rejects.toThrow(/requires owner/i);
  await lifecycle(t, "user-another", "user.created", { id: "another" });
  await expect(
    t.withIdentity(owner).mutation(api.organizations.addMember, { clerkId: "another", role: "staff" }),
  ).resolves.toBeDefined();
});

test("Clerk lifecycle events are idempotent and preserve deactivated history", async () => {
  const t = convexTest(schema, modules);
  const event = {
    id: "user-repeat",
    type: "user.created",
    data: { id: "user_repeat", first_name: "Before" },
  };
  await lifecycle(t, event.id, event.type, event.data);
  await lifecycle(t, event.id, event.type, event.data);
  expect(
    await t.run(async (ctx) =>
      (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", "user_repeat")).collect())
        .length,
    ),
  ).toBe(1);
  await lifecycle(t, "user-repeat-delete", "user.deleted", { id: "user_repeat", deleted: true });
  await expect(t.withIdentity({ subject: "user_repeat" }).query(api.users.getCurrent, {})).rejects.toThrow(
    /inactive|deleted/i,
  );
  expect(await t.run(async (ctx) => (await ctx.db.query("webhookEvents").collect()).length)).toBe(2);
});

test("organization and membership update/delete events are durable and concurrent delivery is idempotent", async () => {
  const t = convexTest(schema, modules);
  await provision(t);
  await lifecycle(t, "org-main-update", "organization.updated", {
    id: "org_main",
    name: "Renamed",
    slug: "renamed",
  });
  await lifecycle(t, "membership-owner-update", "organizationMembership.updated", {
    id: "membership-owner",
    organization: { id: "org_main" },
    public_user_data: { user_id: "user_owner" },
    role: "org:staff",
  });
  expect((await t.withIdentity(owner).query(api.organizations.getCurrent, {})).role).toBe("staff");
  await expect(
    Promise.all(
      Array.from({ length: 5 }, () =>
        lifecycle(t, "org-main-delete", "organization.deleted", { id: "org_main" }),
      ),
    ),
  ).resolves.toHaveLength(5);
  await expect(t.withIdentity(owner).query(api.organizations.getCurrent, {})).rejects.toThrow(
    /unknown|inactive|not a member/i,
  );
  await expect(
    t.run(async (ctx) => (await ctx.db.query("organizations").withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", "org_main")).collect())[0].active),
  ).resolves.toBe(false);
});

test("representative resource IDs cannot cross tenant boundaries", async () => {
  const t = convexTest(schema, modules);
  await provision(t);
  await lifecycle(t, "org-other", "organization.created", { id: "org_other", name: "Other" });
  await lifecycle(t, "user-rival", "user.created", { id: "user_rival", first_name: "Rival" });
  await lifecycle(t, "membership-rival", "organizationMembership.created", {
    id: "membership-rival",
    organization: { id: "org_other" },
    public_user_data: { user_id: "user_rival" },
    role: "org:admin",
  });
  const first = t.withIdentity(owner);
  const second = t.withIdentity({ subject: "user_rival", org_id: "org_other", org_role: "org:admin" });
  const probeId = await first.mutation(api.toolchain.recordProbe, { label: "private" });
  await expect(second.mutation(api.toolchain.removeProbe, { probeId })).rejects.toThrow(
    /forbidden|not belong|not found/i,
  );
});

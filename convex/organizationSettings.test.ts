import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

type TestContext = ReturnType<typeof convexTest>;

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

async function provision(
  t: TestContext,
  organizationId = "org-main",
  subject = "user-owner",
  role = "org:admin",
) {
  await event(t, `${organizationId}-organization`, "organization.created", {
    id: organizationId,
    name: organizationId,
  });
  await event(t, `${subject}-user`, "user.created", { id: subject });
  await event(t, `${organizationId}-${subject}-membership`, "organizationMembership.created", {
    id: `${organizationId}-${subject}-membership-id`,
    organization: { id: organizationId },
    public_user_data: { user_id: subject },
    role,
  });
}

function owner(t: TestContext, subject = "user-owner", org = "org-main") {
  return t.withIdentity({ subject, org_id: org, org_role: "org:admin" });
}

function operator(t: TestContext, subject = "user-operator", org = "org-main") {
  return t.withIdentity({ subject, org_id: org, org_role: "org:operator" });
}

function staff(t: TestContext, subject = "user-staff", org = "org-main") {
  return t.withIdentity({ subject, org_id: org, org_role: "org:staff" });
}

test("organization provisioning creates one idempotent default settings document", async () => {
  const t = convexTest(schema, modules);
  await provision(t);
  await event(t, "org-main-organization-replay", "organization.created", {
    id: "org-main",
    name: "org-main",
  });

  const settings = await owner(t).query(api.organizationSettings.getCurrent, {});
  expect(settings).toMatchObject({ timezone: "UTC", defaultCurrency: "INR" });
  expect(settings.attributionWindow).toMatchObject({ value: 30, unit: "days" });
  expect(settings.healthFreshnessPolicy).toMatchObject({ warningAfterMinutes: 15, criticalAfterMinutes: 60 });
  await expect(
    t.run(async (ctx) => (await ctx.db.query("organizationSettings").collect()).length),
  ).resolves.toBe(1);
  await t.run(async (ctx) => {
    const organizationId = (await ctx.db.query("organizations").collect())[0]!._id;
    await ctx.db.insert("organizationSettings", {
      organizationId,
      ...settings,
      _id: undefined,
      _creationTime: undefined,
    } as never);
  });
  await expect(owner(t).query(api.organizationSettings.getCurrent, {})).rejects.toThrow(/duplicate/i);
});

test("owner can update validated settings and staff can read them", async () => {
  const t = convexTest(schema, modules);
  await provision(t);
  await event(t, "user-staff-user", "user.created", { id: "user-staff" });
  await event(t, "org-main-user-staff-membership", "organizationMembership.created", {
    id: "org-main-user-staff-membership-id",
    organization: { id: "org-main" },
    public_user_data: { user_id: "user-staff" },
    role: "org:staff",
  });
  await expect(
    owner(t).mutation(api.organizationSettings.update, {
      timezone: "Asia/Kolkata",
      defaultCurrency: "USD",
      attributionWindow: { value: 48, unit: "hours", semantics: "interaction_to_outcome" },
      businessVertical: "clinic",
      expectedBookingValuePolicy: { mode: "org_wide", amountMinor: 125000, currency: "USD" },
      healthFreshnessPolicy: { warningAfterMinutes: 30, criticalAfterMinutes: 120 },
    }),
  ).resolves.toMatchObject({ timezone: "Asia/Kolkata", defaultCurrency: "USD" });
  await expect(staff(t).query(api.organizationSettings.getCurrent, {})).resolves.toMatchObject({
    timezone: "Asia/Kolkata",
    defaultCurrency: "USD",
    businessVertical: "clinic",
  });
});

test.each([
  ["timezone", { timezone: "Not/A-Timezone" }],
  ["currency", { defaultCurrency: "usd" }],
  ["attribution lower bound", { attributionWindow: { value: 0, unit: "days", semantics: "interaction_to_outcome" } }],
  ["attribution upper bound", { attributionWindow: { value: 721, unit: "hours", semantics: "interaction_to_outcome" } }],
  ["health ordering", { healthFreshnessPolicy: { warningAfterMinutes: 120, criticalAfterMinutes: 60 } }],
  ["org-wide money contract", { expectedBookingValuePolicy: { mode: "org_wide", amountMinor: 12 } }],
] as const)("rejects invalid %s settings", async (_name, patch) => {
  const t = convexTest(schema, modules);
  await provision(t);
  await expect(owner(t).mutation(api.organizationSettings.update, patch)).rejects.toThrow(/invalid|must|required|bound|currency|timezone/i);
});

test("only owners can initialize or change settings, and inactive membership/org is denied", async () => {
  const t = convexTest(schema, modules);
  await provision(t);
  await event(t, "user-operator-user", "user.created", { id: "user-operator" });
  await event(t, "org-main-user-operator-membership", "organizationMembership.created", {
    id: "org-main-user-operator-membership-id",
    organization: { id: "org-main" },
    public_user_data: { user_id: "user-operator" },
    role: "org:operator",
  });
  await expect(
    operator(t).mutation(api.organizationSettings.update, { timezone: "Europe/London" }),
  ).rejects.toThrow(/requires owner/i);
  await expect(
    staff(t).mutation(api.organizationSettings.initializeDefaults, {}),
  ).rejects.toThrow(/requires owner|not a member|unknown/i);
  await t.run(async (ctx) => {
    const membership = (await ctx.db.query("memberships").collect()).find((row) => row.userId !== undefined && row.role === "owner");
    if (membership) await ctx.db.patch(membership._id, { active: false });
  });
  await expect(owner(t).query(api.organizationSettings.getCurrent, {})).rejects.toThrow(/inactive|member/i);
});

test("bindings store only non-secret metadata, enforce tenant-scoped uniqueness, and audit owner writes", async () => {
  const t = convexTest(schema, modules);
  await provision(t);
  const binding = await owner(t).mutation(api.integrationBindings.upsert, {
    bindingKey: "dograh-primary",
    provider: "dograh",
    status: "active",
    dograhOrganizationId: "dograh-org-1",
    dograhWorkflowId: "workflow-1",
    metadata: [{ key: "region", value: "in" }],
    secretReferenceNames: ["DOGRAH_API_KEY"],
    health: { status: "healthy", lastCheckedAt: 1000 },
  });
  expect(binding).toMatchObject({ bindingKey: "dograh-primary", provider: "dograh", secretReferenceNames: ["DOGRAH_API_KEY"] });
  await expect(
    owner(t).mutation(api.integrationBindings.upsert, {
      bindingKey: "dograh-primary",
      provider: "dograh",
      status: "active",
      dograhOrganizationId: "dograh-org-2",
      dograhWorkflowId: "workflow-2",
    }),
  ).rejects.toThrow(/duplicate|integrity|binding/i);
  await expect(owner(t).query(api.integrationBindings.list, {})).resolves.toHaveLength(1);
  await expect(
    t.run(async (ctx) => (await ctx.db.query("operationEvents").collect()).filter((row) => row.targetType === "integrationBinding").length),
  ).resolves.toBe(1);
  await expect(
    owner(t).mutation(api.integrationBindings.upsert, {
      bindingKey: "secret-attempt",
      provider: "dograh",
      status: "active",
      apiKey: "super-secret",
    } as never),
  ).rejects.toThrow();
});

test("binding updates reject cross-tenant ids and non-owner writes", async () => {
  const t = convexTest(schema, modules);
  await provision(t, "org-main", "user-owner");
  await provision(t, "org-other", "user-other");
  await event(t, "user-operator-for-binding", "user.created", { id: "user-operator" });
  await event(t, "operator-binding-membership", "organizationMembership.created", {
    id: "operator-binding-membership-id",
    organization: { id: "org-main" },
    public_user_data: { user_id: "user-operator" },
    role: "org:operator",
  });
  const binding = await owner(t).mutation(api.integrationBindings.upsert, {
    bindingKey: "twenty-primary",
    provider: "twenty",
    status: "inactive",
    twentyWorkspaceId: "workspace-1",
    twentyObjectMappings: [{ workstationType: "customer", twentyObject: "people" }],
  });
  const bindingId = binding._id;
  await expect(
    t.withIdentity({ subject: "user-other", org_id: "org-other", org_role: "org:admin" }).mutation(api.integrationBindings.update, {
      bindingId,
      status: "active",
    }),
  ).rejects.toThrow(/belong|tenant|forbidden|not found/i);
  await expect(operator(t).mutation(api.integrationBindings.update, { bindingId, status: "active" })).rejects.toThrow(/requires owner/i);
});

test("concurrent binding reservations leave one row and fail the competing writer", async () => {
  const t = convexTest(schema, modules);
  await provision(t);
  const results = await Promise.allSettled(
    Array.from({ length: 2 }, () =>
      owner(t).mutation(api.integrationBindings.upsert, {
        bindingKey: "concurrent-dograh",
        provider: "dograh",
        status: "active",
        dograhOrganizationId: "dograh-org",
        dograhWorkflowId: "workflow",
      }),
    ),
  );
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  await expect(
    t.run(async (ctx) => (await ctx.db.query("integrationBindings").collect()).length),
  ).resolves.toBe(1);
});

test("internal binding resolver requires explicit active tenant and never returns credential values", async () => {
  const t = convexTest(schema, modules);
  await provision(t);
  const binding = await owner(t).mutation(api.integrationBindings.upsert, {
    bindingKey: "hermes-primary",
    provider: "hermes",
    status: "active",
    secretReferenceNames: ["HERMES_MANAGER_KEY"],
  });
  const organizationId = await t.run(async (ctx) => (await ctx.db.query("organizations").collect())[0]!._id);
  await expect(t.query(internal.integrationBindings.resolve, { organizationId, bindingKey: "hermes-primary" })).resolves.toMatchObject({
    organizationId,
    bindingKey: "hermes-primary",
    secretReferenceNames: ["HERMES_MANAGER_KEY"],
  });
  await expect(t.query(internal.integrationBindings.resolve, { organizationId, bindingKey: "missing" })).resolves.toBeNull();
  await t.run(async (ctx) => ctx.db.patch(binding._id, { status: "inactive" }));
  await expect(t.query(internal.integrationBindings.resolve, { organizationId, bindingKey: "hermes-primary" })).resolves.toBeNull();
  const fields = await t.run(async (ctx) => {
    const row = await ctx.db.get(binding._id);
    return row ? Object.keys(row) : [];
  });
  expect(fields.some((field) => /value|token|password|apiKey|secret(?!Reference)/i.test(field))).toBe(false);
});

test("date and money helpers consume organization policy at timezone and currency boundaries", async () => {
  const t = convexTest(schema, modules);
  await provision(t);
  await owner(t).mutation(api.organizationSettings.update, { timezone: "America/New_York", defaultCurrency: "USD" });
  const settings = await owner(t).query(api.organizationSettings.getCurrent, {});
  const { dateKeyForOrganization } = await import("./lib/date");
  const { formatOrganizationMoney, minorFromMajor } = await import("./lib/money");
  const instant = Date.parse("2026-01-01T00:30:00Z");
  expect(dateKeyForOrganization(instant, settings)).toBe("2025-12-31");
  expect(formatOrganizationMoney(125000, settings)).toContain("$1,250.00");
  expect(minorFromMajor("1000", "JPY")).toBe(1000);
  expect(minorFromMajor("1.234", "KWD")).toBe(1234);
});

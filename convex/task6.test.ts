import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { normalizeDograhContext, sanitizeDograhValue } from "./lib/normalizeDograhOutcome";
import { DOGRAH_WEBHOOK_HEADER, MAX_DOGRAH_WEBHOOK_BYTES } from "./http/dograhWebhook";

const modules = import.meta.glob("./**/*.*s");
const secret = "task6-webhook-secret";
const ownerClaims = { subject: "task6-owner", org_id: "org_task6", org_role: "org:admin" };
const rivalClaims = { subject: "task6-rival", org_id: "org_task6_rival", org_role: "org:admin" };

const inboundFixture = {
  run_id: "13501",
  workflow_id: "14",
  workflow_name: "Dentist Demo Agent",
  demo_agent: "dentist",
  from_number: "",
  phone_number: "+919999000001",
  customer_name: "Asha",
  outcome: "Asked for a consultation tomorrow.",
  call_summary: "Asked for a consultation tomorrow.",
  extracted_variables: {
    call_summary: "Asked for a consultation tomorrow.",
    call_direction: "inbound",
    intent: "new_appointment",
    appointment_requested: "True",
    quote_requested: "False",
    follow_up_required: "False",
    handoff_required: "False",
  },
  recording: "",
  transcript: "",
  initial_context: "{\"workstation_provider_run_id\":\"ws-task6-inbound\"}",
  gathered_context: "{\"extracted_variables\":{\"appointment_requested\":\"True\"}}",
};

const outboundFixture = {
  workflow_run_id: 13502,
  workflow_id: 14,
  workflow_name: "Vectis Demo Agent",
  call_time: "2026-08-31T10:00:00.000Z",
  initial_context: { workstation_provider_run_id: "ws-task6-outbound", phone_number: "+919999000002" },
  gathered_context: { resolution: "reached", qualified: true, summary: "Interested in a demo." },
  recording_url: null,
  transcript_url: null,
  state: "completed",
};

async function provision(t: ReturnType<typeof convexTest>, claims = ownerClaims) {
  const identity = t.withIdentity(claims);
  const event = (eventId: string, eventType: string, data: object) =>
    t.mutation(internal.http.clerkWebhook.processEvent, {
      eventId,
      eventType,
      payload: JSON.stringify({ id: eventId, type: eventType, data }),
      eventTimestamp: 1_000,
    });
  await event(`${claims.subject}-user`, "user.created", { id: claims.subject });
  await event(`${claims.org_id}-org`, "organization.created", { id: claims.org_id, name: claims.org_id });
  await event(`${claims.subject}-${claims.org_id}-membership`, "organizationMembership.created", {
    id: `${claims.subject}-${claims.org_id}-membership`,
    organization: { id: claims.org_id },
    public_user_data: { user_id: claims.subject },
    role: "org:admin",
  });
  const customerId = await identity.mutation(api.customers.createCustomer, {
    displayName: "Task 6 Customer",
    phone: "+919999000001",
  });
  return { identity, customerId };
}

async function register(t: ReturnType<typeof convexTest>, organizationId: string, customerId: string, workstationRunId: string, direction: "inbound" | "outbound" = "inbound") {
  return t.mutation(internal.providerRuns.register, {
    organizationId: organizationId as never,
    customerId: customerId as never,
    workstationRunId,
    direction,
  });
}

async function post(t: ReturnType<typeof convexTest>, payload: unknown, headers: Record<string, string> = {}) {
  return t.fetch("/dograh/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", [DOGRAH_WEBHOOK_HEADER]: secret, ...headers },
    body: JSON.stringify(payload),
  });
}

async function seedWithRun(direction: "inbound" | "outbound" = "inbound") {
  const t = convexTest(schema, modules);
  const { identity, customerId } = await provision(t);
  const organizationId = (await t.run(async (ctx) => {
    const row = await ctx.db.query("organizations").withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", ownerClaims.org_id)).unique();
    return row!._id;
  })) as string;
  const workstationRunId = direction === "inbound" ? "ws-task6-inbound" : "ws-task6-outbound";
  await register(t, organizationId, customerId as string, workstationRunId, direction);
  return { t, identity, customerId, organizationId, workstationRunId };
}

test("records the exact inbound and outbound Dograh renderer shapes as supported fixtures", async () => {
  expect(typeof inboundFixture.run_id).toBe("string");
  expect(inboundFixture.extracted_variables.appointment_requested).toBe("True");
  expect(inboundFixture.recording).toBe("");
  expect(outboundFixture.workflow_run_id).toBe(13502);
  expect(outboundFixture.gathered_context).toEqual(expect.objectContaining({ resolution: "reached" }));
});

test("pre-registration plus terminal callback creates one typed timeline projection", async () => {
  process.env.DOGRAH_WEBHOOK_SECRET = secret;
  const { t, identity, customerId } = await seedWithRun();
  const response = await post(t, { ...inboundFixture, state: "completed" });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.ok).toBe(true);
  const timeline = await identity.query(api.customerTimeline.getCustomerTimeline, { customerId: customerId as never });
  expect(timeline.events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "call" }), expect.objectContaining({ kind: "outcome" })]));
  const firstTimelinePage = await identity.query(api.customerTimeline.getCustomerTimeline, { customerId: customerId as never, paginationOpts: { numItems: 1, cursor: null } });
  expect(firstTimelinePage.events).toHaveLength(1);
  expect(firstTimelinePage.events[0].evidence).toEqual(expect.objectContaining({ table: expect.any(String), id: expect.any(String) }));
  expect(timeline.outcomes).toHaveLength(1);
  expect(timeline.outcomes[0]).toMatchObject({ outcomeType: "booking_requested", fields: { bookingRequested: true, bookingConfirmed: false } });
  const runs = await t.run(async (ctx) => ctx.db.query("providerRuns").collect());
  expect(runs).toHaveLength(1);
  expect(runs[0].workstationRunId).toBe("ws-task6-inbound");
});

test("outbound provider-doc shape projects direction from registration, not callback input", async () => {
  process.env.DOGRAH_WEBHOOK_SECRET = secret;
  const { t, identity, customerId } = await seedWithRun("outbound");
  const response = await post(t, outboundFixture);
  expect(response.status).toBe(200);
  const conversations = await identity.query(api.conversations.listCustomerConversations, { customerId: customerId as never, paginationOpts: { numItems: 10, cursor: null } });
  expect(conversations.page[0]).toMatchObject({ direction: "outbound", channel: "voice" });
  const interactions = await t.run(async (ctx) => ctx.db.query("interactions").collect());
  expect(interactions[0]).toMatchObject({ direction: "outbound" });
  expect(interactions[0]).not.toHaveProperty("recordingUrl");
  expect(interactions[0]).not.toHaveProperty("transcriptUrl");
  const outcomes = await t.run(async (ctx) => ctx.db.query("callOutcomes").collect());
  expect(outcomes[0]).toMatchObject({ outcomeType: "qualified", fields: { reached: true, resolution: "reached", bookingConfirmed: false } });
});
test("normalization handles renderer strings with canonical precedence and bounded custom fields", () => {
  const normalized = normalizeDograhContext({
    wants_booking: "False",
    appointment_requested: "True",
    booking_confirmed: "True",
    qualified: "True",
    resolution: "reached",
    sentiment: " Positive ",
    hair_loss_concern: "crown",
    custom: "value",
    empty: "",
  });
  expect(normalized.outcomeType).toBe("booking_requested");
  expect(normalized.fields).toMatchObject({ reached: true, qualified: true, bookingRequested: true, bookingConfirmed: false, sentiment: "positive" });
  expect(normalized.customFields).toEqual(expect.arrayContaining([{ key: "hair_loss_concern", value: "crown" }, { key: "custom", value: "value" }]));
});

test("raw provider context is recursively redacted and bounded", () => {
  const sanitized = sanitizeDograhValue({ password: "secret", nested: { authorization: "Bearer secret", ok: "yes" }, list: [1, true] });
  expect(sanitized).toEqual({ nested: { ok: "yes" }, list: [1, true] });
  const bounded = sanitizeDograhValue({ huge: "x".repeat(100_000) }) as { huge: string };
  expect(bounded.huge).toHaveLength(2_048);
});

test("webhook fails closed for missing secret, wrong method, invalid body, and unknown correlation", async () => {
  const t = convexTest(schema, modules);
  const old = process.env.DOGRAH_WEBHOOK_SECRET;
  delete process.env.DOGRAH_WEBHOOK_SECRET;
  try {
    expect((await post(t, inboundFixture)).status).toBe(503);
    process.env.DOGRAH_WEBHOOK_SECRET = secret;
    expect((await post(t, inboundFixture, { [DOGRAH_WEBHOOK_HEADER]: "wrong-secret" })).status).toBe(401);
    expect((await t.fetch("/dograh/webhook", { method: "GET", headers: { [DOGRAH_WEBHOOK_HEADER]: secret } })).status).toBe(405);
    expect((await post(t, "not an object")).status).toBe(400);
    expect((await post(t, { ...inboundFixture, initial_context: { workstation_provider_run_id: "unknown" } })).status).toBe(404);
  } finally {
    if (old === undefined) delete process.env.DOGRAH_WEBHOOK_SECRET;
    else process.env.DOGRAH_WEBHOOK_SECRET = old;
  }
});

test("duplicate, stale, and nonterminal callbacks do not regress or duplicate side effects", async () => {
  process.env.DOGRAH_WEBHOOK_SECRET = secret;
  const { t, identity, customerId } = await seedWithRun();
  const pending = await post(t, { ...inboundFixture, state: "initiated" });
  expect(pending.status).toBe(200);
  const terminal = await post(t, { ...inboundFixture, state: "completed" });
  const duplicate = await post(t, { ...inboundFixture, state: "completed" });
  const stale = await post(t, { ...inboundFixture, state: "initiated" });
  expect(terminal.status).toBe(200);
  expect((await duplicate.json()).result.replayed).toBe(true);
  expect((await stale.json()).result.replayed).toBe(true);
  const timeline = await identity.query(api.customerTimeline.getCustomerTimeline, { customerId: customerId as never });
  expect(timeline.outcomes).toHaveLength(1);
  expect(await t.run(async (ctx) => (await ctx.db.query("operationEvents").collect()).filter((e) => e.type === "dograh.callback").length)).toBe(1);
  expect(await t.run(async (ctx) => (await ctx.db.query("deliveries").collect()).length)).toBe(1);
});

test("concurrent terminal replays converge to one outcome, event, and intent", async () => {
  process.env.DOGRAH_WEBHOOK_SECRET = secret;
  const { t } = await seedWithRun();
  const responses = await Promise.all(Array.from({ length: 3 }, () => post(t, { ...inboundFixture, state: "completed" })));
  expect(responses.map((response) => response.status).every((status) => status === 200)).toBe(true);
  expect(await t.run(async (ctx) => (await ctx.db.query("callOutcomes").collect()).length)).toBe(1);
  expect(await t.run(async (ctx) => (await ctx.db.query("operationEvents").collect()).filter((event) => event.type === "dograh.callback").length)).toBe(1);
  expect(await t.run(async (ctx) => (await ctx.db.query("deliveries").collect()).length)).toBe(1);
});
test("workstation and provider identifiers are globally collision-safe and tenants cannot substitute", async () => {
  const t = convexTest(schema, modules);
  const first = await provision(t);
  const second = await provision(t, rivalClaims);
  const orgs = await t.run(async (ctx) => ctx.db.query("organizations").collect());
  const firstOrg = orgs.find((o) => o.clerkOrgId === ownerClaims.org_id)!;
  const secondOrg = orgs.find((o) => o.clerkOrgId === rivalClaims.org_id)!;
  await expect(second.identity.query(api.customerTimeline.getCustomerTimeline, { customerId: first.customerId as never })).rejects.toThrow(/not found/i);
  await register(t, firstOrg._id as string, first.customerId as string, "ws-global-collision");
  await expect(register(t, secondOrg._id as string, second.customerId as string, "ws-global-collision")).rejects.toThrow(/collision|unique|already/i);
  await expect(t.mutation(internal.providerRuns.register, { organizationId: secondOrg._id, customerId: second.customerId, workstationRunId: "ws-other", direction: "inbound", providerRunId: "provider-collision" })).resolves.toBeDefined();
  await expect(t.mutation(internal.providerRuns.register, { organizationId: firstOrg._id, customerId: first.customerId, workstationRunId: "ws-first-provider-collision", direction: "inbound", providerRunId: "provider-collision" })).rejects.toThrow(/collision|unique|already/i);
});

test("body limit is enforced before projection", async () => {
  process.env.DOGRAH_WEBHOOK_SECRET = secret;
  const t = convexTest(schema, modules);
  const response = await t.fetch("/dograh/webhook", { method: "POST", headers: { [DOGRAH_WEBHOOK_HEADER]: secret, "content-length": String(MAX_DOGRAH_WEBHOOK_BYTES + 1) }, body: "{}" });
  expect(response.status).toBe(413);
});

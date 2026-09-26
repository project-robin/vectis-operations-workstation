import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { buildCampaignCsv } from "./lib/campaignCsv";
import { mapDograhRun, outcomeLabel } from "./lib/callResult";
import { crmNoteMarkdown } from "./lib/crmNote";
import { normalizePhone, splitForTwenty } from "./lib/phone";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const owner = { subject: "console-owner", name: "Dr Rao", email: "rao@example.com" };
const rival = { subject: "console-rival", name: "Rival" };

beforeEach(() => {
  vi.stubEnv("DOGRAH_API_KEY", "test-key");
  vi.stubEnv("DOGRAH_QUICK_CALL_WORKFLOW_ID", "12361");
  vi.stubEnv("DOGRAH_QUICK_CALL_TRIGGER_PATH", "vectis-quick-test");
  vi.stubEnv("DOGRAH_LEAD_WORKFLOW_ID", "11741");
  vi.stubEnv("TWENTY_API_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

async function workspace(t = convexTest(schema, modules), claims: { subject: string; name: string; email?: string } = owner) {
  const identity = t.withIdentity(claims);
  const { organizationId } = await identity.mutation(api.workspace.ensureWorkspace, {});
  return { t, identity, organizationId };
}

test("phone normalization handles Indian local numbers and rejects junk", () => {
  expect(normalizePhone("8329727869")).toBe("+918329727869");
  expect(normalizePhone("083297 27869")).toBe("+918329727869");
  expect(normalizePhone("+1 (415) 555-0100")).toBe("+14155550100");
  expect(normalizePhone("0044 20 7946 0958")).toBe("+442079460958");
  expect(normalizePhone("12345")).toBeNull();
  expect(normalizePhone("")).toBeNull();
  expect(splitForTwenty("+918329727869")).toEqual({ callingCode: "+91", number: "8329727869" });
  expect(splitForTwenty("+14155550100")).toEqual({ callingCode: "+1", number: "4155550100" });
});

test("maps Dograh runs to call results", () => {
  expect(mapDograhRun({ is_completed: false }).status).toBe("in_progress");
  const done = mapDograhRun({
    is_completed: true,
    cost_info: { call_duration_seconds: 49 },
    transcript_public_url: "https://api.dograh.com/t",
    gathered_context: {
      provider: "twilio",
      agent_visits: [{ node: "Wrap Up" }],
      call_disposition: "end_call",
      extracted_variables: { call_summary: "Feeling fine.", answers: "Q: Dizzy? — A: No", follow_up_required: "True" },
    },
  });
  expect(done).toMatchObject({ status: "completed", disposition: "end_call", durationSeconds: 49, summary: "Feeling fine.", followUpRequired: true });
  expect(JSON.parse(done.extracted ?? "{}")).not.toHaveProperty("agent_visits");
  expect(mapDograhRun({ is_completed: true, gathered_context: { call_disposition: "no-answer" } }).status).toBe("no_answer");
  expect(mapDograhRun({ is_completed: true, gathered_context: { error: "quota", call_disposition: "error" } }).status).toBe("failed");
  expect(outcomeLabel("completed", "not_interested")).toBe("Not interested");
});

test("campaign CSV escapes values and neutralizes formulas", () => {
  const csv = buildCampaignCsv([{ callId: "c1", phone: "+919999000001", name: 'Asha "VIP", Rao', email: "=cmd()" }], "Clinic, Inc");
  const [header, row] = csv.trim().split("\n");
  expect(header).toBe("phone_number,first_name,name,email,business_name,vectis_call_id");
  expect(row).toBe('+919999000001,Asha,"Asha ""VIP"", Rao",\'=cmd(),"Clinic, Inc",c1');
});

test("CRM note includes the brief, answers, and artifact links", () => {
  const markdown = crmNoteMarkdown({
    kind: "quick",
    status: "completed",
    phone: "+918329727869",
    brief: "Ask about tablets",
    summary: "Fine",
    answers: "Q: Taking daily? — A: Yes",
    durationSeconds: 75,
    recordingUrl: "https://r",
    businessName: "Clinic",
  });
  expect(markdown).toContain("### What we asked\nAsk about tablets");
  expect(markdown).toContain("**Duration:** 1m 15s");
  expect(markdown).toContain("[Recording](https://r)");
});

test("ensureWorkspace provisions one owner workspace per user, idempotently", async () => {
  const { t, identity, organizationId } = await workspace();
  const again = await identity.mutation(api.workspace.ensureWorkspace, {});
  expect(again.organizationId).toBe(organizationId);
  const current = await identity.query(api.workspace.current, {});
  expect(current).toMatchObject({ role: "owner", businessName: "Dr Rao's business" });
  const counts = await t.run(async (ctx) => ({
    orgs: (await ctx.db.query("organizations").collect()).length,
    memberships: (await ctx.db.query("memberships").collect()).length,
  }));
  expect(counts).toEqual({ orgs: 1, memberships: 1 });
  await expect(t.query(api.workspace.current, {})).resolves.toBeNull();
});

test("onboarding records an accepted business name and can be dismissed", async () => {
  const { identity } = await workspace();
  const initial = await identity.query(api.workspace.current, {});
  expect(initial?.onboardingStartedAt).toEqual(expect.any(Number));
  expect(initial?.onboardingBusinessNamed).toBe(false);
  await identity.mutation(api.workspace.updateSettings, { businessName: initial?.businessName });
  expect(await identity.query(api.workspace.current, {})).toMatchObject({ onboardingBusinessNamed: true, onboardingDismissedAt: null });
  await identity.mutation(api.workspace.dismissOnboarding, {});
  expect((await identity.query(api.workspace.current, {}))?.onboardingDismissedAt).toEqual(expect.any(Number));
});

test("calling analytics counts real workspace calls within the selected period", async () => {
  const t = convexTest(schema, modules);
  const a = await workspace(t, owner);
  const b = await workspace(t, rival);
  const now = Date.now();
  const insert = (organizationId: Id<"organizations">, createdAt: number, status: "completed" | "failed", crmStatus: "synced" | "failed") =>
    t.run((ctx) => ctx.db.insert("calls", {
      organizationId, kind: "quick", phone: "+919999000001", agentWorkflowId: 12361,
      status, crmStatus, createdAt, updatedAt: createdAt, pollCount: 0,
      ...(status === "completed" ? { durationSeconds: 120, followUpRequired: true } : {}),
    }));
  await insert(a.organizationId, now - 60_000, "completed", "synced");
  await insert(a.organizationId, now - 120_000, "failed", "failed");
  await insert(a.organizationId, now - 10 * 86_400_000, "completed", "synced");
  await insert(b.organizationId, now - 60_000, "completed", "synced");

  const analytics = await a.identity.query(api.calls.callingAnalytics, { startAt: now - 7 * 86_400_000, endAt: now });
  expect(analytics).toMatchObject({
    totalCalls: 2,
    status: { completed: 1, failed: 1 },
    crm: { synced: 1, failed: 1 },
    kind: { quick: 2, campaign: 0 },
    followUps: 1,
    completionRate: 50,
    averageDurationSeconds: 120,
  });
  expect(analytics.activity.reduce((sum: number, bucket: { calls: number }) => sum + bucket.calls, 0)).toBe(2);
  expect((await b.identity.query(api.calls.callingAnalytics, { startAt: now - 7 * 86_400_000, endAt: now })).totalCalls).toBe(1);
  await expect(a.identity.query(api.calls.callingAnalytics, { startAt: now - 91 * 86_400_000, endAt: now })).rejects.toThrow("90 days");
});

test("lead import dedupes by phone and reports invalid rows", async () => {
  const { identity } = await workspace();
  const result = await identity.mutation(api.leads.importRows, {
    source: "csv",
    rows: [
      { name: "Asha", phone: "9999000001" },
      { name: "Asha again", phone: "+91 99990 00001" },
      { name: "Bad", phone: "123" },
      { name: "Ravi", phone: "+919999000002", email: "RAVI@example.com" },
    ],
  });
  expect(result.created).toBe(2);
  expect(result.invalid.map((row: { row: number }) => row.row)).toEqual([2, 3]);
  const second = await identity.mutation(api.leads.importRows, { source: "twenty", rows: [{ name: "Asha", phone: "+919999000001", twentyPersonId: "p1" }] });
  expect(second).toMatchObject({ created: 0, updated: 1 });
  const stats = await identity.query(api.leads.stats, {});
  expect(stats).toMatchObject({ total: 2, new: 2, remaining: 2 });
});

test("workspaces are isolated from each other", async () => {
  const t = convexTest(schema, modules);
  const a = await workspace(t, owner);
  const b = await workspace(t, rival);
  await a.identity.mutation(api.leads.importRows, { source: "manual", rows: [{ name: "Asha", phone: "+919999000001" }] });
  const leads = await b.identity.query(api.leads.list, { paginationOpts: { numItems: 10, cursor: null } });
  expect(leads.page).toHaveLength(0);
  const [lead] = (await a.identity.query(api.leads.list, { paginationOpts: { numItems: 10, cursor: null } })).page;
  await expect(b.identity.mutation(api.leads.remove, { leadId: lead._id })).rejects.toThrow("Lead not found");
  await expect(b.identity.mutation(api.calls.callLeads, { leadIds: [lead._id] })).rejects.toThrow("No leads left to call");
});

test("calling leads queues a campaign and results settle lead, batch, and CRM state", async () => {
  const { t, identity } = await workspace();
  await identity.mutation(api.leads.importRows, { source: "csv", rows: [{ name: "Asha", phone: "+919999000001" }, { name: "Ravi", phone: "+919999000002" }] });
  const { batchId, count } = await identity.mutation(api.calls.callLeads, {});
  expect(count).toBe(2);
  expect(await identity.query(api.leads.stats, {})).toMatchObject({ queued: 2, remaining: 0 });
  await expect(identity.mutation(api.calls.callLeads, {})).rejects.toThrow("No leads left to call");

  const calls = await t.run((ctx) => ctx.db.query("calls").withIndex("by_batch", (q) => q.eq("batchId", batchId)).collect());
  await t.mutation(internal.calls.batchStarted, { batchId });
  await t.mutation(internal.calls.applyResult, { callId: calls[0]._id, status: "completed", disposition: "end_call", summary: "Interested" });
  // Duplicate delivery (webhook + poller) is a no-op.
  await t.mutation(internal.calls.applyResult, { callId: calls[0]._id, status: "failed", error: "late duplicate" });
  await t.mutation(internal.calls.applyResult, { callId: calls[1]._id, status: "no_answer", disposition: "no-answer" });

  const settled = await t.run(async (ctx) => ({
    calls: await Promise.all(calls.map((call) => ctx.db.get(call._id))),
    batch: (await ctx.db.get(batchId)) as Doc<"callBatches"> | null,
  }));
  expect(settled.calls.map((call) => [call?.status, call?.crmStatus])).toEqual([
    ["completed", "skipped"],
    ["no_answer", "skipped"],
  ]);
  expect(settled.batch?.status).toBe("completed");
  expect(await identity.query(api.leads.stats, {})).toMatchObject({ called: 1, failed: 1, remaining: 1 });
  const dashboard = await identity.query(api.calls.dashboard, {});
  expect(dashboard.calls).toMatchObject({ completed: 1, no_answer: 1 });
});

test("a failed campaign start returns leads to the call list", async () => {
  const { t, identity } = await workspace();
  await identity.mutation(api.leads.importRows, { source: "csv", rows: [{ name: "Asha", phone: "+919999000001" }] });
  const { batchId } = await identity.mutation(api.calls.callLeads, {});
  await t.mutation(internal.calls.batchFailed, { batchId, error: "Dograh down" });
  expect(await identity.query(api.leads.stats, {})).toMatchObject({ new: 1, queued: 0 });
});

test("quick call validates input and records the brief", async () => {
  const { t, identity } = await workspace();
  await expect(identity.mutation(api.calls.startQuickCall, { phone: "12", brief: "Ask how they feel" })).rejects.toThrow("valid phone");
  await expect(identity.mutation(api.calls.startQuickCall, { phone: "+918329727869", brief: "hi" })).rejects.toThrow("Describe");
  const callId = await identity.mutation(api.calls.startQuickCall, { phone: "8329727869", brief: "Ask about the new tablets" });
  const call = await t.run((ctx) => ctx.db.get(callId as Id<"calls">));
  expect(call).toMatchObject({ kind: "quick", phone: "+918329727869", status: "queued", agentWorkflowId: 12361, brief: "Ask about the new tablets" });
});

test("Dograh call-events webhook requires the shared secret", async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv("VECTIS_DOGRAH_WEBHOOK_SECRET", "s3cret");
  const post = (headers: Record<string, string>, body: string) => t.fetch("/dograh/call-events", { method: "POST", headers, body });
  expect((await post({}, "{}")).status).toBe(401);
  expect((await post({ "x-vectis-secret": "wrong!" }, "{}")).status).toBe(401);
  expect((await post({ "x-vectis-secret": "s3cret" }, "not json")).status).toBe(400);
  expect((await post({ "x-vectis-secret": "s3cret" }, "{}")).status).toBe(400);
  expect((await post({ "x-vectis-secret": "s3cret" }, JSON.stringify({ workflow_run_id: "712293" }))).status).toBe(200);
});

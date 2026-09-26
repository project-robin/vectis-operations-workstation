import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { DograhAdapter, DograhAmbiguousError } from "./lib/dograhAdapter";
import { buildCampaignCsv, campaignTransition, providerStateIsTerminal } from "./lib/campaignState";

const modules = import.meta.glob("./**/*.*s");
const ownerClaims = { subject: "task8-owner", org_id: "org_task8", org_role: "org:admin" };
const operatorClaims = { subject: "task8-operator", org_id: "org_task8", org_role: "org:operator" };
const rivalClaims = { subject: "task8-rival", org_id: "org_task8-rival", org_role: "org:admin" };

async function provision(t = convexTest(schema, modules), claims = ownerClaims) {
  const identity = t.withIdentity(claims);
  const event = (eventId: string, eventType: string, data: object) => t.mutation(internal.http.clerkWebhook.processEvent, {
    eventId, eventType, payload: JSON.stringify({ id: eventId, type: eventType, data }), eventTimestamp: 1_000,
  });
  await event(`${claims.subject}-user`, "user.created", { id: claims.subject });
  await event(`${claims.org_id}-org`, "organization.created", { id: claims.org_id, name: claims.org_id });
  await event(`${claims.subject}-${claims.org_id}-membership`, "organizationMembership.created", {
    id: `${claims.subject}-${claims.org_id}-membership`, organization: { id: claims.org_id }, public_user_data: { user_id: claims.subject }, role: claims.org_role,
  });
  const organizationId = await t.run(async (ctx) => (await ctx.db.query("organizations").withIndex("by_clerk_org_id", (q) => q.eq("clerkOrgId", claims.org_id)).unique())!._id);
  return { t, identity, organizationId };
}

async function seedCampaignInput(t: ReturnType<typeof convexTest>, identity: ReturnType<typeof t.withIdentity>) {
  const batchId = await identity.mutation(api.imports.stageImport, {
    name: "approved batch", rows: [
      { name: "Asha, \"VIP\"", phone: "+919999000001", consent: "consented", consentSource: "web", evidenceAt: 1_000 },
      { name: "No consent", phone: "+919999000002", consent: "unknown" },
      { name: "Bad", phone: "not-a-phone", consent: "consented" },
    ],
  });
  await identity.mutation(api.imports.commitBatch, { batchId });
  await identity.mutation(api.imports.approveBatch, { batchId });
  const binding = await identity.mutation(api.integrationBindings.upsert, {
    bindingKey: "dograh-primary", provider: "dograh", status: "active",
    dograhOrganizationId: "dograh-org-1", dograhWorkflowId: "14", secretReferenceNames: ["DOGRAH_API_KEY"],
  });
  return { batchId, bindingId: binding._id };
}

test("drafts only from one approved eligible batch and pre-registers each correlation once", async () => {
  const { t, identity } = await provision();
  const { batchId, bindingId } = await seedCampaignInput(t, identity);
  const campaignId = await identity.mutation(api.campaigns.createCampaignDraft, { name: "August pilot", batchId, bindingId, idempotencyKey: "draft-august" });
  const replay = await identity.mutation(api.campaigns.createCampaignDraft, { name: "August pilot", batchId, bindingId, idempotencyKey: "draft-august" });
  expect(replay).toBe(campaignId);
  const rows = await t.run(async (ctx) => ({ members: await ctx.db.query("campaignMembers").collect(), runs: await ctx.db.query("providerRuns").collect(), campaign: await ctx.db.get(campaignId) }));
  expect(rows.members).toHaveLength(1);
  expect(rows.runs).toHaveLength(1);
  expect(rows.members[0]).toMatchObject({ consent: "consented", callDisposition: "not_called" });
  expect(rows.members[0].workstationRunId).toMatch(new RegExp(`^campaign:${campaignId}:member:`));
  expect(rows.runs[0]).toMatchObject({ campaignId, direction: "outbound", state: "pending" });
  expect(rows.campaign).toMatchObject({ businessStatus: "draft", providerExecutionState: "not_created", approvedBatchId: batchId, bindingId, totalRows: 1, processedRows: 0 });
});

test("owner approval and atomic transitional claims enforce legal transitions and tenant isolation", async () => {
  const { t, identity, organizationId } = await provision();
  const { batchId, bindingId } = await seedCampaignInput(t, identity);
  const campaignId = await identity.mutation(api.campaigns.createCampaignDraft, { name: "State machine", batchId, bindingId, idempotencyKey: "state-machine" });
  await provision(t, operatorClaims);
  const operator = t.withIdentity(operatorClaims);
  await expect(operator.mutation(api.campaigns.approveCampaign, { campaignId })).rejects.toThrow(/owner|Forbidden/i);
  await identity.mutation(api.campaigns.approveCampaign, { campaignId });
  const [one, two] = await Promise.all([
    identity.mutation(api.campaigns.startCampaign, { campaignId, idempotencyKey: "start-1" }),
    identity.mutation(api.campaigns.startCampaign, { campaignId, idempotencyKey: "start-1" }),
  ]);
  expect(one).toBe(two);
  const claimed = await t.run(async (ctx) => ctx.db.get(campaignId));
  expect(claimed).toMatchObject({ businessStatus: "starting", claimType: "start", claimToken: expect.any(String) });
  await expect(identity.mutation(api.campaigns.pauseCampaign, { campaignId, idempotencyKey: "pause-too-soon" })).rejects.toThrow(/legal|starting|running/i);
  const rival = await provision(convexTest(schema, modules), rivalClaims);
  await expect(rival.identity.query(api.campaigns.getCampaign, { campaignId })).rejects.toThrow(/not found/i);
  const events = await t.run(async (ctx) => ctx.db.query("operationEvents").withIndex("by_organization_target", (q) => q.eq("organizationId", organizationId).eq("targetType", "campaign").eq("targetId", campaignId)).collect());
  expect(events.map((e) => e.type)).toContain("campaign.transition.claimed");
});

test("campaign CSV is bounded, escaped, and contains only stable correlation fields", () => {
  const csv = buildCampaignCsv([{ workstationRunId: "ws-1", sourceRowId: "row-1", providerRunId: "pending", name: "Asha, \"VIP\"", phone: "+919999000001", consent: "consented" }]);
  expect(csv).toBe("workstation_provider_run_id,source_row_id,name,phone\nws-1,row-1,\"Asha, \"\"VIP\"\"\",+919999000001\n");
  expect(csv).not.toContain("consent");
  expect(() => buildCampaignCsv(Array.from({ length: 501 }, (_, i) => ({ workstationRunId: `w-${i}`, sourceRowId: `r-${i}`, providerRunId: "p", name: "n", phone: "+1", consent: "consented" as const })))).toThrow(/rows|bound/i);
});

test("adapter uses exact Dograh routes and never retries ambiguous mutations", async () => {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    if (req.url === "/api/v1/s3/presigned-upload-url") return json(res, { upload_url: `${baseUrl}/upload`, file_key: "campaigns/dograh/file.csv", expires_in: 900 });
    if (req.url === "/upload") { res.writeHead(200); res.end(); return; }
    if (req.url === "/api/v1/campaign/create") return json(res, { campaign_id: 42, state: "created" });
    if (req.url === "/api/v1/campaign/42/start") return json(res, { campaign_id: 42, state: "running" });
    if (req.url === "/api/v1/campaign/42") return json(res, { campaign_id: 42, state: "running" });
    if (req.url === "/api/v1/campaign/42/pause") return json(res, { campaign_id: 42, state: "paused" });
    if (req.url === "/api/v1/campaign/42/resume") return json(res, { campaign_id: 42, state: "running" });
    if (req.url === "/api/v1/campaign/42/progress") return json(res, { campaign_id: 42, state: "running", total_rows: 1, processed_rows: 1, failed_calls: 0, progress_percentage: 100 });
    if (req.url === "/api/v1/campaign/42/runs") return json(res, { runs: [] });
    if (req.url === "/api/v1/campaign/42/report") return json(res, { rows: [] });
    res.writeHead(404); res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${(address as { port: number }).port}`;
  const adapter = new DograhAdapter(baseUrl, "secret-not-logged");
  const upload = await adapter.requestUploadUrl({ fileName: "campaign.csv", fileSize: 5 });
  await adapter.uploadCsv(upload.uploadUrl, "a,b\n1,2\n");
  expect(await adapter.create({ name: "Pilot", workflowId: 14, fileKey: upload.fileKey })).toMatchObject({ campaignId: 42, state: "created" });
  expect(await adapter.get(42)).toMatchObject({ campaignId: 42 });
  await adapter.start(42);
  await adapter.pause(42);
  await adapter.resume(42);
  await adapter.progress(42); await adapter.runs(42); await adapter.report(42);
  expect(calls).toEqual(expect.arrayContaining(["POST /api/v1/s3/presigned-upload-url", "POST /api/v1/campaign/create", "GET /api/v1/campaign/42", "POST /api/v1/campaign/42/start", "POST /api/v1/campaign/42/pause", "POST /api/v1/campaign/42/resume", "GET /api/v1/campaign/42/progress", "GET /api/v1/campaign/42/runs", "GET /api/v1/campaign/42/report"]));
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("provider terminal state is monotonic and 100 percent progress is not terminal", () => {
  expect(providerStateIsTerminal("completed")).toBe(true);
  expect(providerStateIsTerminal("running")).toBe(false);
  expect(campaignTransition("running", "pausing")).toBe("pausing");
  expect(() => campaignTransition("completed", "running")).toThrow(/terminal|legal/i);
  expect(campaignTransition("completed", "completed")).toBe("completed");
});

test("ambiguous provider mutation is marked for reconciliation and is not retried", async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
  const adapter = new DograhAdapter("https://dograh.example", "secret", fetcher);
  await expect(adapter.start(42)).rejects.toBeInstanceOf(DograhAmbiguousError);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("adapter fails closed on 5xx, malformed mutation responses, and oversize uploads", async () => {
  const fiveHundred = vi.fn().mockResolvedValue(new Response("server error", { status: 503 }));
  await expect(new DograhAdapter("https://dograh.example", "secret", fiveHundred).pause(42)).rejects.toBeInstanceOf(DograhAmbiguousError);
  const malformed = vi.fn().mockResolvedValue(new Response("not-json", { status: 200 }));
  await expect(new DograhAdapter("https://dograh.example", "secret", malformed).start(42)).rejects.toBeInstanceOf(DograhAmbiguousError);
  const upload = new DograhAdapter("https://dograh.example", "secret", vi.fn());
  await expect(upload.uploadCsv("https://storage.example/upload", "x".repeat(10 * 1024 * 1024 + 1))).rejects.toThrow(/size|bound/i);
});

test("scheduled start performs canary, create, start, and read-backs without duplicate provider calls", async () => {
  const { t, identity } = await provision();
  const { batchId, bindingId } = await seedCampaignInput(t, identity);
  const campaignId = await identity.mutation(api.campaigns.createCampaignDraft, { name: "Fake contract", batchId, bindingId, idempotencyKey: "fake-contract" });
  await identity.mutation(api.campaigns.approveCampaign, { campaignId });
  const calls: string[] = [];
  let base = "";
  const server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    if (req.url === "/api/v1/workflow/14") return json(res, { id: 14, status: "published", active: true });
    if (req.url === "/api/v1/s3/presigned-upload-url") return json(res, { upload_url: `${base}/upload`, file_key: "campaigns/dograh/fake.csv" });
    if (req.url === "/upload") { res.writeHead(200); res.end(); return; }
    if (req.url === "/api/v1/campaign/create") return json(res, { campaign_id: 99, state: "created" });
    if (req.url === "/api/v1/campaign/99") return json(res, { campaign_id: 99, state: calls.filter((call) => call.includes("/start")).length ? "running" : "created" });
    if (req.url === "/api/v1/campaign/99/start") return json(res, { campaign_id: 99, state: "running" });
    res.writeHead(404); res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const previousUrl = process.env.DOGRAH_API_URL;
  const previousKey = process.env.DOGRAH_API_KEY;
  process.env.DOGRAH_API_URL = base;
  process.env.DOGRAH_API_KEY = "fake-contract-key";
  try {
    await identity.mutation(api.campaigns.startCampaign, { campaignId, idempotencyKey: "fake-start" });
    await t.finishAllScheduledFunctions(() => {});
    const campaign = await identity.query(api.campaigns.getCampaign, { campaignId });
    expect(campaign).toMatchObject({ businessStatus: "running", dograhCampaignId: 99, providerExecutionState: "running" });
    expect(calls.filter((call) => call === "POST /api/v1/campaign/create")).toHaveLength(1);
    expect(calls.filter((call) => call === "POST /api/v1/campaign/99/start")).toHaveLength(1);
    expect(calls.filter((call) => call === "GET /api/v1/campaign/99")).toHaveLength(3);
  } finally {
    if (previousUrl === undefined) delete process.env.DOGRAH_API_URL; else process.env.DOGRAH_API_URL = previousUrl;
    if (previousKey === undefined) delete process.env.DOGRAH_API_KEY; else process.env.DOGRAH_API_KEY = previousKey;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

function json(res: import("node:http").ServerResponse, value: unknown) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

void once;

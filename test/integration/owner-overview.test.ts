import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";
import { campaigns } from "../../src/server/db/schema/campaigns.js";
import { importBatches, importRows } from "../../src/server/db/schema/imports.js";
import { organizations } from "../../src/server/db/schema/organizations.js";
import { outboxDeliveries } from "../../src/server/db/schema/outbox-deliveries.js";
import { providerRuns } from "../../src/server/db/schema/provider-runs.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for owner overview tests");

const connection = createDatabase(databaseUrl);
beforeAll(() => migrateDatabase(connection.db));
afterAll(() => connection.close());

describe("owner overview", () => {
  it("summarizes verified call outcomes and CRM delivery", async () => {
    const organizationId = randomUUID();
    const batchId = randomUUID();
    const providerRunId = randomUUID();
    const providerCampaignId = Number.parseInt(randomUUID().slice(0, 6), 16);
    const completedAt = new Date("2026-07-31T09:00:00.000Z");
    await connection.db.insert(organizations).values({ id: organizationId, name: "Owner org" });
    await connection.db.insert(importBatches).values({
      id: batchId,
      organizationId,
      filename: "owner-fixture.csv",
      defaultCallingCode: "91",
      status: "approved",
      summary: { total: 1, valid: 1, blockedConsent: 0, invalid: 0, duplicate: 0 },
    });
    const [lead] = await connection.db
      .insert(importRows)
      .values({
        batchId,
        organizationId,
        rowNumber: 1,
        firstName: "Kabir",
        originalPhone: "+918329727869",
        normalizedPhone: "+918329727869",
        consentStatus: "yes",
        classification: "valid",
      })
      .returning();
    if (!lead) throw new Error("Lead insert returned no row");
    await connection.db.insert(providerRuns).values({
      id: providerRunId,
      organizationId,
      importRowId: lead.id,
      providerCampaignId,
      workflowId: 1,
      providerWorkflowRunId: randomUUID(),
      state: "completed",
      gatheredContext: {
        lead_status: "qualified",
        call_disposition: "user_qualified",
        call_summary: "Kabir requested pricing and an evening callback.",
        follow_up_required: "True",
        quote_requested: "True",
      },
      completedAt,
    });
    await connection.db.insert(campaigns).values({
      id: randomUUID(),
      organizationId,
      importBatchId: batchId,
      name: "Kabir Hair Transplant Pilot",
      workflowId: 1,
      status: "paused",
      providerCampaignId,
      startedAt: new Date("2026-07-31T08:57:00.000Z"),
    });
    await connection.db.insert(outboxDeliveries).values({
      id: randomUUID(),
      organizationId,
      type: "twenty.sync_call_outcome",
      idempotencyKey: randomUUID(),
      payload: { providerRunId },
      status: "succeeded",
      attempts: 1,
      nextAttemptAt: completedAt,
      completedAt,
    });
    const app = buildApp({ database: connection.db });

    const response = await app.inject({
      method: "GET",
      url: `/api/overview?organizationId=${organizationId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      metrics: {
        totalLeads: 1,
        callsCompleted: 1,
        qualifiedLeads: 1,
        followUpsRequired: 1,
        crmSynced: 1,
      },
      recentOutcomes: [
        {
          leadId: lead.id,
          displayName: "Kabir",
          state: "completed",
          leadStatus: "qualified",
          disposition: "user_qualified",
          summary: "Kabir requested pricing and an evening callback.",
          followUpRequired: true,
          quoteRequested: true,
        },
      ],
    });
    expect(response.body).not.toContain("+918329727869");

    const campaignResponse = await app.inject({
      method: "GET",
      url: `/api/campaigns?organizationId=${organizationId}`,
    });
    expect(campaignResponse.statusCode).toBe(200);
    expect(campaignResponse.json()).toEqual([
      expect.objectContaining({
        name: "Kabir Hair Transplant Pilot",
        status: "paused",
        totalLeads: 1,
        processedCalls: 1,
        completedCalls: 1,
        failedCalls: 0,
      }),
    ]);

    const attentionResponse = await app.inject({
      method: "GET",
      url: `/api/attention?organizationId=${organizationId}`,
    });
    expect(attentionResponse.json()).toEqual([
      expect.objectContaining({
        kind: "follow_up_required",
        leadId: lead.id,
        title: "Kabir needs follow-up",
        summary: "Kabir requested pricing and an evening callback.",
      }),
    ]);
    await app.close();
  });

  it("protects new owner and import reads with the shared operator key", async () => {
    const organizationId = randomUUID();
    const guardedApp = buildApp({ database: connection.db, apiKey: "owner-route-test-key" });
    const urls = [
      `/api/overview?organizationId=${organizationId}`,
      `/api/campaigns?organizationId=${organizationId}`,
      `/api/imports?organizationId=${organizationId}`,
    ];

    try {
      for (const url of urls) {
        const unauthorized = await guardedApp.inject({ method: "GET", url });
        expect(unauthorized.statusCode).toBe(401);

        const authorized = await guardedApp.inject({
          method: "GET",
          url,
          headers: { "x-workstation-key": "owner-route-test-key" },
        });
        expect(authorized.statusCode).toBe(200);
      }
    } finally {
      await guardedApp.close();
    }
  });
});

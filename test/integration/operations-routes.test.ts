import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";
import { importBatches, importRows } from "../../src/server/db/schema/imports.js";
import { organizations } from "../../src/server/db/schema/organizations.js";
import { outboxDeliveries } from "../../src/server/db/schema/outbox-deliveries.js";
import { providerRuns } from "../../src/server/db/schema/provider-runs.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for operations route tests");
}

const connection = createDatabase(databaseUrl);
beforeAll(() => migrateDatabase(connection.db));
afterAll(() => connection.close());

describe("lead trace, deliveries, and attention routes", () => {
  it("returns correlated state for one tenant and rejects cross-tenant trace access", async () => {
    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    const batchId = randomUUID();
    const providerRunId = randomUUID();
    await connection.db.insert(organizations).values([
      { id: organizationId, name: "Trace org" },
      { id: otherOrganizationId, name: "Other org" },
    ]);
    await connection.db.insert(importBatches).values({
      id: batchId,
      organizationId,
      filename: "synthetic.csv",
      defaultCallingCode: "44",
      status: "approved",
      summary: { total: 1, valid: 1, blockedConsent: 0, invalid: 0, duplicate: 0 },
    });
    const [lead] = await connection.db
      .insert(importRows)
      .values({
        batchId,
        organizationId,
        rowNumber: 1,
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.test",
        originalPhone: "07700 900123",
        normalizedPhone: "+447700900123",
        consentStatus: "yes",
        classification: "valid",
      })
      .returning();
    if (!lead) {
      throw new Error("Lead insert returned no row");
    }
    await connection.db.insert(providerRuns).values({
      id: providerRunId,
      organizationId,
      importRowId: lead.id,
      providerCampaignId: 91,
      workflowId: 9,
      providerWorkflowRunId: randomUUID(),
      state: "failed",
      gatheredContext: {
        lead_status: "follow_up",
        call_summary: "Ada asked for pricing and a callback.",
        follow_up_required: "True",
      },
      completedAt: new Date("2026-07-31T09:00:00.000Z"),
    });
    await connection.db.insert(outboxDeliveries).values({
      id: randomUUID(),
      organizationId,
      type: "twenty.sync_call_outcome",
      idempotencyKey: randomUUID(),
      payload: { providerRunId },
      status: "dead",
      attempts: 5,
      nextAttemptAt: new Date("2026-07-31T09:05:00.000Z"),
      lastError: "synthetic private provider error",
    });
    const app = buildApp({ database: connection.db });

    const leads = await app.inject({
      method: "GET",
      url: `/api/leads?organizationId=${organizationId}`,
    });
    expect(leads.statusCode).toBe(200);
    expect(leads.json()).toEqual([
      expect.objectContaining({
        id: lead.id,
        callSummary: "Ada asked for pricing and a callback.",
        leadStatus: "follow_up",
        followUpRequired: true,
      }),
    ]);

    const trace = await app.inject({
      method: "GET",
      url: `/api/leads/${lead.id}/trace?organizationId=${organizationId}`,
    });
    expect(trace.statusCode).toBe(200);
    expect(trace.json()).toMatchObject({
      lead: { id: lead.id, displayName: "Ada Lovelace", phone: "+447700900123" },
      runs: [{ id: providerRunId, state: "failed" }],
      deliveries: [{ status: "dead", attempts: 5 }],
    });

    const crossTenant = await app.inject({
      method: "GET",
      url: `/api/leads/${lead.id}/trace?organizationId=${otherOrganizationId}`,
    });
    expect(crossTenant.statusCode).toBe(404);

    const deliveries = await app.inject({
      method: "GET",
      url: `/api/deliveries?organizationId=${organizationId}`,
    });
    expect(deliveries.statusCode).toBe(200);
    expect(deliveries.json()).toEqual([
      expect.objectContaining({
        displayName: "Ada Lovelace",
        callSummary: "Ada asked for pricing and a callback.",
        destination: "Twenty CRM",
      }),
    ]);

    const attention = await app.inject({
      method: "GET",
      url: `/api/attention?organizationId=${organizationId}`,
    });
    expect(attention.statusCode).toBe(200);
    expect(attention.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "delivery_dead", leadId: lead.id, retryable: true }),
        expect.objectContaining({ kind: "call_failed", leadId: lead.id, retryable: false }),
      ]),
    );
    expect(attention.body).not.toContain("synthetic private provider error");

    await app.close();
  });
});

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";
import { organizations } from "../../src/server/db/schema/organizations.js";
import { outboxDeliveries } from "../../src/server/db/schema/outbox-deliveries.js";
import { providerRuns } from "../../src/server/db/schema/provider-runs.js";
import { listEventsAfter } from "../../src/server/events/event-ledger.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for Dograh webhook tests");
}

const connection = createDatabase(databaseUrl);
beforeAll(() => migrateDatabase(connection.db));
afterAll(() => connection.close());

describe("Dograh webhook", () => {
  it("authenticates, correlates, deduplicates, and projects a terminal callback", async () => {
    const organizationId = randomUUID();
    const providerRunId = randomUUID();
    await connection.db.insert(organizations).values({ id: organizationId, name: "Dograh org" });
    await connection.db.insert(providerRuns).values({
      id: providerRunId,
      organizationId,
      providerCampaignId: 17,
      workflowId: 9,
      state: "pending",
    });
    const providerWorkflowRunId = randomUUID();
    const app = buildApp({ database: connection.db, dograhWebhookSecret: "webhook-secret" });
    const payload = {
      workflow_run_id: providerWorkflowRunId,
      workstation_provider_run_id: providerRunId,
      campaign_id: "17",
      workflow_id: "9",
      state: "completed",
      gathered_context: { lead_status: "qualified" },
      recording_url: "",
      transcript_url: "",
    };

    try {
      expect(
        (await app.inject({ method: "POST", url: "/api/webhooks/dograh", payload })).statusCode,
      ).toBe(401);

      const accepted = await app.inject({
        method: "POST",
        url: "/api/webhooks/dograh",
        headers: { "x-dograh-webhook-secret": "webhook-secret" },
        payload,
      });
      const duplicate = await app.inject({
        method: "POST",
        url: "/api/webhooks/dograh",
        headers: { "x-dograh-webhook-secret": "webhook-secret" },
        payload,
      });
      const unknown = await app.inject({
        method: "POST",
        url: "/api/webhooks/dograh",
        headers: { "x-dograh-webhook-secret": "webhook-secret" },
        payload: { ...payload, workstation_provider_run_id: randomUUID() },
      });
      const mismatch = await app.inject({
        method: "POST",
        url: "/api/webhooks/dograh",
        headers: { "x-dograh-webhook-secret": "webhook-secret" },
        payload: { ...payload, campaign_id: 999 },
      });

      expect(accepted.statusCode).toBe(202);
      expect(duplicate.json()).toEqual({ status: "duplicate" });
      expect(unknown.statusCode).toBe(404);
      expect(mismatch.statusCode).toBe(409);

      const [projected] = await connection.db
        .select()
        .from(providerRuns)
        .where(eq(providerRuns.id, providerRunId));
      expect(projected).toMatchObject({
        providerWorkflowRunId,
        state: "completed",
        gatheredContext: { lead_status: "qualified" },
        recordingUrl: null,
        transcriptUrl: null,
      });
      const events = await listEventsAfter(connection.db, { organizationId, afterId: 0 });
      expect(events.filter((event) => event.eventType === "dograh.run.completed")).toHaveLength(1);
      const deliveries = await connection.db
        .select()
        .from(outboxDeliveries)
        .where(eq(outboxDeliveries.organizationId, organizationId));
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        type: "twenty.sync_call_outcome",
        status: "pending",
      });
    } finally {
      await app.close();
    }
  });
});

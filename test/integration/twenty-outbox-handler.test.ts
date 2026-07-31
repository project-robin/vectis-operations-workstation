import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";
import { importRows } from "../../src/server/db/schema/imports.js";
import { organizations } from "../../src/server/db/schema/organizations.js";
import { providerRuns } from "../../src/server/db/schema/provider-runs.js";
import { stageImport } from "../../src/server/imports/import-repository.js";
import { deliverTwentyCallOutcome } from "../../src/worker/twenty-outbox-handler.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for Twenty outbox tests");
}

const connection = createDatabase(databaseUrl);
beforeAll(() => migrateDatabase(connection.db));
afterAll(() => connection.close());

describe("Twenty outbox handler", () => {
  it("enriches a provider-run delivery from its exact import row", async () => {
    const organizationId = randomUUID();
    const providerRunId = randomUUID();
    await connection.db.insert(organizations).values({ id: organizationId, name: "Twenty org" });
    const batch = await stageImport(connection.db, {
      organizationId,
      filename: "synthetic.csv",
      defaultCallingCode: "44",
      csv: "first_name,last_name,email,phone,consent_status\nAda,Lovelace,ada@example.test,07700 900123,yes\n",
    });
    const [lead] = await connection.db
      .select()
      .from(importRows)
      .where(eq(importRows.batchId, batch.id));
    if (!lead) {
      throw new Error("Synthetic import created no row");
    }
    await connection.db.insert(providerRuns).values({
      id: providerRunId,
      organizationId,
      importRowId: lead.id,
      providerCampaignId: 91,
      workflowId: 9,
      providerWorkflowRunId: randomUUID(),
      state: "completed",
      gatheredContext: { lead_status: "qualified" },
      recordingUrl: "https://example.test/recording",
      completedAt: new Date(),
    });
    const adapter = { syncCallOutcome: vi.fn().mockResolvedValue(undefined) };

    await deliverTwentyCallOutcome(connection.db, adapter, { providerRunId }, "delivery-key");

    expect(adapter.syncCallOutcome).toHaveBeenCalledWith(
      {
        phone: "+447700900123",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.test",
        providerRunId,
        state: "completed",
        gatheredContext: { lead_status: "qualified" },
        recordingUrl: "https://example.test/recording",
        transcriptUrl: null,
      },
      "delivery-key",
    );
  });
});

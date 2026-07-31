import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  approveCampaign,
  createCampaignDraft,
  pauseCampaign,
  resumeCampaign,
  startApprovedCampaign,
} from "../../src/server/campaigns/campaign-service.js";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";
import { campaigns } from "../../src/server/db/schema/campaigns.js";
import { organizations } from "../../src/server/db/schema/organizations.js";
import { providerRuns } from "../../src/server/db/schema/provider-runs.js";
import { listEventsAfter } from "../../src/server/events/event-ledger.js";
import {
  approveImport,
  commitImport,
  stageImport,
} from "../../src/server/imports/import-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for campaign integration tests");
}

const connection = createDatabase(databaseUrl);
beforeAll(() => migrateDatabase(connection.db));
afterAll(() => connection.close());

describe("campaign approval", () => {
  it("starts Dograh only after approval and persists callback correlation", async () => {
    const organizationId = randomUUID();
    await connection.db.insert(organizations).values({ id: organizationId, name: "Campaign org" });
    const staged = await stageImport(connection.db, {
      organizationId,
      filename: "synthetic.csv",
      defaultCallingCode: "44",
      csv: "first_name,phone,consent_status\nAda,07700 900123,yes\n",
    });
    await commitImport(connection.db, organizationId, staged.id);
    await approveImport(connection.db, organizationId, staged.id);
    const draft = await createCampaignDraft(connection.db, {
      organizationId,
      importBatchId: staged.id,
      name: "Synthetic campaign",
      workflowId: 9,
    });
    const providerCampaignId = Number.parseInt(randomUUID().slice(0, 7), 16);
    const dograh = {
      uploadCampaignCsv: vi.fn().mockResolvedValue("campaigns/1/synthetic.csv"),
      createCampaign: vi.fn().mockResolvedValue({ id: providerCampaignId, state: "created" }),
      startCampaign: vi.fn().mockResolvedValue({ id: providerCampaignId, state: "running" }),
      pauseCampaign: vi.fn().mockResolvedValue({ id: providerCampaignId, state: "paused" }),
      resumeCampaign: vi.fn().mockResolvedValue({ id: providerCampaignId, state: "running" }),
    };

    await expect(
      startApprovedCampaign(connection.db, organizationId, draft.id, dograh),
    ).rejects.toThrow("approved");
    expect(dograh.uploadCampaignCsv).not.toHaveBeenCalled();

    await approveCampaign(connection.db, organizationId, draft.id);
    const starts = await Promise.allSettled([
      startApprovedCampaign(connection.db, organizationId, draft.id, dograh),
      startApprovedCampaign(connection.db, organizationId, draft.id, dograh),
    ]);
    const running = starts.find((result) => result.status === "fulfilled");

    expect(starts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(running).toMatchObject({
      value: { status: "running", providerCampaignId },
    });
    expect(dograh.uploadCampaignCsv).toHaveBeenCalledTimes(1);
    expect(dograh.uploadCampaignCsv).toHaveBeenCalledWith(
      expect.stringMatching(/\.csv$/),
      expect.stringContaining("workstation_provider_run_id"),
    );
    const correlations = await connection.db
      .select()
      .from(providerRuns)
      .where(eq(providerRuns.organizationId, organizationId));
    expect(correlations).toHaveLength(1);
    expect(correlations[0]).toMatchObject({ providerCampaignId, state: "pending" });
    expect(correlations[0]?.importRowId).toEqual(expect.any(Number));

    const events = await listEventsAfter(connection.db, { organizationId, afterId: 0 });
    expect(events.slice(-3).map((event) => event.eventType)).toEqual([
      "campaign.drafted",
      "campaign.approved",
      "campaign.started",
    ]);

    const pauses = await Promise.allSettled([
      pauseCampaign(connection.db, organizationId, draft.id, dograh),
      pauseCampaign(connection.db, organizationId, draft.id, dograh),
    ]);
    expect(pauses.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(dograh.pauseCampaign).toHaveBeenCalledTimes(1);

    const resumes = await Promise.allSettled([
      resumeCampaign(connection.db, organizationId, draft.id, dograh),
      resumeCampaign(connection.db, organizationId, draft.id, dograh),
    ]);
    expect(resumes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(dograh.resumeCampaign).toHaveBeenCalledTimes(1);

    dograh.pauseCampaign.mockRejectedValueOnce(new Error("ambiguous pause timeout"));
    await expect(pauseCampaign(connection.db, organizationId, draft.id, dograh)).rejects.toThrow(
      "ambiguous pause timeout",
    );
    await expect(pauseCampaign(connection.db, organizationId, draft.id, dograh)).rejects.toThrow(
      "running",
    );
    const [failedControl] = await connection.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, draft.id));
    expect(failedControl?.status).toBe("failed");
    expect(dograh.pauseCampaign).toHaveBeenCalledTimes(2);
  });

  it("fails closed after an ambiguous Dograh create attempt", async () => {
    const organizationId = randomUUID();
    await connection.db
      .insert(organizations)
      .values({ id: organizationId, name: "Ambiguous campaign org" });
    const staged = await stageImport(connection.db, {
      organizationId,
      filename: "ambiguous.csv",
      defaultCallingCode: "44",
      csv: "first_name,phone,consent_status\nGrace,07700 900124,yes\n",
    });
    await commitImport(connection.db, organizationId, staged.id);
    await approveImport(connection.db, organizationId, staged.id);
    const draft = await createCampaignDraft(connection.db, {
      organizationId,
      importBatchId: staged.id,
      name: "Ambiguous campaign",
      workflowId: 9,
    });
    await approveCampaign(connection.db, organizationId, draft.id);
    const dograh = {
      uploadCampaignCsv: vi.fn().mockResolvedValue("campaigns/1/ambiguous.csv"),
      createCampaign: vi.fn().mockRejectedValue(new Error("timeout after create")),
      startCampaign: vi.fn(),
    };

    await expect(
      startApprovedCampaign(connection.db, organizationId, draft.id, dograh),
    ).rejects.toThrow("timeout after create");
    await expect(
      startApprovedCampaign(connection.db, organizationId, draft.id, dograh),
    ).rejects.toThrow("approved");

    const [failed] = await connection.db.select().from(campaigns).where(eq(campaigns.id, draft.id));
    expect(failed?.status).toBe("failed");
    expect(dograh.createCampaign).toHaveBeenCalledTimes(1);
    expect(dograh.startCampaign).not.toHaveBeenCalled();
  });
});

import { randomUUID } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { campaigns } from "../db/schema/campaigns.js";
import { importBatches } from "../db/schema/imports.js";
import { operationEvents } from "../db/schema/operation-events.js";
import { providerRuns } from "../db/schema/provider-runs.js";
import { listEligibleImportRows } from "../imports/import-repository.js";

export async function createCampaignDraft(
  db: Database,
  input: {
    organizationId: string;
    importBatchId: string;
    name: string;
    workflowId: number;
  },
) {
  return db.transaction(async (transaction) => {
    const [approvedImport] = await transaction
      .select({ id: importBatches.id })
      .from(importBatches)
      .where(
        and(
          eq(importBatches.id, input.importBatchId),
          eq(importBatches.organizationId, input.organizationId),
          eq(importBatches.status, "approved"),
        ),
      );
    if (!approvedImport) {
      throw new Error("Campaign requires an approved import");
    }

    const [campaign] = await transaction
      .insert(campaigns)
      .values({ id: randomUUID(), ...input, status: "draft" })
      .returning();
    if (!campaign) {
      throw new Error("Campaign draft insert returned no row");
    }
    await transaction.insert(operationEvents).values({
      organizationId: input.organizationId,
      eventType: "campaign.drafted",
      payload: { campaignId: campaign.id, importBatchId: input.importBatchId },
    });
    return campaign;
  });
}

export function approveCampaign(db: Database, organizationId: string, campaignId: string) {
  return db.transaction(async (transaction) => {
    const [campaign] = await transaction
      .update(campaigns)
      .set({ status: "approved", approvedAt: new Date() })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.organizationId, organizationId),
          eq(campaigns.status, "draft"),
        ),
      )
      .returning();
    if (!campaign) {
      throw new Error("Campaign is unavailable or not draft");
    }
    await transaction.insert(operationEvents).values({
      organizationId,
      eventType: "campaign.approved",
      payload: { campaignId },
    });
    return campaign;
  });
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export async function startApprovedCampaign(
  db: Database,
  organizationId: string,
  campaignId: string,
  dograh: {
    uploadCampaignCsv(fileName: string, csv: string): Promise<string>;
    createCampaign(input: {
      name: string;
      workflowId: number;
      sourceId: string;
    }): Promise<{ id: number; state: string }>;
    startCampaign(campaignId: number): Promise<{ id: number; state: string }>;
  },
) {
  const [campaign] = await db
    .update(campaigns)
    .set({ status: "starting" })
    .where(
      and(
        eq(campaigns.id, campaignId),
        eq(campaigns.organizationId, organizationId),
        eq(campaigns.status, "approved"),
      ),
    )
    .returning();
  if (!campaign) {
    throw new Error("Campaign must be approved before start");
  }

  let providerMutationAttempted = false;
  let reconciliationProviderCampaignId = campaign.providerCampaignId;
  let reconciliationSourceId = campaign.sourceId;
  try {
    let providerCampaignId = campaign.providerCampaignId;
    if (providerCampaignId === null) {
      const rows = await listEligibleImportRows(db, organizationId, campaign.importBatchId);
      if (rows.length === 0) {
        throw new Error("Campaign has no eligible leads");
      }
      const correlations = rows.map((row) => ({ row, providerRunId: randomUUID() }));
      const csv = [
        "phone_number,first_name,last_name,email,workstation_lead_id,workstation_provider_run_id",
        ...correlations.map(({ row, providerRunId }) =>
          [
            row.normalizedPhone ?? "",
            row.firstName ?? "",
            row.lastName ?? "",
            row.email ?? "",
            String(row.id),
            providerRunId,
          ]
            .map(csvCell)
            .join(","),
        ),
      ].join("\n");

      const sourceId = await dograh.uploadCampaignCsv(`${campaign.id}.csv`, `${csv}\n`);
      reconciliationSourceId = sourceId;
      providerMutationAttempted = true;
      const providerCampaign = await dograh.createCampaign({
        name: campaign.name,
        workflowId: campaign.workflowId,
        sourceId,
      });
      providerCampaignId = providerCampaign.id;
      reconciliationProviderCampaignId = providerCampaignId;

      await db.transaction(async (transaction) => {
        await transaction
          .update(campaigns)
          .set({ providerCampaignId, sourceId })
          .where(eq(campaigns.id, campaign.id));
        await transaction.insert(providerRuns).values(
          correlations.map(({ row, providerRunId }) => ({
            id: providerRunId,
            organizationId,
            importRowId: row.id,
            providerCampaignId,
            workflowId: campaign.workflowId,
            state: "pending",
          })),
        );
      });
    }

    providerMutationAttempted = true;
    await dograh.startCampaign(providerCampaignId);
    return await db.transaction(async (transaction) => {
      const [running] = await transaction
        .update(campaigns)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(campaigns.id, campaign.id))
        .returning();
      await transaction.insert(operationEvents).values({
        organizationId,
        eventType: "campaign.started",
        payload: { campaignId, providerCampaignId },
      });
      return running;
    });
  } catch (error) {
    if (!providerMutationAttempted) {
      await db
        .update(campaigns)
        .set({ status: "approved" })
        .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, "starting")));
      throw error;
    }

    await db.transaction(async (transaction) => {
      await transaction
        .update(campaigns)
        .set({
          status: "failed",
          ...(reconciliationProviderCampaignId
            ? { providerCampaignId: reconciliationProviderCampaignId }
            : {}),
          ...(reconciliationSourceId ? { sourceId: reconciliationSourceId } : {}),
        })
        .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, "starting")));
      await transaction.insert(operationEvents).values({
        organizationId,
        eventType: "campaign.reconciliation_required",
        payload: {
          campaignId: campaign.id,
          providerCampaignId: reconciliationProviderCampaignId,
        },
      });
    });
    throw error;
  }
}

async function changeCampaignRunState(
  db: Database,
  input: {
    organizationId: string;
    campaignId: string;
    from: "running" | "paused";
    to: "paused" | "running";
    providerAction: (campaignId: number) => Promise<unknown>;
  },
) {
  const claimStatus = input.to === "paused" ? "pausing" : "resuming";
  const [campaign] = await db
    .update(campaigns)
    .set({ status: claimStatus })
    .where(
      and(
        eq(campaigns.id, input.campaignId),
        eq(campaigns.organizationId, input.organizationId),
        eq(campaigns.status, input.from),
        isNotNull(campaigns.providerCampaignId),
      ),
    )
    .returning();
  if (!campaign?.providerCampaignId) {
    throw new Error(`Campaign must be ${input.from} before changing state`);
  }

  try {
    await input.providerAction(campaign.providerCampaignId);
  } catch (error) {
    await db.transaction(async (transaction) => {
      await transaction
        .update(campaigns)
        .set({ status: "failed" })
        .where(
          and(
            eq(campaigns.id, input.campaignId),
            eq(campaigns.organizationId, input.organizationId),
            eq(campaigns.status, claimStatus),
          ),
        );
      await transaction.insert(operationEvents).values({
        organizationId: input.organizationId,
        eventType: "campaign.reconciliation_required",
        payload: {
          campaignId: input.campaignId,
          providerCampaignId: campaign.providerCampaignId,
          attemptedState: input.to,
        },
      });
    });
    throw error;
  }

  return db.transaction(async (transaction) => {
    const [updated] = await transaction
      .update(campaigns)
      .set({ status: input.to })
      .where(
        and(
          eq(campaigns.id, input.campaignId),
          eq(campaigns.organizationId, input.organizationId),
          eq(campaigns.status, claimStatus),
        ),
      )
      .returning();
    if (!updated) {
      throw new Error("Campaign state changed concurrently");
    }
    await transaction.insert(operationEvents).values({
      organizationId: input.organizationId,
      eventType: `campaign.${input.to}`,
      payload: { campaignId: input.campaignId, providerCampaignId: campaign.providerCampaignId },
    });
    return updated;
  });
}

export function pauseCampaign(
  db: Database,
  organizationId: string,
  campaignId: string,
  dograh: { pauseCampaign(campaignId: number): Promise<unknown> },
) {
  return changeCampaignRunState(db, {
    organizationId,
    campaignId,
    from: "running",
    to: "paused",
    providerAction: (providerCampaignId) => dograh.pauseCampaign(providerCampaignId),
  });
}

export function resumeCampaign(
  db: Database,
  organizationId: string,
  campaignId: string,
  dograh: { resumeCampaign(campaignId: number): Promise<unknown> },
) {
  return changeCampaignRunState(db, {
    organizationId,
    campaignId,
    from: "paused",
    to: "running",
    providerAction: (providerCampaignId) => dograh.resumeCampaign(providerCampaignId),
  });
}

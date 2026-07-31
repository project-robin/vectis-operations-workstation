import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  approveCampaign,
  createCampaignDraft,
  pauseCampaign,
  resumeCampaign,
  startApprovedCampaign,
} from "../campaigns/campaign-service.js";
import type { Database } from "../db/client.js";
import { campaigns } from "../db/schema/campaigns.js";
import { outboxDeliveries } from "../db/schema/outbox-deliveries.js";
import { providerRuns } from "../db/schema/provider-runs.js";
import { listLatestHealth } from "../health/health-repository.js";
import { getLeadTrace, listAttentionItems } from "../operations/queries.js";

export const readManagerTools = [
  "get_business_overview",
  "list_recent_calls",
  "list_attention_items",
  "get_lead_trace",
  "list_integration_health",
  "list_active_campaigns",
] as const;

export const mutationManagerTools = [
  "create_campaign_draft",
  "request_campaign_approval",
  "start_approved_campaign",
  "pause_campaign",
  "resume_campaign",
  "retry_failed_delivery",
] as const;

export type ReadManagerTool = (typeof readManagerTools)[number];
export type MutationManagerTool = (typeof mutationManagerTools)[number];

export interface CampaignProvider {
  uploadCampaignCsv(fileName: string, csv: string): Promise<string>;
  createCampaign(input: {
    name: string;
    workflowId: number;
    sourceId: string;
  }): Promise<{ id: number; state: string }>;
  startCampaign(campaignId: number): Promise<{ id: number; state: string }>;
  pauseCampaign(campaignId: number): Promise<unknown>;
  resumeCampaign(campaignId: number): Promise<unknown>;
}

export class ManagerNotFoundError extends Error {}
export class ManagerConflictError extends Error {}
export class ManagerUnavailableError extends Error {}

const noArgumentsSchema = z.object({}).passthrough();
const campaignIdSchema = z.object({ campaignId: z.uuid() });

export async function executeManagerRead(
  db: Database,
  organizationId: string,
  tool: ReadManagerTool,
  rawArguments: unknown,
): Promise<unknown> {
  if (tool === "get_business_overview") {
    noArgumentsSchema.parse(rawArguments);
    const [runs, activeCampaigns, attention] = await Promise.all([
      db
        .select({ state: providerRuns.state })
        .from(providerRuns)
        .where(eq(providerRuns.organizationId, organizationId)),
      db
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.organizationId, organizationId),
            inArray(campaigns.status, ["approved", "starting", "running", "paused"]),
          ),
        ),
      listAttentionItems(db, organizationId),
    ]);
    return {
      activeCampaigns: activeCampaigns.length,
      attentionItems: attention.length,
      calls: {
        pending: runs.filter((run) => run.state === "pending").length,
        active: runs.filter((run) => run.state === "active").length,
        completed: runs.filter((run) => run.state === "completed").length,
        failed: runs.filter((run) => run.state === "failed").length,
      },
    };
  }

  if (tool === "list_recent_calls") {
    const { limit } = z
      .object({ limit: z.number().int().min(1).max(100).default(20) })
      .parse(rawArguments);
    return db
      .select({
        id: providerRuns.id,
        leadId: providerRuns.importRowId,
        state: providerRuns.state,
        providerWorkflowRunId: providerRuns.providerWorkflowRunId,
        createdAt: providerRuns.createdAt,
        completedAt: providerRuns.completedAt,
      })
      .from(providerRuns)
      .where(eq(providerRuns.organizationId, organizationId))
      .orderBy(desc(providerRuns.createdAt))
      .limit(limit);
  }

  if (tool === "list_attention_items") {
    noArgumentsSchema.parse(rawArguments);
    return listAttentionItems(db, organizationId);
  }

  if (tool === "get_lead_trace") {
    const { leadId } = z.object({ leadId: z.number().int().positive() }).parse(rawArguments);
    const trace = await getLeadTrace(db, organizationId, leadId);
    if (!trace) {
      throw new ManagerNotFoundError("Lead not found");
    }
    return trace;
  }

  if (tool === "list_integration_health") {
    noArgumentsSchema.parse(rawArguments);
    return listLatestHealth(db, organizationId);
  }

  noArgumentsSchema.parse(rawArguments);
  return db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.organizationId, organizationId),
        inArray(campaigns.status, ["approved", "starting", "running", "paused"]),
      ),
    )
    .orderBy(desc(campaigns.createdAt));
}

export async function executeManagerMutation(
  db: Database,
  organizationId: string,
  tool: MutationManagerTool,
  rawArguments: unknown,
  campaignProvider?: CampaignProvider,
): Promise<unknown> {
  if (tool === "retry_failed_delivery") {
    const { deliveryId } = z.object({ deliveryId: z.uuid() }).parse(rawArguments);
    const [delivery] = await db
      .update(outboxDeliveries)
      .set({
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
        lockedAt: null,
        completedAt: null,
        lastError: null,
      })
      .where(
        and(
          eq(outboxDeliveries.id, deliveryId),
          eq(outboxDeliveries.organizationId, organizationId),
          eq(outboxDeliveries.status, "dead"),
        ),
      )
      .returning({
        deliveryId: outboxDeliveries.id,
        status: outboxDeliveries.status,
        attempts: outboxDeliveries.attempts,
      });
    if (!delivery) {
      throw new ManagerNotFoundError("Dead delivery not found");
    }
    return delivery;
  }

  if (tool === "create_campaign_draft") {
    const input = z
      .object({
        importBatchId: z.uuid(),
        name: z.string().trim().min(1).max(160),
        workflowId: z.number().int().positive(),
      })
      .parse(rawArguments);
    return createCampaignDraft(db, { organizationId, ...input });
  }

  if (tool === "request_campaign_approval") {
    const { campaignId } = campaignIdSchema.parse(rawArguments);
    try {
      return await approveCampaign(db, organizationId, campaignId);
    } catch {
      throw new ManagerConflictError("Campaign is not an approvable draft");
    }
  }

  if (!campaignProvider) {
    throw new ManagerUnavailableError("Dograh campaign control is not configured");
  }

  const { campaignId } = campaignIdSchema.parse(rawArguments);
  if (tool === "start_approved_campaign") {
    try {
      return await startApprovedCampaign(db, organizationId, campaignId, campaignProvider);
    } catch (error) {
      if (error instanceof Error && error.message.includes("approved")) {
        throw new ManagerConflictError("Campaign is not approved");
      }
      throw error;
    }
  }
  if (tool === "pause_campaign") {
    try {
      return await pauseCampaign(db, organizationId, campaignId, campaignProvider);
    } catch (error) {
      if (error instanceof Error && error.message.includes("must be running")) {
        throw new ManagerConflictError("Campaign is not running");
      }
      throw error;
    }
  }
  try {
    return await resumeCampaign(db, organizationId, campaignId, campaignProvider);
  } catch (error) {
    if (error instanceof Error && error.message.includes("must be paused")) {
      throw new ManagerConflictError("Campaign is not paused");
    }
    throw error;
  }
}

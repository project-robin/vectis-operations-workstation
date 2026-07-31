import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { operationEvents } from "../db/schema/operation-events.js";
import { outboxDeliveries } from "../db/schema/outbox-deliveries.js";
import { providerRuns } from "../db/schema/provider-runs.js";

export interface DograhCallback {
  workflowRunId: string;
  workstationProviderRunId: string;
  campaignId: number;
  workflowId: number;
  state: "completed" | "failed";
  gatheredContext: Record<string, unknown>;
  recordingUrl: string | null;
  transcriptUrl: string | null;
}

export function projectDograhCallback(db: Database, callback: DograhCallback) {
  return db.transaction(async (transaction) => {
    const [run] = await transaction
      .select()
      .from(providerRuns)
      .where(eq(providerRuns.id, callback.workstationProviderRunId))
      .for("update");

    if (!run) {
      return "unknown" as const;
    }
    if (
      run.providerCampaignId !== callback.campaignId ||
      run.workflowId !== callback.workflowId ||
      (run.providerWorkflowRunId !== null && run.providerWorkflowRunId !== callback.workflowRunId)
    ) {
      return "mismatch" as const;
    }
    if (run.providerWorkflowRunId === callback.workflowRunId) {
      return "duplicate" as const;
    }

    const completedAt = new Date();
    await transaction
      .update(providerRuns)
      .set({
        providerWorkflowRunId: callback.workflowRunId,
        state: callback.state,
        gatheredContext: callback.gatheredContext,
        recordingUrl: callback.recordingUrl,
        transcriptUrl: callback.transcriptUrl,
        completedAt,
      })
      .where(eq(providerRuns.id, callback.workstationProviderRunId));
    await transaction.insert(operationEvents).values({
      organizationId: run.organizationId,
      eventType: `dograh.run.${callback.state}`,
      payload: {
        providerRunId: run.id,
        providerWorkflowRunId: callback.workflowRunId,
        providerCampaignId: callback.campaignId,
      },
    });
    await transaction
      .insert(outboxDeliveries)
      .values({
        id: randomUUID(),
        organizationId: run.organizationId,
        type: "twenty.sync_call_outcome",
        idempotencyKey: `twenty:provider-run:${run.id}:terminal`,
        payload: {
          providerRunId: run.id,
          providerWorkflowRunId: callback.workflowRunId,
          providerCampaignId: callback.campaignId,
          workflowId: callback.workflowId,
          state: callback.state,
          gatheredContext: callback.gatheredContext,
          recordingUrl: callback.recordingUrl,
          transcriptUrl: callback.transcriptUrl,
        },
        status: "pending",
        nextAttemptAt: completedAt,
      })
      .onConflictDoNothing({
        target: [outboxDeliveries.organizationId, outboxDeliveries.idempotencyKey],
      });

    return "accepted" as const;
  });
}

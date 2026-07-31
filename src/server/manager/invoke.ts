import type { Database } from "../db/client.js";
import {
  completeHermesMutation,
  failHermesMutation,
  reserveHermesMutation,
} from "./audit-repository.js";
import {
  type CampaignProvider,
  executeManagerMutation,
  executeManagerRead,
  type mutationManagerTools,
  readManagerTools,
} from "./tools.js";

const readTools = new Set<string>(readManagerTools);

export class ManagerIdempotencyError extends Error {}

function jsonObject(value: unknown): Record<string, unknown> {
  const normalized: unknown = JSON.parse(JSON.stringify(value));
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    return { value: normalized };
  }
  return normalized as Record<string, unknown>;
}

export async function invokeManagerTool(
  db: Database,
  input: {
    toolName: (typeof readManagerTools)[number] | (typeof mutationManagerTools)[number];
    organizationId: string;
    actorId: string;
    arguments: Record<string, unknown>;
    idempotencyKey?: string;
    campaignProvider?: CampaignProvider;
  },
): Promise<unknown> {
  if (readTools.has(input.toolName)) {
    return executeManagerRead(
      db,
      input.organizationId,
      input.toolName as (typeof readManagerTools)[number],
      input.arguments,
    );
  }

  if (!input.idempotencyKey) {
    throw new ManagerIdempotencyError("idempotencyKey is required for mutations");
  }
  const reservation = await reserveHermesMutation(db, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: input.toolName,
    idempotencyKey: input.idempotencyKey,
  });
  if (!reservation.created) {
    if (reservation.record.action !== input.toolName) {
      throw new ManagerIdempotencyError("Idempotency key belongs to another action");
    }
    if (reservation.record.status === "completed" && reservation.record.result) {
      return reservation.record.result;
    }
    throw new ManagerIdempotencyError("Mutation already attempted");
  }

  try {
    const result = jsonObject(
      await executeManagerMutation(
        db,
        input.organizationId,
        input.toolName as (typeof mutationManagerTools)[number],
        input.arguments,
        input.campaignProvider,
      ),
    );
    const targetId = [result.deliveryId, result.campaignId, result.id].find(
      (value): value is string => typeof value === "string",
    );
    await completeHermesMutation(db, reservation.record.id, {
      result,
      targetType: input.toolName === "retry_failed_delivery" ? "delivery" : "campaign",
      ...(targetId ? { targetId } : {}),
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Manager mutation failed";
    await failHermesMutation(db, reservation.record.id, message);
    throw error;
  }
}

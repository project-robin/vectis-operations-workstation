import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { auditRecords } from "../db/schema/audit-records.js";

export async function reserveHermesMutation(
  db: Database,
  input: {
    organizationId: string;
    actorId: string;
    action: string;
    idempotencyKey: string;
  },
) {
  const [created] = await db
    .insert(auditRecords)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      actorType: "hermes",
      actorId: input.actorId,
      action: input.action,
      idempotencyKey: input.idempotencyKey,
      status: "started",
    })
    .onConflictDoNothing({
      target: [auditRecords.organizationId, auditRecords.idempotencyKey],
    })
    .returning();
  if (created) {
    return { created: true as const, record: created };
  }

  const [existing] = await db
    .select()
    .from(auditRecords)
    .where(
      and(
        eq(auditRecords.organizationId, input.organizationId),
        eq(auditRecords.idempotencyKey, input.idempotencyKey),
      ),
    );
  if (!existing) {
    throw new Error("Audit idempotency conflict returned no record");
  }
  return { created: false as const, record: existing };
}

export function completeHermesMutation(
  db: Database,
  auditId: string,
  input: {
    result: Record<string, unknown>;
    targetType?: string;
    targetId?: string;
  },
) {
  return db
    .update(auditRecords)
    .set({
      status: "completed",
      result: input.result,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(auditRecords.id, auditId));
}

export function failHermesMutation(db: Database, auditId: string, error: string) {
  return db
    .update(auditRecords)
    .set({ status: "failed", error: error.slice(0, 500), updatedAt: new Date() })
    .where(eq(auditRecords.id, auditId));
}

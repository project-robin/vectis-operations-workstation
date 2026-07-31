import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { outboxDeliveries } from "../db/schema/outbox-deliveries.js";

export async function enqueueDelivery(
  db: Database,
  input: {
    organizationId: string;
    type: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    availableAt?: Date;
  },
) {
  const [created] = await db
    .insert(outboxDeliveries)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      status: "pending",
      nextAttemptAt: input.availableAt ?? new Date(),
    })
    .onConflictDoNothing({
      target: [outboxDeliveries.organizationId, outboxDeliveries.idempotencyKey],
    })
    .returning();
  if (created) {
    return created;
  }

  const [existing] = await db
    .select()
    .from(outboxDeliveries)
    .where(
      and(
        eq(outboxDeliveries.organizationId, input.organizationId),
        eq(outboxDeliveries.idempotencyKey, input.idempotencyKey),
      ),
    );
  if (!existing) {
    throw new Error("Outbox conflict returned no existing delivery");
  }
  return existing;
}

export function claimDeliveries(db: Database, now: Date, limit: number) {
  const staleBefore = new Date(now.getTime() - 5 * 60_000);
  return db.transaction(async (transaction) => {
    const rows = await transaction
      .select({ id: outboxDeliveries.id })
      .from(outboxDeliveries)
      .where(
        and(
          or(
            eq(outboxDeliveries.status, "pending"),
            and(
              eq(outboxDeliveries.status, "processing"),
              lte(outboxDeliveries.lockedAt, staleBefore),
            ),
          ),
          lte(outboxDeliveries.nextAttemptAt, now),
        ),
      )
      .orderBy(outboxDeliveries.createdAt)
      .limit(limit)
      .for("update", { skipLocked: true });
    if (rows.length === 0) {
      return [];
    }

    return transaction
      .update(outboxDeliveries)
      .set({
        status: "processing",
        lockedAt: now,
        attempts: sql`${outboxDeliveries.attempts} + 1`,
      })
      .where(
        inArray(
          outboxDeliveries.id,
          rows.map((row) => row.id),
        ),
      )
      .returning();
  });
}

export function completeDelivery(db: Database, deliveryId: string, now: Date) {
  return db
    .update(outboxDeliveries)
    .set({ status: "succeeded", completedAt: now, lockedAt: null, lastError: null })
    .where(and(eq(outboxDeliveries.id, deliveryId), eq(outboxDeliveries.status, "processing")));
}

export function failDelivery(
  db: Database,
  input: { deliveryId: string; attempts: number; error: string; now: Date; maxAttempts: number },
) {
  const dead = input.attempts >= input.maxAttempts;
  const delay = Math.min(60_000 * 2 ** (input.attempts - 1), 3_600_000);
  return db
    .update(outboxDeliveries)
    .set({
      status: dead ? "dead" : "pending",
      nextAttemptAt: new Date(input.now.getTime() + delay),
      lockedAt: null,
      lastError: input.error.slice(0, 2_000),
    })
    .where(
      and(eq(outboxDeliveries.id, input.deliveryId), eq(outboxDeliveries.status, "processing")),
    );
}

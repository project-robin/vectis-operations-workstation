import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";
import { organizations } from "../../src/server/db/schema/organizations.js";
import { outboxDeliveries } from "../../src/server/db/schema/outbox-deliveries.js";
import { enqueueDelivery } from "../../src/server/outbox/outbox-repository.js";
import { runOutboxBatch } from "../../src/worker/outbox-worker.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for outbox integration tests");
}

const connection = createDatabase(databaseUrl);
beforeAll(() => migrateDatabase(connection.db));
beforeEach(() => connection.db.delete(outboxDeliveries));
afterAll(() => connection.close());

describe("durable outbox", () => {
  it("deduplicates, claims once, retries, and dead-letters without blocking other work", async () => {
    const organizationId = randomUUID();
    await connection.db.insert(organizations).values({ id: organizationId, name: "Outbox org" });
    const now = new Date("2026-07-31T08:00:00.000Z");
    const delivery = await enqueueDelivery(connection.db, {
      organizationId,
      type: "twenty.sync_call_outcome",
      idempotencyKey: randomUUID(),
      payload: { providerRunId: randomUUID() },
      availableAt: now,
    });
    const duplicate = await enqueueDelivery(connection.db, {
      organizationId,
      type: "twenty.sync_call_outcome",
      idempotencyKey: delivery.idempotencyKey,
      payload: { ignored: true },
      availableAt: now,
    });
    const otherOrganizationId = randomUUID();
    await connection.db
      .insert(organizations)
      .values({ id: otherOrganizationId, name: "Other outbox org" });
    const otherTenant = await enqueueDelivery(connection.db, {
      organizationId: otherOrganizationId,
      type: "twenty.sync_call_outcome",
      idempotencyKey: delivery.idempotencyKey,
      payload: { providerRunId: randomUUID() },
      availableAt: now,
    });
    const failing = await enqueueDelivery(connection.db, {
      organizationId,
      type: "twenty.sync_call_outcome",
      idempotencyKey: randomUUID(),
      payload: { fail: true },
      availableAt: now,
    });
    expect(duplicate.id).toBe(delivery.id);
    expect(otherTenant.id).not.toBe(delivery.id);
    expect(otherTenant.organizationId).toBe(otherOrganizationId);

    const deliver = vi.fn(async (payload: Record<string, unknown>) => {
      if (payload.fail) {
        throw new Error("synthetic provider failure");
      }
    });
    const [firstWorker, secondWorker] = await Promise.all([
      runOutboxBatch(connection.db, { "twenty.sync_call_outcome": deliver }, now, 10),
      runOutboxBatch(connection.db, { "twenty.sync_call_outcome": deliver }, now, 10),
    ]);

    expect(firstWorker.processed + secondWorker.processed).toBe(3);
    expect(deliver).toHaveBeenCalledTimes(3);
    const [failedOnce] = await connection.db
      .select()
      .from(outboxDeliveries)
      .where(eq(outboxDeliveries.id, failing.id));
    expect(failedOnce).toMatchObject({ status: "pending", attempts: 1 });

    await runOutboxBatch(
      connection.db,
      { "twenty.sync_call_outcome": deliver },
      new Date("2026-07-31T08:02:00.000Z"),
      10,
      2,
    );
    const [dead] = await connection.db
      .select()
      .from(outboxDeliveries)
      .where(eq(outboxDeliveries.id, failing.id));
    expect(dead).toMatchObject({ status: "dead", attempts: 2 });
  });
});

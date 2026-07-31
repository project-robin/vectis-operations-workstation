import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";
import { auditRecords } from "../../src/server/db/schema/audit-records.js";
import { organizations } from "../../src/server/db/schema/organizations.js";
import { outboxDeliveries } from "../../src/server/db/schema/outbox-deliveries.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for manager tool tests");
}

const connection = createDatabase(databaseUrl);
beforeAll(() => migrateDatabase(connection.db));
afterAll(() => connection.close());

describe("Hermes manager tools", () => {
  it("authenticates, scopes, deduplicates, and audits a dead-letter retry", async () => {
    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    const deliveryId = randomUUID();
    const idempotencyKey = randomUUID();
    await connection.db.insert(organizations).values([
      { id: organizationId, name: "Manager org" },
      { id: otherOrganizationId, name: "Other manager org" },
    ]);
    await connection.db.insert(outboxDeliveries).values({
      id: deliveryId,
      organizationId,
      type: "twenty.sync_call_outcome",
      idempotencyKey: randomUUID(),
      payload: { providerRunId: randomUUID() },
      status: "dead",
      attempts: 5,
      nextAttemptAt: new Date(),
      lastError: "private provider failure",
    });
    const app = buildApp({ database: connection.db, managerKey: "manager-test-key" });
    const request = {
      method: "POST" as const,
      url: "/api/manager/tools/retry_failed_delivery",
      payload: {
        organizationId,
        actorId: "hermes-vectis",
        idempotencyKey,
        arguments: { deliveryId },
      },
    };

    const unauthorized = await app.inject(request);
    expect(unauthorized.statusCode).toBe(401);

    const unknown = await app.inject({
      method: "POST",
      url: "/api/manager/tools/run_shell",
      headers: { "x-manager-key": "manager-test-key" },
      payload: { organizationId, actorId: "hermes-vectis", arguments: {} },
    });
    expect(unknown.statusCode).toBe(400);

    const attention = await app.inject({
      method: "POST",
      url: "/api/manager/tools/list_attention_items",
      headers: { "x-manager-key": "manager-test-key" },
      payload: { organizationId, actorId: "hermes-vectis", arguments: {} },
    });
    expect(attention.statusCode).toBe(200);
    expect(attention.json()).toMatchObject([
      { kind: "delivery_dead", title: "CRM update needs attention", retryable: true },
    ]);
    expect(attention.body).not.toContain("private provider failure");

    const first = await app.inject({
      ...request,
      headers: { "x-manager-key": "manager-test-key" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ deliveryId, status: "pending", attempts: 0 });

    const duplicate = await app.inject({
      ...request,
      headers: { "x-manager-key": "manager-test-key" },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual(first.json());

    const [delivery] = await connection.db
      .select()
      .from(outboxDeliveries)
      .where(eq(outboxDeliveries.id, deliveryId));
    expect(delivery).toMatchObject({ status: "pending", attempts: 0, lastError: null });

    const audits = await connection.db
      .select()
      .from(auditRecords)
      .where(eq(auditRecords.idempotencyKey, idempotencyKey));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      organizationId,
      actorType: "hermes",
      actorId: "hermes-vectis",
      action: "retry_failed_delivery",
      status: "completed",
    });

    const crossTenant = await app.inject({
      ...request,
      headers: { "x-manager-key": "manager-test-key" },
      payload: {
        ...request.payload,
        organizationId: otherOrganizationId,
        idempotencyKey: randomUUID(),
      },
    });
    expect(crossTenant.statusCode).toBe(404);

    await app.close();
  });
});

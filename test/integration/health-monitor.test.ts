import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";
import { organizations } from "../../src/server/db/schema/organizations.js";
import { listEventsAfter } from "../../src/server/events/event-ledger.js";
import { listLatestHealth } from "../../src/server/health/health-repository.js";
import { runHealthCheck } from "../../src/worker/health/run-health-check.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for health monitor integration tests");
}

const connection = createDatabase(databaseUrl);

beforeAll(async () => {
  await migrateDatabase(connection.db);
});

afterAll(async () => {
  await connection.close();
});

describe("health monitor", () => {
  it("stores the probe result and appends a health event", async () => {
    const organizationId = randomUUID();
    await connection.db
      .insert(organizations)
      .values({ id: organizationId, name: "Monitor organization" });

    await runHealthCheck(connection.db, organizationId, {
      component: "database",
      timeoutMs: 50,
      probe: async () => ({ detail: "Connection accepted" }),
    });

    const health = await listLatestHealth(connection.db, organizationId);
    const events = await listEventsAfter(connection.db, { organizationId, afterId: 0 });

    expect(health).toHaveLength(1);
    expect(health[0]).toMatchObject({ component: "database", status: "healthy" });
    expect(events.at(-1)).toMatchObject({
      eventType: "health.checked",
      payload: { component: "database", status: "healthy" },
    });
  });
});

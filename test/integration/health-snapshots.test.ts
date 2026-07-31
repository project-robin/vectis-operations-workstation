import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";
import { organizations } from "../../src/server/db/schema/organizations.js";
import {
  listLatestHealth,
  recordHealthSnapshot,
} from "../../src/server/health/health-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for health integration tests");
}

const connection = createDatabase(databaseUrl);

beforeAll(async () => {
  await migrateDatabase(connection.db);
});

afterAll(async () => {
  await connection.close();
});

describe("health snapshots", () => {
  it("returns the latest component state for only the requested organization", async () => {
    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    await connection.db.insert(organizations).values([
      { id: organizationId, name: "Health organization" },
      { id: otherOrganizationId, name: "Other organization" },
    ]);

    await recordHealthSnapshot(connection.db, {
      organizationId,
      component: "database",
      status: "healthy",
      detail: "Ready",
      latencyMs: 3,
      checkedAt: new Date("2026-07-31T00:00:00Z"),
    });
    await recordHealthSnapshot(connection.db, {
      organizationId,
      component: "database",
      status: "down",
      detail: "Probe timed out",
      latencyMs: 5000,
      checkedAt: new Date("2026-07-31T00:01:00Z"),
    });
    await recordHealthSnapshot(connection.db, {
      organizationId: otherOrganizationId,
      component: "dograh",
      status: "healthy",
      detail: "Ready",
      latencyMs: 10,
      checkedAt: new Date("2026-07-31T00:02:00Z"),
    });

    const latest = await listLatestHealth(connection.db, organizationId);

    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ component: "database", status: "down" });
  });
});

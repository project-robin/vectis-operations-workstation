import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";
import { organizations } from "../../src/server/db/schema/organizations.js";
import { recordHealthSnapshot } from "../../src/server/health/health-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for health route integration tests");
}

const connection = createDatabase(databaseUrl);

beforeAll(async () => {
  await migrateDatabase(connection.db);
});

afterAll(async () => {
  await connection.close();
});

describe("health API", () => {
  it("reports readiness and tenant-scoped component health", async () => {
    const organizationId = randomUUID();
    await connection.db
      .insert(organizations)
      .values({ id: organizationId, name: "Route organization" });
    await recordHealthSnapshot(connection.db, {
      organizationId,
      component: "database",
      status: "healthy",
      detail: "Connection accepted",
      latencyMs: 2,
      checkedAt: new Date(),
    });
    const app = buildApp({ database: connection.db, apiKey: "route-test-key" });

    try {
      const unauthorized = await app.inject({ method: "GET", url: "/api/health/ready" });
      const readiness = await app.inject({
        method: "GET",
        url: "/api/health/ready",
        headers: { "x-workstation-key": "route-test-key" },
      });
      const components = await app.inject({
        method: "GET",
        url: `/api/health/components?organizationId=${organizationId}`,
        headers: { "x-workstation-key": "route-test-key" },
      });
      const invalid = await app.inject({
        method: "GET",
        url: "/api/health/components?organizationId=not-a-uuid",
        headers: { "x-workstation-key": "route-test-key" },
      });

      expect(unauthorized.statusCode).toBe(401);
      expect(readiness.statusCode).toBe(200);
      expect(readiness.json()).toEqual({ status: "healthy" });
      expect(components.statusCode).toBe(200);
      expect(components.json()).toMatchObject({
        components: [{ component: "database", status: "healthy" }],
      });
      expect(invalid.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";
import { organizations } from "../../src/server/db/schema/organizations.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for import route integration tests");
}

const connection = createDatabase(databaseUrl);

beforeAll(async () => {
  await migrateDatabase(connection.db);
});

afterAll(async () => {
  await connection.close();
});

describe("import API", () => {
  it("provides a tenant-scoped preview, commit, and approval flow", async () => {
    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    await connection.db.insert(organizations).values([
      { id: organizationId, name: "Import API organization" },
      { id: otherOrganizationId, name: "Other import organization" },
    ]);
    const app = buildApp({ database: connection.db });

    try {
      const staged = await app.inject({
        method: "POST",
        url: "/api/imports/stage",
        payload: {
          organizationId,
          filename: "synthetic.csv",
          defaultCallingCode: "44",
          csv: [
            "first_name,phone,email,consent_status",
            "Ada,07700 900123,ada@example.com,yes",
            "Grace,07700 900124,grace@example.com,no",
          ].join("\n"),
        },
      });

      expect(staged.statusCode).toBe(201);
      const stagedBody = staged.json();
      expect(stagedBody).toMatchObject({
        status: "staged",
        summary: { valid: 1, blockedConsent: 1 },
      });

      const preview = await app.inject({
        method: "GET",
        url: `/api/imports/${stagedBody.id}?organizationId=${organizationId}`,
      });
      const crossTenant = await app.inject({
        method: "GET",
        url: `/api/imports/${stagedBody.id}?organizationId=${otherOrganizationId}`,
      });

      expect(preview.statusCode).toBe(200);
      expect(preview.json().rows).toMatchObject([
        { classification: "valid" },
        { classification: "blocked_consent" },
      ]);
      expect(crossTenant.statusCode).toBe(404);

      const committed = await app.inject({
        method: "POST",
        url: `/api/imports/${stagedBody.id}/commit`,
        payload: { organizationId },
      });
      const approved = await app.inject({
        method: "POST",
        url: `/api/imports/${stagedBody.id}/approve`,
        payload: { organizationId },
      });

      expect(committed.json()).toMatchObject({ status: "committed" });
      expect(approved.json()).toMatchObject({ status: "approved" });

      const history = await app.inject({
        method: "GET",
        url: `/api/imports?organizationId=${organizationId}`,
      });
      const otherHistory = await app.inject({
        method: "GET",
        url: `/api/imports?organizationId=${otherOrganizationId}`,
      });
      expect(history.statusCode).toBe(200);
      expect(history.json()).toEqual([
        expect.objectContaining({
          id: stagedBody.id,
          filename: "synthetic.csv",
          status: "approved",
          summary: { total: 2, valid: 1, blockedConsent: 1, invalid: 0, duplicate: 0 },
        }),
      ]);
      expect(otherHistory.json()).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

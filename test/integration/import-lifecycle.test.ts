import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";
import { organizations } from "../../src/server/db/schema/organizations.js";
import { listEventsAfter } from "../../src/server/events/event-ledger.js";
import {
  approveImport,
  commitImport,
  listEligibleImportRows,
  stageImport,
} from "../../src/server/imports/import-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for import integration tests");
}

const connection = createDatabase(databaseUrl);

beforeAll(async () => {
  await migrateDatabase(connection.db);
});

afterAll(async () => {
  await connection.close();
});

describe("safe import lifecycle", () => {
  it("exposes only valid rows after commit and approval", async () => {
    const organizationId = randomUUID();
    await connection.db
      .insert(organizations)
      .values({ id: organizationId, name: "Import organization" });
    const csv = [
      "first_name,phone,email,consent_status",
      "Ada,07700 900123,ada@example.com,yes",
      "Grace,07700 900124,grace@example.com,no",
      "Bad,not-a-phone,bad@example.com,yes",
    ].join("\n");

    const staged = await stageImport(connection.db, {
      organizationId,
      filename: "synthetic.csv",
      defaultCallingCode: "44",
      csv,
    });

    expect(staged.status).toBe("staged");
    expect(staged.summary).toEqual({
      total: 3,
      valid: 1,
      blockedConsent: 1,
      invalid: 1,
      duplicate: 0,
    });
    expect(await listEligibleImportRows(connection.db, organizationId, staged.id)).toEqual([]);

    await commitImport(connection.db, organizationId, staged.id);
    expect(await listEligibleImportRows(connection.db, organizationId, staged.id)).toEqual([]);

    await approveImport(connection.db, organizationId, staged.id);
    const eligible = await listEligibleImportRows(connection.db, organizationId, staged.id);

    expect(eligible).toHaveLength(1);
    expect(eligible[0]).toMatchObject({
      firstName: "Ada",
      normalizedPhone: "+447700900123",
      classification: "valid",
    });
    const events = await listEventsAfter(connection.db, { organizationId, afterId: 0 });
    expect(events.slice(-3).map((event) => event.eventType)).toEqual([
      "import.staged",
      "import.committed",
      "import.approved",
    ]);
  });
});

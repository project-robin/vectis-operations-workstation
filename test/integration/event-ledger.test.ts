import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";
import { organizations } from "../../src/server/db/schema/organizations.js";
import { appendEvent, listEventsAfter } from "../../src/server/events/event-ledger.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for event ledger integration tests");
}

const connection = createDatabase(databaseUrl);

beforeAll(async () => {
  await migrateDatabase(connection.db);
});

afterAll(async () => {
  await connection.close();
});

describe("operation event ledger", () => {
  it("replays only newer events from the requested organization", async () => {
    const firstOrganizationId = randomUUID();
    const secondOrganizationId = randomUUID();
    await connection.db.insert(organizations).values([
      { id: firstOrganizationId, name: "First organization" },
      { id: secondOrganizationId, name: "Second organization" },
    ]);

    const first = await appendEvent(connection.db, {
      organizationId: firstOrganizationId,
      eventType: "health.checked",
      payload: { component: "database" },
    });
    await appendEvent(connection.db, {
      organizationId: secondOrganizationId,
      eventType: "health.checked",
      payload: { component: "dograh" },
    });
    const second = await appendEvent(connection.db, {
      organizationId: firstOrganizationId,
      eventType: "campaign.drafted",
      payload: { campaignId: "campaign-1" },
    });

    const replay = await listEventsAfter(connection.db, {
      organizationId: firstOrganizationId,
      afterId: first.id,
    });

    expect(second.id).toBeGreaterThan(first.id);
    expect(replay).toEqual([second]);
  });
});

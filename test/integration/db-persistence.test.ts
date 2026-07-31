import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";
import { organizations } from "../../src/server/db/schema/organizations.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for database integration tests");
}

const openConnections: Array<ReturnType<typeof createDatabase>> = [];

afterEach(async () => {
  await Promise.all(openConnections.splice(0).map((connection) => connection.close()));
});

describe("PostgreSQL persistence", () => {
  it("keeps organization data after the database client reconnects", async () => {
    const organizationId = randomUUID();
    const first = createDatabase(databaseUrl);
    openConnections.push(first);
    await migrateDatabase(first.db);

    await first.db.insert(organizations).values({ id: organizationId, name: "Test organization" });
    await first.close();
    openConnections.splice(openConnections.indexOf(first), 1);

    const reopened = createDatabase(databaseUrl);
    openConnections.push(reopened);
    const rows = await reopened.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Test organization");
  });
});

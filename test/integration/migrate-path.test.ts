import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for migration path integration tests");
}

const connection = createDatabase(databaseUrl);
beforeAll(() => migrateDatabase(connection.db));
afterAll(() => connection.close());

describe("database migration path", () => {
  it("does not depend on the process working directory", async () => {
    const originalDirectory = process.cwd();
    const foreignDirectory = await mkdtemp(join(tmpdir(), "vectis-migrate-"));
    try {
      process.chdir(foreignDirectory);
      await expect(migrateDatabase(connection.db)).resolves.toBeUndefined();
    } finally {
      process.chdir(originalDirectory);
      await rm(foreignDirectory, { recursive: true, force: true });
    }
  });
});

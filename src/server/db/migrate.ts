import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Database } from "./client.js";

export async function migrateDatabase(db: Database): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
  await migrate(db, { migrationsFolder });
}

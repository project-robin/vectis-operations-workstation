import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { organizations } from "./schema/organizations.js";

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, { max: 5, onnotice: () => undefined });
  const db = drizzle(client, { schema: { organizations } });

  return {
    db,
    close: () => client.end({ timeout: 5 }),
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];

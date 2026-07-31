import { DograhClient } from "./adapters/dograh/client.js";
import { buildApp } from "./app.js";
import { readServerConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { migrateDatabase } from "./db/migrate.js";

async function main(): Promise<void> {
  const config = readServerConfig(process.env);
  const connection = createDatabase(config.databaseUrl);
  await migrateDatabase(connection.db);
  const campaignProvider =
    process.env.DOGRAH_API_URL && process.env.DOGRAH_API_KEY
      ? new DograhClient(process.env.DOGRAH_API_URL, process.env.DOGRAH_API_KEY)
      : undefined;

  const app = buildApp({
    database: connection.db,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(process.env.DOGRAH_WEBHOOK_SECRET
      ? { dograhWebhookSecret: process.env.DOGRAH_WEBHOOK_SECRET }
      : {}),
    ...(process.env.MANAGER_API_KEY ? { managerKey: process.env.MANAGER_API_KEY } : {}),
    ...(campaignProvider ? { campaignProvider } : {}),
  });
  app.addHook("onClose", async () => {
    await connection.close();
  });

  const close = () => void app.close();
  process.once("SIGINT", close);
  process.once("SIGTERM", close);

  const address = await app.listen({ host: config.host, port: config.port });
  process.stdout.write(`Vectis API listening at ${address}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(`Vectis API failed to start: ${message}\n`);
  process.exitCode = 1;
});

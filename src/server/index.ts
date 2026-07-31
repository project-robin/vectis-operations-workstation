import { runHealthCheck } from "../worker/health/run-health-check.js";
import { DograhClient } from "./adapters/dograh/client.js";
import { buildApp } from "./app.js";
import { readServerConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { migrateDatabase } from "./db/migrate.js";
import { organizations } from "./db/schema/organizations.js";
import { appendEvent } from "./events/event-ledger.js";
import { recordHealthSnapshot } from "./health/health-repository.js";

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
  let healthTimer: ReturnType<typeof setInterval> | undefined;
  app.addHook("onClose", async () => {
    if (healthTimer) clearInterval(healthTimer);
    await connection.close();
  });

  const close = () => void app.close();
  process.once("SIGINT", close);
  process.once("SIGTERM", close);

  const address = await app.listen({ host: config.host, port: config.port });
  let publishingHealth = false;
  const publishHealth = async () => {
    if (publishingHealth) return;
    publishingHealth = true;
    try {
      const startedAt = Date.now();
      const tenantRows = await connection.db.select({ id: organizations.id }).from(organizations);
      const checkedAt = new Date();
      await Promise.all(
        tenantRows.flatMap(({ id: organizationId }) => {
          const latencyMs = Date.now() - startedAt;
          const checks: Promise<unknown>[] = [
            recordHealthSnapshot(connection.db, {
              organizationId,
              component: "database",
              status: "healthy",
              detail: "Organization query succeeded",
              latencyMs,
              checkedAt,
            }),
            appendEvent(connection.db, {
              organizationId,
              eventType: "health.checked",
              payload: { component: "database", status: "healthy", latencyMs },
            }),
          ];
          if (process.env.DOGRAH_API_URL) {
            checks.push(
              runHealthCheck(connection.db, organizationId, {
                component: "dograh",
                timeoutMs: 5_000,
                probe: async (signal) => {
                  const response = await fetch(
                    `${process.env.DOGRAH_API_URL?.replace(/\/$/, "")}/api/v1/health`,
                    { signal },
                  );
                  if (!response.ok) throw new Error("Dograh health check failed");
                  return { detail: `Voice API responded with HTTP ${response.status}` };
                },
              }),
            );
          }
          return checks;
        }),
      );
    } finally {
      publishingHealth = false;
    }
  };
  await publishHealth();
  healthTimer = setInterval(() => void publishHealth().catch(() => undefined), 30_000);
  process.stdout.write(`Vectis API listening at ${address}\n`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(`Vectis API failed to start: ${message}\n`);
  process.exitCode = 1;
});

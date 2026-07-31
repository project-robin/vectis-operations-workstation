import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { McpHttpClient } from "../server/adapters/mcp/http-client.js";
import { TwentyAdapter } from "../server/adapters/twenty/adapter.js";
import { createDatabase } from "../server/db/client.js";
import { migrateDatabase } from "../server/db/migrate.js";
import { organizations } from "../server/db/schema/organizations.js";
import { appendEvent } from "../server/events/event-ledger.js";
import { recordHealthSnapshot } from "../server/health/health-repository.js";
import { runOutboxBatch } from "./outbox-worker.js";
import { deliverTwentyCallOutcome } from "./twenty-outbox-handler.js";

const environmentSchema = z.object({
  DATABASE_URL: z.url(),
  TWENTY_MCP_URL: z.url(),
  TWENTY_MCP_API_KEY: z.string().min(1).optional(),
  MCP_TWENTY_API_KEY: z.string().min(1).optional(),
  OUTBOX_POLL_MS: z.coerce.number().int().min(250).default(5_000),
});

async function main(): Promise<void> {
  const environment = environmentSchema.parse(process.env);
  const apiKey = environment.TWENTY_MCP_API_KEY ?? environment.MCP_TWENTY_API_KEY;
  if (!apiKey) {
    throw new Error("TWENTY_MCP_API_KEY is required");
  }

  const connection = createDatabase(environment.DATABASE_URL);
  const twentyMcp = new McpHttpClient(
    "twenty",
    environment.TWENTY_MCP_URL,
    { Authorization: `Bearer ${apiKey}` },
    60_000,
  );
  const stop = new AbortController();
  const close = () => stop.abort();
  process.once("SIGINT", close);
  process.once("SIGTERM", close);

  try {
    await migrateDatabase(connection.db);
    await twentyMcp.connect();
    const adapter = new TwentyAdapter((toolName, args) =>
      twentyMcp.callTool("execute_tool", { toolName, arguments: args }),
    );
    let nextHealthAt = 0;

    const publishTwentyHealth = async () => {
      const tenantRows = await connection.db.select({ id: organizations.id }).from(organizations);
      const checkedAt = new Date();
      await Promise.all(
        tenantRows.flatMap(({ id: organizationId }) => [
          recordHealthSnapshot(connection.db, {
            organizationId,
            component: "twenty",
            status: "healthy",
            detail: "CRM worker MCP session connected",
            latencyMs: 0,
            checkedAt,
          }),
          appendEvent(connection.db, {
            organizationId,
            eventType: "health.checked",
            payload: { component: "twenty", status: "healthy", latencyMs: 0 },
          }),
        ]),
      );
      nextHealthAt = Date.now() + 60_000;
    };

    while (!stop.signal.aborted) {
      await runOutboxBatch(
        connection.db,
        {
          "twenty.sync_call_outcome": (payload, idempotencyKey) =>
            deliverTwentyCallOutcome(connection.db, adapter, payload, idempotencyKey),
        },
        new Date(),
      );
      if (Date.now() >= nextHealthAt) {
        await publishTwentyHealth();
      }
      try {
        await delay(environment.OUTBOX_POLL_MS, undefined, { signal: stop.signal });
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "AbortError") {
          throw error;
        }
      }
    }
  } finally {
    await Promise.allSettled([twentyMcp.close(), connection.close()]);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown worker error";
  process.stderr.write(`Vectis worker failed: ${message}\n`);
  process.exitCode = 1;
});

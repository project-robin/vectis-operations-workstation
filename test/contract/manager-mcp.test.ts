import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpHttpClient } from "../../src/server/adapters/mcp/http-client.js";
import { buildApp } from "../../src/server/app.js";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";
import { organizations } from "../../src/server/db/schema/organizations.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for manager MCP tests");
}

const connection = createDatabase(databaseUrl);
beforeAll(() => migrateDatabase(connection.db));
afterAll(() => connection.close());

describe("Hermes manager MCP", () => {
  it("discovers only the finite tool surface and executes a grounded read", async () => {
    const organizationId = randomUUID();
    await connection.db
      .insert(organizations)
      .values({ id: organizationId, name: "MCP manager org" });
    const app = buildApp({ database: connection.db, managerKey: "mcp-test-key" });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const client = new McpHttpClient("manager-mcp-test", `${address}/mcp`, {
      "x-manager-key": "mcp-test-key",
    });

    try {
      await client.connect();
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "create_campaign_draft",
        "get_business_overview",
        "get_lead_trace",
        "list_active_campaigns",
        "list_attention_items",
        "list_integration_health",
        "list_recent_calls",
        "pause_campaign",
        "request_campaign_approval",
        "resume_campaign",
        "retry_failed_delivery",
        "start_approved_campaign",
      ]);

      const response = await client.callTool("get_business_overview", {
        organizationId,
        actorId: "hermes-vectis",
        arguments: {},
      });
      expect(response).toEqual({
        activeCampaigns: 0,
        attentionItems: 0,
        calls: { pending: 0, active: 0, completed: 0, failed: 0 },
      });
    } finally {
      await client.close();
      await app.close();
    }
  });
});

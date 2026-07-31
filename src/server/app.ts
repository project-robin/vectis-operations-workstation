import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { type HealthResponse, healthResponseSchema } from "../shared/contracts/health.js";
import type { Database } from "./db/client.js";
import type { CampaignProvider } from "./manager/tools.js";
import { registerDeliveryRoutes } from "./routes/deliveries.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerImportRoutes } from "./routes/imports.js";
import { registerLeadRoutes } from "./routes/leads.js";
import { registerManagerRoutes } from "./routes/manager.js";
import { registerManagerMcpRoute } from "./routes/manager-mcp.js";
import { registerOverviewRoutes } from "./routes/overview.js";
import { registerDograhWebhook } from "./routes/webhooks/dograh.js";

export interface AppOptions {
  database?: Database;
  dograhWebhookSecret?: string;
  apiKey?: string;
  managerKey?: string;
  campaignProvider?: CampaignProvider;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  const apiKey = options.apiKey;
  if (apiKey) {
    app.addHook("onRequest", async (request, reply) => {
      const path = request.url.split("?", 1)[0] ?? request.url;
      if (
        path === "/api/health/live" ||
        path === "/mcp" ||
        path.startsWith("/api/manager/") ||
        path.startsWith("/api/webhooks/")
      ) {
        return;
      }
      const received = request.headers["x-workstation-key"];
      const actual = typeof received === "string" ? Buffer.from(received) : Buffer.alloc(0);
      const expected = Buffer.from(apiKey);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
    });
  }

  app.get<{ Reply: HealthResponse }>("/api/health/live", async () => {
    return healthResponseSchema.parse({ status: "healthy" });
  });

  if (options.database) {
    registerHealthRoutes(app, options.database);
    registerEventRoutes(app, options.database);
    registerImportRoutes(app, options.database);
    registerLeadRoutes(app, options.database);
    registerDeliveryRoutes(app, options.database);
    registerOverviewRoutes(app, options.database);
    if (options.dograhWebhookSecret) {
      registerDograhWebhook(app, options.database, options.dograhWebhookSecret);
    }
    if (options.managerKey) {
      const managerOptions = {
        database: options.database,
        managerKey: options.managerKey,
        ...(options.campaignProvider ? { campaignProvider: options.campaignProvider } : {}),
      };
      registerManagerRoutes(app, managerOptions);
      registerManagerMcpRoute(app, managerOptions);
    }
  }
  return app;
}

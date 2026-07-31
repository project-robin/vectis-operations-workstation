import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { getOwnerOverview, listCampaigns } from "../operations/queries.js";

const organizationQuerySchema = z.object({ organizationId: z.uuid() });

export function registerOverviewRoutes(app: FastifyInstance, database: Database): void {
  app.get("/api/overview", async (request, reply) => {
    const query = organizationQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid organization" });
    }
    return getOwnerOverview(database, query.data.organizationId);
  });

  app.get("/api/campaigns", async (request, reply) => {
    const query = organizationQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid organization" });
    }
    return listCampaigns(database, query.data.organizationId);
  });
}

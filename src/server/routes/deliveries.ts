import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { listAttentionItems, listDeliveries } from "../operations/queries.js";

const querySchema = z.object({
  organizationId: z.uuid(),
  status: z.enum(["pending", "processing", "succeeded", "dead"]).optional(),
});

export function registerDeliveryRoutes(app: FastifyInstance, database: Database): void {
  app.get("/api/deliveries", async (request, reply) => {
    const query = querySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid delivery list request" });
    }
    return listDeliveries(database, query.data.organizationId, query.data.status);
  });

  app.get("/api/attention", async (request, reply) => {
    const query = querySchema.pick({ organizationId: true }).safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid attention list request" });
    }
    return listAttentionItems(database, query.data.organizationId);
  });
}

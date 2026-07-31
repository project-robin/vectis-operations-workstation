import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { getLeadTrace, listLeads } from "../operations/queries.js";

const organizationQuerySchema = z.object({ organizationId: z.uuid() });
const leadParamsSchema = z.object({ leadId: z.coerce.number().int().positive() });

export function registerLeadRoutes(app: FastifyInstance, database: Database): void {
  app.get("/api/leads", async (request, reply) => {
    const query = organizationQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid lead list request" });
    }
    return listLeads(database, query.data.organizationId);
  });

  app.get("/api/leads/:leadId/trace", async (request, reply) => {
    const params = leadParamsSchema.safeParse(request.params);
    const query = organizationQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.status(400).send({ error: "Invalid lead trace request" });
    }
    const trace = await getLeadTrace(database, query.data.organizationId, params.data.leadId);
    if (!trace) {
      return reply.status(404).send({ error: "Lead not found" });
    }
    return trace;
  });
}

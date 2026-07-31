import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { listLatestHealth } from "../health/health-repository.js";

const organizationQuerySchema = z.object({
  organizationId: z.uuid(),
});

export function registerHealthRoutes(app: FastifyInstance, database: Database): void {
  app.get("/api/health/ready", async (_request, reply) => {
    try {
      await database.execute(sql`select 1`);
      return { status: "healthy" };
    } catch {
      return reply.status(503).send({ status: "down" });
    }
  });

  app.get("/api/health/components", async (request, reply) => {
    const query = organizationQuerySchema.safeParse(request.query);

    if (!query.success) {
      return reply.status(400).send({ error: "Invalid organization" });
    }

    const components = await listLatestHealth(database, query.data.organizationId);
    return { components };
  });
}

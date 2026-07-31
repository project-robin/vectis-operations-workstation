import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { importBatches } from "../db/schema/imports.js";
import {
  approveImport,
  commitImport,
  getImportPreview,
  stageImport,
} from "../imports/import-repository.js";

const organizationBodySchema = z.object({ organizationId: z.uuid() });
const importParamsSchema = z.object({ batchId: z.uuid() });
const previewQuerySchema = z.object({ organizationId: z.uuid() });
const stageImportSchema = z.object({
  organizationId: z.uuid(),
  filename: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/\.csv$/i),
  defaultCallingCode: z.string().regex(/^[1-9]\d{0,2}$/),
  csv: z.string().min(1).max(10_000_000),
});

export function registerImportRoutes(app: FastifyInstance, database: Database): void {
  app.get("/api/imports", async (request, reply) => {
    const query = previewQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid import history request" });
    }
    return database
      .select()
      .from(importBatches)
      .where(eq(importBatches.organizationId, query.data.organizationId))
      .orderBy(desc(importBatches.createdAt));
  });

  app.post("/api/imports/stage", async (request, reply) => {
    const body = stageImportSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid CSV import request" });
    }

    try {
      const batch = await stageImport(database, body.data);
      return reply.status(201).send(batch);
    } catch {
      return reply.status(400).send({ error: "CSV could not be staged" });
    }
  });

  app.get("/api/imports/:batchId", async (request, reply) => {
    const params = importParamsSchema.safeParse(request.params);
    const query = previewQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.status(400).send({ error: "Invalid import preview request" });
    }

    const preview = await getImportPreview(
      database,
      query.data.organizationId,
      params.data.batchId,
    );
    if (!preview) {
      return reply.status(404).send({ error: "Import batch not found" });
    }

    return preview;
  });

  app.post("/api/imports/:batchId/commit", async (request, reply) => {
    const params = importParamsSchema.safeParse(request.params);
    const body = organizationBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "Invalid import commit request" });
    }

    try {
      return await commitImport(database, body.data.organizationId, params.data.batchId);
    } catch {
      return reply.status(409).send({ error: "Import cannot be committed" });
    }
  });

  app.post("/api/imports/:batchId/approve", async (request, reply) => {
    const params = importParamsSchema.safeParse(request.params);
    const body = organizationBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "Invalid import approval request" });
    }

    try {
      return await approveImport(database, body.data.organizationId, params.data.batchId);
    } catch {
      return reply.status(409).send({ error: "Import cannot be approved" });
    }
  });
}

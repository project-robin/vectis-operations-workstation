import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { invokeManagerTool, ManagerIdempotencyError } from "../manager/invoke.js";
import {
  type CampaignProvider,
  ManagerConflictError,
  ManagerNotFoundError,
  ManagerUnavailableError,
  mutationManagerTools,
  readManagerTools,
} from "../manager/tools.js";

const toolNameSchema = z.enum([...readManagerTools, ...mutationManagerTools]);
const bodySchema = z.object({
  organizationId: z.uuid(),
  actorId: z.string().trim().min(1).max(120),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

function authenticated(received: unknown, expected: string): boolean {
  if (typeof received !== "string") {
    return false;
  }
  const actualBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function sendManagerError(reply: FastifyReply, error: unknown) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: "Invalid manager tool arguments" });
  }
  if (error instanceof ManagerNotFoundError) {
    return reply.code(404).send({ error: error.message });
  }
  if (error instanceof ManagerConflictError) {
    return reply.code(409).send({ error: error.message });
  }
  if (error instanceof ManagerIdempotencyError) {
    return reply
      .code(error.message.includes("required") ? 400 : 409)
      .send({ error: error.message });
  }
  if (error instanceof ManagerUnavailableError) {
    return reply.code(503).send({ error: error.message });
  }
  throw error;
}

export function registerManagerRoutes(
  app: FastifyInstance,
  input: {
    database: Database;
    managerKey: string;
    campaignProvider?: CampaignProvider;
  },
): void {
  app.post("/api/manager/tools/:toolName", async (request, reply) => {
    if (!authenticated(request.headers["x-manager-key"], input.managerKey)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsedParams = z.object({ toolName: toolNameSchema }).safeParse(request.params);
    const parsedBody = bodySchema.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return reply.code(400).send({ error: "Invalid manager tool request" });
    }
    const { toolName } = parsedParams.data;
    const body = parsedBody.data;
    try {
      return await invokeManagerTool(input.database, {
        toolName,
        organizationId: body.organizationId,
        actorId: body.actorId,
        arguments: body.arguments,
        ...(body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
        ...(input.campaignProvider ? { campaignProvider: input.campaignProvider } : {}),
      });
    } catch (error) {
      return sendManagerError(reply, error);
    }
  });
}

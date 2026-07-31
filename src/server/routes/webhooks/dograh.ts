import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { projectDograhCallback } from "../../providers/project-dograh-callback.js";

const renderedIdSchema = z.coerce.number().int().positive();
const renderedUrlSchema = z
  .union([z.literal(""), z.url(), z.null()])
  .transform((value) => value || null)
  .optional()
  .default(null);

const callbackSchema = z.object({
  workflow_run_id: z.union([z.string().min(1), z.number().int().positive()]).transform(String),
  workstation_provider_run_id: z.uuid(),
  campaign_id: renderedIdSchema,
  workflow_id: renderedIdSchema,
  state: z.enum(["completed", "failed"]),
  gathered_context: z.record(z.string(), z.unknown()).default({}),
  recording_url: renderedUrlSchema,
  transcript_url: renderedUrlSchema,
});

function secretMatches(provided: string | undefined, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return Boolean(provided) && timingSafeEqual(digest(provided ?? ""), digest(expected));
}

export function registerDograhWebhook(
  app: FastifyInstance,
  database: Database,
  secret: string,
): void {
  app.post("/api/webhooks/dograh", async (request, reply) => {
    const providedSecret = request.headers["x-dograh-webhook-secret"];
    if (typeof providedSecret !== "string" || !secretMatches(providedSecret, secret)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const body = callbackSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid Dograh callback" });
    }

    const result = await projectDograhCallback(database, {
      workflowRunId: body.data.workflow_run_id,
      workstationProviderRunId: body.data.workstation_provider_run_id,
      campaignId: body.data.campaign_id,
      workflowId: body.data.workflow_id,
      state: body.data.state,
      gatheredContext: body.data.gathered_context,
      recordingUrl: body.data.recording_url,
      transcriptUrl: body.data.transcript_url,
    });

    if (result === "unknown") {
      return reply.status(404).send({ error: "Unknown provider run" });
    }
    if (result === "mismatch") {
      return reply.status(409).send({ error: "Provider correlation mismatch" });
    }
    if (result === "duplicate") {
      return { status: "duplicate" };
    }
    return reply.status(202).send({ status: "accepted" });
  });
}

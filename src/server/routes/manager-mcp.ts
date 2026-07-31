import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { invokeManagerTool } from "../manager/invoke.js";
import { type CampaignProvider, mutationManagerTools, readManagerTools } from "../manager/tools.js";

const commonInput = {
  organizationId: z.uuid().describe("Tenant organization UUID"),
  actorId: z.string().min(1).max(120).describe("Hermes actor identifier"),
  arguments: z.record(z.string(), z.unknown()).default({}).describe("Tool-specific arguments"),
};

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

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

function toolError(error: unknown) {
  const known = error instanceof Error && error.constructor.name.startsWith("Manager");
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: known && error instanceof Error ? error.message : "Manager tool execution failed",
      },
    ],
  };
}

function buildManagerMcpServer(input: { database: Database; campaignProvider?: CampaignProvider }) {
  const server = new McpServer({ name: "vectis-workstation", version: "0.1.0" });

  for (const toolName of readManagerTools) {
    server.registerTool(
      toolName,
      {
        description: `Read-only Vectis manager operation: ${toolName}`,
        inputSchema: commonInput,
      },
      async ({ organizationId, actorId, arguments: toolArguments }) => {
        try {
          return toolResult(
            await invokeManagerTool(input.database, {
              toolName,
              organizationId,
              actorId,
              arguments: toolArguments,
              ...(input.campaignProvider ? { campaignProvider: input.campaignProvider } : {}),
            }),
          );
        } catch (error) {
          return toolError(error);
        }
      },
    );
  }

  for (const toolName of mutationManagerTools) {
    server.registerTool(
      toolName,
      {
        description: `Audited Vectis manager mutation: ${toolName}`,
        inputSchema: {
          ...commonInput,
          idempotencyKey: z.string().min(8).max(200).describe("Unique key for safe replay"),
        },
      },
      async ({ organizationId, actorId, arguments: toolArguments, idempotencyKey }) => {
        try {
          return toolResult(
            await invokeManagerTool(input.database, {
              toolName,
              organizationId,
              actorId,
              arguments: toolArguments,
              idempotencyKey,
              ...(input.campaignProvider ? { campaignProvider: input.campaignProvider } : {}),
            }),
          );
        } catch (error) {
          return toolError(error);
        }
      },
    );
  }

  return server;
}

export function registerManagerMcpRoute(
  app: FastifyInstance,
  input: {
    database: Database;
    managerKey: string;
    campaignProvider?: CampaignProvider;
  },
): void {
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    handler: async (request, reply) => {
      if (!authenticated(request.headers["x-manager-key"], input.managerKey)) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      // ponytail: SDK 1.30's transport/options optional-property types disagree under exact mode.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
      const server = buildManagerMcpServer(input);
      await server.connect(transport as unknown as Transport);
      reply.hijack();
      await transport.handleRequest(request.raw, reply.raw, request.body);
    },
  });
}

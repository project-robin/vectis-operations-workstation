import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

const toolResultSchema = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
    }),
  ),
});

export class McpHttpClient {
  readonly #client: Client;
  readonly #transport: StreamableHTTPClientTransport;
  readonly #timeoutMs: number;

  constructor(name: string, url: string, headers: Record<string, string>, timeoutMs = 30_000) {
    this.#client = new Client({ name: `vectis-${name}`, version: "0.1.0" });
    this.#transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers },
    });
    this.#timeoutMs = timeoutMs;
  }

  connect() {
    // ponytail: SDK 1.30's transport/interface optional-property types disagree under exact mode.
    return this.#client.connect(this.#transport as unknown as Transport, {
      timeout: this.#timeoutMs,
    });
  }

  listTools() {
    return this.#client.listTools(undefined, { timeout: this.#timeoutMs });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.#client.callTool({ name, arguments: args }, undefined, {
      timeout: this.#timeoutMs,
    });
    const parsed = toolResultSchema.parse(result);
    if (parsed.isError) {
      const message = parsed.content
        .filter((part) => part.type === "text" && part.text)
        .map((part) => part.text)
        .join("\n");
      throw new Error(message || `MCP tool ${name} failed`);
    }
    if (parsed.structuredContent) {
      return parsed.structuredContent;
    }

    const text = parsed.content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n");
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  close() {
    return this.#client.close();
  }
}

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { createRecordAndReadBack, readRecords } from "../../convex/lib/twentyAdapter";
import { deliveryObjectName } from "../../convex/lib/twentyAdapter";

let server: Server | undefined;
let closeServer: (() => Promise<void>) | undefined;

type Mode = "success" | "timeout" | "server_error" | "malformed" | "orphan";

async function fakeMcp(mode: Mode = "success") {
  const requests: Array<Record<string, unknown>> = [];
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      requests.push(body);
      if (mode === "timeout") return;
      if (mode === "server_error" && body.method === "tools/call") { response.writeHead(503); response.end("upstream unavailable"); return; }
      if (mode === "malformed") { response.writeHead(200, { "content-type": "text/event-stream" }); response.end("event: message\ndata: not-json\n\n"); return; }
      if (body.method === "notifications/initialized") { response.writeHead(202); response.end(); return; }
      response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "fake-session" });
      if (body.method === "initialize") { response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { capabilities: {} } })); return; }
      const params = body.params as { arguments?: { name?: string } };
      const name = params.arguments?.name ?? "unknown";
      const isRead = Boolean((params.arguments as { query?: unknown } | undefined)?.query);
      const id = mode === "orphan" && isRead ? "different-record" : `${name}-record-1`;
      const text = body.method === "tools/call" && (params.arguments as { query?: unknown } | undefined)?.query ? JSON.stringify({ records: [{ id }] }) : JSON.stringify({ recordIds: [id] });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text }] } }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake server did not bind");
  closeServer = () => new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  return { url: `http://127.0.0.1:${address.port}/mcp`, requests };
}

afterEach(async () => { if (closeServer) await closeServer(); closeServer = undefined; server = undefined; });

describe("Twenty Streamable HTTP contract", () => {
  test("initializes a session, maps every delivery target, creates, and reads back exact IDs", async () => {
    const fake = await fakeMcp();
    for (const [target, objectName] of [["twenty_person", "person"], ["twenty_note", "note"], ["twenty_task", "task"], ["twenty_appointment", "appointment"]] as const) {
      expect(deliveryObjectName(target)).toBe(objectName);
      const result = await createRecordAndReadBack({ serverUrl: fake.url, apiKey: "fake-secret", objectName, input: { linkedCustomerId: "customer-1" } });
      expect(result).toMatchObject({ ok: true, externalIds: [`${objectName}-record-1`] });
      expect(result.readbackEvidence).toContain(`${objectName}-record-1`);
    }
    const calls = fake.requests.filter((request) => request.method === "tools/call");
    expect(calls).toHaveLength(8);
    expect((calls[0].params as { arguments: { name: string } }).arguments.name).toBe("person");
    expect((calls[2].params as { arguments: { name: string } }).arguments.name).toBe("note");
    expect((calls[4].params as { arguments: { name: string } }).arguments.name).toBe("task");
    expect((calls[6].params as { arguments: { name: string } }).arguments.name).toBe("appointment");
    expect(fake.requests.every((request) => request.method === "initialize" || request.method === "notifications/initialized" || request.method === "tools/call")).toBe(true);
  });

  test.each(["timeout", "server_error", "malformed", "orphan"] as const)("fails closed for %s and never reports success", async (mode) => {
    const fake = await fakeMcp(mode);
    const result = await createRecordAndReadBack({ serverUrl: fake.url, apiKey: "fake-secret", objectName: "note", input: { body: "hello" }, timeoutMs: mode === "timeout" ? 20 : 1_000 });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    if (mode === "orphan") expect(result.error).toMatch(/read-back/i);
  });

  test("read-only opportunity/payment seam preserves unknown coverage and never calls write tools", async () => {
    const fake = await fakeMcp();
    const result = await readRecords({ serverUrl: fake.url, apiKey: "fake-key", objectName: "opportunity", query: { updatedAt: { _gte: 1 } } });
    expect(result).toMatchObject({ ok: true, coverageState: "unknown", records: [{ id: "opportunity-record-1" }] });
    expect(fake.requests.filter((request) => request.method === "tools/call")).toHaveLength(1);
    expect((fake.requests.find((request) => request.method === "tools/call")!.params as { name: string }).name).toBe("searchRecords");
  });
});

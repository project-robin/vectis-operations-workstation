export type TwentyObject = "person" | "note" | "task" | "appointment";
export type McpResponse = { ok: boolean; externalIds: string[]; readbackEvidence?: string; error?: string };

export class TwentyAdapterError extends Error { readonly kind: "determinate" | "ambiguous"; constructor(message: string, kind: "determinate" | "ambiguous" = "determinate") { super(message); this.name = "TwentyAdapterError"; this.kind = kind; } }
export class TwentyAmbiguousError extends TwentyAdapterError { constructor(message: string) { super(message, "ambiguous"); this.name = "TwentyAmbiguousError"; } }

const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

function boundedText(text: string) { if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new TwentyAmbiguousError("Twenty response exceeds byte limit"); return text; }

async function readBody(response: Response): Promise<unknown> {
  const text = boundedText(await response.text());
  const contentType = response.headers.get("content-type") ?? "";
  if (!text) throw new TwentyAmbiguousError("Twenty returned an empty response");
  if (contentType.includes("text/event-stream")) {
    const payloads = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean);
    if (payloads.length === 0) throw new TwentyAmbiguousError("Twenty returned malformed SSE");
    for (let i = payloads.length - 1; i >= 0; i -= 1) { try { return JSON.parse(payloads[i]) as unknown; } catch { /* try the previous event */ } }
    throw new TwentyAmbiguousError("Twenty returned malformed SSE JSON");
  }
  try { return JSON.parse(text) as unknown; } catch { throw new TwentyAmbiguousError("Twenty returned malformed JSON"); }
}

function resultOf(body: unknown): unknown { return body && typeof body === "object" && "result" in body ? (body as { result: unknown }).result : body; }
function contentText(result: unknown) { const content = result && typeof result === "object" && Array.isArray((result as { content?: unknown }).content) ? (result as { content: Array<{ text?: unknown }> }).content : []; return content.map((part) => typeof part.text === "string" ? part.text : "").join("\n"); }
function jsonFromText(text: string): unknown { try { return JSON.parse(text); } catch { return null; } }

async function mcpCall(serverUrl: string, apiKey: string, method: "tools/call", params: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  if (!/^https?:\/\//i.test(serverUrl)) throw new TwentyAdapterError("Twenty MCP URL is invalid");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (apiKey) headers.apikey = apiKey;
  let sessionId: string | null = null;
  try {
    const initResponse = await fetch(serverUrl, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "vectis-workstation", version: "0.2.0" } },
      }),
    });
    if (!initResponse.ok) throw new TwentyAmbiguousError(`MCP initialize failed: ${initResponse.status}`);
    await readBody(initResponse);
    sessionId = initResponse.headers.get("mcp-session-id");
    const callHeaders = { ...headers, ...(sessionId ? { "mcp-session-id": sessionId } : {}) };
    const initializedResponse = await fetch(serverUrl, { method: "POST", headers: callHeaders, signal: controller.signal, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) });
    if (!initializedResponse.ok && initializedResponse.status !== 202) throw new TwentyAmbiguousError(`MCP initialized notification failed: ${initializedResponse.status}`);
    const callResponse = await fetch(serverUrl, { method: "POST", headers: callHeaders, signal: controller.signal, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }) });
    if (!callResponse.ok) throw new TwentyAmbiguousError(`MCP ${method} failed: ${callResponse.status}`);
    const body = resultOf(await readBody(callResponse));
    if (body && typeof body === "object" && (body as { isError?: boolean }).isError) throw new TwentyAdapterError(contentText(body) || "Twenty tool error");
    return body;
  } catch (error) {
    if (error instanceof TwentyAdapterError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new TwentyAmbiguousError("Twenty request timed out");
    throw new TwentyAmbiguousError(`Twenty request failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally { clearTimeout(timeout); }
}

function idsFromResult(result: unknown): string[] {
  const text = contentText(result);
  const parsed = jsonFromText(text) ?? result;
  const values: unknown[] = [];
  const collect = (value: unknown) => { if (typeof value === "string") values.push(value); else if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === "object") { const object = value as Record<string, unknown>; for (const key of ["id", "recordId", "recordIds", "externalId", "records", "data"]) if (key in object) collect(object[key]); } };
  collect(parsed);
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0 && value.length < 512))];
}

export async function createRecordAndReadBack(args: { serverUrl: string; apiKey: string; objectName: TwentyObject; input: Record<string, unknown>; timeoutMs?: number }): Promise<McpResponse> {
  try {
    const created = await mcpCall(args.serverUrl, args.apiKey, "tools/call", { name: "createRecords", arguments: { name: args.objectName, input: args.input } }, args.timeoutMs);
    const externalIds = idsFromResult(created);
    if (externalIds.length === 0) return { ok: false, externalIds: [], error: "No record id returned by Twenty" };
    const read = await mcpCall(args.serverUrl, args.apiKey, "tools/call", { name: "searchRecords", arguments: { name: args.objectName, query: { id: { _eq: externalIds[0] } } } }, args.timeoutMs);
    const evidence = JSON.stringify(read);
    const readIds = idsFromResult(read);
    if (!readIds.includes(externalIds[0])) return { ok: false, externalIds, readbackEvidence: evidence, error: "Read-back could not resolve created record" };
    return { ok: true, externalIds, readbackEvidence: evidence };
  } catch (error) { return { ok: false, externalIds: [], error: error instanceof Error ? error.message : String(error) }; }
}

export function deliveryObjectName(target: "twenty_person" | "twenty_note" | "twenty_task" | "twenty_appointment"): TwentyObject {
  return target === "twenty_person" ? "person" : target === "twenty_note" ? "note" : target === "twenty_task" ? "task" : "appointment";
}

export type TwentyReadResponse = { ok: boolean; records: unknown[]; readbackEvidence?: string; coverageState: "verified" | "unknown"; error?: string };

/** Read-only seam for Task 9. The object name and query must come from a verified binding mapping. */
export async function readRecords(args: { serverUrl: string; apiKey: string; objectName: string; query: Record<string, unknown>; timeoutMs?: number }): Promise<TwentyReadResponse> {
  try {
    const result = await mcpCall(args.serverUrl, args.apiKey, "tools/call", { name: "searchRecords", arguments: { name: args.objectName, query: args.query } }, args.timeoutMs);
    const text = contentText(result);
    const parsed = jsonFromText(text) ?? result;
    const records = parsed && typeof parsed === "object" && Array.isArray((parsed as { records?: unknown }).records) ? (parsed as { records: unknown[] }).records : [];
    return { ok: true, records, readbackEvidence: JSON.stringify(result), coverageState: "unknown" };
  } catch (error) {
    return { ok: false, records: [], coverageState: "unknown", error: error instanceof Error ? error.message : String(error) };
  }
}

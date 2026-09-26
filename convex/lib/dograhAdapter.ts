export type DograhCampaign = { campaignId: number; state: string };
export type DograhProgress = {
  campaignId: number;
  state: string;
  totalRows: number;
  processedRows: number;
  failedCalls: number;
  progressPercentage: number;
};
export type DograhRun = Record<string, unknown> & { providerRunId?: string | number; state?: string };
export type DograhReport = Record<string, unknown> | string;
export type FetchLike = typeof fetch;

const API_PREFIX = "/api/v1";
const MAX_CSV_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export class DograhError extends Error {
  constructor(message: string, readonly operation: string, readonly status?: number, readonly ambiguous = false) {
    super(message);
    this.name = "DograhError";
  }
}

export class DograhAmbiguousError extends DograhError {
  constructor(operation: string, cause: unknown) {
    super(`Dograh ${operation} outcome is ambiguous`, operation, undefined, true);
    this.cause = cause;
  }
  readonly cause: unknown;
}

function apiBase(value: string) {
  return value.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DograhError("Dograh response is malformed", "read", undefined, true);
  return value as Record<string, unknown>;
}

function number(value: unknown, name: string): number {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(n) || n < 0) throw new DograhError(`Dograh response missing ${name}`, "read", undefined, true);
  return n;
}

function state(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) throw new DograhError("Dograh response has invalid state", "read", undefined, true);
  return value;
}

export class DograhAdapter {
  private readonly base: string;
  private readonly fetcher: FetchLike;
  constructor(private readonly baseUrl: string, private readonly apiKey: string, fetcher: FetchLike = fetch, private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!/^https?:\/\//i.test(baseUrl) || !apiKey) throw new Error("Dograh adapter requires a base URL and API key");
    this.base = apiBase(baseUrl);
    this.fetcher = fetcher;
  }

  private async request<T>(operation: string, path: string, init: RequestInit = {}, mutation = false): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}${API_PREFIX}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { "X-API-Key": this.apiKey, "content-type": "application/json", ...(init.headers ?? {}) },
      });
    } catch (error) {
      if (mutation) throw new DograhAmbiguousError(operation, error);
      throw new DograhError(`Dograh ${operation} transport failed`, operation, undefined, false);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      if (mutation && response.status >= 500) throw new DograhAmbiguousError(operation, new DograhError(`HTTP ${response.status}`, operation, response.status));
      throw new DograhError(`Dograh ${operation} failed: ${response.status}${message ? ` ${message.slice(0, 256)}` : ""}`, operation, response.status, false);
    }
    try {
      return (await response.json()) as T;
    } catch (error) {
      if (mutation) throw new DograhAmbiguousError(operation, error);
      throw new DograhError(`Dograh ${operation} response is malformed`, operation, response.status, false);
    }
  }

  private async requestText(operation: string, path: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.base}${API_PREFIX}${path}`, {
        signal: controller.signal,
        headers: { "X-API-Key": this.apiKey },
      });
      if (!response.ok) throw new DograhError(`Dograh ${operation} failed: ${response.status}`, operation, response.status, false);
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES) throw new DograhError("Dograh response exceeds size bound", operation, response.status, false);
      return text;
    } catch (error) {
      if (error instanceof DograhError) throw error;
      throw new DograhError(`Dograh ${operation} transport failed`, operation, undefined, false);
    } finally {
      clearTimeout(timer);
    }
  }

  async requestUploadUrl(args: { fileName: string; fileSize: number }): Promise<{ uploadUrl: string; fileKey: string }> {
    if (!/^[A-Za-z0-9._ -]+\.csv$/i.test(args.fileName) || !Number.isSafeInteger(args.fileSize) || args.fileSize < 1 || args.fileSize > MAX_CSV_BYTES) throw new Error("CSV upload is outside bounds");
    const body = await this.request<Record<string, unknown>>("presigned-upload-url", "/s3/presigned-upload-url", { method: "POST", body: JSON.stringify({ file_name: args.fileName, file_size: args.fileSize, content_type: "text/csv" }) });
    const uploadUrl = body.upload_url;
    const fileKey = body.file_key;
    if (typeof uploadUrl !== "string" || typeof fileKey !== "string" || !fileKey.startsWith("campaigns/")) throw new DograhError("Dograh upload response is malformed", "presigned-upload-url");
    return { uploadUrl, fileKey };
  }

  async uploadCsv(uploadUrl: string, csv: string): Promise<void> {
    const url = new URL(uploadUrl);
    const base = new URL(this.base);
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(base.hostname) && url.hostname === base.hostname;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) throw new Error("Presigned upload URL must use HTTPS");
    const bytes = new TextEncoder().encode(csv);
    if (bytes.byteLength > MAX_CSV_BYTES) throw new Error("CSV upload exceeds size bound");
    let response: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      response = await this.fetcher(uploadUrl, { method: "PUT", signal: controller.signal, headers: { "content-type": "text/csv" }, body: bytes });
    } catch (error) {
      throw new DograhError("Dograh CSV upload failed", "upload", undefined, true);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new DograhError(`Dograh CSV upload failed: ${response.status}`, "upload", response.status, response.status >= 500);
  }

  async create(args: { name: string; workflowId: number; fileKey: string; dograhOrganizationId?: string }): Promise<DograhCampaign> {
    const sourceId = args.fileKey.startsWith("campaigns/") ? args.fileKey : `campaigns/${args.dograhOrganizationId ?? ""}/${args.fileKey}`;
    const body = await this.request<Record<string, unknown>>("create", "/campaign/create", { method: "POST", body: JSON.stringify({ name: args.name, workflow_id: args.workflowId, source_type: "csv", source_id: sourceId }) }, true);
    return { campaignId: number(body.campaign_id ?? body.id, "campaign_id"), state: state(body.state ?? body.status) };
  }

  async getWorkflow(workflowId: string): Promise<{ workflowId: string; active: boolean; name?: string }> {
    const body = await this.request<Record<string, unknown>>("canary-workflow", `/workflow/${encodeURIComponent(workflowId)}`);
    const workflowIdValue = String(body.id ?? body.workflow_id ?? workflowId);
    const active = body.active !== false && body.status !== "inactive" && body.status !== "archived";
    return { workflowId: workflowIdValue, active, name: typeof body.name === "string" ? body.name : undefined };
  }

  async canary(workflowId: string): Promise<{ workflow: { workflowId: string; active: boolean; name?: string }; telephony: "unknown" }> {
    return { workflow: await this.getWorkflow(workflowId), telephony: "unknown" };
  }

  async get(campaignId: number): Promise<DograhCampaign> {
    const body = await this.request<Record<string, unknown>>("get", `/campaign/${campaignId}`);
    return { campaignId: number(body.campaign_id ?? body.id ?? campaignId, "campaign_id"), state: state(body.state ?? body.status) };
  }
  async start(campaignId: number): Promise<DograhCampaign> { return this.mutate("start", `/campaign/${campaignId}/start`, campaignId); }
  async pause(campaignId: number): Promise<DograhCampaign> { return this.mutate("pause", `/campaign/${campaignId}/pause`, campaignId); }
  async resume(campaignId: number): Promise<DograhCampaign> { return this.mutate("resume", `/campaign/${campaignId}/resume`, campaignId); }
  private async mutate(operation: string, path: string, campaignId: number): Promise<DograhCampaign> {
    const body = await this.request<Record<string, unknown>>(operation, path, { method: "POST" }, true);
    return { campaignId: number(body.campaign_id ?? body.id ?? campaignId, "campaign_id"), state: state(body.state ?? body.status) };
  }

  async progress(campaignId: number): Promise<DograhProgress> {
    const body = await this.request<Record<string, unknown>>("progress", `/campaign/${campaignId}/progress`);
    return { campaignId: number(body.campaign_id ?? body.id ?? campaignId, "campaign_id"), state: state(body.state ?? body.status), totalRows: number(body.total_rows, "total_rows"), processedRows: number(body.processed_rows, "processed_rows"), failedCalls: number(body.failed_calls ?? body.failed_rows ?? 0, "failed_calls"), progressPercentage: typeof body.progress_percentage === "number" ? body.progress_percentage : 0 };
  }
  async runs(campaignId: number): Promise<DograhRun[]> {
    const body = object(await this.request<unknown>("runs", `/campaign/${campaignId}/runs`));
    if (!Array.isArray(body.runs)) throw new DograhError("Dograh runs response is malformed", "runs", undefined, false);
    if (body.runs.some((run) => !run || typeof run !== "object" || Array.isArray(run))) throw new DograhError("Dograh runs response is malformed", "runs", undefined, false);
    return body.runs as DograhRun[];
  }
  async report(campaignId: number): Promise<DograhReport> {
    const text = await this.requestText("report", `/campaign/${campaignId}/report`);
    try { return JSON.parse(text) as Record<string, unknown>; } catch { return text; }
  }

  async listWorkflows(): Promise<{ id: number; name: string; status: string; uuid?: string }[]> {
    const body = await this.request<unknown>("list-workflows", "/workflow/fetch");
    if (!Array.isArray(body)) throw new DograhError("Dograh workflow list is malformed", "list-workflows");
    return body.map((item) => {
      const row = object(item);
      return {
        id: number(row.id, "id"),
        name: typeof row.name === "string" ? row.name : `Workflow ${String(row.id)}`,
        status: typeof row.status === "string" ? row.status : "unknown",
        uuid: typeof row.workflow_uuid === "string" ? row.workflow_uuid : undefined,
      };
    });
  }

  /** Place one outbound call through a workflow's API Trigger node. */
  async triggerCall(args: { triggerPath: string; phoneNumber: string; initialContext: Record<string, unknown> }): Promise<{ runId?: number; runName?: string; raw: Record<string, unknown> }> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(args.triggerPath)) throw new Error("Invalid Dograh trigger path");
    const body = object(
      await this.request<unknown>("trigger-call", `/public/agent/${args.triggerPath}`, {
        method: "POST",
        body: JSON.stringify({ phone_number: args.phoneNumber, initial_context: args.initialContext }),
      }, true),
    );
    const runIdValue = body.workflow_run_id ?? body.run_id ?? body.id;
    const runId = typeof runIdValue === "number" || (typeof runIdValue === "string" && /^\d+$/.test(runIdValue)) ? Number(runIdValue) : undefined;
    const runNameValue = body.workflow_run_name ?? body.run_name ?? body.name;
    return { runId, runName: typeof runNameValue === "string" ? runNameValue : undefined, raw: body };
  }

  async getRun(workflowId: number, runId: number): Promise<Record<string, unknown>> {
    return object(await this.request<unknown>("get-run", `/workflow/${workflowId}/runs/${runId}`));
  }

  async listWorkflowRuns(workflowId: number, limit = 50): Promise<Record<string, unknown>[]> {
    const body = object(await this.request<unknown>("workflow-runs", `/workflow/${workflowId}/runs?limit=${limit}&sort_order=desc`));
    return Array.isArray(body.runs) ? (body.runs as Record<string, unknown>[]) : [];
  }

  async campaignRuns(campaignId: number, page = 1, limit = 100): Promise<{ runs: Record<string, unknown>[]; totalPages: number }> {
    const body = object(await this.request<unknown>("runs", `/campaign/${campaignId}/runs?page=${page}&limit=${limit}`));
    const runs = Array.isArray(body.runs) ? (body.runs as Record<string, unknown>[]) : [];
    return { runs, totalPages: typeof body.total_pages === "number" ? body.total_pages : 1 };
  }

  /** Fetch a public artifact (e.g. transcript) that Dograh exposes via tokenized URL. */
  async fetchPublicText(url: string, maxBytes = 200_000): Promise<string | undefined> {
    const target = new URL(url, this.base);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(target.toString(), { signal: controller.signal, redirect: "follow" });
      if (!response.ok) return undefined;
      const body = await response.text();
      return body.slice(0, maxBytes);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  // Compatibility for the original draft; callers should use create and start separately.
  async createAndStart(args: { name: string; workflowId: number; fileKey: string; campaignSourceId?: string; dograhOrganizationId?: string }): Promise<DograhCampaign> {
    const created = await this.create({ name: args.name, workflowId: args.workflowId, fileKey: args.fileKey, dograhOrganizationId: args.dograhOrganizationId });
    return this.start(created.campaignId);
  }
}

export { MAX_CSV_BYTES };

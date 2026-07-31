import { z } from "zod";

const campaignSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    workflow_id: z.number().int().positive(),
    state: z.string(),
    source_id: z.string(),
    total_rows: z.number().int().nonnegative().nullable(),
    processed_rows: z.number().int().nonnegative(),
    failed_rows: z.number().int().nonnegative(),
  })
  .transform((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    workflowId: campaign.workflow_id,
    state: campaign.state,
    sourceId: campaign.source_id,
    totalRows: campaign.total_rows,
    processedRows: campaign.processed_rows,
    failedRows: campaign.failed_rows,
  }));

const progressSchema = z
  .object({
    campaign_id: z.number().int().positive(),
    state: z.string(),
    total_rows: z.number().int().nonnegative(),
    processed_rows: z.number().int().nonnegative(),
    failed_calls: z.number().int().nonnegative(),
    progress_percentage: z.number().min(0).max(100),
  })
  .transform((progress) => ({
    campaignId: progress.campaign_id,
    state: progress.state,
    totalRows: progress.total_rows,
    processedRows: progress.processed_rows,
    failedCalls: progress.failed_calls,
    progressPercentage: progress.progress_percentage,
  }));

const uploadSchema = z.object({
  upload_url: z.url(),
  file_key: z.string().min(1),
  expires_in: z.number().int().positive(),
});

export class DograhClient {
  readonly #baseUrl: string;
  readonly #apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#apiKey = apiKey;
  }

  async #request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.#baseUrl}/api/v1${path}`, {
      ...init,
      headers: {
        "X-API-Key": this.#apiKey,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`Dograh request failed with status ${response.status}`);
    }
    return schema.parse(await response.json());
  }

  async uploadCampaignCsv(fileName: string, csv: string): Promise<string> {
    const upload = await this.#request("/s3/presigned-upload-url", uploadSchema, {
      method: "POST",
      body: JSON.stringify({
        file_name: fileName,
        file_size: new TextEncoder().encode(csv).byteLength,
        content_type: "text/csv",
      }),
    });
    const response = await fetch(upload.upload_url, {
      method: "PUT",
      headers: { "Content-Type": "text/csv" },
      body: csv,
    });
    if (!response.ok) {
      throw new Error(`Dograh CSV upload failed with status ${response.status}`);
    }
    return upload.file_key;
  }

  createCampaign(input: { name: string; workflowId: number; sourceId: string }) {
    return this.#request("/campaign/create", campaignSchema, {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        workflow_id: input.workflowId,
        source_type: "csv",
        source_id: input.sourceId,
      }),
    });
  }

  startCampaign(campaignId: number) {
    return this.#request(`/campaign/${campaignId}/start`, campaignSchema, { method: "POST" });
  }

  pauseCampaign(campaignId: number) {
    return this.#request(`/campaign/${campaignId}/pause`, campaignSchema, { method: "POST" });
  }

  resumeCampaign(campaignId: number) {
    return this.#request(`/campaign/${campaignId}/resume`, campaignSchema, { method: "POST" });
  }

  getCampaignProgress(campaignId: number) {
    return this.#request(`/campaign/${campaignId}/progress`, progressSchema);
  }
}

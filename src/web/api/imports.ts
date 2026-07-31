import { z } from "zod";

const importSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  valid: z.number().int().nonnegative(),
  blockedConsent: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  duplicate: z.number().int().nonnegative(),
});

const importBatchSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  filename: z.string(),
  defaultCallingCode: z.string(),
  status: z.enum(["staged", "committed", "approved", "rejected"]),
  summary: importSummarySchema,
  createdAt: z.iso.datetime(),
  committedAt: z.iso.datetime().nullable(),
  approvedAt: z.iso.datetime().nullable(),
});

const importPreviewSchema = importBatchSchema.extend({
  rows: z.array(
    z.object({
      id: z.number().int().positive(),
      batchId: z.uuid(),
      organizationId: z.uuid(),
      rowNumber: z.number().int().positive(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      email: z.string().nullable(),
      originalPhone: z.string(),
      normalizedPhone: z.string().nullable(),
      consentStatus: z.string().nullable(),
      classification: z.enum(["valid", "blocked_consent", "invalid", "duplicate"]),
      reason: z.string().nullable(),
    }),
  ),
});

export type ImportPreview = z.infer<typeof importPreviewSchema>;

export interface StageCsvInput {
  organizationId: string;
  filename: string;
  defaultCallingCode: string;
  csv: string;
}

export async function stageCsvForPreview(input: StageCsvInput, fetcher: typeof fetch = fetch) {
  const stagedResponse = await fetcher("/api/imports/stage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!stagedResponse.ok) {
    throw new Error("CSV could not be staged");
  }

  const batch = importBatchSchema.parse(await stagedResponse.json());
  const previewResponse = await fetcher(
    `/api/imports/${batch.id}?organizationId=${encodeURIComponent(input.organizationId)}`,
  );
  if (!previewResponse.ok) {
    throw new Error("Import preview could not be loaded");
  }

  return importPreviewSchema.parse(await previewResponse.json());
}

export async function changeImportStatus(
  batchId: string,
  organizationId: string,
  action: "commit" | "approve",
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(`/api/imports/${batchId}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
  if (!response.ok) {
    throw new Error(`Import could not be ${action === "commit" ? "committed" : "approved"}`);
  }

  return importBatchSchema.parse(await response.json());
}

import { describe, expect, it, vi } from "vitest";
import { changeImportStatus, stageCsvForPreview } from "../../../src/web/api/imports.js";

describe("imports API client", () => {
  it("stages CSV text and retrieves its persisted preview", async () => {
    const organizationId = "00000000-0000-4000-8000-000000000001";
    const batchId = "00000000-0000-4000-8000-000000000002";
    const batch = {
      id: batchId,
      organizationId,
      filename: "synthetic.csv",
      defaultCallingCode: "44",
      status: "staged",
      summary: { total: 1, valid: 1, blockedConsent: 0, invalid: 0, duplicate: 0 },
      createdAt: "2026-07-31T00:00:00.000Z",
      committedAt: null,
      approvedAt: null,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(batch), { status: 201 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...batch,
            rows: [
              {
                id: 1,
                batchId,
                organizationId,
                rowNumber: 2,
                firstName: "Ada",
                lastName: null,
                email: "ada@example.com",
                originalPhone: "07700 900123",
                normalizedPhone: "+447700900123",
                consentStatus: "yes",
                classification: "valid",
                reason: null,
              },
            ],
          }),
        ),
      );

    const preview = await stageCsvForPreview(
      { organizationId, filename: "synthetic.csv", defaultCallingCode: "44", csv: "csv" },
      fetcher,
    );

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/imports/stage",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `/api/imports/${batchId}?organizationId=${organizationId}`,
    );
    expect(preview.rows[0]).toMatchObject({ firstName: "Ada", classification: "valid" });
  });

  it("changes import state through an explicit tenant-scoped action", async () => {
    const organizationId = "00000000-0000-4000-8000-000000000001";
    const batchId = "00000000-0000-4000-8000-000000000002";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: batchId,
          organizationId,
          filename: "synthetic.csv",
          defaultCallingCode: "44",
          status: "committed",
          summary: { total: 1, valid: 1, blockedConsent: 0, invalid: 0, duplicate: 0 },
          createdAt: "2026-07-31T00:00:00.000Z",
          committedAt: "2026-07-31T00:01:00.000Z",
          approvedAt: null,
        }),
      ),
    );

    const batch = await changeImportStatus(batchId, organizationId, "commit", fetcher);

    expect(fetcher).toHaveBeenCalledWith(`/api/imports/${batchId}/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId }),
    });
    expect(batch.status).toBe("committed");
  });
});

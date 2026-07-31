// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportPreview } from "../../../src/web/api/imports.js";
import { ImportsPage } from "../../../src/web/pages/ImportsPage.js";

afterEach(cleanup);

const organizationId = "00000000-0000-4000-8000-000000000001";
const batchId = "00000000-0000-4000-8000-000000000002";
const preview: ImportPreview = {
  id: batchId,
  organizationId,
  filename: "synthetic.csv",
  defaultCallingCode: "44",
  status: "staged",
  summary: { total: 3, valid: 1, blockedConsent: 1, invalid: 1, duplicate: 0 },
  createdAt: "2026-07-31T00:00:00.000Z",
  committedAt: null,
  approvedAt: null,
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
};

describe("Imports page", () => {
  it("stages a preview and requires commit before approval", async () => {
    const user = userEvent.setup();
    const stageForPreview = vi.fn().mockResolvedValue(preview);
    const changeStatus = vi
      .fn()
      .mockResolvedValueOnce({
        ...preview,
        status: "committed",
        committedAt: "2026-07-31T00:01:00.000Z",
      })
      .mockResolvedValueOnce({
        ...preview,
        status: "approved",
        committedAt: "2026-07-31T00:01:00.000Z",
        approvedAt: "2026-07-31T00:02:00.000Z",
      });
    render(
      <ImportsPage
        organizationId={organizationId}
        stageForPreview={stageForPreview}
        changeStatus={changeStatus}
        readFile={async () => "synthetic csv"}
      />,
    );

    await user.upload(
      screen.getByLabelText("CSV file"),
      new File(["synthetic csv"], "synthetic.csv", { type: "text/csv" }),
    );
    await user.click(screen.getByRole("button", { name: "Stage preview" }));

    await waitFor(() => expect(stageForPreview).toHaveBeenCalled());
    expect(stageForPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        filename: "synthetic.csv",
        defaultCallingCode: "44",
        csv: "synthetic csv",
      }),
    );
    expect(screen.getByText("1 ready")).toBeInTheDocument();
    expect(screen.getByText("1 consent blocked")).toBeInTheDocument();
    expect(screen.getByText("1 invalid")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Commit import" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Approve import" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Approve import" }));

    await waitFor(() => expect(screen.getByText("Approved")).toBeInTheDocument());
    expect(changeStatus).toHaveBeenNthCalledWith(1, batchId, organizationId, "commit");
    expect(changeStatus).toHaveBeenNthCalledWith(2, batchId, organizationId, "approve");
  });
});

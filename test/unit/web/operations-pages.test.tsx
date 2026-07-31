/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AttentionPage } from "../../../src/web/pages/AttentionPage.js";
import { DeliveriesPage } from "../../../src/web/pages/DeliveriesPage.js";
import { LeadTracePage } from "../../../src/web/pages/LeadTracePage.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const providerRunId = "00000000-0000-4000-8000-000000000002";
const deliveryId = "00000000-0000-4000-8000-000000000003";
const timestamp = "2026-07-31T09:00:00.000Z";

afterEach(cleanup);

describe("operations pages", () => {
  it("renders a correlated lead timeline", async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/leads?")) {
        return new Response(
          JSON.stringify([
            {
              id: 1,
              displayName: "Ada Lovelace",
              phone: "+447700900123",
              classification: "valid",
              providerState: "completed",
            },
          ]),
        );
      }
      return new Response(
        JSON.stringify({
          lead: {
            id: 1,
            displayName: "Ada Lovelace",
            phone: "+447700900123",
            email: "ada@example.test",
            classification: "valid",
            consentStatus: "yes",
          },
          runs: [
            {
              id: providerRunId,
              state: "completed",
              providerWorkflowRunId: "dograh-run",
              createdAt: timestamp,
              completedAt: timestamp,
            },
          ],
          deliveries: [],
          timeline: [
            {
              id: "event-1",
              component: "dograh",
              title: "Call completed",
              status: "completed",
              occurredAt: timestamp,
            },
          ],
        }),
      );
    };

    render(<LeadTracePage fetcher={fetcher as typeof fetch} organizationId={organizationId} />);

    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
    expect(screen.getByText("Call completed")).toBeVisible();
    expect(screen.getByText("dograh · completed")).toBeVisible();
  });

  it("shows exhausted CRM delivery state", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify([
          {
            id: deliveryId,
            type: "twenty.sync_call_outcome",
            status: "dead",
            attempts: 5,
            providerRunId,
            nextAttemptAt: timestamp,
            lastError: "operator detail",
            completedAt: null,
            createdAt: timestamp,
          },
        ]),
      );

    render(<DeliveriesPage fetcher={fetcher as typeof fetch} organizationId={organizationId} />);

    expect(await screen.findByText("Manual retry required")).toBeVisible();
    expect(screen.getByText("Twenty CRM")).toBeVisible();
  });

  it("shows owner-safe attention without provider errors", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify([
          {
            id: `delivery-${deliveryId}`,
            kind: "delivery_dead",
            title: "CRM update needs attention",
            summary: "The call outcome could not be saved after repeated attempts.",
            leadId: 1,
            retryable: true,
            occurredAt: timestamp,
          },
        ]),
      );

    render(<AttentionPage fetcher={fetcher as typeof fetch} organizationId={organizationId} />);

    expect(await screen.findByText("CRM update needs attention")).toBeVisible();
    expect(screen.getByText("Retry available")).toBeVisible();
    expect(screen.queryByText(/provider error/i)).not.toBeInTheDocument();
  });
});

/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { EventSourceLike } from "../../../src/web/api/event-stream.js";
import { App } from "../../../src/web/app/App.js";

afterEach(cleanup);

describe("workstation application shell", () => {
  it("separates owner and operator navigation without showing invented metrics", () => {
    render(<App />);

    expect(screen.getByRole("banner")).toHaveTextContent("Vectis");
    expect(screen.getByRole("navigation", { name: "Owner" })).toHaveTextContent("Overview");
    expect(screen.getByRole("navigation", { name: "Operator" })).toHaveTextContent(
      "Live Operations",
    );
    expect(screen.getByText("No operational data yet")).toBeVisible();
    expect(screen.queryByText(/99\.9%/)).not.toBeInTheDocument();
  });

  it("renders verified owner metrics and a recent call outcome", async () => {
    const user = userEvent.setup();
    const fetcher = async (input: RequestInfo | URL) => {
      if (!String(input).startsWith("/api/overview?"))
        return new Response("Not found", { status: 404 });
      return new Response(
        JSON.stringify({
          metrics: {
            totalLeads: 1,
            callsCompleted: 1,
            qualifiedLeads: 1,
            followUpsRequired: 1,
            crmSynced: 1,
          },
          recentOutcomes: [
            {
              leadId: 1,
              displayName: "Kabir",
              phone: "+918****7869",
              state: "completed",
              leadStatus: "qualified",
              disposition: "user_qualified",
              summary: "Kabir requested pricing and an evening callback.",
              followUpRequired: true,
              quoteRequested: true,
              completedAt: "2026-07-31T09:00:00.000Z",
            },
          ],
        }),
      );
    };

    render(
      <App
        organizationId="00000000-0000-4000-8000-000000000001"
        fetcher={fetcher as typeof fetch}
      />,
    );

    expect(
      await screen.findByText("Kabir requested pricing and an evening callback."),
    ).toBeVisible();
    expect(screen.getByText("Calls completed").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("Qualified leads").previousSibling).toHaveTextContent("1");
    expect(screen.getByText("Follow-ups needed").previousSibling).toHaveTextContent("1");
    const viewCall = screen.getByRole("button", { name: "View Kabir's call" });
    expect(viewCall).toBeEnabled();

    await user.click(viewCall);

    expect(await screen.findByRole("heading", { name: "Call Trace" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Call Trace" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens a useful leads page from owner navigation", async () => {
    const user = userEvent.setup();
    const fetcher = async (input: RequestInfo | URL) => {
      if (!String(input).startsWith("/api/leads?"))
        return new Response("Not found", { status: 404 });
      return new Response(
        JSON.stringify([
          {
            id: 1,
            displayName: "Kabir",
            phone: "+918****7869",
            classification: "valid",
            providerState: "completed",
            callSummary: "Kabir requested pricing and an evening callback.",
            leadStatus: "qualified",
            disposition: "user_qualified",
            followUpRequired: true,
            quoteRequested: true,
            completedAt: "2026-07-31T09:00:00.000Z",
          },
        ]),
      );
    };
    render(
      <App
        organizationId="00000000-0000-4000-8000-000000000001"
        fetcher={fetcher as typeof fetch}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Leads" }));

    expect(await screen.findByRole("heading", { name: "Leads" })).toBeVisible();
    expect(screen.getByText("Kabir requested pricing and an evening callback.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open Kabir's call trace" })).toBeEnabled();
  });

  it("opens campaign progress from owner navigation", async () => {
    const user = userEvent.setup();
    const fetcher = async () =>
      new Response(
        JSON.stringify([
          {
            id: "00000000-0000-4000-8000-000000000010",
            name: "Kabir Hair Transplant Pilot",
            status: "paused",
            workflowId: 1,
            providerCampaignId: 1,
            totalLeads: 1,
            processedCalls: 1,
            completedCalls: 1,
            failedCalls: 0,
            createdAt: "2026-07-31T08:55:00.000Z",
            approvedAt: "2026-07-31T08:56:00.000Z",
            startedAt: "2026-07-31T08:57:00.000Z",
          },
        ]),
      );
    render(
      <App
        organizationId="00000000-0000-4000-8000-000000000001"
        fetcher={fetcher as typeof fetch}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Campaigns" }));

    expect(await screen.findByRole("heading", { name: "Campaigns" })).toBeVisible();
    expect(screen.getByText("Kabir Hair Transplant Pilot")).toBeVisible();
    expect(screen.getByText("1 of 1 calls processed")).toBeVisible();
    expect(screen.getByText("No failed calls")).toBeVisible();
  });

  it("loads validated component health when Live Operations is selected", async () => {
    const user = userEvent.setup();
    const source: EventSourceLike = {
      onerror: null,
      onopen: null,
      addEventListener: () => undefined,
      close: () => undefined,
    };
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          components: [
            {
              id: 1,
              organizationId: "00000000-0000-4000-8000-000000000001",
              component: "database",
              status: "healthy",
              detail: "Connection accepted",
              latencyMs: 3,
              checkedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        }),
      );
    render(
      <App
        eventSourceFactory={() => source}
        organizationId="00000000-0000-4000-8000-000000000001"
        fetcher={fetcher as typeof fetch}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Live Operations" }));

    expect(await screen.findByRole("heading", { name: "Live Operations" })).toBeVisible();
    expect(await screen.findByText("Database")).toBeVisible();
    expect(screen.getByText("Healthy")).toBeVisible();

    await waitFor(() => expect(source.onopen).not.toBeNull());
    act(() => source.onopen?.());
    await waitFor(() => expect(screen.getByText("Connected")).toBeInTheDocument());
  });

  it("opens validated integration health from operator navigation", async () => {
    const user = userEvent.setup();
    const source: EventSourceLike = {
      onerror: null,
      onopen: null,
      addEventListener: () => undefined,
      close: () => undefined,
    };
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          components: [
            {
              id: 1,
              organizationId: "00000000-0000-4000-8000-000000000001",
              component: "dograh",
              status: "healthy",
              detail: "Voice API responded in 12 ms",
              latencyMs: 12,
              checkedAt: "2026-07-31T09:00:00.000Z",
            },
            {
              id: 2,
              organizationId: "00000000-0000-4000-8000-000000000001",
              component: "twenty",
              status: "healthy",
              detail: "CRM worker connected",
              latencyMs: 18,
              checkedAt: "2026-07-31T09:00:00.000Z",
            },
          ],
        }),
      );
    render(
      <App
        eventSourceFactory={() => source}
        fetcher={fetcher as typeof fetch}
        organizationId="00000000-0000-4000-8000-000000000001"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Integrations" }));

    expect(await screen.findByRole("heading", { name: "Integrations" })).toBeVisible();
    expect(screen.getByText("Dograh")).toBeVisible();
    expect(screen.getByText("Twenty CRM")).toBeVisible();
    expect(screen.getByText("Dograh → Workstation → Twenty CRM")).toBeVisible();
  });

  it("opens the safe import workflow from operator navigation", async () => {
    const user = userEvent.setup();
    render(<App organizationId="00000000-0000-4000-8000-000000000001" />);

    await user.click(screen.getByRole("button", { name: "Imports" }));

    expect(screen.getByRole("heading", { name: "Imports" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stage preview" })).toBeDisabled();
  });
});

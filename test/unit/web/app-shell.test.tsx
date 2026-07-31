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

  it("opens the safe import workflow from operator navigation", async () => {
    const user = userEvent.setup();
    render(<App organizationId="00000000-0000-4000-8000-000000000001" />);

    await user.click(screen.getByRole("button", { name: "Imports" }));

    expect(screen.getByRole("heading", { name: "Imports" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stage preview" })).toBeDisabled();
  });
});

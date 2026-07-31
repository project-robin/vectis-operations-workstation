/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LiveOperationsPage } from "../../../src/web/pages/LiveOperationsPage.js";

const components = [
  {
    id: 1,
    organizationId: "00000000-0000-4000-8000-000000000001",
    component: "database",
    status: "healthy" as const,
    detail: "Connection accepted",
    latencyMs: 3,
    checkedAt: "2026-07-31T00:00:00.000Z",
  },
  {
    id: 2,
    organizationId: "00000000-0000-4000-8000-000000000001",
    component: "dograh",
    status: "down" as const,
    detail: "Probe timed out",
    latencyMs: 5000,
    checkedAt: "2026-07-31T00:00:01.000Z",
  },
];

afterEach(cleanup);

describe("Live Operations page", () => {
  it("shows real component states and a disconnected warning", () => {
    render(<LiveOperationsPage components={components} streamState="disconnected" />);

    expect(screen.getByRole("heading", { name: "Live Operations" })).toBeVisible();
    expect(screen.getByText("Database")).toBeVisible();
    expect(screen.getByText("Dograh")).toBeVisible();
    expect(screen.getByText("Healthy")).toBeVisible();
    expect(screen.getByText("Down")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Live updates disconnected");
  });
});

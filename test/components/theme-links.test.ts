import "@testing-library/jest-dom/vitest";
import { Link } from "@astryxdesign/core/Link";
import { cleanup, render, screen } from "@testing-library/react";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { VectisThemeProvider } from "@/components/providers/VectisThemeProvider";

// Astryx falls back to a native <a> without a LinkProvider, which turns every
// sidebar click into a full reload (Clerk + Convex re-auth on each page).
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { ...rest, href, "data-next-link": "true" }, children),
}));

afterEach(cleanup);

test("Astryx links navigate through next/link", () => {
  render(
    createElement(
      VectisThemeProvider,
      null,
      createElement(Link, { href: "/calls" } as ComponentProps<typeof Link>, "Calls"),
    ),
  );
  expect(screen.getByRole("link", { name: "Calls" })).toHaveAttribute("data-next-link", "true");
});

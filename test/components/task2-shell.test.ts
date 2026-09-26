import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  probeCount: 0,
  recordProbe: vi.fn().mockResolvedValue("probe-id"),
  auth: { isLoading: false, isAuthenticated: true, isRefreshing: false },
}));

vi.mock("convex/react", () => ({
  ConvexReactClient: class ConvexReactClient {
    constructor(public url: string) {}
  },
  useConvexAuth: () => state.auth,
  useMutation: () => state.recordProbe,
  useQuery: () => state.probeCount,
}));

vi.mock("convex/react-clerk", () => ({
  ConvexProviderWithClerk: ({ children }: { children: ReactNode }) =>
    createElement("div", { "data-testid": "convex-provider" }, children),
}));

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) =>
    createElement("div", { "data-testid": "clerk-provider" }, children),
  UserButton: () => createElement("span", null, "user"),
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    getToken: async () => "task2-token",
  }),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

afterEach(cleanup);

beforeEach(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://task2.convex.cloud";
  state.probeCount = 0;
  state.recordProbe.mockClear();
  state.auth = { isLoading: false, isAuthenticated: true, isRefreshing: false };
});

test("ClerkProvider contains ConvexProviderWithClerk", async () => {
  const { default: RootLayout } = await import("@/app/layout");
  const { ConvexClientProvider } = await import("@/components/providers/ConvexClientProvider");
  const tree = RootLayout({ children: createElement("p", null, "shell") });
  const html = tree.props.children;
  const body = html.props.children;
  const convex = body.props.children;
  expect(convex.type).toBe(ConvexClientProvider);
  expect(body.props.children).toBe(convex);
});

test("authenticated Convex auth state is rendered", async () => {
  const { AuthState } = await import("@/components/AuthState");
  render(createElement(AuthState));
  expect(screen.getByRole("status")).toHaveTextContent("Convex auth: authenticated");
});

test("reactive Convex query value is rendered in the component unit seam", async () => {
  const { ProbeCount } = await import("@/components/ProbeCount");
  const view = render(createElement(ProbeCount));
  expect(view.getByRole("status")).toHaveTextContent("Probes: 0");
  state.probeCount = 2;
  view.rerender(createElement(ProbeCount));
  expect(view.getByRole("status")).toHaveTextContent("Probes: 2");
});

test("the reactive component exposes a mutation that the protected lane can exercise", async () => {
  const { ProbeCount } = await import("@/components/ProbeCount");
  render(createElement(ProbeCount));

  await userEvent.setup().click(screen.getByRole("button", { name: "Record probe" }));

  expect(state.recordProbe).toHaveBeenCalledWith({ label: "shell" });
});

test("the application page renders the reactive component through its provider tree (unit seam)", async () => {
  const { ClerkProvider } = await import("@clerk/nextjs");
  const { default: Home } = await import("@/app/(workspace)/page");
  const { ConvexClientProvider } = await import("@/components/providers/ConvexClientProvider");

  render(
    createElement(
      ClerkProvider,
      null,
      createElement(ConvexClientProvider, null, createElement(Home)),
    ),
  );
  expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Quick Call" })).toHaveAttribute("href", "/quick-call");
});

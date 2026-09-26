import { beforeEach, expect, test, vi } from "vitest";

const clerk = vi.hoisted(() => ({
  clerkMiddleware: (handler: unknown) => handler,
  createRouteMatcher: (patterns: string[]) => (request: { nextUrl: { pathname: string } }) =>
    patterns.some((pattern) => {
      if (pattern === "/(api|trpc)(.*)") {
        return /^\/(api|trpc)(\/|$)/.test(request.nextUrl.pathname);
      }
      const prefix = pattern.replace("(.*)", "");
      return request.nextUrl.pathname === prefix || request.nextUrl.pathname.startsWith(`${prefix}/`);
    }),
}));

vi.mock("@clerk/nextjs/server", () => clerk);

const requestFor = (pathname: string) => ({ nextUrl: { pathname } });

test("protects every application page and private API", async () => {
  const { default: middleware } = await import("@/middleware");
  const protect = vi.fn();
  const runMiddleware = middleware as unknown as (
    auth: { protect: () => void },
    request: { nextUrl: { pathname: string } },
  ) => Promise<void>;

  for (const path of ["/", "/leads", "/calls/abc", "/quick-call", "/settings", "/api/private", "/trpc/query"]) {
    await runMiddleware({ protect }, requestFor(path));
  }

  expect(protect).toHaveBeenCalledTimes(7);
});

test("leaves sign-in, sign-up, and health paths public", async () => {
  const { default: middleware, config } = await import("@/middleware");
  const protect = vi.fn();
  const runMiddleware = middleware as unknown as (
    auth: { protect: () => void },
    request: { nextUrl: { pathname: string } },
  ) => Promise<void>;

  for (const path of ["/sign-in", "/sign-in/factor-one", "/sign-up", "/api/health"]) {
    await runMiddleware({ protect }, requestFor(path));
  }

  expect(protect).not.toHaveBeenCalled();
  expect(config.matcher).toContain("/(api|trpc)(.*)");
});

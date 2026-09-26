import { expect, test } from "@playwright/test";

// The synthetic lane runs with fake Clerk keys, so no browser can finish the
// Clerk handshake here. It proves the server boots and that every workspace
// route sits behind Clerk middleware. Signed-in UI flows run in the protected
// lane (test/protected) against real Clerk + Convex.

const workspaceRoutes = [
  "/",
  "/onboarding",
  "/quick-call",
  "/calls",
  "/calls/synthetic-call",
  "/leads",
  "/campaigns",
  "/home",
  "/customers",
  "/customers/synthetic-customer",
  "/conversations",
  "/conversations/synthetic-conversation",
  "/tasks",
  "/agents",
  "/analytics",
  "/settings",
  "/workstation",
  "/operations/live-operations",
  "/operations/imports",
  "/operations/campaigns",
  "/operations/deliveries",
  "/operations/integrations",
  "/operations/audit",
];

const documentRequest = { accept: "text/html", "sec-fetch-dest": "document" };

test("the public sign-in route renders the Vectis brand", async ({ request }) => {
  const response = await request.get("/sign-in");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("Vectis — AI Receptionist");
});

test("anonymous page loads of workspace routes are sent to Clerk to sign in", async ({
  request,
}) => {
  test.slow();
  for (const route of workspaceRoutes) {
    const response = await request.get(route, { headers: documentRequest, maxRedirects: 0 });
    expect(response.status(), route).toBe(307);
    // Depending on Clerk's dev-browser cookie and configured sign-in URL, this is
    // the Clerk handshake, Clerk's hosted sign-in, or the app's own /sign-in.
    const location = new URL(response.headers().location ?? "", response.url());
    expect(location.pathname, route).toMatch(/\/v1\/client\/handshake$|\/sign-in$/);
    expect(location.searchParams.get("redirect_url"), route).toMatch(new RegExp(`:\\d+${route}$`));
  }
});

test("anonymous data requests to workspace routes never receive the workstation", async ({
  request,
}) => {
  test.slow();
  for (const route of workspaceRoutes) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status(), route).toBe(404);
    expect(await response.text(), route).not.toContain("Side navigation");
  }
});

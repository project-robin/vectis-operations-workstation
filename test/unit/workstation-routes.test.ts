import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const routes = [
  "home",
  "customers",
  "conversations",
  "tasks",
  "agents",
  "analytics",
  "operations/imports",
  "operations/campaigns",
  "operations/deliveries",
  "operations/integrations",
  "operations/live-operations",
  "operations/audit",
];

const workspace = join(process.cwd(), "app", "(workspace)");

test("workspace routes share one shell layout", () => {
  expect(readFileSync(join(workspace, "layout.tsx"), "utf8")).toContain("WorkstationShell");
});

test.each(routes)("has a browser route for /%s", (route) => {
  expect(existsSync(join(workspace, route, "page.tsx"))).toBe(true);
});

test.each(["quick-call", "leads", "calls", "calls/[callId]", "campaigns", "settings", "onboarding"])("has a calling console route for /%s", (route) => {
  expect(existsSync(join(workspace, route, "page.tsx"))).toBe(true);
});

test("the root renders the owner dashboard and not the developer probe", () => {
  const source = readFileSync(join(workspace, "page.tsx"), "utf8");
  expect(source).toContain("DashboardPage");
  expect(source).not.toContain("ProbeCount");
  expect(source).not.toContain("Record probe");
});

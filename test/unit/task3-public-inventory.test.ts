import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const publicFunctions = {
  users: { getCurrent: "query" },
  organizations: { addMember: "mutation", getCurrent: "query" },
  toolchain: {
    probeCount: "query",
    recordProbe: "mutation",
    removeProbe: "mutation",
    scheduleEcho: "mutation",
  },
} as const;

test("Task 2/3 public Convex surface is explicit and has no bootstrap facade", () => {
  for (const [moduleName, expected] of Object.entries(publicFunctions)) {
    const source = readFileSync(join(process.cwd(), "convex", `${moduleName}.ts`), "utf8");
    const found = Object.fromEntries(
      [...source.matchAll(/export const (\w+) = (query|mutation|action)\s*\(/g)].map((match) => [match[1], match[2]]),
    );
    expect(found, moduleName).toEqual(expected);
  }

  expect(existsSync(join(process.cwd(), "convex", "tenancy.ts"))).toBe(false);
  for (const moduleName of ["users", "organizations"]) {
    const source = readFileSync(join(process.cwd(), "convex", `${moduleName}.ts`), "utf8");
    expect(source).not.toMatch(/ensureUser|updateProfile|bootstrapOrganization/);
  }
});

test("Task 2/3 identity lifecycle writers are internal or signed HTTP only", () => {
  const webhook = readFileSync(join(process.cwd(), "convex", "http", "clerkWebhook.ts"), "utf8");
  expect(webhook).toContain("verifyWebhook");
  expect(webhook).toContain("export const processEvent = internalMutation");
  expect(webhook).toContain("export const handle = httpAction");
  expect(readFileSync(join(process.cwd(), "convex", "nodeActions.ts"), "utf8")).toContain(
    "export const fetchText = internalAction",
  );
});

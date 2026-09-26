import { ConvexHttpClient } from "convex/browser";
import { expect, test } from "@playwright/test";
import type { Browser } from "@playwright/test";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const fixtureKeys = [
  "TASK3_PROTECTED_DISPOSABLE_TENANT",
  "TASK3_PROTECTED_FIXTURE_ORGANIZATION_ID",
  "TASK3_PROTECTED_CROSS_TENANT_ORGANIZATION_ID",
  "TASK3_PROTECTED_OWNER_CLERK_ID",
  "TASK3_PROTECTED_OPERATOR_CLERK_ID",
  "TASK3_PROTECTED_STAFF_CLERK_ID",
  "TASK3_PROTECTED_OWNER_ROLE",
  "TASK3_PROTECTED_OPERATOR_ROLE",
  "TASK3_PROTECTED_STAFF_ROLE",
  "TASK3_PROTECTED_OWNER_STORAGE_STATE",
  "TASK3_PROTECTED_OPERATOR_STORAGE_STATE",
  "TASK3_PROTECTED_STAFF_STORAGE_STATE",
  "TASK3_PROTECTED_CROSS_TENANT_STORAGE_STATE",
] as const;

const fixtureReady =
  process.env.TASK3_PROTECTED_DISPOSABLE_TENANT === "1" &&
  fixtureKeys.every((name) => Boolean(process.env[name]));

test.describe("protected Task 3 tenant and role boundary", () => {
  test.skip(
    !fixtureReady,
    "Task 3 live verification is blocked: configure all explicit disposable fixture IDs, roles, and session states.",
  );
  test.describe.configure({ mode: "serial" });

  async function openClient(browser: Browser, role: "OWNER" | "OPERATOR" | "STAFF") {
    const page = await browser.newPage({ storageState: process.env[`TASK3_PROTECTED_${role}_STORAGE_STATE`] });
    await page.goto("/workstation");
    await expect(page.getByText("Convex auth: authenticated")).toBeVisible();
    const token = await page.evaluate(async () => {
      const clerk = (window as typeof window & { Clerk?: { session?: { getToken: () => Promise<string> } } }).Clerk;
      return clerk?.session?.getToken() ?? null;
    });
    if (!token) throw new Error("Authenticated Clerk browser session did not expose a session token");
    const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL as string);
    client.setAuth(token);
    return { page, client };
  }

  test("explicit owner/operator/staff fixtures resolve their authoritative roles", async ({ browser }) => {
    const expected = {
      OWNER: [process.env.TASK3_PROTECTED_OWNER_CLERK_ID, process.env.TASK3_PROTECTED_OWNER_ROLE],
      OPERATOR: [process.env.TASK3_PROTECTED_OPERATOR_CLERK_ID, process.env.TASK3_PROTECTED_OPERATOR_ROLE],
      STAFF: [process.env.TASK3_PROTECTED_STAFF_CLERK_ID, process.env.TASK3_PROTECTED_STAFF_ROLE],
    } as const;
    for (const role of ["OWNER", "OPERATOR", "STAFF"] as const) {
      const { page, client } = await openClient(browser, role);
      try {
        await expect(client.query(api.users.getCurrent, {})).resolves.toMatchObject({ clerkId: expected[role][0] });
        await expect(client.query(api.organizations.getCurrent, {})).resolves.toMatchObject({
          organizationId: process.env.TASK3_PROTECTED_FIXTURE_ORGANIZATION_ID,
          role: expected[role][1],
        });
      } finally {
        await page.close();
      }
    }
  });

  test("staff and operator cannot operate while owner can use and clean up a probe", async ({ browser }) => {
    const owner = await openClient(browser, "OWNER");
    const operator = await openClient(browser, "OPERATOR");
    const staff = await openClient(browser, "STAFF");
    let probeId: Id<"toolchainProbes"> | undefined;
    let operatorProbeId: Id<"toolchainProbes"> | undefined;
    try {
      await expect(staff.client.mutation(api.toolchain.recordProbe, { label: "task3-staff-denied" })).rejects.toThrow();
      operatorProbeId = (await operator.client.mutation(api.toolchain.recordProbe, { label: "task3-operator-allowed" })) as Id<"toolchainProbes">;
      probeId = (await owner.client.mutation(api.toolchain.recordProbe, { label: "task3-owner-allowed" })) as Id<"toolchainProbes">;
    } finally {
      if (probeId) await owner.client.mutation(api.toolchain.removeProbe, { probeId });
      if (operatorProbeId) await operator.client.mutation(api.toolchain.removeProbe, { probeId: operatorProbeId });
      await Promise.all([owner.page.close(), operator.page.close(), staff.page.close()]);
    }
  });

  test("a cross-tenant browser session cannot remove a disposable tenant's resource", async ({ browser }) => {
    const owner = await openClient(browser, "OWNER");
    const crossTenant = await browser.newPage({
      storageState: process.env.TASK3_PROTECTED_CROSS_TENANT_STORAGE_STATE,
    });
    await crossTenant.goto("/workstation");
    await expect(crossTenant.getByText("Convex auth: authenticated")).toBeVisible();
    const token = await crossTenant.evaluate(async () => {
      const clerk = (window as typeof window & { Clerk?: { session?: { getToken: () => Promise<string> } } }).Clerk;
      return clerk?.session?.getToken() ?? null;
    });
    if (!token) throw new Error("Cross-tenant Clerk browser session did not expose a session token");
    const other = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL as string);
    other.setAuth(token);
    let probeId: Id<"toolchainProbes"> | undefined;
    try {
      await expect(other.query(api.organizations.getCurrent, {})).resolves.toMatchObject({
        organizationId: process.env.TASK3_PROTECTED_CROSS_TENANT_ORGANIZATION_ID,
      });
      probeId = (await owner.client.mutation(api.toolchain.recordProbe, { label: "task3-cross-tenant" })) as Id<"toolchainProbes">;
      if (probeId) {
        await expect(other.mutation(api.toolchain.removeProbe, { probeId })).rejects.toThrow();
      }
    } finally {
      if (probeId) await owner.client.mutation(api.toolchain.removeProbe, { probeId });
      await Promise.all([owner.page.close(), crossTenant.close()]);
    }
  });
});

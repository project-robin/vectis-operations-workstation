import { expect, test } from "@playwright/test";

const ownerRoutes = ["/home", "/customers", "/conversations", "/tasks", "/agents", "/analytics"];
const operationRoutes = [
  "/operations/imports",
  "/operations/campaigns",
  "/operations/deliveries",
  "/operations/integrations",
  "/operations/live-operations",
  "/operations/audit",
];

test("root is the Vectis workstation home", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Vectis today" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Customers" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /ask vectis/i })).toBeVisible();
  await expect(page.getByText(/commercial evidence required/i)).toBeVisible();
  await expect(page.getByText(/ProbeCount|Record probe/i)).toHaveCount(0);
});

test("all owner and operations destinations are navigable", async ({ page }) => {
  test.slow();
  for (const route of [...ownerRoutes, ...operationRoutes]) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByRole("link", { name: "Home" })).toBeVisible();
  }
});

test("operations drawer and mobile navigation have usable controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/customers");
  await page.getByRole("button", { name: /operations/i }).click();
  await expect(page.getByRole("link", { name: "Imports" })).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow-x", "hidden");
});

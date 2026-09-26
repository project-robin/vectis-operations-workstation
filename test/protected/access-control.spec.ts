import { expect, test } from "@playwright/test";

test("unauthenticated browsers cannot open the workstation", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto("/workstation");
    await expect(page).toHaveURL(/\/sign-in/);
  } finally {
    await context.close();
  }
});

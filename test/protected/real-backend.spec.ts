import { expect, test } from "@playwright/test";

function countFromStatus(text: string | null): number {
  const match = text?.match(/^Probes: (\d+)$/);
  if (!match) throw new Error(`Expected a numeric probe status, received: ${text ?? "<none>"}`);
  return Number(match[1]);
}

test("real Clerk auth reaches Convex and the reactive subscription updates", async ({ page }) => {
  await page.goto("/workstation");
  await expect(page.getByText("Convex auth: authenticated")).toBeVisible();

  const status = page.getByRole("status").filter({ hasText: /^Probes: \d+$/ });
  const before = countFromStatus(await status.textContent());
  const record = page.getByRole("button", { name: "Record probe" });
  try {
    await record.click();
    await expect.poll(async () => countFromStatus(await status.textContent())).toBe(before + 1);
  } finally {
    const remove = page.getByRole("button", { name: "Remove probe" });
    if (await remove.isVisible()) {
      await remove.click();
      await expect(remove).toBeHidden();
      await expect.poll(async () => countFromStatus(await status.textContent())).toBe(before);
    }
  }
});

test("real Convex HTTP action serves the ping contract", async ({ request }) => {
  const response = await request.get(process.env.TASK2_PROTECTED_HTTP_URL as string);
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    service: "vectis-workstation-convex",
  });
});

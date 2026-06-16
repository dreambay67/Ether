import { expect, test } from "@playwright/test";

test("renders the branded Ether shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "ETHER" })).toBeVisible();
  await expect(page.getByText("by DreamBay")).toBeVisible();
  await expect(page.getByLabel("Node Library")).toBeVisible();
  await expect(page.getByLabel("Inspector")).toBeVisible();
  await expect(page.getByLabel("Run Trace")).toBeVisible();
});

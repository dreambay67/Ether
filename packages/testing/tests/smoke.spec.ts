import { expect, test } from "@playwright/test";

test("renders the branded Ether shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("ETHER")).toBeVisible();
  await expect(page.getByText("by DreamBay")).toBeVisible();
  await expect(page.getByText("Node Library")).toBeVisible();
  await expect(page.getByText("Canvas", { exact: true })).toBeVisible();
  await expect(page.getByText("Inspector")).toBeVisible();
  await expect(page.getByText("Run Trace")).toBeVisible();
  await expect(page.getByText("Providers offline")).toBeVisible();
  await expect(page.getByTestId("panel-node-library")).toBeVisible();
  await expect(page.getByTestId("panel-inspector")).toBeVisible();
  await expect(page.getByTestId("panel-run-trace")).toBeVisible();
});

test("panels collapse, expand, and move", async ({ page }) => {
  await page.goto("/");

  const nodeLibrary = page.getByTestId("panel-node-library");
  await expect(nodeLibrary.getByText("Prompt, reference, generate, evaluate")).toBeVisible();

  await page.getByRole("button", { name: "Collapse Node Library" }).click();
  await expect(nodeLibrary.getByText("Prompt, reference, generate, evaluate")).toBeHidden();

  await page.getByRole("button", { name: "Expand Node Library" }).click();
  await expect(nodeLibrary.getByText("Prompt, reference, generate, evaluate")).toBeVisible();

  const inspector = page.getByTestId("panel-inspector");
  const before = await inspector.boundingBox();
  if (!before) {
    throw new Error("Inspector panel was not measurable before drag");
  }

  await page.getByTestId("panel-inspector-drag").dragTo(page.getByLabel("Canvas"), {
    targetPosition: { x: 240, y: 120 }
  });

  const after = await inspector.boundingBox();
  if (!after) {
    throw new Error("Inspector panel was not measurable after drag");
  }

  expect(Math.abs(after.x - before.x)).toBeGreaterThan(20);
});

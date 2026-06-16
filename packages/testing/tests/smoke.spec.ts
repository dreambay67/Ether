import { expect, test } from "@playwright/test";

test("renders the React Flow canvas, library, inspector, run panel, and minimap", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("ETHER")).toBeVisible();
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect(page.locator(".react-flow__minimap")).toBeVisible();
  await expect(page.getByTestId("panel-node-library")).toBeVisible();
  await expect(page.getByTestId("panel-inspector")).toBeVisible();
  await expect(page.getByTestId("panel-run-trace")).toBeVisible();
  await expect(page.getByText("Providers offline")).toBeVisible();
});

test("creates a node from the library and selects it", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();

  await expect(page.getByTestId("ether-node")).toHaveCount(1);
  await expect(page.getByTestId("ether-node").getByRole("heading", { name: "General Prompt" })).toBeVisible();
  await expect(page.getByTestId("canvas-status")).toContainText("Selected General Prompt");
});

test("inspector edits selected node title and label", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();
  await page.getByTestId("inspector-node-title").fill("Campaign spine");
  await page.getByTestId("inspector-node-label").fill("Launch prompt");

  await expect(page.getByTestId("ether-node").getByRole("heading", { name: "Campaign spine" })).toBeVisible();
  await expect(page.getByTestId("ether-node").getByText("Launch prompt")).toBeVisible();
});

test("creates an edge and edits the visible edge label", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();

  await expect(page.getByText("prompt", { exact: true })).toBeVisible();
  await page.getByTestId("inspector-edge-label").fill("brief");
  await expect(page.getByText("brief", { exact: true })).toBeVisible();
});

test("Delete key removes the selected node", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();
  await expect(page.getByTestId("ether-node")).toHaveCount(1);

  await page.keyboard.press("Delete");

  await expect(page.getByTestId("ether-node")).toHaveCount(0);
});

test("undo and redo restore and remove a node", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();
  await expect(page.getByTestId("ether-node")).toHaveCount(1);

  await page.getByTestId("canvas-undo").click();
  await expect(page.getByTestId("ether-node")).toHaveCount(0);

  await page.getByTestId("canvas-redo").click();
  await expect(page.getByTestId("ether-node")).toHaveCount(1);
});

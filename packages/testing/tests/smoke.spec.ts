import { type Locator, expect, test } from "@playwright/test";

const expectPanelWithinWorkspace = async (panel: Locator, workspace: Locator) => {
  const panelBox = await panel.boundingBox();
  const workspaceBox = await workspace.boundingBox();

  if (!panelBox || !workspaceBox) {
    throw new Error("Panel or workspace bounds were not measurable");
  }

  expect(panelBox.x).toBeGreaterThanOrEqual(workspaceBox.x);
  expect(panelBox.y).toBeGreaterThanOrEqual(workspaceBox.y);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(workspaceBox.x + workspaceBox.width + 1);
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(workspaceBox.y + workspaceBox.height + 1);
};

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

  const dragHandle = await page.getByTestId("panel-inspector-drag").boundingBox();
  if (!dragHandle) {
    throw new Error("Inspector drag handle was not measurable");
  }

  await page.mouse.move(dragHandle.x + 20, dragHandle.y + 20);
  await page.mouse.down();
  await page.mouse.move(dragHandle.x - 180, dragHandle.y + 120);
  await page.mouse.up();

  const after = await inspector.boundingBox();
  if (!after) {
    throw new Error("Inspector panel was not measurable after drag");
  }

  expect(Math.abs(after.x - before.x)).toBeGreaterThan(20);
});

test("floating panels stay inside the workspace at the minimum viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1120, height: 720 });
  await page.goto("/");

  const workspace = page.getByLabel("ETHER by DreamBay workspace");

  await expectPanelWithinWorkspace(page.getByTestId("panel-node-library"), workspace);
  await expectPanelWithinWorkspace(page.getByTestId("panel-inspector"), workspace);
  await expectPanelWithinWorkspace(page.getByTestId("panel-run-trace"), workspace);
});

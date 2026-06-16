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

test("disables reference upload until a project is open", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Link reference image" })).toBeDisabled();
  await expect(page.getByTestId("canvas-status")).toContainText("Open a project to link references");
});

test("inspector edits selected node title and label", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();
  await page.getByTestId("inspector-node-title").fill("Campaign spine");
  await page.getByTestId("inspector-node-label").fill("Launch prompt");

  await expect(page.getByTestId("ether-node").getByRole("heading", { name: "Campaign spine" })).toBeVisible();
  await expect(page.getByTestId("ether-node").getByText("Launch prompt")).toBeVisible();
});

test("selected prompt node shows contract summary and assembled preview", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();

  await expect(page.getByTestId("inspector-contract")).toContainText("Assemble Prompt");
  await expect(page.getByTestId("inspector-contract")).toContainText("Outputs");
  await expect(page.getByTestId("inspector-assembly-preview")).toContainText(
    "General prompt placeholder"
  );
});

test("assembling a prompt node freezes a local prompt artifact", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();
  await page.getByLabel("Instruction").fill("hero bottle on reflective glass");
  await page.getByTestId("inspector-run-node").click();

  await expect(page.getByTestId("canvas-status")).toContainText("Assembled General Prompt");
  await expect(page.getByTestId("panel-run-trace")).toContainText("Assembled General Prompt");
  await expect(page.getByTestId("inspector-assembly-preview")).toContainText("Frozen");
});

test("generation node previews prompt inputs from a connected prompt", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();
  await page.getByLabel("Instruction").fill("cinematic skincare campaign");
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();
  await page.getByTestId("ether-node").getByRole("heading", { name: "Image" }).click();

  await expect(page.getByTestId("inspector-assembly-preview")).toContainText(
    "Prepared Generation Inputs"
  );
  await expect(page.getByTestId("inspector-assembly-preview")).toContainText(
    "cinematic skincare campaign"
  );
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

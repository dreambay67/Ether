import { expect, test, type Page } from "@playwright/test";

test("Build, Focus, Run, and Review retain accessible adaptive shell controls", async ({ page }) => {
  await openShell(page);

  for (const workspace of ["Build", "Focus", "Run", "Review"]) {
    await page.getByRole("button", { name: workspace, exact: true }).click();
    await expect(page.locator(".adaptive-workspace")).toHaveAttribute("data-workspace", workspace.toLowerCase());
  }

  for (const panel of ["tools", "inspector", "artifacts", "runs"]) {
    await expect(page.getByTestId(`pane-${panel}`)).toBeVisible();
  }

  await page.getByRole("button", { name: "Build", exact: true }).click();
  await expect(page.locator(".adaptive-workspace")).toHaveAttribute("data-workspace", "build");
  await page.getByRole("button", { name: "Hide Build tools" }).click();
  await expect(page.getByRole("button", { name: "Show Build tools" })).toBeVisible();
  await page.getByRole("button", { name: "Show Build tools" }).click();

  const before = await page.getByTestId("pane-tools").evaluate((element) => element.getBoundingClientRect().width);
  await page.getByRole("separator", { name: "Resize Build tools" }).focus();
  await page.keyboard.press("ArrowRight");
  const after = await page.getByTestId("pane-tools").evaluate((element) => element.getBoundingClientRect().width);
  expect(after).toBeGreaterThan(before);

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.locator(".adaptive-workspace")).toHaveAttribute("data-workspace", "run");
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await expect(page.locator(".adaptive-workspace")).toHaveAttribute("data-workspace", "build");
  await expect(page.getByTestId("pane-tools")).toHaveCSS("width", `${Math.round(after)}px`);
  await page.reload();
  await expect(page.getByTestId("pane-tools")).toHaveCSS("width", `${Math.round(after)}px`);
});

test("keeps the canvas dominant, with its minimap inside its bounds at presentation widths", async ({ page }) => {
  await openShell(page);

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
      const canvas = rect("[data-testid=document-canvas]");
      const tools = rect("[data-testid=pane-tools]");
      const inspector = rect("[data-testid=pane-inspector]");
      const artifacts = rect("[data-testid=pane-artifacts]");
      const minimap = rect(".react-flow__minimap");
      if (!canvas || !tools || !inspector || !artifacts || !minimap) throw new Error("Shell geometry was unavailable");
      return { canvas, tools, inspector, artifacts, minimap };
    });
    expect(layout.canvas.width).toBeGreaterThan(layout.tools.width);
    expect(layout.canvas.width).toBeGreaterThan(layout.inspector.width);
    expect(layout.canvas.height).toBeGreaterThan(layout.artifacts.height);
    expect(layout.minimap.left).toBeGreaterThanOrEqual(layout.canvas.left);
    expect(layout.minimap.right).toBeLessThanOrEqual(layout.canvas.right + 1);
    expect(layout.minimap.bottom).toBeLessThanOrEqual(layout.canvas.bottom + 1);
    await page.screenshot({ path: `../../test-results/phase3-shell-${viewport.width}x${viewport.height}.png` });
  }

  await page.setViewportSize({ width: 760, height: 720 });
  const buttons = await page.locator(".workspace-switcher button").evaluateAll((items) => items.map((item) => {
    const bounds = item.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  }));
  expect(buttons.every((button) => button.width > 44 && button.height < 42)).toBeTruthy();

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
  await expect(page.getByTestId("document-canvas")).toBeVisible();
  await page.screenshot({ path: "../../test-results/phase3-shell-150-percent.png" });
});

test("bounds all four pane directions so resizing cannot starve the canvas", async ({ page }) => {
  await openShell(page);
  await page.setViewportSize({ width: 1280, height: 720 });

  const showReferenceDesk = page.getByRole("button", { name: "Show Reference Desk" });
  if (await showReferenceDesk.count()) await showReferenceDesk.click();
  await page.getByRole("button", { name: "Show Run desk" }).click();
  const resize = async (label: string, key: string) => {
    const separator = page.getByRole("separator", { name: `Resize ${label}` });
    await separator.focus();
    for (let index = 0; index < 8; index += 1) await page.keyboard.press(`Shift+${key}`);
  };
  await resize("Build tools", "ArrowRight");
  await resize("Project lens", "ArrowLeft");
  await resize("Reference Desk", "ArrowDown");
  await resize("Run desk", "ArrowUp");

  const layout = await page.evaluate(() => {
    const rect = (testId: string) => document.querySelector(`[data-testid=${testId}]`)?.getBoundingClientRect();
    const canvas = rect("document-canvas");
    const tools = rect("pane-tools");
    const inspector = rect("pane-inspector");
    const artifacts = rect("pane-artifacts");
    const runs = rect("pane-runs");
    if (!canvas || !tools || !inspector || !artifacts || !runs) throw new Error("Pane geometry unavailable");
    return { canvas, tools, inspector, artifacts, runs };
  });
  expect(layout.canvas.width).toBeGreaterThan(layout.tools.width);
  expect(layout.canvas.width).toBeGreaterThan(layout.inspector.width);
  expect(layout.canvas.height).toBeGreaterThan(layout.artifacts.height);
  expect(layout.canvas.height).toBeGreaterThan(layout.runs.height);
});

async function openShell(page: Page) {
  await page.addInitScript(() => {
    const listeners: Array<(event: unknown) => void> = [];
    const snapshot = () => ({
      documentId: "shell-layout-document",
      displayName: "Shell layout",
      named: true,
      mode: "writable",
      readOnlyReason: null,
      commands: { save: true, saveAs: true, saveCopy: true, compact: true, makePortable: true },
      saveState: "saved",
      documentRevisionId: "revision-1",
      graphId: "graph-root",
      graphRevisionId: "graph-revision-1",
      simulationEnabled: false,
      revision: 1
    });
    const graph = {
      id: "graph-root", title: "Shell", kind: "root", createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z",
      nodes: [{
        id: "shell-prompt",
        definitionId: "prompt.text",
        title: "Shell prompt",
        position: { x: 120, y: 120 },
        size: { width: 250, height: 150 },
        config: { kind: "prompt.text", body: "Keep the canvas visible.", assembly: "append" },
        presentation: { collapsed: false, accent: "default", previewMode: "content" }
      }],
      edges: [], groups: [], modules: [], viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
    };
    Object.defineProperty(window, "ether", { value: {
      document: {
        onEvent: (listener: (event: unknown) => void) => { listeners.push(listener); return () => undefined; },
        bootstrap: async () => snapshot(), new: async () => snapshot(), open: async () => snapshot(), openDropped: async () => snapshot(),
        save: async () => snapshot(), saveAs: async () => snapshot(), saveCopy: async () => snapshot(), close: async () => null,
        compact: async () => ({ beforeBytes: 10, afterBytes: 9 }),
        makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] })
      },
      graph: { snapshot: async () => ({ graph, revision: 1 }), applyTransaction: async () => ({ graph, revision: 1 }) },
      artifacts: { search: async () => [], generateFake: async () => [] },
      references: { list: async () => [], act: async () => [] },
      runtime: { versions: async () => ({ electron: "43", node: "24" }) }
    }});
  });
  await page.goto("/");
  await expect(page.getByTestId("document-canvas")).toBeVisible();
}

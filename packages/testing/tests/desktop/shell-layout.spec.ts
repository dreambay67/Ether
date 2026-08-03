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
    const surface = await page.evaluate(() => {
      const root = document.querySelector("#root")?.getBoundingClientRect();
      const shell = document.querySelector("main.ether-shell")?.getBoundingClientRect();
      if (!root || !shell) throw new Error("Root surface geometry was unavailable");
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        root: { x: root.x, y: root.y, width: root.width, height: root.height },
        shell: { x: shell.x, y: shell.y, width: shell.width, height: shell.height }
      };
    });
    expect(surface.root).toEqual({ x: 0, y: 0, width: surface.innerWidth, height: surface.innerHeight });
    expect(surface.shell).toEqual({ x: 0, y: 0, width: surface.innerWidth, height: surface.innerHeight });
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

test("keeps pointer workflows and primary controls usable across the required scale matrix", async ({ browser }) => {
  const matrix = [
    { width: 1920, height: 1080, scale: 1, action: "resize" },
    { width: 1440, height: 900, scale: 1.25, action: "focus-scroll" },
    { width: 1280, height: 720, scale: 1.5, action: "move-node" },
    { width: 1280, height: 720, scale: 2, action: "target-channel" }
  ];

  for (const entry of matrix) {
    const context = await browser.newContext({
      viewport: { width: Math.round(entry.width / entry.scale), height: Math.round(entry.height / entry.scale) },
      deviceScaleFactor: entry.scale
    });
    const page = await context.newPage();
    await openShell(page);
    if (entry.scale >= 1.5) {
      for (const label of ["Reference Desk", "Build tools", "Project lens"]) {
        const hide = page.getByRole("button", { name: `Hide ${label}`, exact: true });
        if (await hide.count()) await hide.click();
      }
    }
    await expect(page.getByTestId("document-canvas")).toBeVisible();
    const geometry = await page.evaluate(() => {
      const visible = (element: Element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const controls = [...document.querySelectorAll(".project-header-actions button, .workspace-switcher button")]
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { label: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "control", left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
        });
      const overlaps: string[] = [];
      for (let left = 0; left < controls.length; left += 1) {
        for (let right = left + 1; right < controls.length; right += 1) {
          const a = controls[left]!;
          const b = controls[right]!;
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push(`${a.label}/${b.label}`);
        }
      }
      const canvas = document.querySelector("[data-testid=document-canvas]")?.getBoundingClientRect();
      if (!canvas) throw new Error("Canvas geometry unavailable");
      return {
        canvasCssWidth: canvas.width,
        controls,
        overlaps,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        workspaceButtonsHorizontal: controls.filter((control) => ["Build", "Focus", "Run", "Review"].includes(control.label)).every((control) => control.width > control.height)
      };
    });
    expect(geometry.overlaps).toEqual([]);
    expect(
      geometry.controls.filter((control) => control.left < -1 || control.right > geometry.viewport.width + 1 || control.width < 22 || control.height < 22),
      `${entry.width}x${entry.height} at ${Math.round(entry.scale * 100)}% has clipped or undersized primary controls`
    ).toEqual([]);
    expect(geometry.workspaceButtonsHorizontal).toBeTruthy();
    expect(geometry.canvasCssWidth).toBeGreaterThanOrEqual(280);
    if (entry.action === "resize") {
      const resizer = page.getByRole("separator", { name: "Resize Build tools" });
      const beforeResize = await page.getByTestId("pane-tools").evaluate((element) => element.getBoundingClientRect().width);
      const resizerBox = await resizer.boundingBox();
      if (resizerBox === null) throw new Error("Build tools pointer resizer was unavailable.");
      await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + resizerBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(resizerBox.x + resizerBox.width / 2 + 32, resizerBox.y + resizerBox.height / 2, { steps: 4 });
      await page.mouse.up();
      await expect.poll(() => page.getByTestId("pane-tools").evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(beforeResize);
    } else if (entry.action === "focus-scroll") {
      const toolContent = page.getByTestId("pane-tools").locator(".resizable-pane-content");
      await toolContent.hover();
      await page.mouse.wheel(0, 420);
      await page.getByRole("button", { name: "Focus", exact: true }).focus();
      await expect(page.getByRole("button", { name: "Focus", exact: true })).toBeFocused();
    } else if (entry.action === "move-node") {
      const promptHeader = page.locator('[data-testid="rf__node-shell-prompt"] .ether-node-header');
      await promptHeader.scrollIntoViewIfNeeded();
      const promptBox = await promptHeader.boundingBox();
      if (promptBox === null) throw new Error("Prompt pointer target was unavailable.");
      await page.mouse.move(promptBox.x + promptBox.width / 2, promptBox.y + promptBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(promptBox.x + promptBox.width / 2 + 36, promptBox.y + promptBox.height / 2 + 24, { steps: 5 });
      await page.mouse.up();
      await expect.poll(() => page.evaluate(() => (window as typeof window & { __shellTransactions: Array<{ operations?: Array<{ type?: string }> }> }).__shellTransactions.some((transaction) => transaction.operations?.some((operation) => operation.type === "moveNodes")))).toBeTruthy();
    } else {
      const prompt = page.locator('[data-testid="rf__node-shell-prompt"]');
      const image = page.locator('[data-testid="rf__node-shell-image"]');
      await prompt.scrollIntoViewIfNeeded();
      await prompt.getByLabel("Text output").click();
      const imageInput = image.getByLabel("Text input");
      await expect(image.getByTestId("channel-zone-input-text")).toHaveAttribute("data-compatible", "true");
      await imageInput.click();
      await expect(page.getByTestId("edge-role-chip")).toHaveCount(1);
    }
    await page.screenshot({ path: `../../test-results/phase5-shell-${entry.width}x${entry.height}-${Math.round(entry.scale * 100)}-percent.png`, fullPage: true });
    await context.close();
  }
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
    let graph = {
      id: "graph-root", title: "Shell", kind: "root", createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z",
      nodes: [
        {
          id: "shell-prompt",
          definitionId: "prompt.text",
          title: "Shell prompt",
          position: { x: 60, y: 120 },
          size: { width: 250, height: 150 },
          config: { kind: "prompt.text", body: "Keep the canvas visible.", assembly: "append" },
          presentation: { collapsed: false, accent: "default", previewMode: "content" }
        },
        {
          id: "shell-image",
          definitionId: "generation.image",
          title: "Shell image",
          position: { x: 360, y: 120 },
          size: { width: 250, height: 150 },
          config: { kind: "generation.image", providerId: "local", profileId: "local", aspectRatio: "1:1", resolution: { width: 512, height: 512 }, outputCount: 1 },
          presentation: { collapsed: false, accent: "default", previewMode: "summary" }
        }
      ],
      edges: [], groups: [], modules: [], viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
    };
    let revision = 1;
    Object.defineProperty(window, "__shellTransactions", { value: [] });
    Object.defineProperty(window, "ether", { value: {
      document: {
        onEvent: (listener: (event: unknown) => void) => { listeners.push(listener); return () => undefined; },
        bootstrap: async () => snapshot(), new: async () => snapshot(), open: async () => snapshot(), openDropped: async () => snapshot(),
        save: async () => snapshot(), saveAs: async () => snapshot(), saveCopy: async () => snapshot(), close: async () => null,
        compact: async () => ({ beforeBytes: 10, afterBytes: 9 }),
        makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] })
      },
      graph: {
        snapshot: async () => ({ graph, revision }),
        applyTransaction: async (_documentId: string, transaction: { operations?: Array<Record<string, unknown>> }) => {
          for (const operation of transaction.operations ?? []) {
            if (operation.type === "moveNodes") {
              const positions = operation.positions as Array<{ nodeId: string; position: { x: number; y: number } }>;
              graph = { ...graph, nodes: graph.nodes.map((node) => ({ ...node, position: positions.find((item) => item.nodeId === node.id)?.position ?? node.position })) };
            }
            if (operation.type === "addEdge") graph = { ...graph, edges: [...graph.edges, operation.edge as never] };
          }
          (window as typeof window & { __shellTransactions: unknown[] }).__shellTransactions.push(transaction);
          revision += 1;
          return { graph, revision };
        }
      },
      artifacts: { search: async () => [], generateFake: async () => [] },
      references: { list: async () => [], act: async () => [] },
      runtime: { versions: async () => ({ electron: "43", node: "24" }) }
    }});
  });
  await page.goto("/");
  await expect(page.getByTestId("document-canvas")).toBeVisible();
}

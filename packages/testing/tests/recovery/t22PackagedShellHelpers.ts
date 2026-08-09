import { expect, type Locator, type Page } from "@playwright/test";

import type { RealPageInput } from "../../recovery/journeyDriver.js";

export type ShellScalePoint = {
  id: string;
  display: { width: number; height: number };
  scale: number;
  viewport: { width: number; height: number };
};

export const shellScaleMatrix: readonly ShellScalePoint[] = [
  { id: "1920x1080-100", display: { width: 1920, height: 1080 }, scale: 1, viewport: { width: 1920, height: 1080 } },
  { id: "1440x900-125", display: { width: 1440, height: 900 }, scale: 1.25, viewport: { width: 1152, height: 720 } },
  { id: "1280x720-150", display: { width: 1280, height: 720 }, scale: 1.5, viewport: { width: 853, height: 480 } },
  { id: "1280x720-200", display: { width: 1280, height: 720 }, scale: 2, viewport: { width: 640, height: 360 } }
];

const paneDefinitions = [
  { id: "tools", label: "Build tools", axis: "width", delta: { x: 32, y: 0 } },
  { id: "inspector", label: "Project lens", axis: "width", delta: { x: -32, y: 0 } },
  // Build's top and bottom desks start at their workspace maxima, so their
  // visible resize action deliberately shrinks them rather than requesting a
  // clamped no-op.
  { id: "artifacts", label: "Reference Desk", axis: "height", delta: { x: 0, y: -32 } },
  { id: "runs", label: "Run desk", axis: "height", delta: { x: 0, y: 32 } }
] as const;

type PaneId = (typeof paneDefinitions)[number]["id"];
type PaneDimension = Record<PaneId, number>;
type ShellGeometry = Awaited<ReturnType<typeof inspectShellGeometry>>;

export async function assertAdaptiveShell(page: Page, point: ShellScalePoint): Promise<ShellGeometry> {
  await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
  const deviceScale = await page.evaluate(() => window.devicePixelRatio);
  expect(deviceScale, `${point.id} should use the requested Chromium device scale`).toBeCloseTo(point.scale, 1);

  const layout = await inspectShellGeometry(page);
  const declaredCanvasMinimum = point.scale >= 1.5 ? 480 : 420;

  expect(layout.canvasComputedMinWidth).toBe(`${declaredCanvasMinimum}px`);
  expect(layout.canvas.width).toBeGreaterThanOrEqual(declaredCanvasMinimum);
  expect(layout.canvas.width).toBeGreaterThan(layout.tools.width);
  expect(layout.canvas.width).toBeGreaterThan(layout.inspector.width);
  expect(layout.artifacts.bottom).toBeLessThanOrEqual(layout.canvas.top + 1);
  expect(layout.runs.top).toBeGreaterThanOrEqual(layout.canvas.bottom - 1);
  expect(layout.artifacts.height).toBeGreaterThanOrEqual(32);
  expect(layout.runs.height).toBeGreaterThanOrEqual(32);
  expect(Math.abs(layout.canvas.right - layout.inspector.left), "Canvas stays adjacent to Project lens.").toBeLessThanOrEqual(1);
  expect(Math.abs((layout.canvas.right - layout.minimap.right) - 16), "Minimap stays 16px inside the canvas edge beside Project lens.").toBeLessThanOrEqual(2);
  expect(layout.minimap.left).toBeGreaterThanOrEqual(layout.canvas.left);
  expect(layout.minimap.bottom).toBeLessThanOrEqual(layout.canvas.bottom + 1);
  expect(layout.overlaps).toEqual([]);
  expect(layout.controls.filter((control) => (
    control.left < -1 || control.right > layout.viewport.width + 1 || control.width < 22 || control.height < 22
  ))).toEqual([]);
  expect(layout.controls.filter((control) => ["Build", "Focus", "Run", "Review"].includes(control.label))
    .every((control) => control.width > control.height)).toBeTruthy();

  // At narrow logical widths the product deliberately exposes a scrollable
  // shell/main region to retain the declared 480px canvas minimum. That is
  // intentional responsive overflow, not a claim that every surface fits
  // without scrolling.
  if (point.scale >= 1.5) {
    expect(layout.shell.overflowY).toMatch(/auto|scroll/u);
    expect(layout.workspaceMain.overflowX).toMatch(/auto|scroll/u);
    expect(layout.artifacts.left).toBeGreaterThanOrEqual(-1);
    expect(layout.artifacts.right).toBeLessThanOrEqual(layout.viewport.width + 1);
    expect(layout.runs.left).toBeGreaterThanOrEqual(-1);
    expect(layout.runs.right).toBeLessThanOrEqual(layout.viewport.width + 1);
  } else {
    expect(layout.artifacts.left).toBeLessThanOrEqual(layout.canvas.left + 1);
    expect(layout.artifacts.right).toBeGreaterThanOrEqual(layout.canvas.right - 1);
    expect(layout.runs.left).toBeLessThanOrEqual(layout.canvas.left + 1);
    expect(layout.runs.right).toBeGreaterThanOrEqual(layout.canvas.right - 1);
  }
  return layout;
}

async function inspectShellGeometry(page: Page) {
  return page.evaluate(() => {
    const required = (selector: string) => {
      const bounds = document.querySelector(selector)?.getBoundingClientRect();
      if (bounds === undefined) throw new Error(`Missing geometry for ${selector}.`);
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
    };
    const canvas = required("[data-testid=document-canvas]");
    const tools = required("[data-testid=pane-tools]");
    const inspector = required("[data-testid=pane-inspector]");
    const artifacts = required("[data-testid=pane-artifacts]");
    const runs = required("[data-testid=pane-runs]");
    const minimap = required(".react-flow__minimap");
    const shell = document.querySelector<HTMLElement>("main.ether-shell");
    const workspaceMain = document.querySelector<HTMLElement>(".adaptive-workspace-main");
    const canvasElement = document.querySelector<HTMLElement>("[data-testid=document-canvas]");
    if (shell === null || workspaceMain === null || canvasElement === null) throw new Error("Shell scroll geometry was unavailable.");
    const controls = Array.from(document.querySelectorAll<HTMLElement>(".project-header-actions button, .workspace-switcher button"))
      .filter((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
      })
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          label: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "control",
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height
        };
      });
    const overlaps: string[] = [];
    for (let left = 0; left < controls.length; left += 1) {
      for (let right = left + 1; right < controls.length; right += 1) {
        const a = controls[left]!;
        const b = controls[right]!;
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
          overlaps.push(`${a.label}/${b.label}`);
        }
      }
    }
    const scrollState = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      return {
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
        overflowX: style.overflowX,
        overflowY: style.overflowY
      };
    };
    return {
      canvas,
      canvasComputedMinWidth: getComputedStyle(canvasElement).minWidth,
      tools,
      inspector,
      artifacts,
      runs,
      minimap,
      controls,
      overlaps,
      shell: scrollState(shell),
      workspaceMain: scrollState(workspaceMain),
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  });
}

export async function visitWorkspaces(page: Page, input: RealPageInput): Promise<void> {
  for (const workspace of ["Build", "Focus", "Run", "Review", "Build"] as const) {
    await input.leftClick(
      page.getByRole("button", { name: workspace, exact: true }),
      `Open ${workspace} workspace`,
      `${workspace} keeps the ordinary document workspace available without replacing the durable graph.`
    );
    await expect(page.locator(".adaptive-workspace")).toHaveAttribute("data-workspace", workspace.toLowerCase());
  }
}

export async function collapseAllPanes(page: Page, input: RealPageInput): Promise<void> {
  for (const pane of paneDefinitions) {
    const show = page.getByRole("button", { name: `Show ${pane.label}`, exact: true });
    if (await show.isVisible().catch(() => false)) {
      await input.leftClick(show, `Show ${pane.label}`, `${pane.label} returns before its visibility is checked.`);
    }
    const hide = page.getByRole("button", { name: `Hide ${pane.label}`, exact: true });
    await expect(hide).toBeVisible();
    await input.leftClick(hide, `Hide ${pane.label}`, `${pane.label} collapses without obscuring the canvas.`);
    await expect(page.getByTestId(`pane-${pane.id}`)).toHaveClass(/is-collapsed/u);
  }
}

export async function assertCollapsedPanePersistenceAfterReload(page: Page, input: RealPageInput): Promise<void> {
  input.observe(
    "Reload with all supporting panes collapsed",
    "The all-collapsed layout persists through a renderer reload in the same isolated packaged profile.",
    "Reload requested after visible pane collapse controls were used."
  );
  await page.reload();
  await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
  for (const pane of paneDefinitions) {
    await expect(page.getByTestId(`pane-${pane.id}`)).toHaveClass(/is-collapsed/u);
  }
}

export async function restoreAllPanes(page: Page, input: RealPageInput): Promise<void> {
  for (const pane of paneDefinitions) {
    await input.leftClick(
      page.getByRole("button", { name: `Show ${pane.label}`, exact: true }),
      `Restore ${pane.label}`,
      `${pane.label} restores through its visible pane control after persistence is proven.`
    );
    await expect(page.getByTestId(`pane-${pane.id}`)).not.toHaveClass(/is-collapsed/u);
  }
}

export async function resizeEveryPane(page: Page, input: RealPageInput): Promise<PaneDimension> {
  for (const pane of paneDefinitions) {
    const target = page.getByTestId(`pane-${pane.id}`);
    const before = await paneMeasurement(target, pane.axis);
    const separator = page.getByRole("separator", { name: `Resize ${pane.label}`, exact: true });
    const bounds = await separator.boundingBox();
    if (bounds === null) throw new Error(`${pane.label} has no visible pointer resizer.`);
    await input.leftDrag(
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      { x: bounds.x + bounds.width / 2 + pane.delta.x, y: bounds.y + bounds.height / 2 + pane.delta.y },
      `Resize ${pane.label} with the pointer`,
      `${pane.label} changes size within the usable canvas limits.`
    );
    await expect.poll(() => paneMeasurement(target, pane.axis)).not.toBe(before);
  }
  return paneDimensions(page);
}

export async function assertPanePersistenceAfterReload(page: Page, input: RealPageInput, before: PaneDimension): Promise<void> {
  input.observe(
    "Reload the packaged workspace",
    "The restored pane sizes and visibility persist through a renderer reload in the same isolated Ether profile.",
    "Reload requested after real pointer resizing and visible pane restoration."
  );
  await page.reload();
  await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
  for (const pane of paneDefinitions) {
    await expect(page.getByTestId(`pane-${pane.id}`)).not.toHaveClass(/is-collapsed/u);
  }
  const after = await paneDimensions(page);
  for (const pane of paneDefinitions) {
    expect(Math.abs(after[pane.id] - before[pane.id]), `${pane.label} size should persist through reload`).toBeLessThanOrEqual(1);
  }
}

export async function scrollAndFocusBuildTools(page: Page, input: RealPageInput): Promise<void> {
  const content = page.getByTestId("pane-tools").locator(".resizable-pane-content");
  await expect(content).toBeVisible();
  await content.hover();
  await page.mouse.wheel(0, 420);
  input.observe(
    "Scroll Build tools with the pointer wheel",
    "The visible Build tools pane scrolls without changing the document or hiding the workspace controls.",
    "A real pointer wheel event was sent to the visible Build tools pane."
  );
  const focus = page.getByRole("button", { name: "Focus", exact: true });
  await input.leftClick(focus, "Focus the workspace switcher", "The clicked Focus workspace control receives visible browser focus.");
  await expect(focus).toBeFocused();
}

export async function scrollResponsiveShell(page: Page, input: RealPageInput): Promise<void> {
  const shell = page.locator("main.ether-shell");
  const before = await inspectShellGeometry(page);
  await shell.hover();
  await page.mouse.wheel(0, 180);
  const afterPointer = await inspectShellGeometry(page);
  input.observe(
    "Scroll the responsive shell with the pointer wheel",
    "At high scale, any required shell overflow remains inside Ether's deliberate responsive scroll container.",
    `Shell vertical scroll ${before.shell.scrollTop} -> ${afterPointer.shell.scrollTop} of ${Math.max(0, afterPointer.shell.scrollHeight - afterPointer.shell.clientHeight)}px; main horizontal overflow ${Math.max(0, afterPointer.workspaceMain.scrollWidth - afterPointer.workspaceMain.clientWidth)}px.`
  );
  if (before.shell.scrollHeight > before.shell.clientHeight) {
    expect(afterPointer.shell.scrollTop).toBeGreaterThan(before.shell.scrollTop);
  }

  const build = page.getByRole("button", { name: "Build", exact: true });
  await input.leftClick(build, "Focus Build before keyboard scrolling", "The responsive shell's Build control remains visibly focusable before PageDown.");
  const beforeKeyboard = await inspectShellGeometry(page);
  await input.pressKey("PageDown", "Scroll the responsive shell with PageDown", "A keyboard scroll command can move the deliberate responsive shell without changing the graph.");
  const afterKeyboard = await inspectShellGeometry(page);
  input.observe(
    "Record responsive keyboard scroll",
    "The action log distinguishes deliberate responsive scrolling from accidental clipped overflow.",
    `Shell vertical scroll ${beforeKeyboard.shell.scrollTop} -> ${afterKeyboard.shell.scrollTop}; main vertical scroll ${beforeKeyboard.workspaceMain.scrollTop} -> ${afterKeyboard.workspaceMain.scrollTop}.`
  );
}

export async function addShellNodes(page: Page, input: RealPageInput): Promise<{ prompt: Locator; image: Locator }> {
  const canvas = page.getByTestId("ether-canvas-surface");
  await expect(canvas).toHaveAttribute("data-graph-node-count", "0");
  await addDefinition(page, input, "prompt.text", 1);
  await addDefinition(page, input, "generation.image", 2);
  const prompt = page.locator(".ether-node[data-node-definition='prompt.text']");
  const image = page.locator(".ether-node[data-node-definition='generation.image']");
  await expect(prompt).toHaveCount(1);
  await expect(image).toHaveCount(1);
  return { prompt, image };
}

export async function movePromptNode(page: Page, input: RealPageInput, prompt: Locator): Promise<void> {
  await collapseForCanvas(page, input);
  const header = prompt.locator(".ether-node-header");
  await header.scrollIntoViewIfNeeded();
  const before = await header.boundingBox();
  if (before === null) throw new Error("Prompt card header has no visible pointer target.");
  await input.leftDrag(
    { x: before.x + before.width / 2, y: before.y + before.height / 2 },
    { x: before.x + before.width / 2 + 36, y: before.y + before.height / 2 + 24 },
    "Move the blank-authored Prompt", "The Prompt moves once through the visible canvas without losing the shell."
  );
  await expect.poll(async () => {
    const after = await header.boundingBox();
    return after === null ? 0 : Math.hypot(after.x - before.x, after.y - before.y);
  }).toBeGreaterThan(12);
}

export async function targetTextChannel(page: Page, input: RealPageInput, prompt: Locator, image: Locator): Promise<void> {
  await collapseForCanvas(page, input);
  await prompt.scrollIntoViewIfNeeded();
  await image.scrollIntoViewIfNeeded();
  const output = prompt.getByLabel("Text output");
  const receiver = image.getByLabel("Text input");
  await input.leftClick(output, "Begin Text channel connection", "The Image Generator visibly marks its compatible Text input before connection.");
  await expect(image.getByTestId("channel-zone-input-text")).toHaveAttribute("data-compatible", "true");
  await input.leftClick(receiver, "Complete Text channel connection", "One visible Text lane is saved between the blank-authored cards.");
  await expect(page.locator(".ether-edge-hit-target")).toHaveCount(1);
}

async function addDefinition(page: Page, input: RealPageInput, definition: string, expectedCount: number): Promise<void> {
  const row = page.locator(`.node-library-item[data-node-definition='${definition}']`);
  await row.scrollIntoViewIfNeeded();
  await input.leftClick(row.locator(".node-library-add"), `Add ${definition} from Node Library`, `The blank document creates ${definition} through the canonical registry.`);
  await expect(page.getByTestId("ether-canvas-surface")).toHaveAttribute("data-graph-node-count", String(expectedCount));
}

async function collapseForCanvas(page: Page, input: RealPageInput): Promise<void> {
  for (const label of ["Reference Desk", "Build tools", "Project lens"] as const) {
    const hide = page.getByRole("button", { name: `Hide ${label}`, exact: true });
    if (await hide.isVisible().catch(() => false)) {
      await input.leftClick(hide, `Hide ${label} for canvas work`, `${label} collapses to leave a usable authoring canvas.`);
    }
  }
}

async function paneDimensions(page: Page): Promise<PaneDimension> {
  const dimensions = {} as PaneDimension;
  for (const pane of paneDefinitions) {
    dimensions[pane.id] = await paneMeasurement(page.getByTestId(`pane-${pane.id}`), pane.axis);
  }
  return dimensions;
}

async function paneMeasurement(target: Locator, axis: "width" | "height"): Promise<number> {
  return target.evaluate((element, measurementAxis) => element.getBoundingClientRect()[measurementAxis], axis);
}

import { expect, type Locator, type Page } from "@playwright/test";

import type { RealPageInput } from "../../recovery/journeyDriver.js";

const keyboardBypassPatterns: Array<[string, RegExp]> = [
  ["programmatic focus", methodCallPattern("focus")],
  ["pointer activation", methodCallPattern("click|dblclick|hover")],
  ["pointer input", new RegExp(["page", "\\.", "mouse", "\\."].join(""), "u")],
  ["direct form fill", methodCallPattern("fill|selectOption")]
];

/** Keep the claimed keyboard-only route honest when either source file changes. */
export function assertKeyboardOnlyJourneySource(...sources: Array<{ label: string; source: string }>): void {
  for (const { label, source } of sources) {
    for (const [reason, expression] of keyboardBypassPatterns) {
      if (expression.test(source)) throw new Error(`${label} violates the keyboard-only journey guard: ${reason}.`);
    }
  }
}

/**
 * Traverse from the browser's current active element. This deliberately never
 * adjusts focus itself: a missing tab stop is a product reachability defect.
 */
export async function tabTo(page: Page, input: RealPageInput, target: Locator, label: string, direction: "forward" | "backward" = "forward"): Promise<void> {
  await expect(target).toBeVisible();
  const key = direction === "forward" ? "Tab" : "Shift+Tab";
  for (let step = 0; step < 240; step += 1) {
    if (await isFocused(target)) {
      input.observe(label, "The target is reached from the actual current focus using keyboard traversal only.", `Reached ${await targetDescription(target)} with ${step} ${key} key event${step === 1 ? "" : "s"}.`);
      return;
    }
    await page.keyboard.press(key);
  }
  throw new Error(`${label} was not reachable by ${key} from the current keyboard focus.`);
}

export async function keyboardActivate(page: Page, input: RealPageInput, target: Locator, label: string, expected: string, key: "Enter" | "Space" = "Enter"): Promise<void> {
  await tabTo(page, input, target, label);
  await input.pressKey(key, label, expected);
}

/** Create one lane by keyboard-reaching each documented channel handle. */
export async function connectWithKeyboard(page: Page, input: RealPageInput, source: Locator, outputName: string, target: Locator, inputName: string, label: string): Promise<void> {
  const output = source.getByLabel(outputName);
  const receiver = target.getByLabel(inputName);
  await keyboardActivate(page, input, output, `Begin ${label}`, "Enter begins a keyboard-owned connection intent from the source channel.");
  await expect(receiver).toHaveAttribute("data-compatible", "true");
  await keyboardActivate(page, input, receiver, `Complete ${label}`, "Space completes the compatible connection through the ordinary canvas interaction.", "Space");
}

export async function typeWithKeyboard(page: Page, input: RealPageInput, value: string, label: string, expected: string): Promise<void> {
  await page.keyboard.type(value);
  input.observe(label, expected, `Typed ${value.length} characters through the active keyboard target.`);
}

/** Add one node through the tab-reachable Library search rather than a pointer click. */
export async function addFromLibraryWithKeyboard(page: Page, input: RealPageInput, query: string, title: string, expectedCount: number): Promise<void> {
  const search = page.getByLabel("Search node library");
  await tabTo(page, input, search, "Reach the Library search");
  await input.pressKey("Control+A", "Select the Library query", "The focused Library search owns the select-all shortcut, not the canvas graph.");
  await typeWithKeyboard(page, input, query, `Filter Library for ${title}`, "The Library narrows using text typed through its keyboard-reached search field.");
  const add = page.getByRole("button", { name: `Add ${title}`, exact: true });
  await expect(add).toBeVisible();
  await keyboardActivate(page, input, add, `Add ${title} from the Library`, "Enter creates the canonical node through the ordinary Library command.");
  await expect(page.getByTestId("ether-canvas-surface")).toHaveAttribute("data-graph-node-count", String(expectedCount));
}

/** Add a second node with the canvas-owned N quick-add command. */
export async function addFromCanvasQuickAdd(page: Page, input: RealPageInput, query: string, title: string, expectedCount: number): Promise<void> {
  const canvas = page.getByTestId("ether-canvas-surface");
  await tabTo(page, input, canvas, "Reach the authoring canvas");
  await input.pressKey("N", "Open canvas quick add", "N opens the searchable node palette while the canvas owns focus.");
  const palette = page.getByRole("dialog", { name: "Quick add node" });
  const search = palette.getByRole("textbox", { name: "Find a node" });
  await expect(search).toBeFocused();
  await typeWithKeyboard(page, input, query, `Filter quick add for ${title}`, "Quick add filters with text typed into its product-owned autofocus field.");
  await expect(palette.getByRole("option", { name: new RegExp(title, "u") }).first()).toBeVisible();
  await input.pressKey("Enter", `Insert ${title} from quick add`, "Enter inserts the active matching canonical node and returns focus to the canvas.");
  await expect(page.getByTestId("ether-canvas-surface")).toHaveAttribute("data-graph-node-count", String(expectedCount));
  await expect(canvas).toBeFocused();
}

/** Select a native select option using only Home and Arrow keys after tab traversal. */
export async function chooseSelectWithKeyboard(page: Page, input: RealPageInput, control: Locator, value: string, label: string): Promise<void> {
  await tabTo(page, input, control, label);
  const index = await control.locator("option").evaluateAll((options, expected) => options.findIndex((option) => option.getAttribute("value") === expected), value);
  if (index < 0) throw new Error(`${label} does not expose the required option ${value}.`);
  await input.pressKey("Home", `${label}: first option`, "Home places the native select at its first available option.");
  for (let step = 0; step < index; step += 1) {
    await input.pressKey("ArrowDown", `${label}: option ${step + 1}`, "ArrowDown advances the native select through its visible option order.");
  }
  await expect(control).toHaveValue(value);
}

export async function assertReducedMotion(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => page.evaluate(() => globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  const transitionTargets: Array<[string, Locator]> = [
    ["workspace switcher", page.getByTestId("workspace-switcher").getByRole("button", { name: "Build", exact: true })],
    ["resizable shell pane", page.locator(".resizable-pane").first()],
    ["Node Library item", page.locator(".node-library-item").first()]
  ];
  for (const [label, target] of transitionTargets) {
    await expect(target, `${label} must exist for its reduced-motion stylesheet rule.`).toBeVisible();
    await expect.poll(() => target.evaluate((element) => globalThis.getComputedStyle(element).transitionProperty), { message: `${label} must suppress its declared transition under prefers-reduced-motion.` }).toBe("none");
  }
}

export async function activeElementDescription(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = globalThis.document.activeElement;
    if (!(active instanceof HTMLElement)) return "no HTMLElement active";
    return `${active.tagName.toLowerCase()}${active.getAttribute("aria-label") ? ` [${active.getAttribute("aria-label")}]` : ""}${active.id ? ` #${active.id}` : ""}`;
  });
}

export async function selectedNodeCount(page: Page): Promise<number> {
  return page.getByTestId("ether-node").evaluateAll((nodes) => new Set(nodes
    .filter((node) => node.classList.contains("is-selected"))
    .map((node) => node.getAttribute("data-node-id"))
    .filter((id): id is string => id !== null)).size);
}

async function isFocused(target: Locator): Promise<boolean> {
  return target.evaluate((element) => globalThis.document.activeElement === element);
}

async function targetDescription(target: Locator): Promise<string> {
  return target.evaluate((element) => {
    const name = element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName.toLowerCase();
    return name.replace(/\s+/gu, " ").slice(0, 96);
  });
}

function methodCallPattern(methods: string): RegExp {
  return new RegExp(["\\.", `(?:${methods})`, "\\s*\\("].join(""), "u");
}

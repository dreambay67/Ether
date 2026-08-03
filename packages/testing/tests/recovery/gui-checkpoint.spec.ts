import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  assertAuthoringJourneySourceSafety,
  blankAuthoringJourney,
  launchRecoveryJourney,
  packagedJourneyConfig,
  type JourneyPoint
} from "../../recovery/journeyDriver.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const thisSource = fileURLToPath(import.meta.url);
const journeyId = "blank-gui-checkpoint";
const canonicalDefinitions = [
  "prompt.text", "prompt.worker", "reference.set", "generation.image", "edit.image", "edit.mask",
  "edit.transform", "review.compare", "review.evaluate", "review.filter", "flow.variables", "flow.batch",
  "flow.join", "output.collection", "output.export", "canvas.note", "canvas.drawing"
] as const;

test.skip(process.platform !== "win32", "The GUI checkpoint runs against packaged Windows Ether.exe.");

test("authors the practical phase-one journey from a blank packaged document", async () => {
  assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "GUI checkpoint spec");
  const session = await launchRecoveryJourney({
    ...packagedJourneyConfig(workspaceRoot, journeyId),
    evidenceMode: "committed",
    committedEvidencePath: ["phase-1", journeyId],
    viewport: { width: 1600, height: 1000 },
    declaration: blankAuthoringJourney(journeyId)
  });
  let closed = false;
  try {
    const { page, input, evidence } = session;
    const canvas = page.getByTestId("ether-canvas-surface");
    const library = page.getByTestId("node-library");
    await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(canvas).toHaveAttribute("data-graph-node-count", "0");
    await expect(library.locator(".node-library-item")).toHaveCount(17);
    const definitions = await library.locator(".node-library-item").evaluateAll((items) => items.map((item) => item.getAttribute("data-node-definition")));
    expect(definitions).toEqual(canonicalDefinitions);
    input.observe("Registry-backed blank library", "All 17 canonical node types are discoverable before graph mutation.", `Found ${definitions.length} registry rows in canonical order.`);
    await input.screenshot("01-blank-library.png", evidence, "Capture the blank registry-backed library", "A fresh blank document visibly exposes the searchable Node Library.");

    await addDefinition(page, input, "prompt.text", 1);
    await addDefinition(page, input, "prompt.worker", 2);
    const prompt = page.locator(".ether-node[data-node-definition='prompt.text']").first();
    const worker = page.locator(".ether-node[data-node-definition='prompt.worker']").first();
    const canvasBox = await requiredBox(canvas, "authoring canvas");
    const workerBefore = await requiredBox(worker, "Worker before movement");
    const workerCenter = center(workerBefore);
    const safeWorkerTarget = {
      x: workerCenter.x,
      y: Math.min(canvasBox.y + canvasBox.height - workerBefore.height / 2 - 40, workerCenter.y + 400)
    };
    await input.leftDrag(workerCenter, safeWorkerTarget, "Move Worker with ordinary left drag", "The Worker moves once and preserves its graph identity.");
    await expect.poll(async () => (await requiredBox(worker, "Worker after movement")).y).toBeGreaterThan(workerBefore.y + 250);

    const promptBox = await requiredBox(prompt, "Prompt for marquee");
    await input.leftMarquee(...marqueeAround(promptBox, canvasBox), "Marquee-select Prompt", "A left-drag marquee selects the intersected Prompt.");
    await expect.poll(() => selectedNodeDefinitions(page)).toEqual(["prompt.text"]);
    const workerBox = await requiredBox(worker, "Worker for additive marquee");
    await input.shiftMarquee(...marqueeAround(workerBox, canvasBox), "Add Worker with Shift marquee", "Shift marquee preserves Prompt and adds Worker.");
    await expect.poll(() => selectedNodeDefinitions(page)).toEqual(["prompt.text", "prompt.worker"]);
    await input.screenshot("02-marquee-and-movement.png", evidence, "Capture movement and additive marquee", "The separated nodes show one reliable movement and two-node additive selection state.");

    await input.pressKey("Control+D", "Duplicate selected nodes", "Ctrl+D duplicates the two selected nodes with a visible offset.");
    await expect(page.getByTestId("ether-node")).toHaveCount(4);
    await input.pressKey("Control+C", "Copy graph selection", "Ctrl+C records the selected graph subgraph.");
    await input.pressKey("Control+V", "Paste graph selection", "Ctrl+V pastes the selected subgraph with fresh graph identities.");
    await expect(page.getByTestId("ether-node")).toHaveCount(6);
    await input.pressKey("Delete", "Delete pasted graph selection", "Delete removes the current graph selection.");
    await expect(page.getByTestId("ether-node")).toHaveCount(4);
    await input.pressKey("Control+Z", "Undo graph delete", "Ctrl+Z restores the deleted graph selection.");
    await expect(page.getByTestId("ether-node")).toHaveCount(6);
    await input.pressKey("Control+Y", "Redo graph delete", "Ctrl+Y reapplies the graph deletion.");
    await expect(page.getByTestId("ether-node")).toHaveCount(4);
    await input.pressKey("Control+A", "Select every current node", "Ctrl+A selects every node when the canvas owns focus.");
    await expect.poll(() => selectedNodeCount(page)).toBe(4);
    input.observe("Primary graph shortcuts", "Duplicate, clipboard, delete, undo, redo, and select-all change the durable graph.", "Node counts: 2 -> 4 -> 6 -> 4 -> 6 -> 4; four selected.");

    await input.pressKey("F2", "Rename the primary selected node", "F2 opens one controlled title editor.");
    const titleEditor = page.locator(".ether-node-inline-editor input").first();
    await expect(titleEditor).toBeVisible();
    await titleEditor.fill("Campaign direction");
    await input.pressKey("Enter", "Commit the direct title edit", "Enter commits the renamed title as one graph transaction.");
    const renamedTitle = page.getByRole("button", { name: "Campaign direction", exact: true });
    await expect(renamedTitle).toBeVisible();
    await input.leftClick(renamedTitle, "Restore canvas-owned node focus", "The renamed Prompt is the primary selected graph object.");
    await input.pressKey("Enter", "Open primary content editing", "Enter edits the selected Prompt primary content rather than moving the node.");
    const primaryEditor = page.locator(".ether-node-inline-editor textarea").first();
    await expect(primaryEditor).toBeVisible();
    await primaryEditor.fill("Quiet coastal campaign in crisp morning light");
    await input.screenshot("03-direct-editing.png", evidence, "Capture controlled direct editing", "The selected Prompt visibly owns the only bounded on-canvas editor.");
    await input.pressKey("Control+Enter", "Commit primary content edit", "Ctrl+Enter commits text while the editor owns focus.");
    await expect(primaryEditor).toBeHidden();
    await expect.poll(() => selectedNodeDefinitions(page)).toEqual(["prompt.text"]);
    await input.leftClick(renamedTitle, "Restore Prompt command focus", "The directly edited Prompt remains the primary graph selection.");
    await expect.poll(() => selectedNodeDefinitions(page)).toEqual(["prompt.text"]);
    await input.pressKey("Control+Enter", "Preview the selected run", "Ctrl+Enter prepares the selected-node plan without starting provider work.");
    await expect(page.getByTestId("canvas-status")).toContainText("Selected plan ready");

    let expectedCount = 4;
    for (const definition of canonicalDefinitions.slice(2)) {
      expectedCount += 1;
      await addDefinition(page, input, definition, expectedCount);
    }
    await input.leftClick(blankCanvasPoint(canvasBox), "Return focus to the canvas", "Canvas focus owns the final fit command.");
    await expect(canvas).toBeFocused();
    await input.pressKey("Home", "Fit the authored graph", "Home fits all authored node types into the viewport.");
    await page.waitForTimeout(450);
    for (const definition of canonicalDefinitions) await expect(page.locator(`.ether-node[data-node-definition='${definition}']`).first()).toBeVisible();
    const visibleDefinitions = await page.getByTestId("ether-node").evaluateAll((nodes) => [...new Set(nodes.map((node) => node.getAttribute("data-node-definition")).filter(Boolean))]);
    expect(visibleDefinitions.sort()).toEqual([...canonicalDefinitions].sort());
    input.observe("All canonical cards authored", "Every canonical type can be created from the blank document without a graph fixture.", `${visibleDefinitions.length} distinct node definitions are visible on the durable canvas.`);
    await input.screenshot("04-all-17-node-types.png", evidence, "Capture all canonical node types", "The fitted blank-authored graph visibly contains all 17 canonical node types.");
    await input.pressKey("Control+K", "Open the canvas command palette", "Ctrl+K exposes the same graph command registry used by shortcuts and toolbar.");
    await expect(page.getByRole("dialog", { name: "Canvas command palette" })).toBeVisible();
    await input.screenshot("05-command-palette.png", evidence, "Capture the unified command surface", "The palette visibly lists graph commands, shortcuts, availability, and disabled reasons.");

    await session.close("passed");
    closed = true;
  } finally {
    if (!closed) await session.close("failed");
  }
});

async function addDefinition(page: Page, input: import("../../recovery/journeyDriver.js").RealPageInput, definition: string, expectedCount: number) {
  const row = page.locator(`.node-library-item[data-node-definition='${definition}']`);
  await row.scrollIntoViewIfNeeded();
  await input.leftClick(row.locator(".node-library-add"), `Add ${definition} from Node Library`, `The registry factory creates ${definition} with canonical defaults.`);
  await expect(page.getByTestId("ether-canvas-surface")).toHaveAttribute("data-graph-node-count", String(expectedCount));
}

async function requiredBox(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`${label} has no visible bounding box.`);
  return box;
}

function center(box: { x: number; y: number; width: number; height: number }): JourneyPoint {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function blankCanvasPoint(canvas: { x: number; y: number; width: number; height: number }): JourneyPoint {
  return { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height - 28 };
}

function marqueeAround(box: { x: number; y: number; width: number; height: number }, canvas: { x: number; y: number; width: number; height: number }): [JourneyPoint, JourneyPoint] {
  return [
    { x: Math.max(canvas.x + 8, box.x - 18), y: Math.max(canvas.y + 8, box.y - 18) },
    { x: Math.min(canvas.x + canvas.width - 8, box.x + box.width + 18), y: Math.min(canvas.y + canvas.height - 8, box.y + box.height + 18) }
  ];
}

async function selectedNodeCount(page: Page) {
  return page.getByTestId("ether-node").evaluateAll((nodes) => nodes.filter((node) => node.classList.contains("is-selected")).length);
}

async function selectedNodeDefinitions(page: Page) {
  return page.getByTestId("ether-node").evaluateAll((nodes) => nodes
    .filter((node) => node.classList.contains("is-selected"))
    .map((node) => node.getAttribute("data-node-definition"))
    .filter((definition): definition is string => definition !== null)
    .sort());
}

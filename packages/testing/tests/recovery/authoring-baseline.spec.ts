import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import {
  AUTHORING_BASELINE_CODES,
  type AuthoringBaselineObservation,
  validateAuthoringBaselineEvidence,
  writeAuthoringBaselineReport
} from "../../recovery/authoringBaseline.js";
import {
  assertAuthoringJourneySourceSafety,
  blankAuthoringJourney,
  launchRecoveryJourney,
  packagedJourneyConfig,
  type RealPageInput,
  sourceElectronJourneyConfig,
  type JourneyEvidencePaths,
  type JourneyMode,
  type JourneyPoint
} from "../../recovery/journeyDriver.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const thisSource = fileURLToPath(import.meta.url);

test.skip(process.platform !== "win32", "The recovery authoring baseline operates Windows Electron only.");

test("records the rejected blank-document authoring baseline through real UI input", async () => {
  await assertBaselineSpecIsSafe();
  const mode = baselineMode();
  const base = mode === "source-electron"
    ? sourceElectronJourneyConfig(workspaceRoot, "authoring-baseline")
    : packagedJourneyConfig(workspaceRoot, "authoring-baseline");
  const session = await launchRecoveryJourney({
    ...base,
    evidenceMode: "committed",
    committedEvidencePath: ["phase-0", "authoring-baseline"],
    declaration: blankAuthoringJourney("authoring-baseline"),
    ...(mode === "source-electron" ? {
      sourceEntrypoint: path.join(workspaceRoot, "packages", "testing", "fixtures", "desktop-main.mjs"),
      sourceArgs: (profile) => [`--fixture-root=${profile.root}`]
    } : {})
  });
  let closed = false;
  const observations: AuthoringBaselineObservation[] = [];
  try {
    const { page, input, evidence } = session;
    const rail = page.locator(".document-tool-rail");
    const canvas = page.getByTestId("ether-canvas-surface");
    await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(canvas).toHaveAttribute("data-graph-node-count", "0");
    await expect(page.locator(".react-flow__node")).toHaveCount(0);

    const toolLabels = (await rail.getByRole("button").allTextContents()).map((label) => label.trim()).filter(Boolean);
    const authoringTools = toolLabels.filter((label) => ["Prompt", "Image"].includes(label));
    const libraryMatchesRejected = authoringTools.length === 2 && authoringTools.includes("Prompt") && authoringTools.includes("Image") && !toolLabels.includes("Worker");
    observations.push({
      code: "BL-01-node-library",
      expectedRejectedBehavior: "A blank document exposes only Prompt and Image authoring tools rather than the 17-node Node Library.",
      actual: `Visible tool rail: ${toolLabels.join(", ") || "none"}.`,
      matchesRejectedCandidate: libraryMatchesRejected,
      hesitationOrWorkaround: "No searchable Node Library route was available; the only visible creation controls were inspected first."
    });
    input.observe("BL-01 node discovery", observations[0]!.expectedRejectedBehavior, observations[0]!.actual);
    await screenshot(input, evidence, "01-blank-authoring-tools", "Blank-document Build tools are visible after ordinary bootstrap.");

    await input.leftClick(rail.getByRole("button", { name: "Prompt", exact: true }), "Add Prompt from blank tool rail", "A Prompt node is added through the visible UI.");
    await expect(page.getByTestId("ether-node")).toHaveCount(1);
    await screenshot(input, evidence, "02-prompt-created", "Prompt creation is captured after the real click.");
    await input.leftClick(rail.getByRole("button", { name: "Image", exact: true }), "Add Image from blank tool rail", "An Image node is added through the visible UI.");
    await expect(page.getByTestId("ether-node")).toHaveCount(2);
    await screenshot(input, evidence, "03-image-created", "Image creation is captured after the real click.");

    const cards = page.getByTestId("ether-node");
    const imageBounds = await requiredBox(cards.nth(1), "second node");
    await input.leftDrag(center(imageBounds), { x: imageBounds.x + imageBounds.width / 2 + 320, y: imageBounds.y + imageBounds.height / 2 + 60 }, "Separate the second node with ordinary left drag", "The node moves before marquee testing.");
    await page.waitForTimeout(350);
    await screenshot(input, evidence, "04-node-left-drag", "The ordinary left drag result is captured.");

    const firstBounds = await requiredBox(cards.nth(0), "first node");
    const secondBounds = await requiredBox(cards.nth(1), "second node after move");
    const canvasBounds = await requiredBox(canvas, "canvas");
    await input.leftMarquee(...marqueeAround(firstBounds, canvasBounds), "Select the first node with a left marquee", "The ordinary left marquee selects its node.");
    await screenshot(input, evidence, "05-left-marquee", "The left-marquee result is captured.");
    const plainMarqueeSelection = await selectedNodeIds(page);
    await input.shiftMarquee(...marqueeAround(secondBounds, canvasBounds), "Add the second node with Shift marquee", "Shift marquee preserves the first selection and adds the second.");
    await screenshot(input, evidence, "06-shift-marquee", "The Shift-marquee result is captured.");
    const shiftMarqueeSelection = await selectedNodeIds(page);
    await input.rightDragPan(
      { x: canvasBounds.x + 60, y: canvasBounds.y + canvasBounds.height - 72 },
      { x: canvasBounds.x + 180, y: canvasBounds.y + canvasBounds.height - 118 },
      "Pan with a right drag",
      "Canvas pans without changing the current node selection or opening a context menu."
    );
    await screenshot(input, evidence, "07-right-drag-pan", "The right-drag pan result is captured.");
    const pointerMatchesRejected = plainMarqueeSelection.length === 0 || shiftMarqueeSelection.length < 2;
    observations.push({
      code: "BL-02-marquee-pointer",
      expectedRejectedBehavior: "Ordinary marquee/pointer ownership is unreliable; Shift marquee does not reliably add to the current selection.",
      actual: `Left marquee selected ${plainMarqueeSelection.length}; Shift marquee selected ${shiftMarqueeSelection.length}.`,
      matchesRejectedCandidate: pointerMatchesRejected,
      hesitationOrWorkaround: "Nodes were manually separated before testing because the two visible creation buttons place them in overlapping positions."
    });
    input.observe("BL-02 marquee and pointer", observations[1]!.expectedRejectedBehavior, observations[1]!.actual);
    await screenshot(input, evidence, "08-marquee-observation", "The recorded marquee observation is captured.");

    const shortcutBefore = await page.getByTestId("ether-node").count();
    await input.pressKey("Control+D", "Try Ctrl+D graph duplicate", "A selected graph object duplicates with a visible offset.");
    await screenshot(input, evidence, "09-shortcut-duplicate", "The Ctrl+D result is captured.");
    const afterDuplicate = await page.getByTestId("ether-node").count();
    await input.pressKey("Control+C", "Try Ctrl+C graph copy", "The selected graph object enters the graph clipboard.");
    await screenshot(input, evidence, "10-shortcut-copy", "The Ctrl+C result is captured.");
    await input.pressKey("Control+V", "Try Ctrl+V graph paste", "The graph clipboard pastes a duplicate selection.");
    await screenshot(input, evidence, "11-shortcut-paste", "The Ctrl+V result is captured.");
    const afterPaste = await page.getByTestId("ether-node").count();
    await input.pressKey("Delete", "Try Delete graph command", "Selected graph objects are removed with graph-aware behavior.");
    await screenshot(input, evidence, "12-shortcut-delete", "The Delete result is captured.");
    const afterDelete = await page.getByTestId("ether-node").count();
    await input.pressKey("Control+Z", "Try Ctrl+Z graph undo", "The last graph mutation is undone.");
    await screenshot(input, evidence, "13-shortcut-undo", "The Ctrl+Z result is captured.");
    const afterUndo = await page.getByTestId("ether-node").count();
    const shortcutsMatchRejected = [afterDuplicate, afterPaste, afterDelete, afterUndo].every((count) => count === shortcutBefore);
    observations.push({
      code: "BL-03-graph-shortcuts",
      expectedRejectedBehavior: "Ctrl+D, clipboard, Delete, and undo do not provide graph-aware commands when canvas input owns the interaction.",
      actual: `Node counts before/after Ctrl+D/Ctrl+V/Delete/Ctrl+Z: ${shortcutBefore}/${afterDuplicate}/${afterPaste}/${afterDelete}/${afterUndo}.`,
      matchesRejectedCandidate: shortcutsMatchRejected,
      hesitationOrWorkaround: "No command palette or graph shortcut hint appeared, so each documented shortcut was attempted directly after a real canvas interaction."
    });
    input.observe("BL-03 graph shortcuts", observations[2]!.expectedRejectedBehavior, observations[2]!.actual);
    await screenshot(input, evidence, "14-shortcut-observation", "The recorded shortcut observation is captured.");

    await ensureMinimumNodes(page, input, evidence, rail, 2);
    const promptCard = page.getByTestId("ether-node").first();
    const inlineEditorOpened = await input.inlineText(
      promptCard.locator(".ether-node-preview"),
      promptCard,
      "A directly edited blank-canvas prompt",
      "Edit primary Prompt content inline",
      "The primary authored prompt content enters an inline editor and receives keyboard text."
    );
    await screenshot(input, evidence, "15-inline-primary-content", "The inline-primary-content result is captured.");
    observations.push({
      code: "BL-04-primary-inline-edit",
      expectedRejectedBehavior: "Double-clicking primary node content does not expose a direct canvas editor.",
      actual: inlineEditorOpened ? "An inline editor appeared and received keyboard text." : "No inline editor appeared for primary content after the real double click.",
      matchesRejectedCandidate: !inlineEditorOpened,
      hesitationOrWorkaround: "The visible node title can be renamed separately, but the primary preview was targeted to avoid substituting title editing for authored content editing."
    });
    input.observe("BL-04 direct primary-content edit", observations[3]!.expectedRejectedBehavior, observations[3]!.actual);
    await screenshot(input, evidence, "16-inline-edit-observation", "The recorded inline-edit observation is captured.");

    const moduleCards = page.getByTestId("ether-node");
    const moduleCanvasBounds = await requiredBox(canvas, "canvas before module");
    const moduleBoxes = [await requiredBox(moduleCards.nth(0), "module first node"), await requiredBox(moduleCards.nth(1), "module second node")];
    await input.leftMarquee(...marqueeAround(combineBoxes(moduleBoxes), moduleCanvasBounds), "Select multiple nodes for organization", "The two nodes are selected before creating an organizational container.");
    await screenshot(input, evidence, "17-module-selection", "The organizational selection result is captured.");
    const groupButton = page.getByRole("button", { name: "Group", exact: true });
    const moduleButton = page.getByRole("button", { name: "Module", exact: true });
    const groupVisible = await groupButton.isVisible();
    await input.leftClick(groupButton, "Try the visible Group command", "Only the Module organization journey is exposed to users.");
    await screenshot(input, evidence, "18-group-command", "The Group command result is captured.");
    await input.leftClick(moduleButton, "Try the visible Module command", "A selected workflow becomes a locked Module with an organization journey.");
    await page.waitForTimeout(350);
    await screenshot(input, evidence, "19-module-command", "The Module command result is captured.");
    const moduleCount = await page.getByTestId("ether-module-node").count();
    const lockControls = await page.getByRole("button", { name: /lock/i }).count();
    const moduleMatchesRejected = groupVisible && lockControls === 0;
    observations.push({
      code: "BL-05-groups-modules",
      expectedRejectedBehavior: "Visual Group remains alongside Module, while the Module surface lacks a locked-by-default organization journey.",
      actual: `Group command visible=${groupVisible}; module cards created=${moduleCount}; visible lock controls=${lockControls}.`,
      matchesRejectedCandidate: moduleMatchesRejected,
      hesitationOrWorkaround: "The Group command was tried before Module because both organizational concepts remain exposed; no lock control or replacement route was discoverable."
    });
    input.observe("BL-05 Groups and Modules", observations[4]!.expectedRejectedBehavior, observations[4]!.actual);
    await screenshot(input, evidence, "20-groups-modules-observation", "The recorded Groups/Modules observation is captured.");

    expect(observations.map((observation) => observation.code)).toEqual(AUTHORING_BASELINE_CODES);
    const allRejectedBehaviorsReproduced = observations.every((observation) => observation.matchesRejectedCandidate);
    const evidencePath = await session.close(allRejectedBehaviorsReproduced ? "baseline-defects-reproduced" : "failed");
    closed = true;
    await writeAuthoringBaselineReport(evidencePath, { schemaVersion: 1, mode, observations });
    if (!allRejectedBehaviorsReproduced) {
      throw new Error(`The current ${mode} behavior diverged from the rejected baseline: ${observations.filter((observation) => !observation.matchesRejectedCandidate).map((observation) => observation.code).join(", ")}. Evidence was recorded without changing the expected baseline.`);
    }
    await validateAuthoringBaselineEvidence(evidencePath, mode);
  } finally {
    if (!closed) await session.close("failed");
  }
});

async function assertBaselineSpecIsSafe(): Promise<void> {
  assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "authoring baseline spec");
}

function baselineMode(): JourneyMode {
  const mode = process.env.ETHER_RECOVERY_BASELINE_MODE;
  if (mode === "source-electron" || mode === "packaged") return mode;
  throw new Error("Set ETHER_RECOVERY_BASELINE_MODE to source-electron or packaged.");
}

async function screenshot(
  input: RealPageInput,
  evidence: JourneyEvidencePaths,
  label: string,
  expected: string
): Promise<void> {
  await input.screenshot(`${label}.png`, evidence, `Capture ${label}`, expected);
}

async function requiredBox(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`${label} has no visible bounding box.`);
  return box;
}

function center(box: { x: number; y: number; width: number; height: number }): JourneyPoint {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function marqueeAround(
  box: { x: number; y: number; width: number; height: number },
  canvas: { x: number; y: number; width: number; height: number }
): [JourneyPoint, JourneyPoint] {
  return [{
    x: Math.max(canvas.x + 8, box.x - 16),
    y: Math.max(canvas.y + 8, box.y - 16)
  }, {
    x: Math.min(canvas.x + canvas.width - 8, box.x + box.width + 16),
    y: Math.min(canvas.y + canvas.height - 8, box.y + box.height + 16)
  }];
}

function combineBoxes(boxes: Array<{ x: number; y: number; width: number; height: number }>) {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

async function selectedNodeIds(page: Page): Promise<string[]> {
  return page.getByTestId("ether-node").evaluateAll((elements) => elements
    .filter((element) => element.classList.contains("is-selected"))
    .map((element) => element.getAttribute("data-node-id") ?? "unknown"));
}

async function ensureMinimumNodes(
  page: Page,
  input: RealPageInput,
  evidence: JourneyEvidencePaths,
  rail: Locator,
  minimum: number
): Promise<void> {
  while (await page.getByTestId("ether-node").count() < minimum) {
    await input.leftClick(rail.getByRole("button", { name: "Prompt", exact: true }), "Restore a node through visible UI after shortcut probing", "A replacement node is added through the tool rail.");
    await screenshot(input, evidence, `restore-node-${await page.getByTestId("ether-node").count()}`, "The visible UI restoration is captured.");
  }
}

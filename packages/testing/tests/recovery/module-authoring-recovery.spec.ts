import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  assertAuthoringJourneySourceSafety,
  blankAuthoringJourney,
  launchRecoveryJourney,
  packagedJourneyConfig,
  sourceElectronJourneyConfig,
  type JourneyPoint,
  type RealPageInput
} from "../../recovery/journeyDriver.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const thisSource = fileURLToPath(import.meta.url);
const journeyId = "module-authoring-recovery";
const sourceElectronDiagnostic = process.env.ETHER_RECOVERY_SOURCE_ELECTRON === "1";

test.skip(process.platform !== "win32", "The module recovery journey runs against packaged Windows Ether.exe.");

test("authors, protects, edits, navigates, reorganizes, and dissolves a Module from a blank packaged document", async () => {
  assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "module authoring recovery spec");
  const session = await launchRecoveryJourney({
    ...(sourceElectronDiagnostic ? sourceElectronJourneyConfig(workspaceRoot, journeyId) : packagedJourneyConfig(workspaceRoot, journeyId)),
    evidenceMode: sourceElectronDiagnostic ? "ephemeral" : "committed",
    ...(sourceElectronDiagnostic ? {} : { committedEvidencePath: ["phase-2", "module-authoring"] }),
    ...(sourceElectronDiagnostic ? {
      sourceEntrypoint: path.join(workspaceRoot, "packages", "testing", "fixtures", "desktop-main.mjs"),
      sourceArgs: (profile: { root: string }) => [`--fixture-root=${profile.root}`]
    } : {}),
    viewport: { width: 1600, height: 1000 },
    declaration: blankAuthoringJourney(journeyId)
  });
  let closed = false;
  try {
    const { page, input, evidence } = session;
    const canvas = page.getByTestId("ether-canvas-surface");
    await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(canvas).toHaveAttribute("data-graph-node-count", "0");

    await addDefinition(page, input, "prompt.text", 1);
    await addDefinition(page, input, "prompt.worker", 2);
    await canvas.focus();
    await input.pressKey("Control+A", "Select the workflow for a Module", "The canvas-owned select-all command selects both blank-authored nodes before organization.");
    await expect.poll(() => selectedNodeCount(page)).toBe(2);
    const createModule = page.getByRole("button", { name: "Create module", exact: true });
    await expect(createModule).toBeEnabled();
    await input.leftClick(createModule, "Create Module from selection", "The visible command moves the selection into one locked, durable Module through the shared graph command.");

    const moduleCard = page.getByTestId("ether-module-node");
    await expect(moduleCard).toHaveCount(1);
    await expect(moduleCard).toHaveAttribute("data-module-locked", "true");
    await expect(page.getByTestId("ether-node")).toHaveCount(0);
    input.observe("Locked by default", "New Modules protect their contents and position until explicitly unlocked.", "The new Module replaced both parent nodes and reported data-module-locked=true.");
    await input.screenshot("01-locked-module-created.png", evidence, "Capture locked Module creation", "A blank-authored selection is visibly represented as Ether's single locked organizational container.");

    const lockedBefore = await requiredBox(moduleCard, "locked Module before movement attempt");
    await input.leftDrag(center(lockedBefore), { x: center(lockedBefore).x + 180, y: center(lockedBefore).y + 90 }, "Try to move the locked Module", "A locked Module remains fixed on the parent canvas.");
    const lockedAfter = await requiredBox(moduleCard, "locked Module after movement attempt");
    expect(Math.abs(lockedAfter.x - lockedBefore.x)).toBeLessThan(2);
    expect(Math.abs(lockedAfter.y - lockedBefore.y)).toBeLessThan(2);

    await input.leftClick(moduleCard.locator(".ether-module-title"), "Select the Module", "The Project lens switches to the Module inspector.");
    const inspector = page.getByTestId("module-inspector");
    await expect(inspector).toContainText("Locked module");
    await input.pressKey("F2", "Focus Module rename", "F2 targets the selected Module title field.");
    const title = page.getByLabel("Module title");
    await expect(title).toBeFocused();
    await title.fill("Campaign engine");
    await page.getByLabel("Module description").fill("Reusable campaign direction and worker handoff");
    await input.leftClick(inspector.locator('label[title="Violet"]'), "Choose the Module highlight", "The Module uses a deliberate Violet accent.");
    await input.leftClick(inspector.getByRole("button", { name: "Save details" }), "Save Module details", "Title, description, and accent commit together.");
    await expect(moduleCard).toContainText("Campaign engine");
    await expect(moduleCard).toContainText("Reusable campaign direction and worker handoff");
    await input.leftClick(inspector.getByRole("button", { name: "Unlock module" }), "Explicitly unlock the Module", "Parent-canvas movement and membership controls become available only after this action.");
    await expect(moduleCard).toHaveAttribute("data-module-locked", "false");

    const unlockedBefore = await requiredBox(moduleCard, "unlocked Module before movement");
    await input.leftDrag(center(unlockedBefore), { x: center(unlockedBefore).x + 170, y: center(unlockedBefore).y + 70 }, "Move the unlocked Module", "The explicitly unlocked Module can be repositioned on the parent canvas.");
    await expect.poll(async () => (await requiredBox(moduleCard, "unlocked Module after movement")).x).toBeGreaterThan(unlockedBefore.x + 100);

    await input.leftClick(moduleCard.locator(".ether-module-title"), "Restore Module selection", "The moved Module remains the current organization target.");
    await input.leftClick(inspector.getByRole("button", { name: "Collapse" }), "Collapse the Module", "Collapse compacts presentation without deleting its internal graph.");
    await expect(moduleCard).toContainText("Collapsed");
    expect((await requiredBox(moduleCard, "collapsed Module")).height).toBeLessThanOrEqual(114);
    await input.screenshot("02-module-details-and-collapse.png", evidence, "Capture edited collapsed Module", "The Module visibly carries its title, description, Violet highlight, unlocked state, and compact presentation.");
    await input.leftClick(moduleCard.getByRole("button", { name: "Expand" }), "Expand the Module", "The full Module presentation returns with its durable metadata.");

    await input.leftClick(moduleCard.locator(".ether-module-title"), "Select Module for keyboard entry", "Canvas focus can enter the selected Module through the primary edit shortcut.");
    await expect(moduleCard).toHaveClass(/is-selected/u);
    await canvas.focus();
    await input.pressKey("Enter", "Enter the Module", "Enter opens the Module's independently editable internal graph.");
    await expect(page.getByLabel("Canvas legend")).toContainText("Campaign engine");
    await expect(page.getByTestId("ether-node")).toHaveCount(2);
    await input.screenshot("03-module-interior.png", evidence, "Capture Module interior", "Both original blank-authored members are visible inside the Module workspace.");

    await input.leftClick(page.getByTestId("ether-node").first().locator(".ether-node-main"), "Select one Module member", "One internal member becomes the membership change target.");
    await input.leftClick(page.getByRole("button", { name: "Move selected to parent" }), "Move a member to the parent", "Unlocked membership editing moves the selected node out without recreating it.");
    await expect(page.getByTestId("ether-node")).toHaveCount(1);
    await input.leftClick(page.getByRole("button", { name: "Leave module" }), "Leave the Module", "The parent viewport and Module selection are restored.");
    await expect(page.getByTestId("ether-module-node")).toHaveCount(1);
    await expect(page.getByTestId("ether-node")).toHaveCount(1);

    const parentNode = page.getByTestId("ether-node").first();
    await input.leftClick(parentNode.locator(".ether-node-main"), "Select the parent node", "The moved member is selected for reassignment.");
    await expect.poll(() => selectedNodeCount(page)).toBe(1);
    await page.keyboard.down("Shift");
    try {
      await input.leftClick(moduleCard.locator(".ether-module-title"), "Add the Module to the selection context", "Shift-click preserves the selected parent node while opening Module membership controls.");
    } finally {
      await page.keyboard.up("Shift");
    }
    await expect(inspector.getByRole("button", { name: "Add selected to module" })).toBeEnabled();
    await input.leftClick(inspector.getByRole("button", { name: "Add selected to module" }), "Add the selected node to the Module", "The existing node returns to the Module through the explicit membership command.");
    await expect(page.getByTestId("ether-node")).toHaveCount(0);
    await expect(inspector).toContainText("2 members");
    input.observe("Durable membership", "Members move across the parent/Module boundary without duplicate identities or hidden leftovers.", "The internal count changed 2 -> 1 -> 2 while the parent count changed 0 -> 1 -> 0.");

    await input.leftClick(inspector.getByRole("button", { name: "Relock module" }), "Relock the Module", "The completed organization is protected again explicitly.");
    await expect(moduleCard).toHaveAttribute("data-module-locked", "true");
    await input.screenshot("04-module-membership-relocked.png", evidence, "Capture relocked membership", "The two-member Module is visibly relocked after a complete membership round trip.");
    await input.leftClick(inspector.getByRole("button", { name: "Unlock module" }), "Unlock before dissolution", "Dissolution remains a deliberate action unavailable while locked.");
    const advanced = inspector.locator("details.inspector-disclosure");
    await advanced.locator("summary").click();
    const dissolve = advanced.getByRole("button", { name: /Dissolve module/u });
    await expect(dissolve).toBeEnabled();
    page.once("dialog", (dialog) => void dialog.accept());
    await input.leftClick(dissolve, "Confirm Module dissolution", "Dissolve restores both members to the parent in one undoable transaction.");
    await expect(page.getByTestId("ether-module-node")).toHaveCount(0);
    await expect(page.getByTestId("ether-node")).toHaveCount(2);
    await input.screenshot("05-dissolved-members.png", evidence, "Capture dissolved Module", "Both original members are restored to the parent canvas with no Module shell left behind.");

    await canvas.focus();
    await input.pressKey("Control+Z", "Undo Module dissolution", "Undo restores the Module and removes the restored parent copies atomically.");
    await expect(page.getByTestId("ether-module-node")).toHaveCount(1);
    await expect(page.getByTestId("ether-node")).toHaveCount(0);
    await input.leftClick(page.getByTestId("ether-module-node").locator(".ether-module-title"), "Inspect the restored Module", "Undo preserves the Module metadata and explicit lock state from immediately before dissolution.");
    await expect(page.getByLabel("Module title")).toHaveValue("Campaign engine");
    await expect(page.getByLabel("Module description")).toHaveValue("Reusable campaign direction and worker handoff");
    await input.leftClick(page.getByTestId("module-inspector").getByRole("button", { name: "Relock module" }), "Relock the restored Module", "The practical journey ends with the recovered organization protected.");
    await expect(page.getByTestId("ether-module-node")).toHaveAttribute("data-module-locked", "true");
    await input.screenshot("06-dissolve-undone.png", evidence, "Capture dissolution undo", "Undo visibly restores the named two-member Module, ready in its protected state.");

    await session.close("passed");
    closed = true;
  } finally {
    if (!closed) await session.close("failed");
  }
});

async function addDefinition(page: Page, input: RealPageInput, definition: string, expectedCount: number) {
  const row = page.locator(`.node-library-item[data-node-definition='${definition}']`);
  await row.scrollIntoViewIfNeeded();
  await input.leftClick(row.locator(".node-library-add"), `Add ${definition} from Node Library`, `The blank document creates ${definition} through the registry-backed factory.`);
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

async function selectedNodeCount(page: Page) {
  return page.getByTestId("ether-node").evaluateAll((nodes) => nodes.filter((node) => node.classList.contains("is-selected")).length);
}

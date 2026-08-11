import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import {
  assertAuthoringJourneySourceSafety,
  blankAuthoringJourney,
  launchRecoveryJourney,
  packagedJourneyConfig
} from "../../recovery/journeyDriver.js";
import {
  addFromCanvasQuickAdd,
  addFromLibraryWithKeyboard,
  activeElementDescription,
  assertKeyboardOnlyJourneySource,
  assertReducedMotion,
  keyboardActivate,
  selectedNodeCount,
  tabTo,
  typeWithKeyboard
} from "./t23KeyboardJourneyHelpers.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const thisSource = fileURLToPath(import.meta.url);
const helperSource = fileURLToPath(new URL("./t23KeyboardJourneyHelpers.ts", import.meta.url));
const journeyId = "t23-keyboard-packaged";

test.skip(process.platform !== "win32", "The T23 keyboard journey runs against packaged Windows Ether.exe.");

test("authors and edits a blank packaged document with keyboard-only J03 controls", async () => {
  const [source, helper] = await Promise.all([readFile(thisSource, "utf8"), readFile(helperSource, "utf8")]);
  assertAuthoringJourneySourceSafety(source, "T23 keyboard packaged spec");
  assertKeyboardOnlyJourneySource({ label: "T23 keyboard packaged spec", source }, { label: "T23 keyboard journey helper", source: helper });
  const session = await launchRecoveryJourney({
    ...packagedJourneyConfig(workspaceRoot, journeyId),
    evidenceMode: "committed",
    committedEvidencePath: ["phase-5", "t23-keyboard-packaged"],
    viewport: { width: 1440, height: 900 },
    declaration: blankAuthoringJourney(journeyId)
  });
  let closed = false;
  try {
    const { page, input, evidence } = session;
    const canvas = page.getByTestId("ether-canvas-surface");
    const status = page.getByTestId("canvas-status");
    await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(canvas).toHaveAttribute("data-graph-node-count", "0");
    await expect(status).toHaveAttribute("aria-live", "polite");
    input.observe("Initial keyboard focus", "Keyboard traversal begins from the application's actual initial active element.", await activeElementDescription(page));
    await assertReducedMotion(page);

    await addFromLibraryWithKeyboard(page, input, "Prompt", "Prompt", 1);
    await addFromCanvasQuickAdd(page, input, "Note", "Note", 2);

    const promptTitle = canvas.locator(".ether-node[data-node-definition='prompt.text'] .ether-node-title");
    await keyboardActivate(page, input, promptTitle, "Select Prompt from its focused title", "Space selects the keyboard-reached node without using a pointer.", "Space");
    await expect.poll(() => selectedNodeCount(page)).toBe(1);
    await input.pressKey("F2", "Open the focused Prompt title editor", "F2 opens one bounded title editor for the selected Prompt.");
    const titleEditor = page.locator(".ether-node-inline-editor input");
    await expect(titleEditor).toBeFocused();
    await input.pressKey("Control+A", "Select title editor text", "The inline editor keeps Ctrl+A local instead of selecting graph nodes.");
    await typeWithKeyboard(page, input, "Keyboard brief", "Type the Prompt title", "The bounded F2 editor receives typed text while graph selection remains unchanged.");
    await expect.poll(() => selectedNodeCount(page)).toBe(1);
    await input.pressKey("Enter", "Commit the focused title editor", "Enter commits the title edit and closes the inline editor.");
    await expect(titleEditor).toBeHidden();
    const renamedTitle = canvas.getByRole("button", { name: "Keyboard brief", exact: true });
    await expect(renamedTitle).toBeVisible();

    await tabTo(page, input, canvas, "Return to the canvas after title editing");
    await input.pressKey("Control+A", "Select both authored nodes", "The canvas-owned command selects the two blank-authored nodes.");
    await expect.poll(() => selectedNodeCount(page)).toBe(2);
    input.observe("Keyboard multi-selection", "Ctrl+A is the documented keyboard route for selecting all authored canvas nodes.", "The blank-authored Prompt and Note are selected together before duplicate, copy, paste, delete, undo, and redo.");
    await input.pressKey("Control+D", "Duplicate the keyboard selection", "Duplicate creates two offset graph nodes without opening an editor.");
    await expect(canvas).toHaveAttribute("data-graph-node-count", "4");
    await input.pressKey("Control+C", "Copy the duplicated selection", "Copy retains the selected graph subgraph for the ordinary clipboard command.");
    await input.pressKey("Control+V", "Paste the graph selection", "Paste creates fresh graph identities through the canvas command.");
    await expect(canvas).toHaveAttribute("data-graph-node-count", "6");
    await input.pressKey("Delete", "Delete the pasted selection", "Delete removes only the current selection and reports the mutation through the polite canvas status.");
    await expect(canvas).toHaveAttribute("data-graph-node-count", "4");
    await expect.poll(() => status.innerText()).toContain("Delete");
    await input.pressKey("Control+Z", "Undo the keyboard delete", "Undo restores the pasted selection.");
    await expect(canvas).toHaveAttribute("data-graph-node-count", "6");
    await input.pressKey("Control+Y", "Redo the keyboard delete", "Redo reapplies the deletion without losing canvas focus.");
    await expect(canvas).toHaveAttribute("data-graph-node-count", "4");
    await expect(canvas).toBeFocused();

    await keyboardActivate(page, input, renamedTitle, "Restore the edited Prompt selection", "The renamed Prompt is selected for its keyboard-accessible Inspector help.", "Space");
    const help = page.getByRole("button", { name: "Setup help", exact: true });
    await tabTo(page, input, help, "Reach Setup help");
    const tooltipId = await help.getAttribute("aria-describedby");
    if (tooltipId === null) throw new Error("Setup help did not expose a tooltip description.");
    const tooltip = page.locator(`#${tooltipId}`);
    await expect(tooltip).toHaveAttribute("role", "tooltip");
    await expect(tooltip).toHaveAttribute("data-open", "true");
    await input.pressKey("Escape", "Dismiss the focused Setup tooltip", "Escape closes the focus tooltip without changing graph selection.");
    await expect(tooltip).toHaveAttribute("data-open", "false");

    const shortcutButton = page.getByRole("button", { name: "Keyboard and pointer reference", exact: true });
    await keyboardActivate(page, input, shortcutButton, "Open keyboard reference from its focused toolbar control", "Enter opens the keyboard-help modal and transfers focus inside it.");
    const shortcutDialog = page.getByRole("dialog", { name: "Keyboard and pointer reference" });
    await expect(shortcutDialog).toBeVisible();
    await expect(shortcutDialog.getByRole("button", { name: "Close keyboard and pointer reference" })).toBeFocused();
    await input.pressKey("Escape", "Close keyboard reference", "Escape closes the modal and returns focus to its toolbar trigger.");
    await expect(shortcutDialog).toBeHidden();
    await expect(shortcutButton).toBeFocused();

    input.observe("Keyboard-only J03 subset", "The fresh packaged document was authored, edited, multi-selected, duplicated, copied, pasted, deleted, undone, and redone using keyboard focus and real key events.", "Library Tab/Enter, canvas N/Enter, F2/Enter, Ctrl+A multi-selection, graph shortcuts, a focus tooltip, reduced-motion CSS targets, and modal Escape focus return all remained available. Pointer-only marquee and move are outside this keyboard subset.");
    await input.screenshot("01-keyboard-authoring.png", evidence, "Capture keyboard-only authoring state", "The packaged blank-authored canvas visibly retains the renamed node after keyboard-only commands.");
    await session.close("passed");
    closed = true;
  } finally {
    if (!closed) await session.close("failed");
  }
});

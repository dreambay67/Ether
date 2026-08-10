import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import {
  assertAuthoringJourneySourceSafety,
  blankAuthoringJourney,
  launchRecoveryJourney,
  packagedJourneyConfig,
  type RealPageInput
} from "../../recovery/journeyDriver.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const thisSource = fileURLToPath(import.meta.url);
const journeyId = "manual-recovery";
const channels = ["text", "image", "mask", "data", "video", "audio"] as const;

test.skip(process.platform !== "win32", "The manual journey runs against packaged Windows Ether.exe.");

test("captures the manual from visible blank-document actions without provider work", async () => {
  test.setTimeout(12 * 60_000);
  assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "manual recovery spec");
  const session = await launchRecoveryJourney({
    ...packagedJourneyConfig(workspaceRoot, journeyId),
    evidenceMode: "committed",
    committedEvidencePath: ["phase-5", "manual-packaged"],
    viewport: { width: 1600, height: 1000 },
    declaration: blankAuthoringJourney(journeyId)
  });
  let closed = false;
  try {
    const { page, input, evidence } = session;
    const canvas = page.getByTestId("ether-canvas-surface");
    await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(canvas).toHaveAttribute("data-graph-node-count", "0");
    await expect(page.getByTestId("node-library").locator(".node-library-item")).toHaveCount(17);
    await expect(page.getByText("Start in three moves.", { exact: true })).toBeVisible();
    input.observe("Blank first-run state", "A fresh profile begins with a blank writable graph, the 17-node Library, and concise first steps.", "The canvas reported zero nodes and showed the three-step guide.");
    await input.screenshot("01-first-run-blank.png", evidence, "Capture first-run guidance", "The packaged blank document shows the registry Library and three practical starting steps.");

    await input.leftClick(page.getByRole("button", { name: "Keyboard and pointer reference" }), "Open the shortcut reference", "The Canvas toolbar exposes commands and gestures without requiring pointer hover.");
    const shortcutDialog = page.getByRole("dialog", { name: "Keyboard and pointer reference" });
    await expect(shortcutDialog).toBeVisible();
    await expect(shortcutDialog.getByText("Shift + left drag", { exact: true })).toBeVisible();
    await expect(shortcutDialog.getByText("Ctrl+G", { exact: true })).toBeVisible();
    await input.screenshot("02-shortcut-reference.png", evidence, "Capture the shortcut reference", "Keyboard commands and pointer gestures are readable in one focused dialog.");
    await input.pressKey("Escape", "Close the shortcut reference", "Escape closes the modal and returns focus to its toolbar button.");
    await expect(shortcutDialog).toBeHidden();

    await addDefinition(page, input, "prompt.text");
    await addDefinition(page, input, "prompt.worker");
    await addDefinition(page, input, "review.evaluate");
    await addDefinition(page, input, "flow.batch");
    for (const panel of ["Reference Desk", "Build tools", "Project lens"]) {
      await input.leftClick(page.getByRole("button", { name: `Hide ${panel}`, exact: true }), `Hide ${panel}`, "The canvas gains room for the authoring action.");
    }
    await canvas.focus();
    await input.pressKey("Home", "Fit the authored nodes", "The four blank-authored cards and their channel rails fit the visible canvas.");
    await page.waitForTimeout(450);

    const prompt = page.locator(".ether-node[data-node-definition='prompt.text']");
    const worker = page.locator(".ether-node[data-node-definition='prompt.worker']");
    await input.leftClick(prompt.locator(".ether-node-title"), "Select Prompt for direct editing", "The Prompt becomes the primary canvas selection.");
    await input.pressKey("F2", "Rename the Prompt", "F2 opens the bounded title editor.");
    const titleEditor = prompt.locator(".ether-node-inline-editor input");
    await titleEditor.fill("Campaign brief");
    await input.pressKey("Enter", "Commit the Prompt title", "Enter saves the title as one graph transaction.");
    await input.leftClick(prompt.getByRole("button", { name: "Edit Prompt body", exact: true }), "Focus Prompt content", "The renamed Prompt's primary content control owns keyboard focus.");
    await input.pressKey("Enter", "Edit Prompt content", "Enter opens the primary content editor on the card.");
    const contentEditor = prompt.locator(".ether-node-inline-editor textarea");
    await contentEditor.fill("Design a quiet coastal campaign in crisp morning light.");
    await input.screenshot("03-direct-editing.png", evidence, "Capture direct editing", "The packaged canvas shows one controlled in-place content editor.");
    await input.pressKey("Control+Enter", "Commit Prompt content", "Ctrl+Enter saves the edit without starting a run.");
    await expect(contentEditor).toBeHidden();
    await expect(page.getByTestId("canvas-status")).toContainText("Edit node content saved");

    const evaluate = page.locator(".ether-node[data-node-definition='review.evaluate']");
    const batch = page.locator(".ether-node[data-node-definition='flow.batch']");
    for (const [index, channel] of channels.entries()) {
      const label = channelLabel(channel);
      await evaluate.getByLabel(`${label} output`).hover();
      await input.leftClick(evaluate.getByLabel(`${label} output`), `Begin ${label} lane`, `Compatible ${label} inputs become visible before the lane is saved.`);
      await expect(batch.getByTestId(`channel-zone-input-${channel}`)).toHaveAttribute("data-compatible", "true");
      await batch.getByLabel(`${label} input`).hover();
      await input.leftClick(batch.getByLabel(`${label} input`), `Complete ${label} lane`, `The ${label} lane persists through the visible canvas interaction.`);
      await expect(page.getByTestId("canvas-status")).toContainText("Connect nodes saved");
      await expect(page.locator(".ether-edge-hit-target")).toHaveCount(index + 1);
    }
    const firstRole = page.getByTestId("edge-role-chip").first();
    await input.leftClick(firstRole.getByRole("button", { name: "General" }), "Open semantic roles", "The lane exposes the shared semantic role grid.");
    await input.leftClick(page.getByTestId("edge-role-grid").getByRole("button", { name: "Subject" }), "Set the Subject role", "The Text lane carries a visible Subject badge.");
    await input.screenshot("04-channels-and-roles.png", evidence, "Capture channels and roles", "All six channel lanes coexist and one lane shows its semantic Subject role.");

    await input.leftClick(prompt.locator(".ether-node-main"), "Select Prompt for a Module", "Prompt begins the Module selection.");
    await page.keyboard.down("Shift");
    try {
      await input.leftClick(worker.locator(".ether-node-main"), "Add Worker to the Module selection", "Shift keeps Prompt selected and adds Worker.");
    } finally {
      await page.keyboard.up("Shift");
    }
    await input.pressKey("Control+G", "Create a Module", "Ctrl+G moves the two selected nodes into one locked durable Module.");
    const moduleCard = page.getByTestId("ether-module-node");
    await expect(moduleCard).toHaveAttribute("data-module-locked", "true");
    await input.screenshot("05-locked-module.png", evidence, "Capture the locked Module", "The packaged canvas shows the protected Module beside the remaining workflow.");

    await input.leftClick(page.getByRole("button", { name: "Show Build tools", exact: true }), "Restore Build tools", "The Library returns for the next documented setup.");
    await expect(page.getByRole("button", { name: "Hide Build tools", exact: true })).toBeVisible();
    await input.leftClick(page.getByRole("button", { name: "Show Project lens", exact: true }), "Restore Project lens", "The Inspector returns for setup details.");
    await expect(page.getByRole("button", { name: "Hide Project lens", exact: true })).toBeVisible();
    await input.leftClick(page.getByRole("button", { name: "Show Reference Desk", exact: true }), "Restore Reference Desk", "The source desk returns above the canvas.");
    await expect(page.getByRole("button", { name: "Hide Reference Desk", exact: true })).toBeVisible();
    await addDefinition(page, input, "reference.set");
    const referenceSet = page.locator(".ether-node[data-node-definition='reference.set']");
    await input.leftClick(referenceSet.locator(".ether-node-title"), "Select Reference Set", "Reference controls and the empty source desk share the visible Build workspace.");
    await expect(page.getByTestId("pane-artifacts").getByRole("region", { name: "Reference Desk" })).toContainText("No references yet");
    await input.screenshot("06-reference-setup.png", evidence, "Capture reference setup", "Reference Set setup and the honest empty Reference Desk are visible without importing or injecting a source.");

    await input.leftClick(page.getByRole("button", { name: "Run", exact: true }), "Open Run workspace", "Run reveals Batch Matrix and Job Center around the same durable graph.");
    const batchMatrix = page.getByRole("region", { name: "Batch Matrix" });
    await expect(batchMatrix).toBeVisible();
    await expect(batchMatrix.getByRole("heading", { name: "Full batch" })).toBeVisible();
    await input.screenshot("07-batch-run-workspace.png", evidence, "Capture batch planning", "The Batch Matrix shows the work set, allocation boundary, and concurrency controls without starting work.");

    await input.leftClick(page.getByRole("button", { name: "Review", exact: true }), "Open Review workspace", "Review exposes the Artifact Observatory for the current blank-authored document.");
    await expect(page.getByTestId("artifact-observatory")).toBeVisible();
    await input.screenshot("08-review-empty-state.png", evidence, "Capture Review", "The packaged Review workspace reports its empty artifact state instead of fabricating output.");

    await input.leftClick(page.getByRole("button", { name: "Build", exact: true }), "Return to Build", "The same authored graph returns for export setup.");
    await addDefinition(page, input, "output.export");
    const exportNode = page.locator(".ether-node[data-node-definition='output.export']");
    await input.leftClick(exportNode.locator(".ether-node-title"), "Select Export", "The Inspector exposes export setup before any folder grant or write.");
    const exportInspector = page.getByTestId("node-inspector");
    await expect(exportInspector).toContainText("Export settings");
    await expect(exportInspector.getByRole("button", { name: "Choose export folder", exact: true })).toHaveText("Choose export folder…");
    await expect(exportInspector).toContainText("Required before this node can write files.");
    await input.screenshot("09-export-setup.png", evidence, "Capture export setup", "Export names the required scoped folder grant, template, format, collision policy, and metadata choice before writing.");

    await addDefinition(page, input, "prompt.worker");
    const guardWorker = page.locator(".ether-node[data-node-definition='prompt.worker']").last();
    await input.leftClick(guardWorker.locator(".ether-node-title"), "Select an unconfigured Worker", "The run preview targets one visible runnable node.");
    await canvas.focus();
    await input.pressKey("Control+Enter", "Preview without a provider", "Preview stops at capability validation and starts no provider work.");
    await expect(page.getByTestId("canvas-status")).toContainText("requires an injected Worker provider capability");
    await input.screenshot("10-provider-safe-error.png", evidence, "Capture the provider guard", "The visible error explains why the plan cannot run; no provider request was sent.");

    await input.leftClick(page.getByRole("button", { name: "Recipes", exact: true }), "Open Recipe Gallery", "The versioned recipe catalog opens without applying a recipe.");
    const recipes = page.getByRole("dialog", { name: "Recipe Gallery" });
    await expect(recipes).toBeVisible();
    await expect(recipes.locator("[data-testid^='recipe-card-']")).toHaveCount(12);
    await input.screenshot("11-recipe-gallery.png", evidence, "Capture Recipe Gallery", "All 12 recipe cards are visible before setup, mutation, or provider work.");
    await input.pressKey("Escape", "Close Recipe Gallery", "Escape closes the recipe dialog without changing the graph.");

    await input.leftClick(page.getByRole("button", { name: "Settings", exact: true }), "Open Settings", "Settings exposes local interface, safety, recovery, and version state.");
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    await expect(settings.getByTestId("release-recovery-status")).toContainText("healthy");
    await expect(settings.getByTestId("gemini-api-settings")).toContainText("Not configured");
    await input.screenshot("12-recovery-and-provider-setup.png", evidence, "Capture recovery and provider setup", "Settings shows a healthy local recovery state and an unconfigured Gemini route without testing or connecting it.");

    input.observe("T25 manual route", "Every screenshot comes from visible actions in a fresh packaged blank document.", "The journey authored nodes, editing, six lanes, a locked Module, setup views, a provider-safe error, recipes, and recovery state without provider execution or injected graph state.");
    await session.close("passed");
    closed = true;
  } finally {
    if (!closed) await session.close("failed");
  }
});

async function addDefinition(page: Page, input: RealPageInput, definition: string) {
  const authored = page.locator(`.ether-node[data-node-definition='${definition}']`);
  const previousDefinitionCount = await authored.count();
  const canvas = page.getByTestId("ether-canvas-surface");
  const previousGraphCount = Number(await canvas.getAttribute("data-graph-node-count"));
  if (!Number.isSafeInteger(previousGraphCount)) throw new Error(`The canvas did not expose a numeric node count before adding ${definition}.`);
  const row = page.locator(`.node-library-item[data-node-definition='${definition}']`);
  await input.leftClick(row.locator(".node-library-add"), `Add ${definition} from Node Library`, `The registry creates ${definition} with canonical defaults.`);
  await expect(canvas).toHaveAttribute("data-graph-node-count", String(previousGraphCount + 1));
  if (await authored.count() === previousDefinitionCount) {
    await canvas.focus();
    await input.pressKey("Home", `Reveal ${definition} on the canvas`, "The newly saved node is brought into the rendered canvas before selection.");
  }
  await expect(authored).toHaveCount(previousDefinitionCount + 1);
}

function channelLabel(channel: typeof channels[number]) {
  return channel[0]!.toLocaleUpperCase() + channel.slice(1);
}

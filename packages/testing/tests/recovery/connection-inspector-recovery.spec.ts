import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import {
  assertAuthoringJourneySourceSafety,
  blankAuthoringJourney,
  launchRecoveryJourney,
  packagedJourneyConfig,
  sourceElectronJourneyConfig,
  type RealPageInput
} from "../../recovery/journeyDriver.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const thisSource = fileURLToPath(import.meta.url);
const journeyId = "connection-inspector-recovery";
const channels = ["text", "image", "mask", "data", "video", "audio"] as const;
const sourceElectronDiagnostic = process.env.ETHER_RECOVERY_SOURCE_ELECTRON === "1";

test.skip(process.platform !== "win32", "The connection and Inspector journey runs against packaged Windows Ether.exe.");

test("authors six-channel lanes, an adapter, and progressive Inspector controls from a blank packaged document", async () => {
  assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "connection and Inspector recovery spec");
  const session = await launchRecoveryJourney({
    ...(sourceElectronDiagnostic ? sourceElectronJourneyConfig(workspaceRoot, journeyId) : packagedJourneyConfig(workspaceRoot, journeyId)),
    evidenceMode: sourceElectronDiagnostic ? "ephemeral" : "committed",
    ...(sourceElectronDiagnostic ? {} : { committedEvidencePath: ["phase-2", "connection-inspector-authoring"] }),
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

    await addDefinition(page, input, "review.evaluate", 1);
    await addDefinition(page, input, "flow.batch", 2);
    await addDefinition(page, input, "prompt.text", 3);
    await addDefinition(page, input, "prompt.worker", 4);
    for (const panel of ["Reference Desk", "Build tools", "Project lens"]) {
      await input.leftClick(page.getByRole("button", { name: `Hide ${panel}`, exact: true }), `Hide ${panel}`, "The graph gets a clear practical authoring viewport.");
    }
    await canvas.focus();
    await input.pressKey("Home", "Fit the blank-authored connection graph", "All four authored cards and their channel rails fit in the visible canvas.");
    await page.waitForTimeout(450);

    const evaluate = page.locator(".ether-node[data-node-definition='review.evaluate']");
    const batch = page.locator(".ether-node[data-node-definition='flow.batch']");
    for (const [index, channel] of channels.entries()) {
      const label = channelLabel(channel);
      const sourceHandle = evaluate.getByLabel(`${label} output`);
      const targetHandle = batch.getByLabel(`${label} input`);
      await sourceHandle.hover();
      await input.leftClick(sourceHandle, `Begin ${label} lane`, `Only compatible receiver handles are emphasized for the ${label} channel.`);
      await expect(batch.getByTestId(`channel-zone-input-${channel}`)).toHaveAttribute("data-compatible", "true");
      if (index === 0) {
        await input.screenshot("01-compatible-six-channel-intent.png", evidence, "Capture compatible channel intent", "A deliberate source click reveals the compatible receiver rail before persistence.");
      }
      await targetHandle.hover();
      await input.leftClick(targetHandle, `Complete ${label} lane`, `The ${label} lane persists through the ordinary connection interaction.`);
      await expect(canvas).toHaveAttribute("data-projected-edge-count", String(index + 1));
      if (index === 0) {
        input.observe(
          "First lane completion state",
          "The saved graph and rendered path both report the completed Text lane.",
          JSON.stringify({
            status: await page.getByTestId("canvas-status").innerText(),
            sourceConnected: await evaluate.getByTestId(`channel-zone-output-${channel}`).getAttribute("data-connected"),
            targetConnected: await batch.getByTestId(`channel-zone-input-${channel}`).getAttribute("data-connected"),
            renderedEdges: await page.locator(".ether-edge-hit-target").count()
          })
        );
      }
      await expect(page.locator(".ether-edge-hit-target")).toHaveCount(index + 1);
    }
    await expect(page.locator(".ether-edge-hit-target")).toHaveCount(6);

    const firstRole = page.getByTestId("edge-role-chip").first();
    await input.leftClick(firstRole.getByRole("button", { name: "General" }), "Open the in-place role grid", "All 15 semantic roles are available directly on the lane.");
    await expect(page.getByTestId("edge-role-grid").getByRole("button")).toHaveCount(15);
    await input.leftClick(page.getByTestId("edge-role-grid").getByRole("button", { name: "Subject" }), "Name the Text lane Subject", "The non-General role becomes a visible lane badge.");
    await expect(page.getByTestId("canvas-status")).toContainText("Change connection role saved");
    await expect(page.getByTestId("edge-role-chip").getByText("Subject", { exact: true })).toBeVisible();
    await input.screenshot("02-six-channel-lanes-and-role.png", evidence, "Capture six persisted lanes", "Six channel-specific paths coexist between the same node pair and one carries a visible Subject role.");

    await input.leftClick(evaluate.locator(".ether-node-title"), "Select Evaluate before edge deletion", "The source node remains the graph selection while an edge-only context action runs.");
    await input.rightClick(firstRole.getByRole("button", { name: "Source channel Text" }), "Delete only the Text lane", "Right-click removes the targeted edge without deleting or deselecting either node.");
    await expect(page.locator(".ether-edge-hit-target")).toHaveCount(5);
    await expect(evaluate).toHaveClass(/is-selected/u);

    const prompt = page.locator(".ether-node[data-node-definition='prompt.text']");
    const worker = page.locator(".ether-node[data-node-definition='prompt.worker']");
    await prompt.getByLabel("Data output").hover();
    await input.leftClick(prompt.getByLabel("Data output"), "Begin Data-to-Text adapter lane", "The receiver Text handle is available through Ether's local data-to-text adapter.");
    await expect(worker.getByTestId("channel-zone-input-text")).toHaveAttribute("data-compatible", "true");
    await worker.getByLabel("Text input").hover();
    await input.leftClick(worker.getByLabel("Text input"), "Complete adapter lane", "The adapter-backed lane persists before any run or provider call.");
    await expect(page.locator(".ether-edge-hit-target")).toHaveCount(6);

    await input.leftClick(page.getByTestId("edge-role-chip").last().getByRole("button", { name: "General" }), "Select the adapter lane", "A visible lane control selects the exact connection for the Project lens.");
    await input.leftClick(page.getByRole("button", { name: "Show Project lens", exact: true }), "Show Project lens", "Ordinary connection controls appear without covering the completed authoring interaction.");
    const edgeInspector = page.getByTestId("edge-inspector");
    await expect(edgeInspector).toContainText("Adapter · local.data-to-text");
    await expect(edgeInspector).toContainText("Receiver field");
    const connectionDiagnostics = edgeInspector.getByRole("button", { name: "Connection diagnostics", exact: true });
    await expect(connectionDiagnostics).toHaveAttribute("aria-expanded", "false");
    await input.leftClick(edgeInspector.getByLabel("Output selection", { exact: true }), "Focus output selection", "The lane's output policy is editable in the ordinary Inspector.");
    await input.pressKey("ArrowDown", "Choose latest output", "The selector changes from Latest approved to Latest output through the focused control.");
    await input.pressKey("Enter", "Commit output selection", "The changed selector persists as a graph transaction.");
    await expect(edgeInspector.getByLabel("Output selection", { exact: true })).toHaveValue("latest");
    await input.screenshot("03-adapter-consequence-inspector.png", evidence, "Capture adapter consequence Inspector", "The ordinary Inspector names the local adapter, receiver field, assembly, preservation, channels, role, and selector while diagnostics stay collapsed.");
    await input.leftClick(connectionDiagnostics, "Open connection diagnostics deliberately", "Expert adapter and capability details appear only after an explicit disclosure.");
    await expect(connectionDiagnostics).toHaveAttribute("aria-expanded", "true");
    await expect(edgeInspector).toContainText("Resolved: local.data-to-text");
    await input.screenshot("04-connection-diagnostics.png", evidence, "Capture expert connection diagnostics", "The deliberate Advanced view exposes the resolved adapter and capability requirement without starting work.");

    await input.leftClick(page.getByRole("button", { name: "Hide Project lens", exact: true }), "Hide Project lens", "The canvas regains clear pointer access for the next Inspector target.");
    await input.leftClick(batch.locator(".ether-node-title"), "Select the Batch node", "The progressive node Inspector opens from a real canvas selection.");
    await input.leftClick(page.getByRole("button", { name: "Show Project lens", exact: true }), "Show Batch Inspector", "Registry-backed ordinary controls are visible for the selected canonical node.");
    const nodeInspector = page.getByTestId("node-inspector");
    await expect(nodeInspector).toContainText("Channels & routes");
    await expect(nodeInspector).toContainText("Batch settings");
    await expect(nodeInspector.getByTestId("inspector-list-dimensions").locator(".inspector-list-item")).toHaveCount(1);
    const nodeDiagnostics = nodeInspector.getByRole("button", { name: "Diagnostics & provenance", exact: true });
    await expect(nodeDiagnostics).toHaveAttribute("aria-expanded", "false");
    await input.leftClick(nodeInspector.getByRole("button", { name: "Add dimension" }), "Add a structured Batch dimension", "The Inspector adds a named structured item rather than exposing raw JSON.");
    await input.leftClick(nodeInspector.getByRole("button", { name: "Add exclusion" }), "Add a structured Batch exclusion", "The Inspector adds a key/value exclusion editor through an ordinary control.");
    await expect(nodeInspector.getByTestId("inspector-list-dimensions").locator(".inspector-list-item")).toHaveCount(2);
    await expect(nodeInspector.getByTestId("inspector-list-exclusions").locator(".inspector-list-item")).toHaveCount(1);
    await input.leftClick(nodeInspector.getByRole("button", { name: "Save batch" }), "Save structured Batch settings", "The registry-backed draft commits through one durable graph transaction.");
    await input.screenshot("05-progressive-batch-inspector.png", evidence, "Capture ordinary progressive Inspector", "Concise channels and structured Batch controls are visible while technical provenance remains collapsed.");
    expect((await nodeInspector.innerText()).includes(workspaceRoot)).toBe(false);
    await input.leftClick(nodeDiagnostics, "Open node diagnostics deliberately", "Stable IDs and provenance appear only in the expert disclosure.");
    await expect(nodeDiagnostics).toHaveAttribute("aria-expanded", "true");
    await input.screenshot("06-progressive-batch-advanced.png", evidence, "Capture deliberate node diagnostics", "The expert section expands without path leakage or replacing ordinary authoring controls.");

    input.observe("T10-T12 practical slice", "Six channels, roles, edge deletion, adapters, consequences, and progressive controls work from a blank package.", "Six same-pair lanes were authored; one was role-edited and edge-only deleted; a local adapter lane exposed its consequence; structured Batch settings saved without raw JSON.");
    await session.close("passed");
    closed = true;
  } finally {
    if (!closed) await session.close("failed");
  }
});

async function addDefinition(page: Page, input: RealPageInput, definition: string, expectedCount: number) {
  const row = page.locator(`.node-library-item[data-node-definition='${definition}']`);
  await row.scrollIntoViewIfNeeded();
  await input.leftClick(row.locator(".node-library-add"), `Add ${definition} from Node Library`, `The blank document creates ${definition} through the canonical registry.`);
  await expect(page.getByTestId("ether-canvas-surface")).toHaveAttribute("data-graph-node-count", String(expectedCount));
}

function channelLabel(channel: typeof channels[number]) {
  return channel[0]!.toLocaleUpperCase() + channel.slice(1);
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  assertAuthoringJourneySourceSafety,
  blankAuthoringJourney,
  launchRecoveryJourney,
  packagedJourneyConfig,
  recoveryShellTokenForProfile,
  sourceElectronJourneyConfig,
  type RealPageInput
} from "../../recovery/journeyDriver.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const thisSource = fileURLToPath(import.meta.url);
const journeyId = "t13-run-safety";
const sourceElectronDiagnostic = process.env.ETHER_RECOVERY_SOURCE_ELECTRON === "1";

test.skip(process.platform !== "win32", "The T13 run-safety journey uses the Windows desktop application.");

test("previews exact scopes and completes one fake-local job from a blank document", async () => {
  assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "T13 run-safety spec");
  const base = sourceElectronDiagnostic
    ? sourceElectronJourneyConfig(workspaceRoot, journeyId)
    : packagedJourneyConfig(workspaceRoot, journeyId);
  const session = await launchRecoveryJourney({
    ...base,
    evidenceMode: sourceElectronDiagnostic ? "ephemeral" : "committed",
    ...(sourceElectronDiagnostic ? {} : {
      committedEvidencePath: ["phase-3", "run-safety", journeyId]
    }),
    ...(sourceElectronDiagnostic ? {
      sourceEntrypoint: path.join(workspaceRoot, "packages", "testing", "fixtures", "desktop-main.mjs"),
      sourceArgs: (profile) => [`--fixture-root=${profile.root}`]
    } : {
      packagedArgs: (profile) => [`--ether-recovery-simulation=${recoveryShellTokenForProfile(profile)}`]
    }),
    viewport: { width: 1600, height: 1000 },
    declaration: blankAuthoringJourney(journeyId, "fake")
  });
  let closed = false;
  try {
    const { page, input, evidence } = session;
    const canvas = page.getByTestId("ether-canvas-surface");
    await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(canvas).toHaveAttribute("data-graph-node-count", "0");

    await addDefinition(page, input, "prompt.text", 1);
    await addDefinition(page, input, "generation.image", 2);
    await addDefinition(page, input, "edit.image", 3);
    await addDefinition(page, input, "flow.batch", 4);
    for (const panel of ["Reference Desk", "Build tools"]) {
      await input.leftClick(page.getByRole("button", { name: `Hide ${panel}`, exact: true }), `Hide ${panel}`, "The authored run graph gets a clear practical viewport.");
    }
    await canvas.focus();
    await input.pressKey("Home", "Fit the run-safety graph", "All four blank-authored cards and their channel rails fit visibly.");
    await page.waitForTimeout(450);

    const prompt = page.locator(".ether-node[data-node-definition='prompt.text']");
    const generator = page.locator(".ether-node[data-node-definition='generation.image']");
    const editor = page.locator(".ether-node[data-node-definition='edit.image']");
    const batch = page.locator(".ether-node[data-node-definition='flow.batch']");

    await input.leftClick(prompt.locator(".ether-node-title"), "Select Prompt for direct editing", "The blank Prompt becomes the canvas editing target.");
    await input.pressKey("Enter", "Edit Prompt body", "The primary on-canvas editor opens without entering a provider workflow.");
    const promptEditor = page.locator(".ether-node-inline-editor textarea");
    await expect(promptEditor).toBeVisible();
    await promptEditor.fill("A quiet cobalt vessel on warm stone, precise side light");
    await input.pressKey("Control+Enter", "Commit Prompt body", "The exact authored text becomes durable graph input.");
    await expect(promptEditor).toBeHidden();

    await connect(input, prompt, "Text output", generator, "Text input", "Prompt text to Image Generator");
    await connect(input, generator, "Image output", editor, "Image input", "Generated image to Image Editor");
    await connect(input, batch, "Data output", generator, "Data input", "Batch data to Image Generator");
    await expect(page.locator(".ether-edge-hit-target")).toHaveCount(3);

    await selectFakeProfile(page, input, generator, "Image Generator");
    await selectFakeProfile(page, input, editor, "Image Editor");
    await input.leftClick(batch.locator(".ether-node-title"), "Select Batch", "The progressive Inspector exposes the authored batch and its run scope.");
    const inspector = page.getByTestId("node-inspector");
    const values = inspector.getByTestId("inspector-list-dimensions").locator("textarea").first();
    await values.fill("coastal\nstudio");
    await input.leftClick(inspector.getByRole("button", { name: "Save batch", exact: true }), "Save two Batch values", "The exact two-item expansion is stored before preview.");
    await expect(page.getByTestId("canvas-status")).toContainText("Update Batch saved");
    await input.screenshot("01-blank-authored-run-graph.png", evidence, "Capture the blank-authored run graph", "Prompt, Batch, Image Generator, Image Editor, and three visible lanes were created only through ordinary UI input.");

    await input.leftClick(inspector.getByRole("button", { name: "Preview plan", exact: true }), "Preview explicit Batch scope", "The immutable Batch scope expands dimensions and downstream work without starting it.");
    const prepared = inspector.getByLabel("Prepared plan");
    await expect(prepared).toBeVisible();
    await expect(prepared).toContainText("Batch");
    await expect(prepared).toContainText(/Batch .* 2 work items/u);
    await expect(prepared).toContainText("Plan ID");
    await expect(prepared).toContainText("Content hash");
    await expect(prepared).toContainText("ether-fake-local");
    await expect(prepared).toContainText("Concurrency");
    await input.leftClick(prepared.locator("summary", { hasText: "Compiled steps and inputs" }), "Expand compiled Batch steps", "Exact compiled inputs and provider bindings are reviewable before any permit exists.");
    await input.screenshot("02-immutable-batch-preview.png", evidence, "Capture immutable Batch preview", "The prepared plan exposes scope, identity, provider settings, call count, concurrency, batch expansion, boundary, and compiled inputs.");

    await input.leftClick(generator.locator(".ether-node-title"), "Select Image Generator", "The same authored graph exposes node, branch, and downstream scope choices.");
    const runScope = page.getByLabel("Run scope");
    await expect(runScope).toBeVisible();
    await runScope.selectOption("node");
    await input.leftClick(page.getByTestId("node-inspector").getByRole("button", { name: "Preview plan", exact: true }), "Preview Node scope", "Node only predicts two generator calls because the upstream Batch has two values.");
    await expect(page.getByLabel("Prepared plan")).toContainText("Node only");
    await expect(page.getByLabel("Prepared plan")).toContainText("2 provider calls");

    await runScope.selectOption("branch");
    await input.leftClick(page.getByTestId("node-inspector").getByRole("button", { name: "Preview plan", exact: true }), "Preview Branch scope", "Branch includes the selected generator and downstream editor for both Batch values.");
    await expect(page.getByLabel("Prepared plan")).toContainText("Branch");
    await expect(page.getByLabel("Prepared plan")).toContainText("4 provider calls");
    await runScope.selectOption("downstream");
    await input.leftClick(page.getByTestId("node-inspector").getByRole("button", { name: "Preview plan", exact: true }), "Preview Downstream scope", "Downstream excludes the root generator and predicts one editor call for each Batch value.");
    await expect(page.getByLabel("Prepared plan")).toContainText("Downstream only");
    await expect(page.getByLabel("Prepared plan")).toContainText("2 provider calls");

    await canvas.focus();
    await input.pressKey("Control+A", "Select the authored induced graph", "All four UI-authored nodes become the Selected execution boundary.");
    await input.pressKey("Control+Enter", "Preview Selected scope", "The first shortcut press prepares the exact selected-node plan and does not run it.");
    const selectedPlan = page.getByLabel("Selected plan");
    await expect(selectedPlan).toBeVisible();
    await expect(selectedPlan).toContainText("Selected");
    await expect(selectedPlan).toContainText("4 nodes");
    await input.screenshot("03-scope-comparison.png", evidence, "Capture Selected scope after Node, Branch, and Downstream previews", "The blank-authored induced selection has its own inspect-first plan and remains unstarted.");

    await input.leftClick(page.getByRole("button", { name: "Dismiss", exact: true }), "Dismiss Selected preview", "The provider-safe comparison closes without starting the selected plan.");
    await input.leftClick(generator.locator(".ether-node-title"), "Return to Image Generator", "One small two-call fake-local job is isolated for the practical Job Center proof.");
    await page.getByLabel("Run scope").selectOption("node");
    await input.leftClick(page.getByTestId("node-inspector").getByRole("button", { name: "Preview plan", exact: true }), "Prepare two fake-local calls", "The exact two-call Batch-expanded plan is reviewed before permission is granted.");
    await expect(page.getByTestId("node-inspector").getByRole("button", { name: "Start 2 calls", exact: true })).toBeVisible();
    await input.leftClick(page.getByTestId("node-inspector").getByRole("button", { name: "Start 2 calls", exact: true }), "Permit and start the reviewed plan", "Only the displayed fake-local plan receives a one-use permit and starts.");
    await expect(page.getByTestId("canvas-status")).toContainText("Run started");
    await input.leftClick(page.getByTestId("workspace-switcher").getByRole("button", { name: "Run", exact: true }), "Open Run workspace", "Job Center hydrates the durable job created by the reviewed plan.");
    const jobCenter = page.getByRole("region", { name: "Job Center" });
    await expect(jobCenter).toBeVisible();
    await expect(jobCenter.getByText("1 durable job", { exact: false })).toBeVisible();
    await expect.poll(async () => (await jobCenter.innerText()).toLocaleLowerCase()).toContain("completed");
    const jobDetail = jobCenter.locator(".job-detail");
    await expect(jobDetail).toContainText("2 accepted");
    await expect(jobDetail).toContainText("2 attempts");
    await input.leftClick(jobDetail.locator("summary").filter({ hasText: /^Immutable plan$/u }), "Inspect authorized Job plan", "Job Center shows the same immutable identity and exact plan after completion.");
    await expect(jobDetail).toContainText("Content hash");
    await input.screenshot("04-job-center-result.png", evidence, "Capture durable completed Job", "The fake-local result is accepted and its immutable plan, attempt, timeline, and completion remain visible in Job Center.");

    input.observe("T13 practical slice", "All five run scopes are inspect-first and one explicitly permitted offline job is durable.", "Batch, Node, Branch, Downstream, and Selected previews were reviewed with their exact Batch-expanded call counts; only the final two-call fake-local Node plan started and completed with two accepted work items and two attempts.");
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

async function connect(input: RealPageInput, source: Locator, output: string, target: Locator, receiver: string, label: string) {
  const sourceHandle = source.getByLabel(output);
  const targetHandle = target.getByLabel(receiver);
  await sourceHandle.hover();
  await input.leftClick(sourceHandle, `Begin ${label}`, `The compatible ${receiver} handle becomes the intended receiver.`);
  await targetHandle.hover();
  await input.leftClick(targetHandle, `Complete ${label}`, "The exact channel lane persists through the ordinary connection interaction.");
}

async function selectFakeProfile(page: Page, input: RealPageInput, node: Locator, title: string) {
  await input.leftClick(node.locator(".ether-node-title"), `Select ${title}`, "The Project lens exposes only verified provider profiles.");
  const inspector = page.getByTestId("node-inspector");
  const profile = inspector.getByLabel("Provider profile", { exact: true });
  await expect(profile).toBeVisible();
  await profile.selectOption("ether-fake-local:fake-image-default");
  await input.leftClick(inspector.getByRole("button", { name: "Save provider settings", exact: true }), `Save ${title} fake-local profile`, "The offline deterministic capability becomes the durable binding for this recovery-only run.");
  await expect(page.getByTestId("canvas-status")).toContainText("Update provider settings saved");
}

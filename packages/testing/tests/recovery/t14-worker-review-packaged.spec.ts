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
const journeyId = "t14-worker-review";
const workerAInstruction = "Clarify the product direction while retaining the quiet cobalt palette.";
const workerBInstruction = "Turn the approved direction into one concise image-ready prompt.";
const sourceElectronDiagnostic = process.env.ETHER_RECOVERY_SOURCE_ELECTRON === "1";

test.skip(process.platform !== "win32", "The T14 worker-review journey uses the Windows desktop application.");

test("authors a review-gated Worker chain and runs its approved image branch from a blank packaged document", async () => {
  assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "T14 worker-review spec");
  const session = await launchRecoveryJourney({
    ...(sourceElectronDiagnostic ? sourceElectronJourneyConfig(workspaceRoot, journeyId) : packagedJourneyConfig(workspaceRoot, journeyId)),
    evidenceMode: sourceElectronDiagnostic ? "ephemeral" : "committed",
    ...(sourceElectronDiagnostic ? {
      sourceEntrypoint: path.join(workspaceRoot, "packages", "testing", "fixtures", "desktop-main.mjs"),
      sourceArgs: (profile) => [`--fixture-root=${profile.root}`]
    } : {
      committedEvidencePath: ["phase-3", "t14-worker-review", journeyId],
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
    await addDefinition(page, input, "prompt.worker", 2);
    await addDefinition(page, input, "prompt.worker", 3);
    await addDefinition(page, input, "generation.image", 4);
    for (const panel of ["Reference Desk", "Build tools"]) {
      await input.leftClick(page.getByRole("button", { name: `Hide ${panel}`, exact: true }), `Hide ${panel}`, "The blank-authored recovery chain remains fully visible.");
    }
    await canvas.focus();
    await input.pressKey("Home", "Fit the Worker recovery chain", "Prompt, both Workers, and Image Generator fit in one ordinary canvas view.");
    await page.waitForTimeout(450);

    const prompt = page.locator(".ether-node[data-node-definition='prompt.text']");
    const workers = page.locator(".ether-node[data-node-definition='prompt.worker']");
    const workerA = workers.nth(0);
    const workerB = workers.nth(1);
    const generator = page.locator(".ether-node[data-node-definition='generation.image']");

    await input.leftClick(prompt.getByRole("button", { name: "Edit Prompt body", exact: true }), "Focus Prompt content", "The Prompt's primary content control owns keyboard focus.");
    await input.pressKey("Enter", "Edit the authored Prompt", "Enter opens the primary inline text editor through the focused card control.");
    const promptEditor = page.locator(".ether-node-inline-editor textarea");
    await expect(promptEditor).toBeVisible();
    await promptEditor.fill("A quiet cobalt vessel on warm stone with precise side light.");
    await input.pressKey("Control+Enter", "Commit the authored Prompt", "The durable Prompt becomes the sole starting material for the Worker chain.");
    await expect(promptEditor).toBeHidden();

    await connect(input, prompt, "Text output", workerA, "Text input", "Prompt to Worker A");
    await connect(input, workerA, "Text output", workerB, "Text input", "Worker A to Worker B");
    await connect(input, workerB, "Text output", generator, "Text input", "Worker B to Image Generator");
    await expect(page.locator(".ether-edge-hit-target")).toHaveCount(3);
    await assertLatestApprovedLanes(page, input);

    await configureWorker(page, input, workerA, workerAInstruction, "inspect-first", "Worker A");
    await configureWorker(page, input, workerB, workerBInstruction, "auto-apply", "Worker B");
    await configureFakeImageProfile(page, input, generator);
    await input.screenshot("01-authored-review-chain.png", evidence, "Capture the blank-authored Worker chain", "Prompt, two Workers, Image Generator, and three latest-approved lanes were created through ordinary UI input only.");

    await input.leftClick(workerA.locator(".ether-node-title"), "Select Worker A for inspect-first execution", "Worker A is configured to leave its durable result unreviewed.");
    const workerAInspector = page.getByTestId("node-inspector");
    await expect(workerAInspector.getByLabel("Worker result handling")).toHaveValue("inspect-first");
    await input.leftClick(workerAInspector.getByRole("button", { name: "Preview plan", exact: true }), "Preview Worker A plan", "The deterministic Worker plan is reviewed before any permit is created.");
    const workerAPlan = page.getByLabel("Prepared plan");
    await expect(workerAPlan).toContainText("1 provider call");
    await expect(workerAPlan).toContainText("deterministic-transform-v1");
    await expect(workerAPlan).toContainText("Content hash");
    await input.leftClick(workerAInspector.getByRole("button", { name: "Start 1 call", exact: true }), "Permit and start Worker A", "Only the reviewed deterministic Worker plan receives its one-use permit.");
    await expect(page.getByTestId("canvas-status")).toContainText("Run started");
    await waitForCompletedJob(page, input, "Wait for Worker A durable job");

    await input.leftClick(page.getByRole("button", { name: "Build", exact: true }), "Return to the Build workspace", "The Inspector refreshes Worker A's completed durable version.");
    await input.leftClick(workerA.locator(".ether-node-title"), "Inspect Worker A output", "Worker A's exact output and provenance are visible before approval.");
    const workerAOutputs = page.getByTestId("output-versions");
    await expect(workerAOutputs).toContainText("Unreviewed");
    const workerAOutput = workerAOutputs.locator(".inspector-output-version").first();
    await input.leftClick(workerAOutput.locator("summary", { hasText: "Version provenance" }), "Open Worker A provenance", "Provider, job, and generated output lineage are inspectable before approval.");
    await expect(workerAOutput).toContainText("ether-fake-local");
    await expect(workerAOutput).toContainText("Run");
    await expect(workerAOutput).toContainText("Lineage");
    await input.screenshot("02-worker-a-unreviewed-provenance.png", evidence, "Capture Worker A unreviewed output", "The inspect-first result is durable, unreviewed, and visibly tied to the deterministic local simulation.");
    await input.leftClick(workerAOutput.getByRole("button", { name: "Approve", exact: true }), "Approve Worker A output", "The durable output becomes eligible for the next latest-approved lane.");
    await expect(workerAOutputs).toContainText("Approved");

    await input.leftClick(workerB.locator(".ether-node-title"), "Select Worker B and the Image branch", "Worker B retains its separately authored instruction and auto-apply policy.");
    const workerBInspector = page.getByTestId("node-inspector");
    await expect(workerBInspector.getByLabel("Worker instruction")).toHaveValue(workerBInstruction);
    await expect(workerBInspector.getByLabel("Worker result handling")).toHaveValue("auto-apply");
    await workerBInspector.getByLabel("Run scope").selectOption("branch");
    await input.leftClick(workerBInspector.getByRole("button", { name: "Preview plan", exact: true }), "Preview approved Worker B image branch", "The branch resolves only Worker A's approved result and the fake-local Image Generator before permit.");
    const workerBPlan = page.getByLabel("Prepared plan");
    await expect(workerBPlan).toContainText("Branch");
    await expect(workerBPlan).toContainText("2 provider calls");
    await expect(workerBPlan).toContainText("deterministic-transform-v1");
    await expect(workerBPlan).toContainText("fake-image-default");
    await input.leftClick(workerBInspector.getByRole("button", { name: "Start 2 calls", exact: true }), "Permit and start Worker B with Image Generator", "The previewed Worker B branch is explicitly permitted and started without a real provider or image call.");
    await waitForCompletedJob(page, input, "Wait for Worker B and Image Generator durable job");

    await input.leftClick(page.getByRole("button", { name: "Build", exact: true }), "Return to Build for transformed lineage", "The completed branch output is inspected in the ordinary canvas workspace.");
    await input.leftClick(workerB.locator(".ether-node-title"), "Inspect Worker B transformed output", "Worker B's auto-applied durable output preserves its selected approved input lineage.");
    const workerBOutputs = page.getByTestId("output-versions");
    await expect(workerBOutputs).toContainText("Approved");
    const workerBOutput = workerBOutputs.locator(".inspector-output-version").first();
    await input.leftClick(workerBOutput.locator("summary", { hasText: "Version provenance" }), "Open Worker B transformed provenance", "The output identifies its selected input version instead of changing Worker B's authored instruction.");
    await expect(workerBOutput).toContainText(/1 inputs? .* 1 selected versions?/u);
    await expect(workerBInspector.getByLabel("Worker instruction")).toHaveValue(workerBInstruction);

    await input.leftClick(generator.locator(".ether-node-title"), "Inspect Image Generator output lineage", "The generated image has the Worker B approved version as its selected input.");
    const imageOutputs = page.getByTestId("output-versions");
    await expect(imageOutputs).toContainText("deterministic-png-v1");
    const imageOutput = imageOutputs.locator(".inspector-output-version").first();
    await input.leftClick(imageOutput.locator("summary", { hasText: "Version provenance" }), "Open Image Generator provenance", "The image output preserves the transformed Worker lineage through the latest-approved lane.");
    await expect(imageOutput).toContainText(/1 inputs? .* 1 selected versions?/u);
    await input.screenshot("03-approved-worker-and-image-lineage.png", evidence, "Capture approved transformed lineage", "Worker B auto-applies its valid output, Image Generator consumes that approved version, and Worker B's authored instruction remains unchanged.");

    input.observe("T14 practical slice", "A blank-authored review-gated Worker chain can safely progress into a deterministic image branch.", "Worker A produced an unreviewed durable version that was explicitly approved; Worker B then auto-applied a transformed version consumed by Image Generator through latest-approved lanes while retaining its own instruction.");
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
  await input.leftClick(sourceHandle, `Begin ${label}`, `The compatible ${receiver} receiver becomes the intended lane target.`);
  await targetHandle.hover();
  await input.leftClick(targetHandle, `Complete ${label}`, "The exact connection persists through the ordinary channel interaction.");
}

async function assertLatestApprovedLanes(page: Page, input: RealPageInput) {
  const lanes = page.getByTestId("edge-role-chip");
  await expect(lanes).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    const lane = lanes.nth(index);
    await input.leftClick(lane.getByRole("button", { name: "General", exact: true }), `Inspect latest-approved lane ${index + 1}`, "Each freshly authored lane is explicitly verified as latest-approved.");
    await expect(page.getByTestId("edge-inspector").getByLabel("Output selection", { exact: true })).toHaveValue("latest-approved");
  }
}

async function configureWorker(page: Page, input: RealPageInput, node: Locator, instruction: string, reviewPolicy: "inspect-first" | "auto-apply", title: string) {
  await input.leftClick(node.locator(".ether-node-title"), `Select ${title}`, "The ordinary Inspector exposes the Worker profile and result-handling controls.");
  const inspector = page.getByTestId("node-inspector");
  await inspector.getByLabel("Worker instruction").fill(instruction);
  await inspector.getByLabel("Worker result handling").selectOption(reviewPolicy);
  await expect(inspector).toContainText("deterministic-transform-v1");
  await input.leftClick(inspector.getByRole("button", { name: "Save worker", exact: true }), `Save ${title} review policy`, "The authored instruction, deterministic profile, and review policy save together through one normal Inspector action.");
  await expect(page.getByTestId("canvas-status")).toContainText("Update worker saved");
}

async function configureFakeImageProfile(page: Page, input: RealPageInput, node: Locator) {
  await input.leftClick(node.locator(".ether-node-title"), "Select Image Generator", "The ordinary Inspector exposes only verified image profiles.");
  const inspector = page.getByTestId("node-inspector");
  const profile = inspector.getByLabel("Provider profile", { exact: true });
  await expect(profile).toBeVisible();
  await profile.selectOption("ether-fake-local:fake-image-default");
  await input.leftClick(inspector.getByRole("button", { name: "Save provider settings", exact: true }), "Save deterministic Image Generator profile", "The recovery-only fake-local image profile becomes the durable binding for this branch.");
  await expect(page.getByTestId("canvas-status")).toContainText("Update provider settings saved");
}

async function waitForCompletedJob(page: Page, input: RealPageInput, label: string) {
  await input.leftClick(page.getByTestId("workspace-switcher").getByRole("button", { name: "Run", exact: true }), label, "Job Center displays the durable plan execution created through preview and permit.");
  const jobCenter = page.getByRole("region", { name: "Job Center" });
  await expect(jobCenter).toBeVisible();
  await expect.poll(async () => (await jobCenter.innerText()).toLocaleLowerCase()).toContain("completed");
}

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
const journeyId = "t16-t19-visible-packaged";
const promptText = "A considered ${subject} product study, editorial, spare, and precisely lit.";
const evaluationInstruction = "Evaluate the transformed image for editorial clarity and product fidelity.";
const sourceElectronDiagnostic = process.env.ETHER_RECOVERY_SOURCE_ELECTRON === "1";

test.skip(process.platform !== "win32", "The T16-T19 visible recovery journey uses the packaged Windows desktop application.");

test("authors a fake-provider image-to-review-and-delivery journey from a blank document", async () => {
  assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "T16-T19 visible packaged spec");
  const session = await launchRecoveryJourney({
    ...(sourceElectronDiagnostic ? sourceElectronJourneyConfig(workspaceRoot, journeyId) : packagedJourneyConfig(workspaceRoot, journeyId)),
    evidenceMode: sourceElectronDiagnostic ? "ephemeral" : "committed",
    ...(sourceElectronDiagnostic ? {
      sourceEntrypoint: path.join(workspaceRoot, "packages", "testing", "fixtures", "desktop-main.mjs"),
      sourceArgs: (profile) => [`--fixture-root=${profile.root}`]
    } : {
      committedEvidencePath: ["phase-3", "t16-t19-visible", journeyId],
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

    const definitions = [
      "flow.variables",
      "prompt.text",
      "generation.image",
      "edit.transform",
      "review.compare",
      "review.evaluate",
      "review.filter",
      "flow.batch",
      "flow.join",
      "output.collection",
      "output.export"
    ] as const;
    for (const [index, definition] of definitions.entries()) await addDefinition(page, input, definition, index + 1);
    for (const panel of ["Reference Desk", "Build tools"]) {
      await input.leftClick(page.getByRole("button", { name: `Hide ${panel}`, exact: true }), `Hide ${panel}`, "The eleven-node recovery route remains fully visible while it is configured and connected.");
    }
    await canvas.focus();
    await input.pressKey("Home", "Fit the T16-T19 recovery route", "All eleven blank-authored nodes fit in one ordinary canvas view before direct configuration continues.");
    await page.waitForTimeout(450);

    const variables = page.locator(".ether-node[data-node-definition='flow.variables']");
    const prompt = page.locator(".ether-node[data-node-definition='prompt.text']");
    const image = page.locator(".ether-node[data-node-definition='generation.image']");
    const transform = page.locator(".ether-node[data-node-definition='edit.transform']");
    const compare = page.locator(".ether-node[data-node-definition='review.compare']");
    const evaluate = page.locator(".ether-node[data-node-definition='review.evaluate']");
    const filter = page.locator(".ether-node[data-node-definition='review.filter']");
    const batch = page.locator(".ether-node[data-node-definition='flow.batch']");
    const join = page.locator(".ether-node[data-node-definition='flow.join']");
    const collection = page.locator(".ether-node[data-node-definition='output.collection']");
    const exportNode = page.locator(".ether-node[data-node-definition='output.export']");

    await configureVariables(page, input, variables);
    await authorPrompt(page, input, prompt);
    await configureBatch(page, input, batch);
    await configureFakeImage(page, input, image);
    await configureTransform(page, input, transform);
    await configureCompare(page, input, compare);
    await configureEvaluate(page, input, evaluate);
    await configureFilter(page, input, filter);
    await configureJoin(page, input, join);
    await inspectDeliverySetup(page, input, collection, exportNode);

    await connect(input, variables, "Text output", prompt, "Text input", "Variables to Prompt");
    await connect(input, prompt, "Text output", image, "Text input", "Prompt to Image Generator");
    await connect(input, image, "Image output", transform, "Image input", "Image Generator to Transform");
    await connect(input, transform, "Image output", compare, "Image input", "Transform to Compare");
    await selectLatestOnNewestLane(page, input, "Transform to Compare", 4);
    await connect(input, transform, "Image output", evaluate, "Image input", "Transform to Evaluate");
    await selectLatestOnNewestLane(page, input, "Transform to Evaluate", 5);
    await connect(input, evaluate, "Image output", filter, "Image input", "Evaluation image to Filter");
    await selectLatestOnNewestLane(page, input, "Evaluation image to Filter", 6);
    await connect(input, evaluate, "Data output", filter, "Data input", "Evaluation data to Filter");
    await selectLatestOnNewestLane(page, input, "Evaluation data to Filter", 7);
    await connect(input, filter, "Image output", join, "Image input", "Filter to Join");
    await selectLatestOnNewestLane(page, input, "Filter to Join", 8);
    await expect(page.locator(".ether-edge-hit-target")).toHaveCount(8);

    await previewBatchMatrix(page, input);
    await input.leftClick(page.getByRole("button", { name: "Build", exact: true }), "Return to Build for the image run", "The authored runtime route remains on the ordinary canvas after the isolated Batch grid/setup preview.");
    await input.leftClick(image.locator(".ether-node-title"), "Select Image Generator", "The provider-backed image node is the first explicit fake-provider run target.");
    const imageInspector = page.getByTestId("node-inspector");
    await input.leftClick(imageInspector.getByRole("button", { name: "Preview plan", exact: true }), "Preview fake Image Generator plan", "The single offline image call is shown before its one-use permit is issued.");
    const imagePlan = page.getByLabel("Prepared plan");
    await expect(imagePlan).toContainText("1 provider call");
    await expect(imagePlan).toContainText("ether-fake-local");
    await expect(imagePlan).toContainText("fake-image-default");
    await input.leftClick(imageInspector.getByRole("button", { name: "Start 1 call", exact: true }), "Permit and start fake Image Generator", "Only the displayed local recovery simulation route starts; no real provider is contacted.");
    await expect(page.getByTestId("canvas-status")).toContainText("Run started");
    await waitForJobStatus(page, input, "completed", "Wait for the fake Image Generator artifact");

    await input.leftClick(page.getByTestId("workspace-switcher").getByRole("button", { name: "Build", exact: true }), "Return to Build for Transform review", "The completed image is available to the authored local Transform node.");
    await input.leftClick(image.locator(".ether-node-title"), "Inspect generated image before reuse", "The latest-approved boundary remains deliberate rather than silently consuming an unreviewed provider output.");
    const imageOutputs = page.getByTestId("output-versions");
    await expect(imageOutputs).toContainText("deterministic-png-v1");
    const generatedImage = imageOutputs.locator(".inspector-output-version").first();
    await expect(generatedImage).toContainText("Unreviewed");
    await input.leftClick(generatedImage.getByRole("button", { name: "Approve", exact: true }), "Approve generated image for Transform", "The image becomes eligible for the protected latest-approved lane only through this explicit review action.");
    await expect(imageOutputs).toContainText("Approved");
    await input.leftClick(transform.locator(".ether-node-title"), "Select Transform branch", "Transform owns the local-media result and its downstream human and deterministic review sequence.");
    const transformInspector = page.getByTestId("node-inspector");
    await transformInspector.getByLabel("Run scope").selectOption("branch");
    await input.leftClick(transformInspector.getByRole("button", { name: "Preview plan", exact: true }), "Preview Transform review branch", "The visible branch includes one fake Evaluation call and its human Compare checkpoint before any permit is issued.");
    const reviewPlan = page.getByLabel("Prepared plan");
    await expect(reviewPlan).toContainText("Branch");
    await expect(reviewPlan).toContainText("1 provider call");
    await expect(reviewPlan).toContainText("ether-fake-local-evaluation");
    await expect(reviewPlan).toContainText("deterministic-evaluation-v1");
    await input.screenshot("01-image-transform-review-plan.png", evidence, "Capture the authored Transform review branch", "The blank-authored graph visibly joins local Transform, human Compare, fake Evaluation, deterministic Filter, and Join under one inspect-first branch plan.");
    await input.leftClick(transformInspector.getByRole("button", { name: "Start 1 call", exact: true }), "Permit and start Transform review branch", "The exact local Transform and deterministic evaluation branch is explicitly permitted without a real image or model request.");
    await waitForJobStatus(page, input, "waiting review", "Wait for the human Compare checkpoint");

    await input.leftClick(page.getByTestId("workspace-switcher").getByRole("button", { name: "Review", exact: true }), "Open Review for the Compare checkpoint", "Artifact Observatory presents the durable human checkpoint instead of invoking an implicit model selection.");
    const observatory = page.getByTestId("artifact-observatory");
    await expect(observatory).toBeVisible();
    await input.leftClick(observatory.getByRole("button", { name: "Compare", exact: true }), "Open Compare Stage", "The transform result appears as a sealed human candidate.");
    const compareStage = page.getByTestId("compare-stage");
    await expect(compareStage).toBeVisible({ timeout: 30_000 });
    await expect(compareStage).toContainText("No AI runs here");
    await input.leftClick(compareStage.locator(".compare-review-tile").first(), "Select the transformed candidate", "A person, not a model, makes the one-candidate Compare decision.");
    await compareStage.getByLabel("Review note").fill("The transformed image retains the intended cobalt direction.");
    await input.leftClick(compareStage.getByTestId("compare-complete"), "Complete the human Compare checkpoint", "The exact selected version and review note persist before the independent Evaluate and Filter continuation finishes.");
    await expect(compareStage).toBeHidden();
    await expect(observatory.getByRole("status")).toContainText("Human selection saved");

    await waitForJobStatus(page, input, "completed", "Wait for Evaluate, Filter, and Join to finish after Compare", 2);
    await input.leftClick(page.getByTestId("workspace-switcher").getByRole("button", { name: "Review", exact: true }), "Return to Review for durable outputs", "Artifact Observatory refreshes its local artifact and review views after the completed branch.");
    await expect(observatory).toContainText("document artifacts");
    await inspectEvaluationAndFilter(page, input, observatory);
    await createCollectionAndInspectExport(page, input, observatory, evidence);

    input.observe("T16-T19 visible practical slice", "A blank-authored image route, local Transform, human Compare, deterministic Evaluate/Filter/Join, an isolated Batch grid/setup preview, graph delivery setup, and the Review-side collection/direct-export gate are visible in one offline journey.", "The only provider-facing calls used Ether's opt-in local recovery simulation. Collection membership was added in Artifact Observatory, while the independent direct Export dialog stayed at its visible folder-grant gate; no real provider, native folder selection, or filesystem export was requested.");
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

async function configureVariables(page: Page, input: RealPageInput, variables: Locator) {
  await input.leftClick(variables.locator(".ether-node-title"), "Select Variables", "The Inspector exposes typed values and an explicit interpolation preview.");
  const inspector = page.getByTestId("node-inspector");
  await input.leftClick(inspector.getByRole("button", { name: "Add variable", exact: true }), "Add the typed subject variable", "One ordinary reusable string variable is added to the blank graph.");
  await inspector.getByLabel("Variable 1 name").fill("subject");
  await inspector.getByLabel("Variable 1 value").fill("cobalt vessel");
  await inspector.getByLabel("Variable interpolation preview").fill("${subject} on warm stone");
  await expect(inspector.getByTestId("variables-preview")).toContainText("cobalt vessel on warm stone");
  await input.leftClick(inspector.getByRole("button", { name: "Save variables", exact: true }), "Save typed Variables", "The saved variable is available to reachable downstream text only.");
  await expect(page.getByTestId("canvas-status")).toContainText("Update Variables saved");
}

async function authorPrompt(page: Page, input: RealPageInput, prompt: Locator) {
  await input.leftClick(prompt.getByRole("button", { name: "Edit Prompt body", exact: true }), "Focus Prompt content", "The Prompt's primary content control owns keyboard focus for the variable token.");
  await input.pressKey("Enter", "Edit Prompt content", "Enter opens the focused Prompt's direct content editor without switching to a hidden form.");
  const editor = prompt.locator(".ether-node-inline-editor textarea");
  await expect(editor).toBeVisible();
  await editor.fill(promptText);
  await input.pressKey("Control+Enter", "Commit Prompt content", "The reusable ${subject} prompt is saved as one ordinary graph edit.");
  await expect(editor).toBeHidden();
}

async function configureBatch(page: Page, input: RealPageInput, batch: Locator) {
  await input.leftClick(batch.locator(".ether-node-title"), "Select Batch", "The Inspector exposes the exact dimension values and sequential default before any run is prepared.");
  const inspector = page.getByTestId("node-inspector");
  await input.leftClick(inspector.getByRole("button", { name: "Add dimension", exact: true }), "Add the lighting dimension", "A new Batch begins empty and the first controlled dimension is added explicitly.");
  const dimensions = inspector.getByTestId("inspector-list-dimensions");
  await dimensions.getByLabel("Name").fill("Lighting");
  await dimensions.getByLabel("Values").fill("morning\nevening");
  await input.leftClick(inspector.getByRole("button", { name: "Save batch", exact: true }), "Save the two-cell Batch", "The reusable Batch has two visible lighting cells and sequential concurrency.");
  await expect(page.getByTestId("canvas-status")).toContainText("Update Batch saved");
}

async function configureFakeImage(page: Page, input: RealPageInput, image: Locator) {
  await input.leftClick(image.locator(".ether-node-title"), "Select Image Generator", "The ordinary Provider section lists the recovery-only fake-local image profile.");
  const inspector = page.getByTestId("node-inspector");
  await inspector.getByLabel("Provider profile", { exact: true }).selectOption("ether-fake-local:fake-image-default");
  await input.leftClick(inspector.getByRole("button", { name: "Save provider settings", exact: true }), "Save fake Image Generator profile", "The durable binding is the explicit local simulation profile, not a real provider fallback.");
  await expect(page.getByTestId("canvas-status")).toContainText("Update provider settings saved");
}

async function configureTransform(page: Page, input: RealPageInput, transform: Locator) {
  await input.leftClick(transform.locator(".ether-node-title"), "Select Transform", "The local Transform controls are configured before the generated source exists.");
  const inspector = page.getByTestId("node-inspector");
  await inspector.getByLabel("Operation").selectOption("resize");
  await inspector.getByLabel("Width").fill("96");
  await inspector.getByLabel("Height").fill("96");
  await input.leftClick(inspector.getByRole("button", { name: "Save transform", exact: true }), "Save deterministic resize", "Resize settings become durable local-media behavior with no provider route.");
}

async function configureCompare(page: Page, input: RealPageInput, compare: Locator) {
  await input.leftClick(compare.locator(".ether-node-title"), "Select Compare", "The human checkpoint stays visibly configured as a deliberate one-selection decision.");
  const inspector = page.getByTestId("node-inspector");
  await inspector.getByLabel("Selection mode").selectOption("one");
  await inspector.getByLabel("Minimum selections").fill("1");
  await expect(inspector).toContainText("Compare settings");
}

async function configureEvaluate(page: Page, input: RealPageInput, evaluate: Locator) {
  await input.leftClick(evaluate.locator(".ether-node-title"), "Select Evaluate", "The Inspector exposes the visible instruction, rubric, and distinct evaluation model route.");
  const inspector = page.getByTestId("node-inspector");
  await inspector.getByLabel("Instruction").fill(evaluationInstruction);
  await inspector.getByLabel("Model").fill("deterministic-evaluation-v1");
  const rubric = inspector.getByTestId("inspector-list-rubric");
  await input.leftClick(rubric.getByRole("button", { name: "Add rubric", exact: true }), "Add a visible evaluation criterion", "The configured review instruction carries an explicit weighted criterion.");
  await rubric.getByLabel("Label").fill("Product fidelity");
  await input.leftClick(inspector.getByRole("button", { name: "Save evaluate", exact: true }), "Save Evaluate settings", "The distinct recovery evaluation capability is saved with its authored instruction and rubric.");
}

async function configureFilter(page: Page, input: RealPageInput, filter: Locator) {
  await input.leftClick(filter.locator(".ether-node-title"), "Select Filter", "The Inspector exposes deterministic rules and named matched routes without an implicit model call.");
  const inspector = page.getByTestId("node-inspector");
  const rules = inspector.getByTestId("inspector-list-rules");
  await input.leftClick(rules.getByRole("button", { name: "Add rule", exact: true }), "Add an evaluation-exists Filter rule", "The Filter route checks persisted evaluator metadata rather than inferring a score from hidden text.");
  await rules.getByLabel("Field").fill("evaluationItem");
  await rules.getByLabel("Operator").selectOption("exists");
  const routes = inspector.getByTestId("inspector-list-routes");
  await input.leftClick(routes.getByRole("button", { name: "Add route", exact: true }), "Add a matched Selects route", "Matched Filter outputs have a durable user-facing route label.");
  await routes.getByLabel("Label").fill("Selects");
  await routes.getByLabel("Outcome").selectOption("matched");
  await input.leftClick(inspector.getByRole("button", { name: "Save filter", exact: true }), "Save deterministic Filter", "The exact rule and route save before Filter runs after the human checkpoint.");
}

async function configureJoin(page: Page, input: RealPageInput, join: Locator) {
  await selectNodeBehindProjectLens(page, input, join, "Join", "The Inspector exposes an explicit post-filter merge strategy and completeness behavior.");
  const inspector = page.getByTestId("node-inspector");
  await expect(inspector).toContainText("Join settings");
  await inspector.getByRole("combobox", { name: "Strategy", exact: true }).selectOption("merge");
  await input.leftClick(inspector.getByRole("button", { name: "Save join", exact: true }), "Save Join strategy", "The branch ends in a deterministic merge with its source lineage preserved.");
}

async function inspectDeliverySetup(page: Page, input: RealPageInput, collection: Locator, exportNode: Locator) {
  await selectNodeBehindProjectLens(page, input, collection, "Collection", "The graph Collection node exposes its non-destructive membership configuration separately from Review workspace collections.");
  const collectionInspector = page.getByTestId("node-inspector");
  await expect(collectionInspector.getByLabel("Collection id")).toHaveValue("default");
  await expect(collectionInspector.getByLabel("Membership mode")).toHaveValue("add");

  await selectNodeBehindProjectLens(page, input, exportNode, "Export", "The graph Export node makes its own grant, naming, format, collision, and sidecar controls visible before any folder is requested.");
  const exportInspector = page.getByTestId("node-inspector");
  await expect(exportInspector.getByLabel("Path grant id")).toHaveValue("unconfigured");
  await exportInspector.getByLabel("Naming template").fill("{collection}/{title}-{artifactId}");
  await exportInspector.getByLabel("Format").selectOption("png");
  await input.leftClick(exportInspector.getByRole("button", { name: "Save export", exact: true }), "Save graph Export delivery template", "The graph node's durable Export setup remains gated on an explicit folder grant and does not write during authoring.");
}

async function connect(input: RealPageInput, source: Locator, output: string, target: Locator, receiver: string, label: string) {
  const sourceHandle = source.getByLabel(output);
  const targetHandle = target.getByLabel(receiver);
  await sourceHandle.hover();
  await input.leftClick(sourceHandle, `Begin ${label}`, `The compatible ${receiver} handle becomes the intended receiver.`);
  await targetHandle.hover();
  await input.leftClick(targetHandle, `Complete ${label}`, "The exact visible lane persists through ordinary channel interaction.");
}

async function selectLatestOnNewestLane(page: Page, input: RealPageInput, label: string, expectedLaneCount: number) {
  const lanes = page.getByTestId("edge-role-chip");
  await expect(lanes).toHaveCount(expectedLaneCount);
  await page.waitForTimeout(250);
  const lane = lanes.nth(expectedLaneCount - 1);
  await input.leftClick(lane.getByRole("button", { name: "General", exact: true }), `Inspect ${label} lane`, "This local or review continuation intentionally consumes the latest durable output, including an unreviewed intermediate.");
  const outputSelection = page.getByTestId("edge-inspector").getByLabel("Output selection", { exact: true });
  await outputSelection.selectOption("latest");
  await expect(outputSelection).toHaveValue("latest");
  await page.waitForTimeout(150);
  await input.leftClick(lanes.nth(expectedLaneCount - 1).locator("button.ether-edge-role-chip"), `Close ${label} role menu`, "The connection remains selected while its role menu no longer covers later canvas handles.");
  await expect(page.getByTestId("edge-role-grid")).toHaveCount(0);
}

async function selectNodeBehindProjectLens(page: Page, input: RealPageInput, node: Locator, title: string, expected: string) {
  await input.leftClick(page.getByRole("button", { name: "Hide Project lens", exact: true }), `Hide Project lens to select ${title}`, "The ordinary canvas target is exposed without changing graph state.");
  await input.leftClick(node.locator(".ether-node-title"), `Select ${title}`, expected);
  await expect(node).toHaveClass(/is-selected/);
  await input.leftClick(page.getByRole("button", { name: "Show Project lens", exact: true }), `Show Project lens for ${title}`, "The selected node's ordinary Inspector returns with the same graph selection.");
  await expect(page.getByTestId("node-inspector")).toBeVisible();
}

async function previewBatchMatrix(page: Page, input: RealPageInput) {
  await input.leftClick(page.getByTestId("workspace-switcher").getByRole("button", { name: "Run", exact: true }), "Open Batch Matrix", "The two authored Batch cells and sequential concurrency are visible before any image run.");
  const matrix = page.getByTestId("pane-artifacts").locator("section.batch-matrix");
  const cells = matrix.getByTestId("batch-cells").getByRole("button");
  await expect(cells).toHaveCount(2);
  await expect(cells.nth(0)).toContainText("morning");
  await expect(cells.nth(1)).toContainText("evening");
  await expect(matrix.getByLabel("Batch execution policy")).toHaveValue("1");
  await input.leftClick(cells.first(), "Exclude one Batch cell", "The visible exclusion removes only the selected morning-or-evening cell.");
  await expect(cells.first()).toHaveAttribute("aria-pressed", "true");
  await expect(matrix.locator(".batch-summary")).toContainText("Excluded1");
}

async function waitForJobStatus(page: Page, input: RealPageInput, status: string, label: string, minimumMatches = 1) {
  await input.leftClick(page.getByTestId("workspace-switcher").getByRole("button", { name: "Run", exact: true }), label, "Job Center exposes the durable state transition created through the reviewed plan.");
  const jobCenter = page.getByRole("region", { name: "Job Center" });
  await expect(jobCenter).toBeVisible();
  await expect.poll(async () => (
    (await jobCenter.locator(".job-list button").allInnerTexts())
      .filter((text) => text.toLocaleLowerCase().includes(status)).length
  )).toBeGreaterThanOrEqual(minimumMatches);
}

async function inspectEvaluationAndFilter(page: Page, input: RealPageInput, observatory: Locator) {
  await input.leftClick(observatory.getByRole("button", { name: "Evaluate", exact: true }), "Inspect visible Evaluate configuration", "The Review workspace shows the authored evaluation instruction, rubric, and deterministic simulation model identity.");
  const evaluationPanel = page.getByTestId("evaluation-panel");
  await expect(evaluationPanel).toContainText(evaluationInstruction);
  await expect(evaluationPanel).toContainText("Product fidelity");
  await expect(evaluationPanel).toContainText("deterministic-evaluation-v1");

  await input.leftClick(observatory.getByRole("button", { name: "Filter", exact: true }), "Inspect deterministic Filter explanations", "The Review workspace exposes the saved evaluation metadata rule and Selects route without a provider call.");
  const filterRules = page.getByTestId("filter-rules");
  await expect(filterRules).toContainText("evaluationItem");
  await expect(filterRules).toContainText("Selects");
  await expect(filterRules).toContainText("No model is called");
}

async function createCollectionAndInspectExport(page: Page, input: RealPageInput, observatory: Locator, evidence: { screenshots: string; root: string; actionLog: string; result: string }) {
  await input.leftClick(observatory.getByRole("button", { name: "Select loaded", exact: true }), "Select the visible generated and transformed artifacts", "Artifact Observatory selects actual document artifacts without a synthetic result set.");
  await input.leftClick(observatory.getByRole("button", { name: "Collections", exact: true }), "Open Collections", "Many-to-many membership is edited in the Artifact Observatory rather than by moving or deleting originals.");
  const collections = page.getByRole("region", { name: "Collections" });
  await collections.getByLabel("New collection title").fill("Campaign selects");
  await input.leftClick(collections.getByRole("button", { name: "Create", exact: true }), "Create Campaign selects collection", "A durable collection is created through the ordinary Review workspace.");
  const card = collections.locator(".collection-cards article").filter({ hasText: "Campaign selects" });
  await expect(card).toBeVisible();
  await input.leftClick(card.getByRole("button", { name: "Add selection", exact: true }), "Add selected artifacts to Campaign selects", "Collection membership is non-destructive and remains visible beside the original artifacts.");
  await expect(card).toContainText("items");

  await input.leftClick(observatory.getByRole("button", { name: "Export", exact: true }), "Open Export delivery setup", "Export presents its explicit destination-grant gate and delivery controls without opening a native folder picker.");
  const dialog = page.getByRole("dialog", { name: "Export artifacts" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Choose folder", { exact: false })).toBeVisible();
  await expect(dialog.getByLabel("Naming template")).toHaveValue("{collection}/{title}-{artifactId}");
  await expect(dialog.getByLabel("Format")).toHaveValue("original");
  await expect(dialog.getByText("Metadata sidecars", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Lineage report", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
  await input.screenshot("02-review-collections-export-gate.png", evidence, "Capture Review collection and direct Export grant gate", "Generated artifacts are selected into Campaign selects while the Review-side direct Export dialog remains visibly blocked on its explicit folder choice; it is independent of the graph Export node and no native dialog or filesystem write occurs.");
  await input.leftClick(dialog.getByRole("button", { name: "Close export", exact: true }), "Close Export setup", "The journey leaves delivery configuration without requesting a folder grant.");
}

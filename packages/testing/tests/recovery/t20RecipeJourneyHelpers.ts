import { expect, type Locator, type Page } from "@playwright/test";

import type { RealPageInput } from "../../recovery/journeyDriver.js";

/**
 * The narrow recipe contract consumed by the T20 packaged journey. Keeping it
 * structural lets the spec retain any display-only facts (such as node count)
 * without coupling these interaction helpers to the catalog implementation.
 */
export type T20RecipeJourney = {
  id: string;
  title: string;
  runTitle: string;
  calls: number;
  checkpoint: boolean;
  batch?: boolean;
  requiresArtifact?: boolean;
  requiresMask?: boolean;
};

const sourceArtifactPrompt = "A small cobalt vessel on warm stone, made as a reusable recipe source image.";
const humanCheckpointNote = "Selected through the visible recipe review checkpoint.";

/** Create one current-document image artifact through the ordinary blank-canvas flow. */
export async function createSourceArtifact(page: Page, input: RealPageInput): Promise<void> {
  const canvas = page.getByTestId("ether-canvas-surface");
  await expect(canvas).toHaveAttribute("data-graph-node-count", "0");

  await addDefinition(page, input, "prompt.text", 1);
  await addDefinition(page, input, "generation.image", 2);

  const prompt = page.locator(".ether-node[data-node-definition='prompt.text']");
  const image = page.locator(".ether-node[data-node-definition='generation.image']");
  await expect(prompt).toHaveCount(1);
  await expect(image).toHaveCount(1);

  await input.leftClick(prompt.getByRole("button", { name: "Edit Prompt body", exact: true }), "Focus source Prompt content", "The blank document's source prompt exposes its direct canvas content target.");
  await input.pressKey("Enter", "Edit source Prompt", "The ordinary Prompt editor opens on the canvas.");
  const promptEditor = prompt.locator(".ether-node-inline-editor textarea");
  await expect(promptEditor).toBeVisible();
  await promptEditor.fill(sourceArtifactPrompt);
  await input.pressKey("Control+Enter", "Commit source Prompt", "The reusable source-artifact brief is saved as authored graph content.");
  await expect(promptEditor).toBeHidden();

  await configureFakeImage(page, input, image, "source Image Generator");
  await connect(input, prompt, "Text output", image, "Text input", "source Prompt to Image Generator");

  await input.leftClick(image.locator(".ether-node-title"), "Select source Image Generator", "The explicit local recovery image route is prepared from the blank graph.");
  const inspector = page.getByTestId("node-inspector");
  await input.leftClick(inspector.getByRole("button", { name: "Preview plan", exact: true }), "Preview source artifact plan", "The one-call fake image plan is inspected before a permit is issued.");
  const plan = page.getByLabel("Prepared plan");
  await expect(plan).toContainText("Node only");
  await assertExactFakePlan(plan, 1);

  const start = inspector.getByRole("button", { name: "Start 1 call", exact: true });
  await expect(start).toBeVisible();
  await input.leftClick(start, "Start source artifact plan", "Only the reviewed offline fake image plan starts; no real provider is contacted.");
  await expect(page.getByTestId("canvas-status")).toContainText("Run started");
  await waitForJobStatus(page, input, "completed", "Wait for the source artifact to become durable");

  await input.leftClick(page.getByTestId("workspace-switcher").getByRole("button", { name: "Build", exact: true }), "Return to Build after source artifact", "The completed current-document artifact is available to recipe setup without changing the graph.");
  await input.leftClick(image.locator(".ether-node-title"), "Inspect source artifact output", "The generated source is confirmed on its ordinary Image Generator node.");
  await expect(page.getByTestId("output-versions")).toContainText("deterministic-png-v1");
}

/** Focus the recipe graph using the canvas's documented fit command. */
export async function fitRecipe(page: Page, input: RealPageInput): Promise<void> {
  const canvas = page.getByTestId("ether-canvas-surface");
  await expect(canvas).toBeVisible();
  await canvas.focus();
  await input.pressKey("Home", "Fit inserted recipe", "The inserted recipe's cards and visible lanes fit the ordinary canvas viewport.");
  await page.waitForTimeout(350);
}

/** Paint and commit a real local mask through the selected recipe Mask node. */
export async function publishRecipeMask(page: Page, input: RealPageInput): Promise<void> {
  const maskNode = nodeByTitle(page, "Paint mask");
  await expect(maskNode).toHaveCount(1);
  await input.leftClick(maskNode.locator(".ether-node-title"), "Select recipe Mask", "The inserted Mask node exposes its visible image-backed Mask workspace.");

  const workspace = page.getByTestId("mask-workspace");
  await expect(workspace).toBeVisible({ timeout: 30_000 });
  await expect(workspace).toContainText("Mask output");
  await expect(page.getByTestId("mask-input-summary")).toContainText("1 Image");

  const overlay = workspace.getByTestId("mask-canvas-overlay");
  await overlay.scrollIntoViewIfNeeded();
  const box = await overlay.boundingBox();
  if (box === null || box.width < 8 || box.height < 8) {
    throw new Error("The visible recipe Mask workspace did not provide usable canvas geometry.");
  }
  await input.leftDrag(
    { x: box.x + box.width * 0.24, y: box.y + box.height * 0.28 },
    { x: box.x + box.width * 0.72, y: box.y + box.height * 0.66 },
    "Paint recipe mask",
    "A visible brush stroke creates the local white-selected Mask geometry before it is committed."
  );
  await expect(workspace).toContainText("1 mask stroke");
  await input.leftClick(workspace.getByRole("button", { name: "Commit mask", exact: true }), "Commit recipe mask", "The painted local mask is published as an immutable document artifact without a provider call.");
  await expect(page.getByTestId("canvas-status")).toContainText("Mask artifact", { timeout: 30_000 });
}

/** Locate exactly the node card whose visible title is the supplied recipe title. */
export function nodeByTitle(page: Page, title: string): Locator {
  const exactTitle = new RegExp(`^\\s*${escapeRegularExpression(title)}\\s*$`, "u");
  return page.locator(".ether-node").filter({
    has: page.locator(".ether-node-title", { hasText: exactTitle })
  });
}

/** Preview and start the complete recipe path, stopping at the durable human checkpoint when present. */
export async function runRecipe(page: Page, input: RealPageInput, recipe: T20RecipeJourney): Promise<void> {
  const runNode = nodeByTitle(page, recipe.runTitle);
  await expect(runNode).toHaveCount(1);
  await runNode.scrollIntoViewIfNeeded();
  const runTitle = runNode.locator(".ether-node-title");
  await runTitle.focus();
  await input.pressKey("Space", `Select ${recipe.title} run root`, "The recipe's advertised run node is selected through its visible keyboard-focusable title even when a connection lane crosses the card.");

  const inspector = page.getByTestId("node-inspector");
  await expect(inspector).toBeVisible();
  if (recipe.batch === true) {
    await expect(inspector).toContainText("Batch branch");
  } else {
    const scope = inspector.getByLabel("Run scope", { exact: true });
    await expect(scope).toBeVisible();
    await scope.selectOption("branch");
  }

  await input.leftClick(inspector.getByRole("button", { name: "Preview plan", exact: true }), `Preview ${recipe.title} ${recipe.batch === true ? "Batch" : "Branch"}`, "The exact recipe boundary, fake-provider bindings, and call count are visible before permission is granted.");
  const plan = page.getByLabel("Prepared plan");
  await expect(plan).toBeVisible();
  await expect(plan).toContainText(recipe.batch === true ? "Batch" : "Branch");
  await assertExactFakePlan(plan, recipe.calls);

  const start = inspector.getByRole("button", { name: startCallLabel(recipe.calls), exact: true });
  await expect(start).toBeVisible();
  await input.leftClick(start, `Start ${recipe.title} reviewed plan`, "Only this immutable fake-provider recipe plan receives a one-use permit and starts.");
  await expect(page.getByTestId("canvas-status")).toContainText("Run started");

  if (recipe.checkpoint) {
    await waitForJobStatus(page, input, "waiting review", `Wait for ${recipe.title} human checkpoint`);
  }
}

/** Complete any active Compare checkpoint by explicitly selecting its visible sealed candidates. */
export async function completeHumanCheckpoint(page: Page, input: RealPageInput): Promise<void> {
  await input.leftClick(page.getByTestId("workspace-switcher").getByRole("button", { name: "Review", exact: true }), "Open Review for recipe checkpoint", "Artifact Observatory exposes the durable human Compare checkpoint without an implicit model decision.");
  const observatory = page.getByTestId("artifact-observatory");
  await expect(observatory).toBeVisible();
  await input.leftClick(observatory.getByRole("button", { name: "Compare", exact: true }), "Open recipe Compare stage", "The recipe's sealed output candidates are reviewed by a person, not a model.");

  const stage = page.getByTestId("compare-stage");
  await expect(stage).toBeVisible({ timeout: 30_000 });
  await expect(stage).toContainText("No AI runs here");
  const candidates = stage.locator(".compare-review-tile");
  const candidateCount = await candidates.count();
  if (candidateCount === 0) throw new Error("The recipe Compare checkpoint has no visible sealed candidates.");
  for (let index = 0; index < candidateCount; index += 1) {
    await input.leftClick(candidates.nth(index), `Select recipe review candidate ${index + 1}`, "The visible candidate is included in the explicit human checkpoint decision.");
  }
  await stage.getByLabel("Review note").fill(humanCheckpointNote);
  const complete = stage.getByTestId("compare-complete");
  await expect(complete).toBeEnabled();
  await input.leftClick(complete, "Complete recipe human checkpoint", "The selected output versions and review note are durably saved before downstream work resumes.");
  await expect(stage).toBeHidden({ timeout: 30_000 });
  await expect(observatory.getByRole("status")).toContainText("Human selection saved");
}

/** Wait for a durable Job Center status, counting only the requested status text. */
export async function waitForJobStatus(
  page: Page,
  input: RealPageInput,
  status: string,
  label: string,
  minimumMatches = 1
): Promise<void> {
  await input.leftClick(page.getByTestId("workspace-switcher").getByRole("button", { name: "Run", exact: true }), label, "Job Center exposes the durable transition created through the reviewed recipe plan.");
  const jobCenter = page.getByRole("region", { name: "Job Center" });
  await expect(jobCenter).toBeVisible();
  const expected = normalized(status);
  let lastLabels: string[] = [];
  try {
    await expect.poll(async () => {
      lastLabels = await jobCenter.locator(".job-list button").allInnerTexts();
      return lastLabels.filter((entry) => normalized(entry).includes(expected)).length;
    }, { timeout: 30_000, message: `Expected at least ${minimumMatches} job(s) with status ${status}.` }).toBeGreaterThanOrEqual(minimumMatches);
  } catch (error) {
    let detail = "";
    const failed = jobCenter.locator(".job-list button").filter({ hasText: /failed/iu }).first();
    if (await failed.count() === 1) {
      await input.leftClick(failed, "Inspect failed recipe job", "The failed durable job is opened only to capture its actionable product error.");
      detail = await jobCenter.locator(".job-detail").innerText();
    }
    throw new Error(`Expected at least ${minimumMatches} job(s) with status ${status}; visible jobs: ${JSON.stringify(lastLabels)}; detail: ${JSON.stringify(detail)}`, { cause: error });
  }
}

async function addDefinition(page: Page, input: RealPageInput, definition: string, expectedCount: number): Promise<void> {
  const row = page.locator(`.node-library-item[data-node-definition='${definition}']`);
  await row.scrollIntoViewIfNeeded();
  await input.leftClick(row.locator(".node-library-add"), `Add ${definition} from Node Library`, `The blank document creates ${definition} through the canonical registry.`);
  await expect(page.getByTestId("ether-canvas-surface")).toHaveAttribute("data-graph-node-count", String(expectedCount));
}

async function configureFakeImage(page: Page, input: RealPageInput, image: Locator, title: string): Promise<void> {
  await input.leftClick(image.locator(".ether-node-title"), `Select ${title}`, "The ordinary Inspector exposes the recovery-only fake image profile.");
  const inspector = page.getByTestId("node-inspector");
  const profile = inspector.getByLabel("Provider profile", { exact: true });
  await expect(profile).toBeVisible();
  await profile.selectOption("ether-fake-local:fake-image-default");
  await input.leftClick(inspector.getByRole("button", { name: "Save provider settings", exact: true }), `Save ${title} fake profile`, "The durable binding is the explicit local simulation profile, not a real-provider fallback.");
  await expect(page.getByTestId("canvas-status")).toContainText("Update provider settings saved");
}

async function connect(input: RealPageInput, source: Locator, output: string, target: Locator, receiver: string, label: string): Promise<void> {
  const sourceHandle = source.getByLabel(output);
  const targetHandle = target.getByLabel(receiver);
  await sourceHandle.hover();
  await input.leftClick(sourceHandle, `Begin ${label}`, `The compatible ${receiver} handle becomes the intended receiver.`);
  await targetHandle.hover();
  await input.leftClick(targetHandle, `Complete ${label}`, "The exact visible lane persists through ordinary channel interaction.");
}

async function assertExactFakePlan(plan: Locator, calls: number): Promise<void> {
  await expect(plan).toContainText("Plan ID");
  await expect(plan).toContainText("Content hash");
  await expect(plan).toContainText(providerCallLabel(calls));

  const providers = plan.locator("small").filter({ hasText: /^Provider\s*\u00b7/u });
  await expect(providers).not.toHaveCount(0);
  for (const provider of await providers.allInnerTexts()) {
    expect(provider.trim()).toMatch(/^Provider\s*\u00b7\s*ether-fake-local(?:-evaluation)?(?:\s*\u00b7|$)/u);
  }
}

function providerCallLabel(calls: number): string {
  return `${calls} provider call${calls === 1 ? "" : "s"}`;
}

function startCallLabel(calls: number): string {
  return `Start ${calls} call${calls === 1 ? "" : "s"}`;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

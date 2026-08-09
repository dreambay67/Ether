import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import {
  assertAuthoringJourneySourceSafety,
  blankAuthoringJourney,
  launchRecoveryJourney,
  packagedJourneyConfig,
  recoveryShellTokenForProfile
} from "../../recovery/journeyDriver.js";
import {
  activeElementDescription,
  addFromLibraryWithKeyboard,
  assertKeyboardOnlyJourneySource,
  chooseSelectWithKeyboard,
  connectWithKeyboard,
  keyboardActivate,
  tabTo,
  typeWithKeyboard
} from "./t23KeyboardJourneyHelpers.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const thisSource = fileURLToPath(import.meta.url);
const helperSource = fileURLToPath(new URL("./t23KeyboardJourneyHelpers.ts", import.meta.url));
const journeyId = "t23-j06-keyboard-packaged";

test.skip(process.platform !== "win32", "The T23 J06 keyboard journey runs against packaged Windows Ether.exe.");

test("runs a blank Prompt to Worker to Worker to Image fake-local chain using keyboard-only controls", async () => {
  const [source, helper] = await Promise.all([readFile(thisSource, "utf8"), readFile(helperSource, "utf8")]);
  assertAuthoringJourneySourceSafety(source, "T23 keyboard J06 packaged spec");
  assertKeyboardOnlyJourneySource({ label: "T23 keyboard J06 packaged spec", source }, { label: "T23 keyboard journey helper", source: helper });
  const session = await launchRecoveryJourney({
    ...packagedJourneyConfig(workspaceRoot, journeyId),
    evidenceMode: "committed",
    committedEvidencePath: ["phase-5", "t23-j06-keyboard-packaged"],
    packagedArgs: (profile) => [`--ether-recovery-simulation=${recoveryShellTokenForProfile(profile)}`],
    viewport: { width: 1440, height: 900 },
    declaration: blankAuthoringJourney(journeyId, "fake")
  });
  let closed = false;
  try {
    const { page, input, evidence } = session;
    const canvas = page.getByTestId("ether-canvas-surface");
    await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(canvas).toHaveAttribute("data-graph-node-count", "0");
    input.observe("Initial keyboard focus", "The keyboard-only J06 route starts from the application's actual current focus.", await activeElementDescription(page));

    await addFromLibraryWithKeyboard(page, input, "Prompt", "Prompt", 1);
    await addFromLibraryWithKeyboard(page, input, "Worker", "Worker", 2);
    await addFromLibraryWithKeyboard(page, input, "Worker", "Worker", 3);
    await addFromLibraryWithKeyboard(page, input, "Image Generator", "Image Generator", 4);

    const prompt = page.locator(".ether-node[data-node-definition='prompt.text']");
    const workers = page.locator(".ether-node[data-node-definition='prompt.worker']");
    const workerA = workers.nth(0);
    const workerB = workers.nth(1);
    const image = page.locator(".ether-node[data-node-definition='generation.image']");
    await connectWithKeyboard(page, input, prompt, "Text output", workerA, "Text input", "Prompt to Worker A");
    await connectWithKeyboard(page, input, workerA, "Text output", workerB, "Text input", "Worker A to Worker B");
    await connectWithKeyboard(page, input, workerB, "Text output", image, "Text input", "Worker B to Image Generator");
    await expect(page.locator(".ether-edge-hit-target")).toHaveCount(3);
    const firstRole = page.getByTestId("edge-role-chip").first().getByRole("button", { name: "General", exact: true });
    await keyboardActivate(page, input, firstRole, "Open the first lane role grid", "Space opens the keyboard-reachable role grid for the first connection.", "Space");
    const roleGrid = page.getByTestId("edge-role-grid");
    await expect(roleGrid).toBeVisible();
    const edgeInspector = page.getByTestId("edge-inspector");
    await expect(edgeInspector).toBeVisible();
    const sourceChannel = edgeInspector.getByLabel("Source channel", { exact: true });
    const targetChannel = edgeInspector.getByLabel("Target channel", { exact: true });
    const connectionRole = edgeInspector.getByLabel("Connection role", { exact: true });
    const outputSelection = edgeInspector.getByLabel("Output selection", { exact: true });
    await expect(sourceChannel).toBeVisible();
    await expect(targetChannel).toBeVisible();
    await expect(connectionRole).toHaveValue("general");
    await expect(outputSelection).toHaveValue("latest-approved");
    await tabTo(page, input, connectionRole, "Reach Project Lens Connection role");
    await keyboardActivate(page, input, roleGrid.getByRole("button", { name: "Subject", exact: true }), "Choose the Subject role", "Enter assigns the visible semantic Subject role without pointer input.");
    await expect(page.getByTestId("edge-role-chip").first()).toContainText("Subject");
    await expect(connectionRole).toHaveValue("subject");
    input.observe("Keyboard role grid and Project Lens", "The lane role grid and selected Edge Inspector are reached through Tab and Enter after keyboard-created connection intent.", "The first Text lane now exposes Subject; Project Lens exposes source channel, target channel, connection role, and output-selection controls for the selected edge.");

    await configureWorker(page, input, workerA, "Clarify the subject while preserving its concise intent.", "Worker A");
    await configureWorker(page, input, workerB, "Turn the approved Worker A result into one image-ready prompt.", "Worker B");
    await configureFakeImage(page, input, image);

    await keyboardActivate(page, input, workerA.locator(".ether-node-title"), "Select Worker A for reviewed preview", "Space selects Worker A through its keyboard-reached title.", "Space");
    const inspector = page.getByTestId("node-inspector");
    await chooseSelectWithKeyboard(page, input, inspector.getByLabel("Run scope", { exact: true }), "branch", "Select Worker A branch scope");
    const preview = inspector.getByRole("button", { name: "Preview plan", exact: true });
    await keyboardActivate(page, input, preview, "Preview the fake-local Worker branch", "Enter prepares the immutable Worker-to-Image plan before it can start.");
    const prepared = page.getByLabel("Prepared plan");
    await expect(prepared).toContainText("ether-fake-local");
    await expect(prepared).toContainText("deterministic-transform-v1");
    await expect(prepared).toContainText("fake-image-default");
    const start = inspector.getByRole("button", { name: /^Start \d+ calls?$/u });
    await keyboardActivate(page, input, start, "Explicitly start the reviewed fake-local plan", "Enter grants the one-use permit for the exact displayed plan; no real provider is available to this route.");

    const runWorkspace = page.getByTestId("workspace-switcher").getByRole("button", { name: "Run", exact: true });
    await keyboardActivate(page, input, runWorkspace, "Open Job Center with the keyboard", "Enter opens Run workspace where the durable fake-local job can be observed.");
    const jobCenter = page.getByRole("region", { name: "Job Center" });
    await expect(jobCenter).toBeVisible();
    await expect.poll(async () => (await jobCenter.innerText()).toLocaleLowerCase()).toContain("completed");

    const buildWorkspace = page.getByTestId("workspace-switcher").getByRole("button", { name: "Build", exact: true });
    await keyboardActivate(page, input, buildWorkspace, "Return to Build for output lineage", "Enter returns to the authored chain without using a pointer.");
    await keyboardActivate(page, input, image.locator(".ether-node-title"), "Select Image Generator output", "Space selects the completed Image Generator for output inspection.", "Space");
    const outputVersions = page.getByTestId("output-versions");
    await expect(outputVersions).toContainText("deterministic-png-v1");
    const provenance = outputVersions.locator("summary", { hasText: "Version provenance" }).first();
    await keyboardActivate(page, input, provenance, "Open Image Generator provenance", "Space expands the output's durable selected-input lineage.", "Space");
    await expect(outputVersions).toContainText(/1 inputs? .* 1 selected versions?/u);

    input.observe("Keyboard-only J06 chain", "A blank Prompt to Worker to Worker to Image chain was created, configured, previewed, explicitly started, and inspected using Tab, Enter, Space, Home, Arrow keys, and typed text only.", "The recovery-token-gated fake-local route completed in Job Center and the Image output exposed its selected-input lineage without a real provider request.");
    await input.screenshot("01-keyboard-j06-lineage.png", evidence, "Capture keyboard-only J06 output lineage", "The packaged Image Generator output visibly retains deterministic fake-local provenance after a keyboard-only journey.");
    await session.close("passed");
    closed = true;
  } finally {
    if (!closed) await session.close("failed");
  }
});

async function configureWorker(page: import("@playwright/test").Page, input: import("../../recovery/journeyDriver.js").RealPageInput, node: import("@playwright/test").Locator, instruction: string, label: string): Promise<void> {
  await keyboardActivate(page, input, node.locator(".ether-node-title"), `Select ${label}`, `Space selects ${label} through a tab-reached node title.`, "Space");
  const inspector = page.getByTestId("node-inspector");
  const workerInstruction = inspector.getByLabel("Worker instruction", { exact: true });
  await tabTo(page, input, workerInstruction, `Reach ${label} instruction`);
  await input.pressKey("Control+A", `Select ${label} instruction`, "Ctrl+A remains inside the focused Worker instruction field.");
  await typeWithKeyboard(page, input, instruction, `Type ${label} instruction`, "The Worker instruction is authored through the keyboard-reached Inspector textarea.");
  await chooseSelectWithKeyboard(page, input, inspector.getByLabel("Worker result handling", { exact: true }), "auto-apply", `Set ${label} result handling`);
  await keyboardActivate(page, input, inspector.getByRole("button", { name: "Save worker", exact: true }), `Save ${label}`, "Enter saves the Worker instruction and auto-apply policy through the ordinary Inspector control.");
  await expect(page.getByTestId("canvas-status")).toContainText("Update worker saved");
}

async function configureFakeImage(page: import("@playwright/test").Page, input: import("../../recovery/journeyDriver.js").RealPageInput, node: import("@playwright/test").Locator): Promise<void> {
  await keyboardActivate(page, input, node.locator(".ether-node-title"), "Select Image Generator", "Space selects the Image Generator through its keyboard-reached title.", "Space");
  const inspector = page.getByTestId("node-inspector");
  await chooseSelectWithKeyboard(page, input, inspector.getByLabel("Provider profile", { exact: true }), "ether-fake-local:fake-image-default", "Choose recovery-only fake-local image profile");
  await keyboardActivate(page, input, inspector.getByRole("button", { name: "Save provider settings", exact: true }), "Save fake-local Image profile", "Enter saves the deterministic local image binding; no real provider fallback is used.");
  await expect(page.getByTestId("canvas-status")).toContainText("Update provider settings saved");
}

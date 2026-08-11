import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  assertAuthoringJourneySourceSafety,
  blankAuthoringJourney,
  launchRecoveryJourney,
  packagedJourneyConfig,
  recoveryShellTokenForProfile,
  type RealPageInput
} from "../../recovery/journeyDriver.js";
import { completeNativeFileDialogWithUia, findExactPackagedProcessId } from "../../recovery/windowsIntegration.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const thisSource = fileURLToPath(import.meta.url);
const journeyId = "t15-reference-set-packaged";
const sourceElectronDiagnostic = process.env.ETHER_RECOVERY_SOURCE_ELECTRON === "1";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl5oKAAAAAASUVORK5CYII=", "base64");

test.skip(process.platform !== "win32", "The T15 reference journey uses Windows native file selection in Ether.exe.");

test("builds a linked and embedded Reference Set, then previews its offline Worker input from a blank document", async () => {
  assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "T15 Reference Set packaged spec");
  test.skip(sourceElectronDiagnostic, "The source fixture supports the offline Worker simulation but intentionally cancels native reference selection; do not replace it with bridge or fixture input.");

  const sourcesRoot = await mkdtemp(path.join(os.tmpdir(), "ether-t15-reference-sources-"));
  const sources = ["01-linked-style.png", "02-embedded-subject.png", "03-linked-lighting.png"].map((name) => path.join(sourcesRoot, name));
  await Promise.all(sources.map((source) => writeFile(source, png)));
  const session = await launchRecoveryJourney({
    ...packagedJourneyConfig(workspaceRoot, journeyId),
    evidenceMode: "committed",
    committedEvidencePath: ["phase-3", "t15-reference-set", journeyId],
    packagedArgs: (profile) => [`--ether-recovery-simulation=${recoveryShellTokenForProfile(profile)}`],
    viewport: { width: 1600, height: 1000 },
    declaration: blankAuthoringJourney(journeyId, "fake")
  });
  let closed = false;
  try {
    const { page, input, profile, evidence } = session;
    const canvas = page.getByTestId("ether-canvas-surface");
    await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(canvas).toHaveAttribute("data-graph-node-count", "0");

    await addDefinition(page, input, "reference.set", 1);
    await addDefinition(page, input, "prompt.worker", 2);
    const referenceSet = page.locator(".ether-node[data-node-definition='reference.set']");
    const worker = page.locator(".ether-node[data-node-definition='prompt.worker']");

    await input.leftClick(referenceSet.locator(".ether-node-title"), "Select Reference Set", "The blank document exposes source controls only after the Reference Set exists.");
    const inspector = page.getByTestId("node-inspector");
    await expect(inspector.getByRole("button", { name: "Link file", exact: true })).toBeVisible();
    await chooseReference(input, profile.userData, inspector.getByRole("button", { name: "Link file", exact: true }), sources[0]!, "Link the first local reference");
    const desk = page.locator(".reference-desk");
    await expect(desk).toContainText("01-linked-style.png");
    await chooseReference(input, profile.userData, inspector.getByRole("button", { name: "Embed copy", exact: true }), sources[1]!, "Embed the second local reference");
    await expect(desk).toContainText("02-embedded-subject.png");
    await chooseReference(input, profile.userData, inspector.getByRole("button", { name: "Link file", exact: true }), sources[2]!, "Link the third local reference");
    await expect(inspector).toContainText("3 saved members; ordered manual.");

    await setReferenceSelection(input, desk, "01-linked-style.png", false, "style", "Select excluded Style reference");
    await input.leftClick(desk.getByRole("button", { name: "Add to set", exact: true }), "Add the excluded Style reference", "Add updates membership explicitly and never replaces the existing source set.");
    await expect(inspector).toContainText("3 saved members; ordered manual.");

    await setReferenceSelection(input, desk, "01-linked-style.png", false, "style", "Select first reference for Replace");
    await setReferenceSelection(input, desk, "02-embedded-subject.png", true, "subject", "Select embedded Subject reference for Replace");
    await input.leftClick(desk.locator(".reference-row").filter({ hasText: "03-linked-lighting.png" }).getByRole("checkbox", { name: "Select 03-linked-lighting.png", exact: true }), "Deselect third reference for Replace", "Replace receives only the two explicitly selected references; Include remains an independent channel-use control.");
    await input.leftClick(desk.getByRole("button", { name: "Replace set", exact: true }), "Replace with the explicit two-reference set", "Replace removes the unselected third reference only after the explicit action.");
    await expect(inspector).toContainText("2 saved members; ordered manual.");

    await setReferenceSelection(input, desk, "03-linked-lighting.png", true, "lighting", "Select third reference for explicit Add");
    await input.leftClick(desk.getByRole("button", { name: "Add to set", exact: true }), "Add the third reference after Replace", "Add restores the third reference at the end of manual membership order.");
    await expect(inspector).toContainText("3 saved members; ordered manual.");
    await expect(referenceSet.getByTestId("reference-set-preview")).toHaveAttribute("aria-label", "3 references");
    await expect(referenceSet.getByText("Excluded", { exact: true })).toBeVisible();

    for (const panel of ["Reference Desk", "Build tools", "Project lens"]) {
      await input.leftClick(page.getByRole("button", { name: `Hide ${panel}`, exact: true }), `Hide ${panel}`, "The two-node graph gets a clear canvas for precise channel authoring.");
    }
    await canvas.focus();
    await input.pressKey("Home", "Fit the Reference Set graph", "Both cards and their Image handles fit in the unobstructed canvas.");
    await connect(input, referenceSet, "Image output", worker, "Image input", "Reference Set image input to Worker");
    const roleChip = page.getByTestId("edge-role-chip");
    await input.leftClick(roleChip.getByRole("button", { name: "General", exact: true }), "Open the Reference Set lane roles", "The downstream Worker receives a deliberate semantic role, separate from member-level overrides.");
    await input.leftClick(page.getByTestId("edge-role-grid").getByRole("button", { name: "Style", exact: true }), "Set the Reference Set lane role to Style", "The persisted image lane visibly carries the Style role.");
    await expect(roleChip.getByText("Style", { exact: true })).toBeVisible();

    await input.leftClick(worker.locator(".ether-node-title"), "Select Worker for provider-safe preview", "The Worker receives the enabled Reference Set image members without running a provider.");
    await input.leftClick(page.getByRole("button", { name: "Show Project lens", exact: true }), "Show Project lens for Worker", "The selected Worker's concise setup and preview controls return after connection authoring.");
    const workerInspector = page.getByTestId("node-inspector");
    await workerInspector.getByRole("button", { name: "Advanced worker settings", exact: true }).click();
    await workerInspector.getByLabel("Worker provider and model", { exact: true }).selectOption("ether-fake-local\u0000worker:deterministic-transform-v1");
    await input.leftClick(workerInspector.getByRole("button", { name: "Save advanced settings", exact: true }), "Save the offline Worker route", "The preview is limited to the recovery-only deterministic Worker capability.");
    await expect(page.getByTestId("canvas-status")).toContainText("Update worker saved");

    await input.leftClick(workerInspector.getByRole("button", { name: "Preview plan", exact: true }), "Preview the immutable Reference Set Worker input", "Preview seals the currently enabled members and does not start a provider call.");
    const prepared = page.getByLabel("Prepared plan");
    await expect(prepared).toBeVisible();
    await expect(prepared).toContainText("Node only");
    await expect(prepared).toContainText("ether-fake-local");
    await expect(prepared).toContainText("1 provider call");
    const sealedReferences = prepared.getByRole("region", { name: "Sealed Reference Set members" });
    await expect(sealedReferences).toContainText("Reference Set · 2 included");
    await expect(sealedReferences.locator(":scope > article > strong")).toHaveText(["02-embedded-subject.png", "03-linked-lighting.png"]);
    await expect(sealedReferences.locator(":scope > article").nth(0)).toContainText("Included in this plan · Subject · Image · Embedded reference");
    await expect(sealedReferences.locator(":scope > article").nth(1)).toContainText("Included in this plan · Lighting · Image · Linked reference");
    await expect(sealedReferences).not.toContainText("01-linked-style.png");
    const collapsedReferenceDetails = sealedReferences.locator(":scope > article details:not([open])");
    await expect(collapsedReferenceDetails).toHaveCount(2);
    await expect(collapsedReferenceDetails.filter({ hasText: "Payload ID" })).toHaveCount(2);
    await expect(workerInspector.getByRole("button", { name: "Start 1 call", exact: true })).toBeVisible();
    await input.screenshot("01-sealed-reference-preview.png", evidence, "Capture the sealed Reference Set preview", "The ordinary preview shows two enabled members in manual order with Subject and Lighting roles; the excluded Style member and expert IDs stay out of the concise view.");
    input.observe("T15 provider-safe Reference Set preview", "The blank-authored Worker preview contains the two enabled references only and remains unstarted.", "Link, Embed, explicit Add, explicit Replace, manual order, an excluded Style member, and two enabled members were authored through UI; the concise immutable preview showed their names, order, roles, channels, and source kinds on the offline deterministic Worker route.");

    await session.close("passed");
    closed = true;
  } finally {
    if (!closed) await session.close("failed");
    await rm(sourcesRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});

async function addDefinition(page: Page, input: RealPageInput, definition: string, expectedCount: number): Promise<void> {
  const row = page.locator(`.node-library-item[data-node-definition='${definition}']`);
  await row.scrollIntoViewIfNeeded();
  await input.leftClick(row.locator(".node-library-add"), `Add ${definition} from Node Library`, `The blank document creates ${definition} through the canonical registry.`);
  await expect(page.getByTestId("ether-canvas-surface")).toHaveAttribute("data-graph-node-count", String(expectedCount));
}

async function chooseReference(input: RealPageInput, userData: string, button: Locator, source: string, label: string): Promise<void> {
  await input.leftClick(button, label, "The exact local source is selected through Ether's owned native file picker.");
  await completeNativeFileDialogWithUia(await exactPackagedPid(userData), source);
  input.observe(`${label} completed`, "The owned native Open dialog returned one local image path to Ether.", path.basename(source));
}

async function setReferenceSelection(input: RealPageInput, desk: Locator, displayName: string, enabled: boolean, role: string, label: string): Promise<void> {
  const row = desk.locator(".reference-row").filter({ hasText: displayName });
  const selector = row.getByRole("checkbox", { name: `Select ${displayName}`, exact: true });
  if (!(await selector.isChecked())) {
    await input.leftClick(selector, label, "The Reference Desk selection carries explicit inclusion and role metadata.");
  }
  const include = row.getByRole("checkbox", { name: "Include", exact: true });
  if (enabled) await include.check();
  else await include.uncheck();
  await row.getByLabel(`${displayName} role override`, { exact: true }).selectOption(role);
}

async function connect(input: RealPageInput, source: Locator, output: string, target: Locator, receiver: string, label: string): Promise<void> {
  const sourceHandle = source.getByLabel(output);
  const targetHandle = target.getByLabel(receiver);
  await sourceHandle.hover();
  await input.leftClick(sourceHandle, `Begin ${label}`, `The compatible ${receiver} handle becomes the intended receiver.`);
  await targetHandle.hover();
  await input.leftClick(targetHandle, `Complete ${label}`, "The Reference Set image lane persists through ordinary canvas input.");
}

async function exactPackagedPid(userData: string): Promise<number> {
  return findExactPackagedProcessId(path.join(workspaceRoot, "release", "windows", "win-unpacked", "Ether.exe"), userData);
}

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectEtherDocument } from "@ether/document";
import { expect, test } from "@playwright/test";

import {
  assertAuthoringJourneySourceSafety,
  blankAuthoringJourney,
  cleanupIsolatedJourneyProfile,
  launchRecoveryJourney,
  packagedJourneyConfig,
  type RecoveryJourneySession
} from "../../recovery/journeyDriver.js";
import {
  WINDOWS_INTEGRATION_MODE,
  assertExactPackagedEtherExecutable,
  assertExactProcessForPath,
  cleanupWindowsIntegrationRoot,
  completeNativeFileDialogWithUia,
  createAssociationDryRunPlan,
  createWindowsIntegrationRoot,
  findExactPackagedProcessId,
  invokeDocumentFromExplorerWithUia,
  isAssociationMutationApproved,
  removeTestOwnedDisposableRoots,
  restoreReversibleAssociation,
  applyReversibleAssociation
} from "../../recovery/windowsIntegration.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const thisSource = fileURLToPath(import.meta.url);
const packagedExecutable = path.join(workspaceRoot, "release", "windows", "win-unpacked", "Ether.exe");

test.skip(process.platform !== "win32", "A02 Windows integration runs only on Windows.");
test.skip(process.env[WINDOWS_INTEGRATION_MODE] !== "packaged", `Set ${WINDOWS_INTEGRATION_MODE}=packaged after a reviewed package exists.`);

test("records the scoped A02 packaged native-picker, identity, lease, and Explorer association journey", async () => {
  await assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "A02 Windows integration journey");
  const executable = await assertExactPackagedEtherExecutable(packagedExecutable, workspaceRoot);
  const root = await createWindowsIntegrationRoot();
  const documentPath = path.join(root, "Unicode Žltý priestor.ether");
  const renamedPath = path.join(root, "Save As Žltý priestor.ether");
  let primary: RecoveryJourneySession | null = null;
  let reopened: RecoveryJourneySession | null = null;
  let primaryProfile: RecoveryJourneySession["profile"] | null = null;
  let associationPlan: Awaited<ReturnType<typeof createAssociationDryRunPlan>> | null = null;

  try {
    primary = await launch(executable, "a02-windows-primary", undefined);
    primaryProfile = primary.profile;
    const primaryPid = await findExactPackagedProcessId(executable, primary.profile.userData);
    await expect(primary.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await primary.input.leftClick(primary.page.getByRole("button", { name: "Prompt", exact: true }), "Create a document through visible UI", "The blank canvas has one UI-authored node before native Save.");
    await primary.input.pressKey("Control+S", "Save through the native Windows picker", "The exact Ether-owned native Save dialog receives the Unicode/spaces path through UI Automation.");
    await completeNativeFileDialogWithUia(primaryPid, documentPath);
    await expect.poll(() => isFile(documentPath)).toBe(true);
    await assertOneFileDocument(root, documentPath);
    await assertDocumentIdentity(documentPath);
    primary.input.observe("One-file format identity", "The saved document is a single valid Ether document with format/application/schema identity.", `Validated ${path.basename(documentPath)} with inspectEtherDocument.`);

    await primary.input.leftClick(primary.page.getByRole("button", { name: "Save as", exact: true }), "Save As through the native Windows picker", "The UI switches only after the Unicode destination validates.");
    await completeNativeFileDialogWithUia(primaryPid, renamedPath);
    await expect.poll(() => isFile(renamedPath)).toBe(true);
    await expect(primary.page.getByTestId("project-header")).toContainText(path.basename(renamedPath));
    primary.input.observe("Save As lease rebinding", "The source writer lease is released and the destination lease is active in isolated AppData.", "Verified by the second opened source document below; source is not held by the Save As writer.");

    await primary.input.leftClick(primary.page.getByRole("button", { name: "Open", exact: true }), "File > Open through native picker", "The exact Ether-owned native Open dialog receives the saved source path through UI Automation.");
    await completeNativeFileDialogWithUia(primaryPid, documentPath);
    await expect(primary.page.getByTestId("project-header")).toContainText(path.basename(documentPath));
    await primary.input.screenshot("01-native-open-unicode.png", primary.evidence, "Capture File > Open result", "File > Open shows the original Unicode/spaces document.");

    reopened = await launch(executable, "a02-windows-second-instance", primary.profile, documentPath);
    await expect(reopened.page.getByTestId("project-header")).toContainText(path.basename(documentPath), { timeout: 30_000 });
    await assertExactProcessForPath(executable, primaryPid);
    reopened.input.observe("Second-instance focus", "Opening the already-open exact path targets the packaged Ether.exe window rather than a user-installed Ether process.", `Exact packaged PID ${primaryPid} remained the observed target.`);

    const disposableRoots = [
      path.join(primary.profile.localAppData, "Ether-Recovery-Profile", "cache"),
      path.join(primary.profile.localAppData, "Ether-Recovery-Profile", "provider-staging"),
      path.join(primary.profile.localAppData, "Ether-Recovery-Profile", "live-output")
    ];
    await removeTestOwnedDisposableRoots(primary.profile.root, disposableRoots);
    await expect(primary.page.getByTestId("document-canvas")).toBeVisible();
    await assertDocumentIdentity(documentPath);
    primary.input.observe("Test-owned cache/staging/live-output deletion", "Only disposable roots beneath the driver-created profile were removed; project data reopens and validates.", "Removed only named test-owned roots and revalidated the .ether file.");

    associationPlan = await createAssociationDryRunPlan({ executablePath: executable, documentPath, root });
    primary.input.observe("Association dry run", "The exact HKCU .ether key and original ProgID state are snapshotted before any optional mutation.", `Dry-run plan uses unique ${associationPlan.testProgId}; no registry mutation occurred without main approval.`);
    if (isAssociationMutationApproved()) {
      try {
        await applyReversibleAssociation(associationPlan);
        const uiaResult = await invokeDocumentFromExplorerWithUia(documentPath);
        await expect(primary.page.getByTestId("project-header")).toContainText(path.basename(documentPath), { timeout: 30_000 });
        primary.input.observe("Explorer association", "Explorer's exact UIA InvokePattern opens the test-owned .ether in the exact packaged Ether.exe.", uiaResult);
      } finally {
        await restoreReversibleAssociation(associationPlan);
      }
      associationPlan = null;
    }

    await primary.input.pressKey("Alt+F4", "Clean close through keyboard", "A Saved document closes without an unsaved-changes prompt.");
    await expect.poll(() => primary?.page.isClosed() ?? false, { timeout: 15_000 }).toBe(true);
    await primary.close("passed");
    primary = null;
  } finally {
    if (associationPlan !== null && isAssociationMutationApproved()) await restoreReversibleAssociation(associationPlan).catch(() => undefined);
    if (reopened !== null) await reopened.close("failed");
    if (primary !== null) await primary.close("failed");
    if (primaryProfile !== null) await cleanupIsolatedJourneyProfile(primaryProfile).catch(() => undefined);
    await cleanupWindowsIntegrationRoot(root).catch(() => undefined);
  }
});

async function launch(executablePath: string, journeyId: string, profile?: RecoveryJourneySession["profile"], openPath?: string): Promise<RecoveryJourneySession> {
  return launchRecoveryJourney({
    ...packagedJourneyConfig(workspaceRoot, journeyId),
    executablePath,
    declaration: blankAuthoringJourney(journeyId),
    evidenceMode: "committed",
    committedEvidencePath: ["phase-0", "document-windows-integration", journeyId],
    ...(profile === undefined ? { cleanupProfile: false } : { profile, cleanupProfile: false }),
    packagedArgs: () => openPath === undefined ? [] : [openPath]
  });
}

async function assertOneFileDocument(root: string, documentPath: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  expect(entries.filter((entry) => entry.name.endsWith(".ether"))).toHaveLength(1);
  expect(entries.some((entry) => entry.isDirectory() && entry.name === `${path.basename(documentPath, ".ether")}.ether`)).toBe(false);
  expect((await stat(documentPath)).size).toBeGreaterThan(0);
}

async function assertDocumentIdentity(documentPath: string): Promise<void> {
  const inspection = inspectEtherDocument(documentPath);
  expect(inspection.document.formatMarker).toBe("ETHERDOC");
  expect(inspection.document.formatVersion).toMatch(/^4\./u);
  expect(inspection.pragmas.applicationId).toBe(0x45544852);
  expect(inspection.pragmas.userVersion).toBeGreaterThan(0);
}

async function isFile(candidate: string): Promise<boolean> {
  try { return (await stat(candidate)).isFile(); } catch { return false; }
}

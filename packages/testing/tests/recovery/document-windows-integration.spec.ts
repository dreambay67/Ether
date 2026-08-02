import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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
  ASSOCIATION_APPROVAL,
  ASSOCIATION_APPROVAL_VALUE,
  SHELL_UI_APPROVAL,
  SHELL_UI_APPROVAL_VALUE,
  WINDOWS_INTEGRATION_MODE,
  assertExactPackagedEtherExecutable,
  assertExactPackagedProcess,
  assertExactWindowForegroundWithUia,
  applyReversibleAssociation,
  cleanupWindowsIntegrationRoot,
  completeNativeFileDialogWithUia,
  createAssociationDryRunPlan,
  createWindowsIntegrationRoot,
  dragDocumentFromExplorerWithNativePointer,
  findExactPackagedProcessId,
  invokeDocumentFromExplorerWithUia,
  invokeJumpListRecentDocumentWithUia,
  minimizeExactWindowWithUia,
  openExactWindowWithNativeKeyboard,
  removeTestOwnedDisposableRoots,
  readAndCloseExactNativeErrorDialog,
  cleanupTestOwnedRecentShortcuts,
  restoreReversibleAssociation,
  snapshotTestOwnedRecentShortcuts
} from "../../recovery/windowsIntegration.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const thisSource = fileURLToPath(import.meta.url);
const packagedExecutable = path.join(workspaceRoot, "release", "windows", "win-unpacked", "Ether.exe");

test.skip(process.platform !== "win32", "A02 Windows integration runs only on Windows.");
test.skip(process.env[WINDOWS_INTEGRATION_MODE] !== "packaged", `Set ${WINDOWS_INTEGRATION_MODE}=packaged after a reviewed package exists.`);

test("records the scoped A02 packaged native-picker, identity, lease, and association dry-run journey", async () => {
  await assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "A02 Windows integration journey");
  const executable = await assertExactPackagedEtherExecutable(packagedExecutable, workspaceRoot);
  const root = await createWindowsIntegrationRoot();
  const documentPath = path.join(root, "Unicode \u017dlt\u00fd priestor.ether");
  const renamedPath = path.join(root, "Save As \u017dlt\u00fd priestor.ether");
  const copyPath = path.join(root, "Copy \u017dlt\u00fd priestor.ether");
  let primary: RecoveryJourneySession | null = null;
  let reopened: RecoveryJourneySession | null = null;
  let primaryProfile: RecoveryJourneySession["profile"] | null = null;

  try {
    primary = await launch(executable, "a02-windows-primary");
    primaryProfile = primary.profile;
    const recentBefore = await snapshotTestOwnedRecentShortcuts({ appData: primary.profile.appData, root, documentPaths: [documentPath, renamedPath, copyPath] });
    const primaryPid = await findExactPackagedProcessId(executable, primary.profile.userData);
    await expect(primary.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await primary.input.leftClick(primary.page.getByRole("button", { name: "Prompt", exact: true }), "Create a document through visible UI", "The blank canvas has one UI-authored node before native Save.");
    await primary.input.pressKey("Control+s", "Save through the native Windows picker", "The exact Ether-owned native Save dialog receives the Unicode/spaces path through UI Automation.");
    await completeNativeFileDialogWithUia(primaryPid, documentPath);
    await expect.poll(() => isFile(documentPath)).toBe(true);
    await assertOneFileDocument(root, documentPath);
    await assertDocumentIdentity(documentPath);
    primary.input.observe("One-file format identity", "The saved document is a single valid Ether document with format/application/schema identity.", `Validated ${path.basename(documentPath)} with inspectEtherDocument.`);
    primary.input.observe("Recent shortcut snapshot", "Only shortcuts resolving to unique test-owned paths are eligible for later cleanup.", `Found ${recentBefore.length} pre-existing matching isolated-profile Recent shortcuts.`);

    await primary.input.leftClick(primary.page.getByRole("button", { name: "Save as", exact: true }), "Save As through the native Windows picker", "The UI switches only after the Unicode destination validates.");
    await completeNativeFileDialogWithUia(primaryPid, renamedPath);
    await expect.poll(() => isFile(renamedPath)).toBe(true);
    await expect(primary.page.getByTestId("project-header")).toContainText(path.basename(renamedPath));
    await assertIsolatedLeasePlacement(primary.profile, root, documentPath, renamedPath);
    primary.input.observe("Save As lease rebinding", "The source writer lease is released and the destination lease is active under isolated AppData, never beside the document.", "Enumerated the document directory and observed active lease root after the completed Save As; recovery remains unclaimed by this clean-save journey.");

    await primary.input.leftClick(primary.page.getByRole("button", { name: "Save a copy", exact: true }), "Save a Copy through the native Windows picker", "A complete Unicode/spaces copy is saved without switching the active Save As document.");
    await completeNativeFileDialogWithUia(primaryPid, copyPath);
    await expect.poll(() => isFile(copyPath)).toBe(true);
    await expect(primary.page.getByTestId("project-header")).toContainText(path.basename(renamedPath));
    await assertDocumentIdentity(copyPath);
    primary.input.observe("Save a Copy result", "Save a Copy creates a valid second .ether file while the active document remains the Save As destination.", `Validated ${path.basename(copyPath)} and retained ${path.basename(renamedPath)} as the active title.`);

    const openAction = await openExactWindowWithNativeKeyboard(primaryPid);
    primary.input.observe("File > Open through native picker", "A native Ctrl+O sent to the exact packaged Ether window opens its native picker.", openAction);
    await completeNativeFileDialogWithUia(primaryPid, documentPath);
    await expect(primary.page.getByTestId("project-header")).toContainText(path.basename(documentPath));
    await primary.input.screenshot("01-native-open-unicode.png", primary.evidence, "Capture File > Open result", "File > Open shows the original Unicode/spaces document.");

    await minimizeExactWindowWithUia(primaryPid);
    const secondInstance = await requestSecondInstance(executable, primary.profile, documentPath);
    await expect(primary.page.getByTestId("project-header")).toContainText(path.basename(documentPath), { timeout: 30_000 });
    await expect.poll(() => primary?.page.evaluate(() => document.hasFocus()) ?? false).toBe(true);
    await assertExactWindowForegroundWithUia(primaryPid);
    await assertExactPackagedProcess(executable, primaryPid);
    primary.input.observe("Second-instance focus", "A separate exact Ether.exe request exits through the single-instance lock and focuses the already-attached primary window for the requested document.", secondInstance);

    const disposableRoots = await createActualTestOwnedDisposableRoots(primary.profile);
    await primary.input.pressKey("Alt+F4", "Clean close after disposable-root cleanup", "A Saved document closes without an unsaved-changes prompt before reopen validation.");
    await expect.poll(() => primary?.page.isClosed() ?? false, { timeout: 15_000 }).toBe(true);
    await primary.close("passed");
    primary = null;

    if (primaryProfile === null) throw new Error("Primary packaged journey did not retain its isolated profile.");
    await removeTestOwnedDisposableRoots(primaryProfile.root, disposableRoots);
    for (const disposableRoot of disposableRoots) await expect.poll(() => exists(disposableRoot)).toBe(false);

    reopened = await launch(executable, "a02-windows-reopen-after-cleanup", primaryProfile, documentPath);
    await expect(reopened.page.getByTestId("project-header")).toContainText(path.basename(documentPath), { timeout: 30_000 });
    await expect(reopened.page.locator(".react-flow__node")).toHaveCount(1);
    await assertDocumentIdentity(documentPath);
    reopened.input.observe("Test-owned cache/staging/live-output deletion", "Only actual named disposable roots under the isolated profile were removed; project data reopens and validates.", "Created and removed test-owned cache, staging, and live-output sentinels; reopened the UI-authored .ether and validated its graph/identity.");

    const associationPlan = await createAssociationDryRunPlan({ executablePath: executable, documentPath, root });
    reopened.input.observe("Association dry run", "The exact HKCU .ether key and original ProgID state are snapshotted before any future optional mutation.", `Dry-run plan uses unique ${associationPlan.testProgId}; this harness does not mutate the registry or invoke Explorer.`);
    await reopened.input.pressKey("Alt+F4", "Clean close through keyboard", "A Saved document closes without an unsaved-changes prompt.");
    await expect.poll(() => reopened?.page.isClosed() ?? false, { timeout: 15_000 }).toBe(true);
    await reopened.close("passed");
    reopened = null;
  } finally {
    if (reopened !== null) await reopened.close("failed");
    if (primary !== null) await primary.close("failed");
    if (primaryProfile !== null) await cleanupTestOwnedRecentShortcuts({ appData: primaryProfile.appData, root, documentPaths: [documentPath, renamedPath, copyPath] }).catch(() => undefined);
    if (primaryProfile !== null) await cleanupIsolatedJourneyProfile(primaryProfile).catch(() => undefined);
    await cleanupWindowsIntegrationRoot(root).catch(() => undefined);
  }
});

test("runs the separately approved reversible Explorer association route", async () => {
  test.skip(
    process.env[ASSOCIATION_APPROVAL] !== ASSOCIATION_APPROVAL_VALUE,
    `Main must explicitly authorize ${ASSOCIATION_APPROVAL}=${ASSOCIATION_APPROVAL_VALUE}.`
  );
  const executable = await assertExactPackagedEtherExecutable(packagedExecutable, workspaceRoot);
  const root = await createWindowsIntegrationRoot();
  const documentPath = path.join(root, "Association \u017dlt\u00fd test.ether");
  let session: RecoveryJourneySession | null = null;
  let profile: RecoveryJourneySession["profile"] | null = null;
  let plan: Awaited<ReturnType<typeof createAssociationDryRunPlan>> | null = null;
  try {
    session = await launch(executable, "a02-windows-association");
    profile = session.profile;
    await snapshotTestOwnedRecentShortcuts({ appData: profile.appData, root, documentPaths: [documentPath] });
    const primaryPid = await findExactPackagedProcessId(executable, profile.userData);
    await expect(session.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await session.input.leftClick(session.page.getByRole("button", { name: "Prompt", exact: true }), "Create a test-owned association document", "A visible blank-UI node is saved before Explorer invokes the association.");
    await session.input.pressKey("Control+s", "Save association document through native picker", "The association target is a unique test-owned .ether document.");
    await completeNativeFileDialogWithUia(primaryPid, documentPath);
    await expect.poll(() => isFile(documentPath)).toBe(true);
    plan = await createAssociationDryRunPlan({ executablePath: executable, documentPath, root });
    try {
      await applyReversibleAssociation(plan);
      await minimizeExactWindowWithUia(primaryPid);
      const activation = await invokeDocumentFromExplorerWithUia(documentPath);
      await expect(session.page.getByTestId("project-header")).toContainText(path.basename(documentPath), { timeout: 30_000 });
      await expect.poll(() => session?.page.evaluate(() => document.hasFocus()) ?? false).toBe(true);
      await assertExactPackagedProcess(executable, primaryPid);
      await assertExactWindowForegroundWithUia(primaryPid);
      session.input.observe("Explorer UIA association", "Explorer resolves the uniquely named test folder/item, invokes it through UI Automation, and focuses the exact packaged primary document.", activation);
    } finally {
      await restoreReversibleAssociation(plan);
      plan = null;
    }
    await session.close("passed");
    session = null;
  } finally {
    if (plan !== null) await restoreReversibleAssociation(plan).catch(() => undefined);
    if (session !== null) await session.close("failed");
    if (profile !== null) await cleanupTestOwnedRecentShortcuts({ appData: profile.appData, root, documentPaths: [documentPath] }).catch(() => undefined);
    if (profile !== null) await cleanupIsolatedJourneyProfile(profile).catch(() => undefined);
    await cleanupWindowsIntegrationRoot(root).catch(() => undefined);
  }
});

test("runs the separately approved Explorer pointer drag/drop route", async () => {
  test.skip(
    process.env[SHELL_UI_APPROVAL] !== SHELL_UI_APPROVAL_VALUE,
    `Main must explicitly authorize ${SHELL_UI_APPROVAL}=${SHELL_UI_APPROVAL_VALUE}.`
  );
  const executable = await assertExactPackagedEtherExecutable(packagedExecutable, workspaceRoot);
  const root = await createWindowsIntegrationRoot();
  const sourcePath = path.join(root, "Explorer drag source \u017dlt\u00fd.ether");
  const targetPath = path.join(root, "Explorer drag target \u017dlt\u00fd.ether");
  let session: RecoveryJourneySession | null = null;
  let profile: RecoveryJourneySession["profile"] | null = null;
  try {
    session = await launch(executable, "a02-windows-explorer-drag");
    profile = session.profile;
    await snapshotTestOwnedRecentShortcuts({ appData: profile.appData, root, documentPaths: [sourcePath, targetPath] });
    const primaryPid = await findExactPackagedProcessId(executable, profile.userData);
    await expect(session.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await session.input.leftClick(session.page.getByRole("button", { name: "Prompt", exact: true }), "Create the Explorer drag source through visible UI", "The source .ether document has a real graph authored through the canvas UI.");
    await session.input.pressKey("Control+s", "Save unique Explorer drag source", "The native picker saves the test-owned drag source.");
    await completeNativeFileDialogWithUia(primaryPid, sourcePath);
    await expect.poll(() => isFile(sourcePath)).toBe(true);
    await session.input.leftClick(session.page.getByRole("button", { name: "New", exact: true }), "Create a visibly different active drag target", "The target begins as a new blank document while the saved Explorer source remains unchanged.");
    await session.input.leftClick(session.page.getByRole("button", { name: "Prompt", exact: true }), "Add first target node", "The active target graph differs from the saved one-node source.");
    await session.input.leftClick(session.page.getByRole("button", { name: "Image", exact: true }), "Add second target node", "The active target visibly has two nodes before the Explorer drop.");
    await expect(session.page.locator(".react-flow__node")).toHaveCount(2);
    await session.input.pressKey("Control+s", "Save distinct active drag target", "The native picker saves the two-node target separately from the source.");
    await completeNativeFileDialogWithUia(primaryPid, targetPath);
    await expect(session.page.getByTestId("project-header")).toContainText(path.basename(targetPath));
    const target = await nativeScreenPointForCanvas(session);
    const drag = await dragDocumentFromExplorerWithNativePointer({ documentPath: sourcePath, etherPid: primaryPid, target });
    await expect(session.page.getByTestId("project-header")).toContainText(path.basename(sourcePath), { timeout: 30_000 });
    await expect(session.page.locator(".react-flow__node")).toHaveCount(1);
    await expect.poll(() => session?.page.evaluate(() => document.hasFocus()) ?? false).toBe(true);
    await assertExactPackagedProcess(executable, primaryPid);
    await assertExactWindowForegroundWithUia(primaryPid);
    session.input.observe("Explorer pointer drag/drop", "A real OS pointer drag from the uniquely named Explorer item onto the exact Fixer Ether canvas opens the source document.", `${drag}; canvas target=(${target.x},${target.y}).`);
    await session.close("passed");
    session = null;
  } finally {
    if (session !== null) await session.close("failed");
    if (profile !== null) await cleanupTestOwnedRecentShortcuts({ appData: profile.appData, root, documentPaths: [sourcePath, targetPath] }).catch(() => undefined);
    if (profile !== null) await cleanupIsolatedJourneyProfile(profile).catch(() => undefined);
    await cleanupWindowsIntegrationRoot(root).catch(() => undefined);
  }
});

test("runs the separately approved Windows Jump List known-and-missing target route", async () => {
  test.skip(
    process.env[SHELL_UI_APPROVAL] !== SHELL_UI_APPROVAL_VALUE,
    `Main must explicitly authorize ${SHELL_UI_APPROVAL}=${SHELL_UI_APPROVAL_VALUE}.`
  );
  const executable = await assertExactPackagedEtherExecutable(packagedExecutable, workspaceRoot);
  const root = await createWindowsIntegrationRoot();
  const documentPath = path.join(root, "Jump List unique \u017dlt\u00fd.ether");
  let session: RecoveryJourneySession | null = null;
  let profile: RecoveryJourneySession["profile"] | null = null;
  try {
    session = await launch(executable, "a02-windows-jump-list");
    profile = session.profile;
    await snapshotTestOwnedRecentShortcuts({ appData: profile.appData, root, documentPaths: [documentPath] });
    const primaryPid = await findExactPackagedProcessId(executable, profile.userData);
    await session.input.leftClick(session.page.getByRole("button", { name: "Prompt", exact: true }), "Create unique Jump List document", "Saving it lets Ether register the unique target with app.addRecentDocument and its recent Jump List category.");
    await session.input.pressKey("Control+s", "Save unique Jump List target", "The native picker saves the exact test-owned recent document.");
    await completeNativeFileDialogWithUia(primaryPid, documentPath);
    await expect.poll(() => isFile(documentPath)).toBe(true);
    await session.page.waitForTimeout(1_000);
    await minimizeExactWindowWithUia(primaryPid);
    const knownTarget = await invokeJumpListRecentDocumentWithUia({ documentPath, etherPid: primaryPid });
    await expect(session.page.getByTestId("project-header")).toContainText(path.basename(documentPath), { timeout: 30_000 });
    await expect.poll(() => session?.page.evaluate(() => document.hasFocus()) ?? false).toBe(true);
    await assertExactPackagedProcess(executable, primaryPid);
    await assertExactWindowForegroundWithUia(primaryPid);
    session.input.observe("Jump List known target", "The exact unique Windows shell recent item routes to and focuses the existing Fixer Ether document.", knownTarget);

    await session.input.leftClick(session.page.getByRole("button", { name: "New", exact: true }), "Switch to a new document before missing-target check", "The Jump List document is no longer open when its test-owned source file is deleted.");
    await expect(session.page.getByTestId("project-header")).not.toContainText(path.basename(documentPath));
    await rm(documentPath, { force: true });
    await expect.poll(() => isFile(documentPath)).toBe(false);
    const missingTarget = await invokeJumpListRecentDocumentWithUia({ documentPath, etherPid: primaryPid });
    const nativeError = await readAndCloseExactNativeErrorDialog(primaryPid, documentPath);
    session.input.observe("Jump List missing target", "The exact unique recent item reports an Ether-owned native error naming the deleted test document.", `${missingTarget}; ${nativeError}`);
    await session.close("passed");
    session = null;
  } finally {
    if (session !== null) await session.close("failed");
    if (profile !== null) await cleanupTestOwnedRecentShortcuts({ appData: profile.appData, root, documentPaths: [documentPath] }).catch(() => undefined);
    if (profile !== null) await cleanupIsolatedJourneyProfile(profile).catch(() => undefined);
    await cleanupWindowsIntegrationRoot(root).catch(() => undefined);
  }
});

async function nativeScreenPointForCanvas(session: RecoveryJourneySession): Promise<{ x: number; y: number }> {
  const canvas = session.page.getByTestId("document-canvas");
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("The exact Ether canvas has no browser bounding box for native drag/drop.");
  const metrics = await session.page.evaluate(() => ({
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    outerHeight: window.outerHeight,
    outerWidth: window.outerWidth,
    screenX: window.screenX,
    screenY: window.screenY
  }));
  const chromeX = Math.max(0, (metrics.outerWidth - metrics.innerWidth) / 2);
  const chromeY = Math.max(0, metrics.outerHeight - metrics.innerHeight);
  return {
    x: Math.round(metrics.screenX + chromeX + bounds.x + bounds.width / 2),
    y: Math.round(metrics.screenY + chromeY + bounds.y + bounds.height / 2)
  };
}

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

async function requestSecondInstance(executablePath: string, profile: RecoveryJourneySession["profile"], documentPath: string): Promise<string> {
  const requester = spawn(executablePath, [`--user-data-dir=${profile.userData}`, documentPath], {
    env: { ...process.env, APPDATA: profile.appData, LOCALAPPDATA: profile.localAppData },
    stdio: "pipe",
    windowsHide: true
  });
  const [exitCode, signal] = await Promise.race([
    once(requester, "exit") as Promise<[number | null, NodeJS.Signals | null]>,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Second-instance requester did not exit through the application lock.")), 15_000))
  ]);
  if (exitCode !== 0 || signal !== null) throw new Error(`Second-instance requester exited unexpectedly: code=${exitCode}; signal=${signal}.`);
  return `Exact requester ${requester.pid ?? "unknown"} exited after routing ${path.basename(documentPath)} to the existing primary window.`;
}

async function assertOneFileDocument(root: string, documentPath: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  expect(entries.filter((entry) => entry.name.endsWith(".ether"))).toHaveLength(1);
  expect(entries.some((entry) => entry.isDirectory() && entry.name === `${path.basename(documentPath, ".ether")}.ether`)).toBe(false);
  expect((await stat(documentPath)).size).toBeGreaterThan(0);
}

async function assertIsolatedLeasePlacement(
  profile: RecoveryJourneySession["profile"],
  documentRoot: string,
  sourcePath: string,
  destinationPath: string
): Promise<void> {
  const applicationRoot = path.join(profile.userData, "4.0");
  const leaseRoot = path.join(applicationRoot, "leases");
  const [documentEntries, leaseEntries] = await Promise.all([
    directoryEntries(documentRoot),
    directoryEntries(leaseRoot)
  ]);
  const leaseRecords = await Promise.all(leaseEntries
    .filter((entry) => entry.endsWith(".json"))
    .map(async (entry) => JSON.parse(await readFile(path.join(leaseRoot, entry), "utf8")) as {
      documentId?: unknown;
      pathHash?: unknown;
    }));
  const sourceDocumentId = inspectEtherDocument(sourcePath).document.documentId;
  const destinationDocumentId = inspectEtherDocument(destinationPath).document.documentId;
  expect(documentEntries.some((entry) => /lease|recovery|journal/iu.test(entry))).toBe(false);
  expect(leaseRecords).toHaveLength(1);
  expect(leaseRecords[0]).toMatchObject({ documentId: destinationDocumentId });
  expect(leaseRecords[0]?.pathHash).toMatch(/^[a-f0-9]{64}$/u);
  expect(leaseRecords.some((lease) => lease.documentId === sourceDocumentId)).toBe(false);
}

async function createActualTestOwnedDisposableRoots(profile: RecoveryJourneySession["profile"]): Promise<string[]> {
  const roots = [
    path.join(profile.userData, "Cache"),
    path.join(profile.userData, "4.0", "staging"),
    path.join(profile.userData, "4.0", "live-output")
  ];
  await Promise.all(roots.map(async (root) => {
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "a02-test-owned-sentinel.txt"), "test-owned disposable root\n", "utf8");
  }));
  return roots;
}

async function assertDocumentIdentity(documentPath: string): Promise<void> {
  const inspection = inspectEtherDocument(documentPath);
  expect(inspection.document.formatMarker).toBe("ETHERDOC");
  expect(inspection.document.formatVersion).toMatch(/^4\./u);
  expect(inspection.pragmas.applicationId).toBe(0x45544852);
  expect(inspection.pragmas.userVersion).toBeGreaterThan(0);
}

async function directoryEntries(root: string): Promise<string[]> {
  try { return (await readdir(root)).sort(); } catch { return []; }
}

async function isFile(candidate: string): Promise<boolean> {
  try { return (await stat(candidate)).isFile(); } catch { return false; }
}

async function exists(candidate: string): Promise<boolean> {
  try { await stat(candidate); return true; } catch { return false; }
}

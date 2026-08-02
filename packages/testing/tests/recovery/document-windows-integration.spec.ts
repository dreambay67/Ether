import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
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
  WINDOWS_INTEGRATION_MODE,
  assertExactPackagedEtherExecutable,
  assertExactPackagedProcess,
  assertExactWindowForegroundWithUia,
  applyReversibleAssociation,
  cleanupWindowsIntegrationRoot,
  completeNativeFileDialogWithUia,
  createAssociationDryRunPlan,
  createWindowsIntegrationRoot,
  findExactPackagedProcessId,
  invokeDocumentFromExplorerWithUia,
  minimizeExactWindowWithUia,
  removeTestOwnedDisposableRoots,
  restoreReversibleAssociation
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
    await assertIsolatedLeasePlacement(primary.profile, root, documentPath, renamedPath);
    primary.input.observe("Save As lease rebinding", "The source writer lease is released and the destination lease is active under isolated AppData, never beside the document.", "Enumerated the document directory and observed active lease root after the completed Save As; recovery remains unclaimed by this clean-save journey.");

    await primary.input.leftClick(primary.page.getByRole("button", { name: "Save a copy", exact: true }), "Save a Copy through the native Windows picker", "A complete Unicode/spaces copy is saved without switching the active Save As document.");
    await completeNativeFileDialogWithUia(primaryPid, copyPath);
    await expect.poll(() => isFile(copyPath)).toBe(true);
    await expect(primary.page.getByTestId("project-header")).toContainText(path.basename(renamedPath));
    await assertDocumentIdentity(copyPath);
    primary.input.observe("Save a Copy result", "Save a Copy creates a valid second .ether file while the active document remains the Save As destination.", `Validated ${path.basename(copyPath)} and retained ${path.basename(renamedPath)} as the active title.`);

    await primary.input.leftClick(primary.page.getByRole("button", { name: "Open", exact: true }), "File > Open through native picker", "The exact Ether-owned native Open dialog receives the saved source path through UI Automation.");
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
    const primaryPid = await findExactPackagedProcessId(executable, profile.userData);
    await expect(session.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await session.input.leftClick(session.page.getByRole("button", { name: "Prompt", exact: true }), "Create a test-owned association document", "A visible blank-UI node is saved before Explorer invokes the association.");
    await session.input.pressKey("Control+S", "Save association document through native picker", "The association target is a unique test-owned .ether document.");
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
    if (profile !== null) await cleanupIsolatedJourneyProfile(profile).catch(() => undefined);
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
  const destinationLease = path.join(leaseRoot, `${documentPathHash(destinationPath)}.json`);
  const sourceLease = path.join(leaseRoot, `${documentPathHash(sourcePath)}.json`);
  const [documentEntries, leaseText, sourceLeaseExists] = await Promise.all([
    directoryEntries(documentRoot),
    readFile(destinationLease, "utf8"),
    exists(sourceLease)
  ]);
  const lease = JSON.parse(leaseText) as { pathHash?: unknown };
  expect(documentEntries.some((entry) => /lease|recovery|journal/iu.test(entry))).toBe(false);
  expect(lease.pathHash).toBe(documentPathHash(destinationPath));
  expect(sourceLeaseExists).toBe(false);
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

function documentPathHash(filePath: string): string {
  const canonical = path.resolve(filePath).toLocaleLowerCase("en-US");
  return createHash("sha256").update(canonical).digest("hex");
}

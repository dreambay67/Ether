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
  createIsolatedJourneyProfile,
  launchRecoveryJourney,
  packagedJourneyConfig,
  recoveryShellTokenForProfile,
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
  assertWindowsShellStateRestored,
  cleanupWindowsIntegrationRoot,
  closeExactWindowWithNativeKeyboard,
  completeNativeFileDialogWithUia,
  createAssociationDryRunPlan,
  createWindowsIntegrationRoot,
  disarmAssociationRestorationWatchdog,
  dragDocumentFromExplorerWithNativePointer,
  findExactPackagedProcessId,
  invokeDocumentFromExplorerWithUia,
  invokeJumpListRecentDocumentWithUia,
  minimizeExactWindowWithUia,
  openExactWindowWithNativeKeyboard,
  readAndCloseExactOwnedNativeDialogWithUia,
  removeTestOwnedDisposableRoots,
  cleanupTestOwnedRecentShortcuts,
  compareWindowsShellState,
  recycleProvenRecoveryAutomaticDestination,
  formatWindowsShellStateChanges,
  recoveryShellIdentityArgument,
  recoveryShellTaskbarName,
  resnapshotWindowsShellState,
  restoreReversibleAssociation,
  startAssociationRestorationWatchdog,
  snapshotWindowsShellState,
  snapshotTestOwnedRecentShortcuts,
  triggerAssociationRestorationWatchdog,
  type AssociationRestorationWatchdog,
  type ReversibleAssociationPlan,
  type WindowsShellStateSnapshot
} from "../../recovery/windowsIntegration.js";
import { removeRecoveryShellAutomaticDestinations } from "../../recovery/windowsShellDestinations.js";

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
  const primaryProfile = await createIsolatedJourneyProfile();
  const shellBefore = await snapshotWindowsShellState(primaryProfile.appData);

  try {
    primary = await launch(executable, "a02-windows-primary", primaryProfile);
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
    const primaryClose = await closeExactWindowWithNativeKeyboard(primaryPid);
    primary.input.observe("Clean close after disposable-root cleanup", "A native Alt+F4 sent to the exact packaged Ether window closes the Saved document without an unsaved-changes prompt before reopen validation.", primaryClose);
    await expect.poll(() => primary?.page.isClosed() ?? false, { timeout: 15_000 }).toBe(true);
    await primary.close("passed");
    primary = null;

    await removeTestOwnedDisposableRoots(primaryProfile.root, disposableRoots);
    for (const disposableRoot of disposableRoots) await expect.poll(() => exists(disposableRoot)).toBe(false);

    reopened = await launch(executable, "a02-windows-reopen-after-cleanup", primaryProfile, documentPath);
    await expect(reopened.page.getByTestId("project-header")).toContainText(path.basename(documentPath), { timeout: 30_000 });
    await expect(reopened.page.locator(".react-flow__node")).toHaveCount(1);
    await assertDocumentIdentity(documentPath);
    reopened.input.observe("Test-owned cache/staging/live-output deletion", "Only actual named disposable roots under the isolated profile were removed; project data reopens and validates.", "Created and removed test-owned cache, staging, and live-output sentinels; reopened the UI-authored .ether and validated its graph/identity.");

    const associationPlan = await createAssociationDryRunPlan({ executablePath: executable, documentPath, root });
    reopened.input.observe("Association dry run", "The exact HKCU .ether key and original ProgID state are snapshotted before any future optional mutation.", `Dry-run plan uses unique ${associationPlan.testProgId}; this harness does not mutate the registry or invoke Explorer.`);
    const reopenedPid = await findExactPackagedProcessId(executable, reopened.profile.userData);
    const reopenedClose = await closeExactWindowWithNativeKeyboard(reopenedPid);
    reopened.input.observe("Clean close through keyboard", "A native Alt+F4 sent to the exact packaged Ether window closes the Saved document without an unsaved-changes prompt.", reopenedClose);
    await expect.poll(() => reopened?.page.isClosed() ?? false, { timeout: 15_000 }).toBe(true);
    await reopened.close("passed");
    reopened = null;
  } finally {
    if (reopened !== null) await reopened.close("failed");
    if (primary !== null) await primary.close("failed");
    try {
      await restoreShellJourneyState({ profile: primaryProfile, root, shellBefore, documentPaths: [documentPath, renamedPath, copyPath] });
    } finally {
      await cleanupIsolatedJourneyProfile(primaryProfile).catch(() => undefined);
      await cleanupWindowsIntegrationRoot(root).catch(() => undefined);
    }
  }
});

test("runs the separately approved reversible Explorer association route", async () => {
  test.skip(
    process.env[ASSOCIATION_APPROVAL] !== ASSOCIATION_APPROVAL_VALUE,
    `Main must explicitly authorize ${ASSOCIATION_APPROVAL}=${ASSOCIATION_APPROVAL_VALUE}.`
  );
  const executable = await assertExactPackagedEtherExecutable(packagedExecutable, workspaceRoot);
  const root = await createWindowsIntegrationRoot();
  const profile = await createIsolatedJourneyProfile();
  const shellToken = recoveryShellTokenForProfile(profile);
  const shellBefore = await snapshotWindowsShellState(profile.appData);
  const documentPath = path.join(root, `Association ${shellToken.slice(0, 8)} \u017dlt\u00fd.ether`);
  let session: RecoveryJourneySession | null = null;
  let primaryPid: number | null = null;
  let plan: ReversibleAssociationPlan | null = null;
  let watchdog: AssociationRestorationWatchdog | null = null;
  let associationMayBeMutated = false;
  try {
    session = await launch(executable, "a02-windows-association", profile);
    await snapshotTestOwnedRecentShortcuts({ appData: profile.appData, root, documentPaths: [documentPath] });
    primaryPid = await findExactPackagedProcessId(executable, profile.userData);
    await expect(session.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await session.input.leftClick(session.page.getByRole("button", { name: "Prompt", exact: true }), "Create a test-owned association document", "A visible blank-UI node is saved before Explorer invokes the association.");
    await session.input.pressKey("Control+s", "Save association document through native picker", "The association target is a unique test-owned .ether document.");
    await completeNativeFileDialogWithUia(primaryPid, documentPath);
    await expect.poll(() => isFile(documentPath)).toBe(true);
    plan = await createAssociationDryRunPlan({ executablePath: executable, documentPath, root, recoveryShellToken: shellToken, userData: profile.userData });
    watchdog = await startAssociationRestorationWatchdog(plan);
    try {
      associationMayBeMutated = true;
      await applyReversibleAssociation(plan);
      await minimizeExactWindowWithUia(primaryPid);
      const activation = await invokeDocumentFromExplorerWithUia(documentPath);
      await expect(session.page.getByTestId("project-header")).toContainText(path.basename(documentPath), { timeout: 30_000 });
      await expect.poll(() => session?.page.evaluate(() => document.hasFocus()) ?? false).toBe(true);
      await assertExactPackagedProcess(executable, primaryPid);
      await assertExactWindowForegroundWithUia(primaryPid);
      session.input.observe("Explorer UIA association", "Explorer resolves the uniquely named test folder/item, invokes it through UI Automation, and focuses the exact packaged primary document.", activation);
    } finally {
      const restorePlan = plan;
      const restoreWatchdog = watchdog;
      await restoreAssociationWithWatchdog(restorePlan, restoreWatchdog);
      plan = null;
      watchdog = null;
      associationMayBeMutated = false;
    }
    const closeAction = await closeExactWindowWithNativeKeyboard(primaryPid);
    session.input.observe("Close isolated association journey", "A native Alt+F4 closes only the exact recovery-AUMID Ether window before shell-state verification.", closeAction);
    await expect.poll(() => session?.page.isClosed() ?? false, { timeout: 15_000 }).toBe(true);
    await session.close("passed");
    session = null;
  } finally {
    if (associationMayBeMutated && plan !== null && watchdog !== null) {
      const restorePlan = plan;
      const restoreWatchdog = watchdog;
      await restoreAssociationWithWatchdog(restorePlan, restoreWatchdog);
    } else if (watchdog !== null) {
      await disarmAssociationRestorationWatchdog(watchdog);
    }
    if (session !== null && primaryPid !== null) await closeExactWindowWithNativeKeyboard(primaryPid).catch(() => undefined);
    if (session !== null) await session.close("failed");
    try {
      await restoreShellJourneyState({ profile, root, shellBefore, documentPaths: [documentPath] });
    } finally {
      await cleanupIsolatedJourneyProfile(profile).catch(() => undefined);
      await cleanupWindowsIntegrationRoot(root).catch(() => undefined);
    }
  }
});

test("runs the separately approved Explorer pointer drag/drop route", async () => {
  test.skip(
    process.env[SHELL_UI_APPROVAL] !== SHELL_UI_APPROVAL_VALUE,
    `Main must explicitly authorize ${SHELL_UI_APPROVAL}=${SHELL_UI_APPROVAL_VALUE}.`
  );
  const executable = await assertExactPackagedEtherExecutable(packagedExecutable, workspaceRoot);
  const root = await createWindowsIntegrationRoot();
  const profile = await createIsolatedJourneyProfile();
  const shellToken = recoveryShellTokenForProfile(profile);
  const shellBefore = await snapshotWindowsShellState(profile.appData);
  const sourcePath = path.join(root, `Explorer drag source ${shellToken.slice(0, 8)} \u017dlt\u00fd.ether`);
  const targetPath = path.join(root, `Explorer drag target ${shellToken.slice(0, 8)} \u017dlt\u00fd.ether`);
  let session: RecoveryJourneySession | null = null;
  let primaryPid: number | null = null;
  try {
    session = await launch(executable, "a02-windows-explorer-drag", profile);
    await snapshotTestOwnedRecentShortcuts({ appData: profile.appData, root, documentPaths: [sourcePath, targetPath] });
    primaryPid = await findExactPackagedProcessId(executable, profile.userData);
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
    const closeAction = await closeExactWindowWithNativeKeyboard(primaryPid);
    session.input.observe("Close isolated drag journey", "A native Alt+F4 closes only the exact recovery-AUMID Ether window before shell-state verification.", closeAction);
    await expect.poll(() => session?.page.isClosed() ?? false, { timeout: 15_000 }).toBe(true);
    await session.close("passed");
    session = null;
  } finally {
    if (session !== null && primaryPid !== null) await closeExactWindowWithNativeKeyboard(primaryPid).catch(() => undefined);
    if (session !== null) await session.close("failed");
    try {
      await restoreShellJourneyState({ profile, root, shellBefore, documentPaths: [sourcePath, targetPath] });
    } finally {
      await cleanupIsolatedJourneyProfile(profile).catch(() => undefined);
      await cleanupWindowsIntegrationRoot(root).catch(() => undefined);
    }
  }
});

test("runs the separately approved Windows Jump List known-and-missing target route", async () => {
  test.skip(
    process.env[SHELL_UI_APPROVAL] !== SHELL_UI_APPROVAL_VALUE || process.env[ASSOCIATION_APPROVAL] !== ASSOCIATION_APPROVAL_VALUE,
    `Main must explicitly authorize both ${SHELL_UI_APPROVAL}=${SHELL_UI_APPROVAL_VALUE} and ${ASSOCIATION_APPROVAL}=${ASSOCIATION_APPROVAL_VALUE}.`
  );
  const executable = await assertExactPackagedEtherExecutable(packagedExecutable, workspaceRoot);
  const root = await createWindowsIntegrationRoot();
  const profile = await createIsolatedJourneyProfile();
  const shellToken = recoveryShellTokenForProfile(profile);
  const taskbarName = recoveryShellTaskbarName(shellToken);
  const shellBefore = await snapshotWindowsShellState(profile.appData);
  const documentPath = path.join(root, `Jump List ${shellToken.slice(0, 8)} \u017dlt\u00fd.ether`);
  let session: RecoveryJourneySession | null = null;
  let primaryPid: number | null = null;
  let plan: ReversibleAssociationPlan | null = null;
  let watchdog: AssociationRestorationWatchdog | null = null;
  let associationMayBeMutated = false;
  let jumpListShellStateRestored = false;
  let recentModeLaunched = false;
  let jumpListFailure: unknown = null;
  const finalizationFailures: unknown[] = [];
  try {
    recentModeLaunched = true;
    session = await launch(executable, "a02-windows-jump-list", profile, undefined, true);
    await snapshotTestOwnedRecentShortcuts({ appData: profile.appData, root, documentPaths: [documentPath] });
    primaryPid = await findExactPackagedProcessId(executable, profile.userData);
    await session.input.leftClick(session.page.getByRole("button", { name: "Prompt", exact: true }), "Create unique Jump List document", "Saving it lets Ether register the unique target with app.addRecentDocument and its recent Jump List category.");
    await session.input.pressKey("Control+s", "Save unique Jump List target", "The native picker saves the exact test-owned recent document.");
    await completeNativeFileDialogWithUia(primaryPid, documentPath);
    await expect.poll(() => isFile(documentPath)).toBe(true);
    await session.page.waitForTimeout(1_000);
    plan = await createAssociationDryRunPlan({ executablePath: executable, documentPath, root, recoveryShellToken: shellToken, userData: profile.userData });
    watchdog = await startAssociationRestorationWatchdog(plan);
    try {
      associationMayBeMutated = true;
      await applyReversibleAssociation(plan);
      await minimizeExactWindowWithUia(primaryPid);
      const knownTarget = await invokeJumpListRecentDocumentWithUia({ documentPath, etherPid: primaryPid, taskbarAppName: taskbarName });
      await expect(session.page.getByTestId("project-header")).toContainText(path.basename(documentPath), { timeout: 30_000 });
      await expect.poll(() => session?.page.evaluate(() => document.hasFocus()) ?? false).toBe(true);
      await assertExactPackagedProcess(executable, primaryPid);
      await assertExactWindowForegroundWithUia(primaryPid);
      session.input.observe("Jump List known target", "The exact unique Windows shell recent item routes through the verified temporary handler to the existing recovery-AUMID Fixer document.", knownTarget);

      await session.input.leftClick(session.page.getByRole("button", { name: "New", exact: true }), "Switch to a new document before missing-target check", "The Jump List document is no longer open when its test-owned source file is deleted.");
      await expect(session.page.getByTestId("project-header")).not.toContainText(path.basename(documentPath));
      await rm(documentPath, { force: true });
      await expect.poll(() => isFile(documentPath)).toBe(false);
      const missingTarget = await invokeJumpListRecentDocumentWithUia({ documentPath, etherPid: primaryPid, taskbarAppName: taskbarName });
      const nativeError = await readAndCloseExactOwnedNativeDialogWithUia(primaryPid);
      expect(nativeError).toContain(path.basename(documentPath));
      session.input.observe("Jump List missing target", "The exact unique recent item reports an Ether-owned native error naming the deleted test document.", `${missingTarget}; ${nativeError}`);
    } finally {
      const restorePlan = plan;
      const restoreWatchdog = watchdog;
      await restoreAssociationWithWatchdog(restorePlan, restoreWatchdog);
      plan = null;
      watchdog = null;
      associationMayBeMutated = false;
    }
    const closeAction = await closeExactWindowWithNativeKeyboard(primaryPid);
    session.input.observe("Close isolated Jump List journey", "A native Alt+F4 closes only the exact recovery-AUMID Ether window before shell-state verification.", closeAction);
    await expect.poll(() => session?.page.isClosed() ?? false, { timeout: 15_000 }).toBe(true);
    await session.close("passed", {
      afterApplicationExit: async () => {
        const shellDisposition = await restoreApprovedJumpListShellState({
          before: shellBefore,
          documentPaths: [documentPath],
          profile,
          root,
          token: shellToken
        });
        session?.input.observe("Jump List app-scoped cleanup", "Only the exact 2560-byte recovery-AUMID AutomaticDestinations artifact is recycled after COM cleanup, then the complete real and isolated shell state matches baseline.", shellDisposition);
        jumpListShellStateRestored = true;
      }
    });
    session = null;
  } catch (error) {
    jumpListFailure = error;
  } finally {
    try {
      if (associationMayBeMutated && plan !== null && watchdog !== null) {
        const restorePlan = plan;
        const restoreWatchdog = watchdog;
        await restoreAssociationWithWatchdog(restorePlan, restoreWatchdog);
      } else if (watchdog !== null) {
        await disarmAssociationRestorationWatchdog(watchdog);
      }
    } catch (error) {
      finalizationFailures.push(error);
    }
    if (session !== null && primaryPid !== null) await closeExactWindowWithNativeKeyboard(primaryPid).catch(() => undefined);
    if (session !== null) {
      try {
        await session.close("failed", recentModeLaunched && !jumpListShellStateRestored ? {
          afterApplicationExit: async () => {
            await restoreApprovedJumpListShellState({ before: shellBefore, documentPaths: [documentPath], profile, root, token: shellToken });
            jumpListShellStateRestored = true;
          }
        } : {});
        session = null;
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    try {
      if (!jumpListShellStateRestored && !recentModeLaunched) {
        await restoreShellJourneyState({ profile, root, shellBefore, documentPaths: [documentPath] });
      }
    } catch (error) {
      finalizationFailures.push(error);
    } finally {
      await cleanupIsolatedJourneyProfile(profile).catch(() => undefined);
      await cleanupWindowsIntegrationRoot(root).catch(() => undefined);
    }
  }
  if (jumpListFailure !== null) {
    if (finalizationFailures.length > 0) {
      throw new AggregateError([jumpListFailure, ...finalizationFailures], "Jump List route and its exact shell cleanup both failed.", { cause: finalizationFailures.at(-1) });
    }
    throw jumpListFailure;
  }
  if (finalizationFailures.length > 0) {
    throw new AggregateError(finalizationFailures, "Jump List finalization failed.", { cause: finalizationFailures.at(-1) });
  }
});

async function restoreAssociationWithWatchdog(
  plan: ReversibleAssociationPlan | null,
  watchdog: AssociationRestorationWatchdog | null
): Promise<void> {
  if (plan === null || watchdog === null) throw new Error("Association restoration guard was not fully initialized.");
  try {
    await restoreReversibleAssociation(plan);
  } catch (primaryError) {
    try {
      await triggerAssociationRestorationWatchdog(watchdog);
      await restoreReversibleAssociation(plan);
    } catch (watchdogError) {
      throw new AggregateError([primaryError, watchdogError], "Both primary and watchdog association restoration failed.", { cause: watchdogError });
    }
    throw primaryError;
  }
  await disarmAssociationRestorationWatchdog(watchdog);
}

async function restoreShellJourneyState(input: {
  documentPaths: readonly string[];
  profile: RecoveryJourneySession["profile"];
  root: string;
  shellBefore: WindowsShellStateSnapshot;
}): Promise<void> {
  const failures: unknown[] = [];
  try {
    await cleanupTestOwnedRecentShortcuts({
      appData: input.profile.appData,
      ...(process.env.APPDATA === undefined ? {} : { additionalAppData: [process.env.APPDATA] }),
      root: input.root,
      documentPaths: input.documentPaths
    });
  } catch (error) {
    failures.push(error);
  }
  try {
    await assertWindowsShellStateRestored(input.shellBefore);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw new AggregateError(failures, "The isolated Windows shell state did not restore completely.");
}

/**
 * The sole COM cleanup route is deliberately local to the separately approved
 * Jump List journey. It proves that every affected real/isolated Recent file
 * is one new recovery-AUMID AutomaticDestinations artifact before deleting it.
 */
async function restoreApprovedJumpListShellState(input: {
  before: WindowsShellStateSnapshot;
  documentPaths: readonly string[];
  profile: RecoveryJourneySession["profile"];
  root: string;
  token: string;
}): Promise<string> {
  const realAppData = process.env.APPDATA;
  if (realAppData === undefined) throw new Error("Jump List cleanup requires the real APPDATA snapshot root.");
  await cleanupTestOwnedRecentShortcuts({
    appData: input.profile.appData,
    additionalAppData: [realAppData],
    root: input.root,
    documentPaths: input.documentPaths
  });
  const preCleanup = await resnapshotWindowsShellState(input.before);
  const createdByJourney = compareWindowsShellState(input.before, preCleanup);
  const candidate = requireSingleRecoveryAutomaticDestination(createdByJourney, path.resolve(realAppData), "practical Jump List route");

  await removeRecoveryShellAutomaticDestinations(input.token);

  const postCleanup = await resnapshotWindowsShellState(input.before);
  const cleanupChanges = compareWindowsShellState(preCleanup, postCleanup);
  const cleanupCandidate = requireSingleRecoveryAutomaticDestination(cleanupChanges, path.resolve(realAppData), "app-scoped COM cleanup", candidate.relativePath, false);
  const postFile = postCleanup.roots
    .find((root) => root.appData === path.resolve(realAppData))?.files
    .find((file) => file.path === candidate.relativePath);
  if (postFile === undefined || postFile.size !== 2560) {
    throw new Error(`Jump List cleanup did not leave the expected empty/test-created artifact: ${candidate.relativePath}.`);
  }
  if (cleanupCandidate.relativePath !== candidate.relativePath) {
    throw new Error("Jump List cleanup changed a different AutomaticDestinations artifact than the practical route.");
  }

  const disposition = await recycleProvenRecoveryAutomaticDestination({ appData: realAppData, file: postFile });
  await assertWindowsShellStateRestored(input.before);
  return disposition;
}

function requireSingleRecoveryAutomaticDestination(
  changes: ReturnType<typeof compareWindowsShellState>,
  realAppData: string,
  stage: string,
  expectedPath?: string,
  requireNewFile = true
): { relativePath: string } {
  if (changes.length !== 1) {
    throw new Error(`${stage} changed an ambiguous Windows shell state: ${formatWindowsShellStateChanges(changes) || "(none)"}.`);
  }
  const [change] = changes;
  const relativePath = change?.after?.path ?? change?.before?.path;
  if (
    change === undefined || change.appData !== realAppData || (requireNewFile && change.before !== null) || change.after === null ||
    !/^AutomaticDestinations[\\/][a-f0-9]+\.automaticDestinations-ms$/iu.test(relativePath ?? "") ||
    (expectedPath !== undefined && relativePath !== expectedPath)
  ) {
    throw new Error(`${stage} did not produce one new exact recovery AutomaticDestinations artifact: ${formatWindowsShellStateChanges(changes)}.`);
  }
  return { relativePath: change.after.path };
}

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

async function launch(
  executablePath: string,
  journeyId: string,
  profile?: RecoveryJourneySession["profile"],
  openPath?: string,
  recoveryShellRecent = false
): Promise<RecoveryJourneySession> {
  return launchRecoveryJourney({
    ...packagedJourneyConfig(workspaceRoot, journeyId),
    executablePath,
    declaration: blankAuthoringJourney(journeyId),
    evidenceMode: "committed",
    committedEvidencePath: ["phase-0", "document-windows-integration", journeyId],
    ...(profile === undefined ? { cleanupProfile: false } : { profile, cleanupProfile: false }),
    ...(recoveryShellRecent ? { recoveryShellRecent: true } : {}),
    packagedArgs: () => openPath === undefined ? [] : [openPath]
  });
}

async function requestSecondInstance(executablePath: string, profile: RecoveryJourneySession["profile"], documentPath: string): Promise<string> {
  const requester = spawn(executablePath, [
    `--user-data-dir=${profile.userData}`,
    recoveryShellIdentityArgument(recoveryShellTokenForProfile(profile)),
    documentPath
  ], {
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

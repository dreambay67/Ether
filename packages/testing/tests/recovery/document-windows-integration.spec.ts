import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectEtherDocument } from "@ether/document";
import { expect, test } from "@playwright/test";

import {
  assertAuthoringJourneySourceSafety,
  assertExactPackagedBuildIdentity,
  blankAuthoringJourney,
  cleanupIsolatedJourneyProfile,
  collectJourneyBuildIdentity,
  createIsolatedJourneyProfile,
  journeyEvidencePaths,
  launchRecoveryJourney,
  packagedJourneyConfig,
  recoveryShellTokenForProfile,
  type JourneyBuildIdentity,
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
  associationArtifactsMayBeCleaned,
  assertWindowsShellCheckpointStable,
  assertWindowsShellClassificationClean,
  classifyJumpListComProgress,
  classifyJumpListRecycleProgress,
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
  classifyWindowsShellStateChanges,
  describeWindowsShellSetupDelta,
  recycleProvenRecoveryAutomaticDestination,
  formatWindowsShellStateChanges,
  requireNoTestOwnedRecentShortcuts,
  recoveryShellIdentityArgument,
  recoveryShellTaskbarName,
  recoveryArtifactsMayBeCleanedAfterShellCheckpoint,
  resnapshotWindowsShellState,
  restoreReversibleAssociation,
  startAssociationRestorationWatchdog,
  snapshotWindowsShellState,
  snapshotTestOwnedRecentShortcuts,
  triggerAssociationRestorationWatchdog,
  type AssociationRestorationWatchdog,
  type ReversibleAssociationPlan,
  type WindowsShellStateChange,
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
  let shellFinalizationSidecar = await createShellFinalizationSidecar("a02-windows-primary", "primary");
  const shellS0 = await snapshotWindowsShellState(primaryProfile.appData);
  let shellS1: WindowsShellStateSnapshot | null = null;
  let shellS1TargetShortcuts: string[] | null = null;
  let postS1ShellClassified = false;
  let postS1ExactProcessAbsenceProven = false;
  let exactProcessAbsenceProven = false;
  let primaryJourneyFailure: unknown = null;
  let journeyFailedAfterCheckpoint = false;
  const finalizationFailures: unknown[] = [];

  try {
    exactProcessAbsenceProven = false;
    primary = await launch(executable, "a02-windows-primary", primaryProfile, undefined, false, {
      afterLaunchFailureApplicationExit: async () => {
        exactProcessAbsenceProven = true;
        await recordShellFinalizationBlocked({ action: "primary launch failure without S1", exactProcessAbsenceProven, reason: "S1 prerequisites were unavailable; sanitation was not attempted.", sidecar: shellFinalizationSidecar });
      }
    });
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
    primary.input.observe("Recent shortcut snapshot", "The pre-setup isolated-profile Recent links are diagnostic only; S1 becomes the first restoration checkpoint after native setup.", `Found ${recentBefore.length} pre-existing matching isolated-profile Recent shortcuts.`);

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
    shellS1 = await resnapshotWindowsShellState(shellS0);
    primary.input.observe("Capture S1 after native primary setup", "S0 is diagnostic; every S0→S1 shell delta from native Save, Save As, Copy, and Open is recorded as OS-native setup and is not restored.", describeWindowsShellSetupDelta(shellS0, shellS1));
    await assertShellCheckpointRestored(shellS1);
    shellS1TargetShortcuts = await snapshotS1TargetShortcuts({ documentPaths: [documentPath, renamedPath, copyPath], profile: primaryProfile, root });
    primary.input.observe("S1 exact target-link checkpoint", "Both real and isolated S1 Recent roots contain zero links resolving to the exact random test documents.", "S1 matching target links=0.");
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
    await primary.close("passed", {
      afterApplicationExit: () => { exactProcessAbsenceProven = true; }
    });
    primary = null;
    postS1ExactProcessAbsenceProven = true;

    await removeTestOwnedDisposableRoots(primaryProfile.root, disposableRoots);
    for (const disposableRoot of disposableRoots) await expect.poll(() => exists(disposableRoot)).toBe(false);

    postS1ExactProcessAbsenceProven = false;
    exactProcessAbsenceProven = false;
    shellFinalizationSidecar = await createShellFinalizationSidecar("a02-windows-reopen-after-cleanup", "primary-reopen");
    reopened = await launch(executable, "a02-windows-reopen-after-cleanup", primaryProfile, documentPath, false, {
      afterLaunchFailureApplicationExit: async () => {
        postS1ExactProcessAbsenceProven = true;
        exactProcessAbsenceProven = true;
        if (shellS1 === null || shellS1TargetShortcuts === null) {
          await recordShellFinalizationBlocked({ action: "reopen launch failure without S1", exactProcessAbsenceProven, reason: "S1 prerequisites were unavailable; sanitation was not attempted.", sidecar: shellFinalizationSidecar });
          return;
        }
        await recordShellFinalizationAttempt({ action: "reopen launch failure sanitation", exactProcessAbsenceProven, sidecar: shellFinalizationSidecar, sanitize: () => classifyShellAfterExactExit({
          documentPaths: [documentPath, renamedPath, copyPath], profile: primaryProfile, root, s0: shellS0, s1: shellS1!, s1TargetShortcuts: shellS1TargetShortcuts!
        }) });
        postS1ShellClassified = true;
      }
    });
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
    if (shellS1 === null || shellS1TargetShortcuts === null) throw new Error("S1 exact target-link checkpoint was not captured before primary final close.");
    const primaryShellS1 = shellS1;
    const primaryS1TargetShortcuts = shellS1TargetShortcuts;
    await reopened.close("passed", {
      afterApplicationExit: async () => {
        postS1ExactProcessAbsenceProven = true;
        exactProcessAbsenceProven = true;
        const disposition = await recordShellFinalizationAttempt({ action: "reopen close sanitation", exactProcessAbsenceProven, sidecar: shellFinalizationSidecar, sanitize: () => classifyShellAfterExactExit({
          documentPaths: [documentPath, renamedPath, copyPath], profile: primaryProfile, root, s0: shellS0, s1: primaryShellS1, s1TargetShortcuts: primaryS1TargetShortcuts
        }) });
        reopened?.input.observe("Post-S1 primary shell classification", "After exact process absence, only exact post-S1 target links are removed; no new files or non-opaque changes are allowed.", disposition);
        postS1ShellClassified = true;
      }
    });
    reopened = null;
  } catch (error) {
    primaryJourneyFailure = error;
    journeyFailedAfterCheckpoint = shellS1 !== null;
  } finally {
    if (reopened !== null) {
      try {
        await reopened.close("failed", {
          afterApplicationExit: async () => {
            postS1ExactProcessAbsenceProven = true;
            exactProcessAbsenceProven = true;
            if (shellS1 !== null && shellS1TargetShortcuts !== null) {
              const disposition = await recordShellFinalizationAttempt({ action: "failed reopen close sanitation", exactProcessAbsenceProven, sidecar: shellFinalizationSidecar, sanitize: () => classifyShellAfterExactExit({ documentPaths: [documentPath, renamedPath, copyPath], profile: primaryProfile, root, s0: shellS0, s1: shellS1!, s1TargetShortcuts: shellS1TargetShortcuts! }) });
              reopened?.input.observe("Post-S1 primary shell classification", "After exact process absence, only exact post-S1 target links are removed; no new files or non-opaque changes are allowed.", disposition);
              postS1ShellClassified = true;
            }
          }
        });
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    if (primary !== null) {
      try {
        await primary.close("failed", {
          afterApplicationExit: async () => {
            postS1ExactProcessAbsenceProven = true;
            exactProcessAbsenceProven = true;
            if (shellS1 !== null && shellS1TargetShortcuts !== null) {
              const disposition = await recordShellFinalizationAttempt({ action: "failed primary close sanitation", exactProcessAbsenceProven, sidecar: shellFinalizationSidecar, sanitize: () => classifyShellAfterExactExit({ documentPaths: [documentPath, renamedPath, copyPath], profile: primaryProfile, root, s0: shellS0, s1: shellS1!, s1TargetShortcuts: shellS1TargetShortcuts! }) });
              primary?.input.observe("Post-S1 primary shell classification", "After exact process absence, only exact post-S1 target links are removed; no new files or non-opaque changes are allowed.", disposition);
              postS1ShellClassified = true;
            }
          }
        });
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    if (reopened === null && primary === null && !postS1ShellClassified && shellS1 !== null && shellS1TargetShortcuts !== null && postS1ExactProcessAbsenceProven) {
      try {
        await recordShellFinalizationAttempt({ action: "no-session primary sanitation retry", exactProcessAbsenceProven, sidecar: shellFinalizationSidecar, sanitize: () => classifyShellAfterExactExit({ documentPaths: [documentPath, renamedPath, copyPath], profile: primaryProfile, root, s0: shellS0, s1: shellS1!, s1TargetShortcuts: shellS1TargetShortcuts! }) });
        postS1ShellClassified = true;
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    if (reopened === null && primary === null && !postS1ShellClassified && shellS1 !== null && shellS1TargetShortcuts !== null && !postS1ExactProcessAbsenceProven) {
      try {
        await recordShellFinalizationBlocked({ action: "no-session primary sanitation blocked", exactProcessAbsenceProven, reason: "Exact process absence was not proven; sanitation was not attempted.", sidecar: shellFinalizationSidecar });
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    if (primaryJourneyFailure !== null && shellFinalizationSidecar.attempts.length === 0) {
      try {
        await recordShellFinalizationBlockedOnce({ action: "primary no-session finalization blocked", exactProcessAbsenceProven, reason: exactProcessAbsenceProven ? "S1 prerequisites were unavailable; sanitation was not attempted." : "Exact process absence was not proven; sanitation was not attempted.", sidecar: shellFinalizationSidecar });
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    try {
      await ensureShellFinalizationSidecarDurable(shellFinalizationSidecar);
    } catch (error) {
      finalizationFailures.push(error);
    }
    const shellS1Restored = shellS1 === null || postS1ShellClassified;
    if (recoveryArtifactsMayBeCleanedAfterShellCheckpoint({
      checkpointCaptured: shellS1 !== null,
      exactProcessAbsenceProven,
      finalizationFailuresAbsent: finalizationFailures.length === 0,
      journeyFailedAfterCheckpoint,
      sidecarDurabilityProven: shellFinalizationSidecar.durabilityProven && !shellFinalizationSidecar.durabilityFailureObserved,
      shellCheckpointRestored: shellS1Restored
    })) {
      try {
        await cleanupIsolatedJourneyProfile(primaryProfile);
        await cleanupWindowsIntegrationRoot(root);
      } catch (error) {
        finalizationFailures.push(error);
      }
    } else {
      const reason = !exactProcessAbsenceProven
        ? "unproven exact process absence"
        : finalizationFailures.length > 0
          ? "failed finalization"
        : journeyFailedAfterCheckpoint
          ? "post-S1 journey assertion/action failure"
          : "unproven post-S1 shell cleanup";
      finalizationFailures.push(new Error(`Preserved primary recovery artifacts after ${reason}: root=${root}; profile=${primaryProfile.root}.`));
    }
  }
  if (primaryJourneyFailure !== null) {
    if (finalizationFailures.length > 0) {
      throw new AggregateError([primaryJourneyFailure, ...finalizationFailures], "A02 primary journey and safe finalization failed.", { cause: finalizationFailures.at(-1) });
    }
    throw primaryJourneyFailure;
  }
  if (finalizationFailures.length > 0) {
    throw new AggregateError(finalizationFailures, "A02 primary finalization did not prove safe cleanup.", { cause: finalizationFailures.at(-1) });
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
  const shellS0 = await snapshotWindowsShellState(profile.appData);
  const documentPath = path.join(root, `Association ${shellToken.slice(0, 8)} \u017dlt\u00fd.ether`);
  let session: RecoveryJourneySession | null = null;
  let primaryPid: number | null = null;
  let plan: ReversibleAssociationPlan | null = null;
  let watchdog: AssociationRestorationWatchdog | null = null;
  let associationMayBeMutated = false;
  let associationRestorationProven = false;
  let shellStateRestored = false;
  let shellS1: WindowsShellStateSnapshot | null = null;
  let shellS1TargetShortcuts: string[] | null = null;
  let postS1ShellClassified = false;
  let associationJourneyFailure: unknown = null;
  let journeyFailedAfterCheckpoint = false;
  let exactProcessAbsenceProven = false;
  const shellFinalizationSidecar = await createShellFinalizationSidecar("a02-windows-association", "association");
  const finalizationFailures: unknown[] = [];
  try {
    exactProcessAbsenceProven = false;
    session = await launch(executable, "a02-windows-association", profile, undefined, false, {
      afterLaunchFailureApplicationExit: async () => {
        exactProcessAbsenceProven = true;
        await recordShellFinalizationBlocked({ action: "association launch failure without S1", exactProcessAbsenceProven, reason: "S1 prerequisites were unavailable; sanitation was not attempted.", sidecar: shellFinalizationSidecar });
      }
    });
    await snapshotTestOwnedRecentShortcuts({ appData: profile.appData, root, documentPaths: [documentPath] });
    primaryPid = await findExactPackagedProcessId(executable, profile.userData);
    await expect(session.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await session.input.leftClick(session.page.getByRole("button", { name: "Prompt", exact: true }), "Create a test-owned association document", "A visible blank-UI node is saved before Explorer invokes the association.");
    await session.input.pressKey("Control+s", "Save association document through native picker", "The association target is a unique test-owned .ether document.");
    await completeNativeFileDialogWithUia(primaryPid, documentPath);
    await expect.poll(() => isFile(documentPath)).toBe(true);
    shellS1 = await resnapshotWindowsShellState(shellS0);
    session.input.observe("Capture S1 after native association setup", "S0 is diagnostic; every S0→S1 shell delta is recorded as OS-native setup and is not restored.", describeWindowsShellSetupDelta(shellS0, shellS1));
    await assertShellCheckpointRestored(shellS1);
    shellS1TargetShortcuts = await snapshotS1TargetShortcuts({ documentPaths: [documentPath], profile, root });
    session.input.observe("S1 exact target-link checkpoint", "Both real and isolated S1 Recent roots contain zero links resolving to the exact association document.", "S1 matching target links=0.");
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
      associationRestorationProven = true;
      plan = null;
      watchdog = null;
      associationMayBeMutated = false;
    }
    const closeAction = await closeExactWindowWithNativeKeyboard(primaryPid);
    session.input.observe("Close isolated association journey", "A native Alt+F4 closes only the exact recovery-AUMID Ether window before shell-state verification.", closeAction);
    await expect.poll(() => session?.page.isClosed() ?? false, { timeout: 15_000 }).toBe(true);
    if (shellS1 === null || shellS1TargetShortcuts === null) throw new Error("S1 exact target-link checkpoint was not captured before association final close.");
    const associationShellS1 = shellS1;
    const associationS1TargetShortcuts = shellS1TargetShortcuts;
    await session.close("passed", {
      afterApplicationExit: async () => {
        exactProcessAbsenceProven = true;
        const disposition = await recordShellFinalizationAttempt({ action: "association close sanitation", exactProcessAbsenceProven, sidecar: shellFinalizationSidecar, sanitize: () => classifyShellAfterExactExit({ documentPaths: [documentPath], profile, root, s0: shellS0, s1: associationShellS1, s1TargetShortcuts: associationS1TargetShortcuts }) });
        session?.input.observe("Post-S1 association shell classification", "After exact process absence, only exact post-S1 target links are removed; no new files or non-opaque changes are allowed.", disposition);
        postS1ShellClassified = true;
      }
    });
    session = null;
  } catch (error) {
    associationJourneyFailure = error;
    journeyFailedAfterCheckpoint = shellS1 !== null;
  } finally {
    try {
      if (associationMayBeMutated && plan !== null && watchdog !== null) {
        const restorePlan = plan;
        const restoreWatchdog = watchdog;
        await restoreAssociationWithWatchdog(restorePlan, restoreWatchdog);
        associationRestorationProven = true;
      } else if (watchdog !== null) {
        await disarmAssociationRestorationWatchdog(watchdog);
        associationRestorationProven = true;
      } else if (associationArtifactsMayBeCleaned({ mutationAttempted: associationMayBeMutated, restorationProven: false, watchdogActive: false })) {
        associationRestorationProven = true;
      }
    } catch (error) { finalizationFailures.push(error); }
    if (session !== null && primaryPid !== null) {
      try {
        await closeExactWindowWithNativeKeyboard(primaryPid);
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    if (session !== null) await session.close("failed", {
      afterApplicationExit: async () => {
        exactProcessAbsenceProven = true;
        if (shellS1 !== null && shellS1TargetShortcuts !== null) {
          const disposition = await recordShellFinalizationAttempt({ action: "failed association close sanitation", exactProcessAbsenceProven, sidecar: shellFinalizationSidecar, sanitize: () => classifyShellAfterExactExit({ documentPaths: [documentPath], profile, root, s0: shellS0, s1: shellS1!, s1TargetShortcuts: shellS1TargetShortcuts! }) });
          session?.input.observe("Post-S1 association shell classification", "After exact process absence, only exact post-S1 target links are removed; no new files or non-opaque changes are allowed.", disposition);
          postS1ShellClassified = true;
        }
      }
    }).catch((error) => finalizationFailures.push(error));
    if (associationJourneyFailure !== null && shellFinalizationSidecar.attempts.length === 0) {
      try {
        await recordShellFinalizationBlockedOnce({ action: "association finalization blocked", exactProcessAbsenceProven, reason: exactProcessAbsenceProven ? "S1 prerequisites were unavailable; sanitation was not attempted." : "Exact process absence was not proven; sanitation was not attempted.", sidecar: shellFinalizationSidecar });
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    if (shellS1 === null) {
      finalizationFailures.push(new Error("S1 shell checkpoint was not captured before association mutation."));
    } else shellStateRestored = postS1ShellClassified;
    try {
      await ensureShellFinalizationSidecarDurable(shellFinalizationSidecar);
    } catch (error) {
      finalizationFailures.push(error);
    }
    if (associationRestorationProven && recoveryArtifactsMayBeCleanedAfterShellCheckpoint({
      checkpointCaptured: shellS1 !== null,
      exactProcessAbsenceProven,
      finalizationFailuresAbsent: finalizationFailures.length === 0,
      journeyFailedAfterCheckpoint,
      sidecarDurabilityProven: shellFinalizationSidecar.durabilityProven && !shellFinalizationSidecar.durabilityFailureObserved,
      shellCheckpointRestored: shellStateRestored
    })) {
      try {
        await cleanupIsolatedJourneyProfile(profile);
        await cleanupWindowsIntegrationRoot(root);
      } catch (error) {
        finalizationFailures.push(error);
      }
    } else {
      finalizationFailures.push(new Error(`Preserved recovery artifacts after unproven restoration: root=${root}; profile=${profile.root}.`));
    }
  }
  if (associationJourneyFailure !== null) {
    if (finalizationFailures.length > 0) {
      throw new AggregateError([associationJourneyFailure, ...finalizationFailures], "Association journey and safe finalization failed.", { cause: finalizationFailures.at(-1) });
    }
    throw associationJourneyFailure;
  }
  if (finalizationFailures.length > 0) {
    throw new AggregateError(finalizationFailures, "Association journey finalization did not prove safe cleanup.", { cause: finalizationFailures.at(-1) });
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
  const shellS0 = await snapshotWindowsShellState(profile.appData);
  const sourcePath = path.join(root, `Explorer drag source ${shellToken.slice(0, 8)} \u017dlt\u00fd.ether`);
  const targetPath = path.join(root, `Explorer drag target ${shellToken.slice(0, 8)} \u017dlt\u00fd.ether`);
  let session: RecoveryJourneySession | null = null;
  let primaryPid: number | null = null;
  let dragJourneyFailure: unknown = null;
  let shellStateRestored = false;
  let shellS1: WindowsShellStateSnapshot | null = null;
  let shellS1TargetShortcuts: string[] | null = null;
  let postS1ShellClassified = false;
  let journeyFailedAfterCheckpoint = false;
  let exactProcessAbsenceProven = false;
  const shellFinalizationSidecar = await createShellFinalizationSidecar("a02-windows-explorer-drag", "explorer-drag");
  const finalizationFailures: unknown[] = [];
  try {
    exactProcessAbsenceProven = false;
    session = await launch(executable, "a02-windows-explorer-drag", profile, undefined, false, {
      afterLaunchFailureApplicationExit: async () => {
        exactProcessAbsenceProven = true;
        await recordShellFinalizationBlocked({ action: "Explorer drag launch failure without S1", exactProcessAbsenceProven, reason: "S1 prerequisites were unavailable; sanitation was not attempted.", sidecar: shellFinalizationSidecar });
      }
    });
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
    shellS1 = await resnapshotWindowsShellState(shellS0);
    session.input.observe("Capture S1 after native Explorer setup", "S0 is diagnostic; every S0→S1 shell delta is recorded as OS-native setup and is not restored.", describeWindowsShellSetupDelta(shellS0, shellS1));
    await assertShellCheckpointRestored(shellS1);
    shellS1TargetShortcuts = await snapshotS1TargetShortcuts({ documentPaths: [sourcePath, targetPath], profile, root });
    session.input.observe("S1 exact target-link checkpoint", "Both real and isolated S1 Recent roots contain zero links resolving to the exact Explorer documents.", "S1 matching target links=0.");
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
    if (shellS1 === null || shellS1TargetShortcuts === null) throw new Error("S1 exact target-link checkpoint was not captured before Explorer final close.");
    const dragShellS1 = shellS1;
    const dragS1TargetShortcuts = shellS1TargetShortcuts;
    await session.close("passed", {
      afterApplicationExit: async () => {
        exactProcessAbsenceProven = true;
        const disposition = await recordShellFinalizationAttempt({ action: "Explorer drag close sanitation", exactProcessAbsenceProven, sidecar: shellFinalizationSidecar, sanitize: () => classifyShellAfterExactExit({ documentPaths: [sourcePath, targetPath], profile, root, s0: shellS0, s1: dragShellS1, s1TargetShortcuts: dragS1TargetShortcuts }) });
        session?.input.observe("Post-S1 Explorer shell classification", "After exact process absence, only exact post-S1 target links are removed; no new files or non-opaque changes are allowed.", disposition);
        postS1ShellClassified = true;
      }
    });
    session = null;
  } catch (error) {
    dragJourneyFailure = error;
    journeyFailedAfterCheckpoint = shellS1 !== null;
  } finally {
    if (session !== null && primaryPid !== null) {
      try {
        await closeExactWindowWithNativeKeyboard(primaryPid);
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    if (session !== null) {
      try {
        await session.close("failed", {
          afterApplicationExit: async () => {
            exactProcessAbsenceProven = true;
            if (shellS1 !== null && shellS1TargetShortcuts !== null) {
              const disposition = await recordShellFinalizationAttempt({ action: "failed Explorer drag close sanitation", exactProcessAbsenceProven, sidecar: shellFinalizationSidecar, sanitize: () => classifyShellAfterExactExit({ documentPaths: [sourcePath, targetPath], profile, root, s0: shellS0, s1: shellS1!, s1TargetShortcuts: shellS1TargetShortcuts! }) });
              session?.input.observe("Post-S1 Explorer shell classification", "After exact process absence, only exact post-S1 target links are removed; no new files or non-opaque changes are allowed.", disposition);
              postS1ShellClassified = true;
            }
          }
        });
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    if (dragJourneyFailure !== null && shellFinalizationSidecar.attempts.length === 0) {
      try {
        await recordShellFinalizationBlockedOnce({ action: "Explorer drag finalization blocked", exactProcessAbsenceProven, reason: exactProcessAbsenceProven ? "S1 prerequisites were unavailable; sanitation was not attempted." : "Exact process absence was not proven; sanitation was not attempted.", sidecar: shellFinalizationSidecar });
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    if (shellS1 === null) {
      finalizationFailures.push(new Error("S1 shell checkpoint was not captured before Explorer drag."));
    } else shellStateRestored = postS1ShellClassified;
    try {
      await ensureShellFinalizationSidecarDurable(shellFinalizationSidecar);
    } catch (error) {
      finalizationFailures.push(error);
    }
    if (recoveryArtifactsMayBeCleanedAfterShellCheckpoint({
      checkpointCaptured: shellS1 !== null,
      exactProcessAbsenceProven,
      finalizationFailuresAbsent: finalizationFailures.length === 0,
      journeyFailedAfterCheckpoint,
      sidecarDurabilityProven: shellFinalizationSidecar.durabilityProven && !shellFinalizationSidecar.durabilityFailureObserved,
      shellCheckpointRestored: shellStateRestored
    })) {
      try {
        await cleanupIsolatedJourneyProfile(profile);
        await cleanupWindowsIntegrationRoot(root);
      } catch (error) {
        finalizationFailures.push(error);
      }
    } else {
      finalizationFailures.push(new Error(`Preserved recovery artifacts after unproven shell cleanup: root=${root}; profile=${profile.root}.`));
    }
  }
  if (dragJourneyFailure !== null) {
    if (finalizationFailures.length > 0) {
      throw new AggregateError([dragJourneyFailure, ...finalizationFailures], "Explorer drag route and safe finalization failed.", { cause: finalizationFailures.at(-1) });
    }
    throw dragJourneyFailure;
  }
  if (finalizationFailures.length > 0) {
    throw new AggregateError(finalizationFailures, "Explorer drag finalization did not prove safe cleanup.", { cause: finalizationFailures.at(-1) });
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
  const shellS0 = await snapshotWindowsShellState(profile.appData);
  const documentPath = path.join(root, `Jump List ${shellToken.slice(0, 8)} \u017dlt\u00fd.ether`);
  let setupSession: RecoveryJourneySession | null = null;
  let session: RecoveryJourneySession | null = null;
  let primaryPid: number | null = null;
  let plan: ReversibleAssociationPlan | null = null;
  let watchdog: AssociationRestorationWatchdog | null = null;
  let associationMayBeMutated = false;
  let associationRestorationProven = false;
  let jumpListShellStateRestored = false;
  let recentModeLaunched = false;
  let shellS1: WindowsShellStateSnapshot | null = null;
  let s1RecentShortcutPaths: string[] | null = null;
  let jumpListFailure: unknown = null;
  let journeyFailedAfterCheckpoint = false;
  let exactProcessAbsenceProven = false;
  let shellFinalizationSidecar = await createShellFinalizationSidecar("a02-windows-jump-list-setup", "jump-list-setup");
  const jumpListCleanupState = createJumpListShellCleanupState();
  const finalizationFailures: unknown[] = [];
  try {
    exactProcessAbsenceProven = false;
    setupSession = await launch(executable, "a02-windows-jump-list-setup", profile, undefined, false, {
      afterLaunchFailureApplicationExit: async () => {
        exactProcessAbsenceProven = true;
        await recordShellFinalizationBlocked({ action: "Jump List setup launch failure without S1", exactProcessAbsenceProven, reason: "S1 prerequisites were unavailable; sanitation was not attempted.", sidecar: shellFinalizationSidecar });
      }
    });
    const setupPid = await findExactPackagedProcessId(executable, profile.userData);
    await expect(setupSession.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await setupSession.input.leftClick(setupSession.page.getByRole("button", { name: "Prompt", exact: true }), "Create the ordinary-recovery Jump List document", "The document is authored through the ordinary recovery UI with Recent disabled.");
    await setupSession.input.pressKey("Control+s", "Save ordinary-recovery Jump List setup document", "The native picker creates the exact test-owned document before the approved Recent-mode session starts.");
    await completeNativeFileDialogWithUia(setupPid, documentPath);
    await expect.poll(() => isFile(documentPath)).toBe(true);
    const setupClose = await closeExactWindowWithNativeKeyboard(setupPid);
    setupSession.input.observe("Close ordinary-recovery Jump List setup", "The ordinary recovery process exits before S1 is captured and before Recent mode is admitted.", setupClose);
    await expect.poll(() => setupSession?.page.isClosed() ?? false, { timeout: 15_000 }).toBe(true);
    await setupSession.close("passed", {
      afterApplicationExit: async () => {
        exactProcessAbsenceProven = true;
        shellS1 = await resnapshotWindowsShellState(shellS0);
        setupSession?.input.observe("Capture S1 after ordinary native-save setup", "S0 is diagnostic; every S0→S1 shell delta is recorded as OS-native setup and is not restored.", describeWindowsShellSetupDelta(shellS0, shellS1));
        await assertShellCheckpointRestored(shellS1);
      }
    });
    setupSession = null;
    if (shellS1 === null) throw new Error("S1 shell checkpoint was not captured after ordinary-recovery setup.");
    await assertShellCheckpointRestored(shellS1);
    s1RecentShortcutPaths = await snapshotS1TargetShortcuts({ documentPaths: [documentPath], profile, root });

    recentModeLaunched = true;
    exactProcessAbsenceProven = false;
    shellFinalizationSidecar = await createShellFinalizationSidecar("a02-windows-jump-list", "jump-list");
    session = await launch(executable, "a02-windows-jump-list", profile, documentPath, true, {
      afterLaunchFailureApplicationExit: async () => {
        exactProcessAbsenceProven = true;
        if (shellS1 === null || s1RecentShortcutPaths === null) {
          await recordShellFinalizationBlocked({ action: "Jump List launch failure without S1", exactProcessAbsenceProven, jumpState: jumpListCleanupState, reason: "S1 prerequisites were unavailable; sanitation was not attempted.", sidecar: shellFinalizationSidecar });
          return;
        }
        await recordShellFinalizationAttempt({ action: "Jump List launch failure sanitation", exactProcessAbsenceProven, jumpState: jumpListCleanupState, sidecar: shellFinalizationSidecar, sanitize: () => restoreApprovedJumpListShellState({
          allowNoCandidate: true, before: shellS1!, documentPaths: [documentPath], profile, root, s1RecentShortcutPaths: s1RecentShortcutPaths!, state: jumpListCleanupState, token: shellToken
        }) });
        jumpListShellStateRestored = true;
      }
    });
    await snapshotTestOwnedRecentShortcuts({ appData: profile.appData, root, documentPaths: [documentPath] });
    primaryPid = await findExactPackagedProcessId(executable, profile.userData);
    await expect(session.page.getByTestId("project-header")).toContainText(path.basename(documentPath), { timeout: 30_000 });
    session.input.observe("Open existing S1 document in approved Recent mode", "The approved Jump List session opens the ordinary-recovery document and does not invoke a native Save dialog; both real and isolated S1 Recent roots contained zero matching target links.", `Opened ${path.basename(documentPath)} from the same disposable profile/token; S1 matching links=0.`);
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
      associationRestorationProven = true;
      plan = null;
      watchdog = null;
      associationMayBeMutated = false;
    }
    const closeAction = await closeExactWindowWithNativeKeyboard(primaryPid);
    session.input.observe("Close isolated Jump List journey", "A native Alt+F4 closes only the exact recovery-AUMID Ether window before shell-state verification.", closeAction);
    await expect.poll(() => session?.page.isClosed() ?? false, { timeout: 15_000 }).toBe(true);
    if (shellS1 === null) throw new Error("S1 shell checkpoint was not captured before approved Jump List cleanup.");
    if (s1RecentShortcutPaths === null) throw new Error("S1 Recent shortcut baseline was not captured before approved Jump List cleanup.");
    const approvedShellS1 = shellS1;
    const approvedRecentShortcutPaths = s1RecentShortcutPaths;
    await session.close("passed", {
      afterApplicationExit: async () => {
        exactProcessAbsenceProven = true;
        const shellDisposition = await recordShellFinalizationAttempt({ action: "Jump List close sanitation", exactProcessAbsenceProven, jumpState: jumpListCleanupState, sidecar: shellFinalizationSidecar, sanitize: () => restoreApprovedJumpListShellState({
          before: approvedShellS1, documentPaths: [documentPath], profile, root, s1RecentShortcutPaths: approvedRecentShortcutPaths, state: jumpListCleanupState, token: shellToken
        }) });
        session?.input.observe("Jump List app-scoped cleanup", "After exact process absence, only the exact new recovery candidate is recycled; J2 equals the J0 micro-baseline without that candidate while opaque in-place OS changes are recorded.", shellDisposition);
        jumpListShellStateRestored = true;
      }
    });
    session = null;
  } catch (error) {
    jumpListFailure = error;
    journeyFailedAfterCheckpoint = shellS1 !== null;
  } finally {
    try {
      if (associationMayBeMutated && plan !== null && watchdog !== null) {
        const restorePlan = plan;
        const restoreWatchdog = watchdog;
        await restoreAssociationWithWatchdog(restorePlan, restoreWatchdog);
        associationRestorationProven = true;
      } else if (watchdog !== null) {
        await disarmAssociationRestorationWatchdog(watchdog);
        associationRestorationProven = true;
      } else if (associationArtifactsMayBeCleaned({ mutationAttempted: associationMayBeMutated, restorationProven: false, watchdogActive: false })) {
        associationRestorationProven = true;
      }
    } catch (error) {
      finalizationFailures.push(error);
    }
    if (setupSession !== null) {
      try {
        await setupSession.close("failed", {
          afterApplicationExit: async () => {
            exactProcessAbsenceProven = true;
            shellS1 ??= await resnapshotWindowsShellState(shellS0);
            setupSession?.input.observe("Capture S1 after failed ordinary setup", "S0 is diagnostic; this retained S1 is the only later restoration checkpoint.", describeWindowsShellSetupDelta(shellS0, shellS1));
          }
        });
        setupSession = null;
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    if (session !== null && primaryPid !== null) {
      try {
        await closeExactWindowWithNativeKeyboard(primaryPid);
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    if (session !== null) {
      try {
        await session.close("failed", {
          afterApplicationExit: async () => {
            exactProcessAbsenceProven = true;
            if (recentModeLaunched && !jumpListShellStateRestored) {
              if (shellS1 === null) throw new Error("S1 shell checkpoint was not captured before approved Jump List cleanup.");
              if (s1RecentShortcutPaths === null) throw new Error("S1 Recent shortcut baseline was not captured before approved Jump List cleanup.");
              await recordShellFinalizationAttempt({ action: "failed Jump List close sanitation", exactProcessAbsenceProven, jumpState: jumpListCleanupState, sidecar: shellFinalizationSidecar, sanitize: () => restoreApprovedJumpListShellState({ before: shellS1!, documentPaths: [documentPath], profile, root, s1RecentShortcutPaths: s1RecentShortcutPaths!, state: jumpListCleanupState, token: shellToken }) });
              jumpListShellStateRestored = true;
            }
          }
        });
        session = null;
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    if (session === null && recentModeLaunched && !jumpListShellStateRestored && shellS1 !== null && s1RecentShortcutPaths !== null && exactProcessAbsenceProven) {
      try {
        await recordShellFinalizationAttempt({ action: "no-session Jump List sanitation retry", exactProcessAbsenceProven, jumpState: jumpListCleanupState, sidecar: shellFinalizationSidecar, sanitize: () => restoreApprovedJumpListShellState({ allowNoCandidate: true, before: shellS1!, documentPaths: [documentPath], profile, root, s1RecentShortcutPaths: s1RecentShortcutPaths!, state: jumpListCleanupState, token: shellToken }) });
        jumpListShellStateRestored = true;
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    if (session === null && recentModeLaunched && !jumpListShellStateRestored && shellS1 !== null && s1RecentShortcutPaths !== null && !exactProcessAbsenceProven) {
      try {
        await recordShellFinalizationBlocked({ action: "no-session Jump List sanitation blocked", exactProcessAbsenceProven, jumpState: jumpListCleanupState, reason: "Exact process absence was not proven; sanitation was not attempted.", sidecar: shellFinalizationSidecar });
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    if (jumpListFailure !== null && shellFinalizationSidecar.attempts.length === 0) {
      try {
        await recordShellFinalizationBlockedOnce({ action: "Jump List no-session finalization blocked", exactProcessAbsenceProven, jumpState: jumpListCleanupState, reason: exactProcessAbsenceProven ? "S1 prerequisites were unavailable; sanitation was not attempted." : "Exact process absence was not proven; sanitation was not attempted.", sidecar: shellFinalizationSidecar });
      } catch (error) {
        finalizationFailures.push(error);
      }
    }
    try {
      await ensureShellFinalizationSidecarDurable(shellFinalizationSidecar);
    } catch (error) {
      finalizationFailures.push(error);
    }
    if (associationRestorationProven && recoveryArtifactsMayBeCleanedAfterShellCheckpoint({
      checkpointCaptured: shellS1 !== null,
      exactProcessAbsenceProven,
      finalizationFailuresAbsent: finalizationFailures.length === 0,
      journeyFailedAfterCheckpoint,
      sidecarDurabilityProven: shellFinalizationSidecar.durabilityProven && !shellFinalizationSidecar.durabilityFailureObserved,
      shellCheckpointRestored: jumpListShellStateRestored
    })) {
      try {
        await cleanupIsolatedJourneyProfile(profile);
        await cleanupWindowsIntegrationRoot(root);
      } catch (error) {
        finalizationFailures.push(error);
      }
    } else {
      finalizationFailures.push(new Error(`Preserved recovery artifacts after unproven restoration: root=${root}; profile=${profile.root}.`));
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

/** S1 is the first restore obligation; S0 only documents unavoidable native setup deltas. */
async function assertShellCheckpointRestored(s1: WindowsShellStateSnapshot): Promise<void> {
  assertWindowsShellCheckpointStable(s1, await resnapshotWindowsShellState(s1));
}

async function snapshotS1TargetShortcuts(input: {
  documentPaths: readonly string[];
  profile: RecoveryJourneySession["profile"];
  root: string;
}): Promise<string[]> {
  const realAppData = process.env.APPDATA;
  if (realAppData === undefined) throw new Error("S1 target-link checkpoint requires the real APPDATA path.");
  const paths = [
    ...await snapshotTestOwnedRecentShortcuts({ appData: input.profile.appData, root: input.root, documentPaths: input.documentPaths }),
    ...await snapshotTestOwnedRecentShortcuts({ appData: realAppData, root: input.root, documentPaths: input.documentPaths })
  ];
  requireNoTestOwnedRecentShortcuts(paths);
  return paths;
}

async function classifyShellAfterExactExit(input: {
  documentPaths: readonly string[];
  profile: RecoveryJourneySession["profile"];
  root: string;
  s0: WindowsShellStateSnapshot;
  s1: WindowsShellStateSnapshot;
  s1TargetShortcuts: readonly string[];
}): Promise<string> {
  const realAppData = process.env.APPDATA;
  if (realAppData === undefined) throw new Error("Post-exit shell classification requires the real APPDATA path.");
  requireNoTestOwnedRecentShortcuts(input.s1TargetShortcuts);
  const removed = await cleanupTestOwnedRecentShortcuts({
    appData: input.profile.appData,
    additionalAppData: [realAppData],
    root: input.root,
    documentPaths: input.documentPaths,
    s1: input.s1
  });
  const final = await resnapshotWindowsShellState(input.s1);
  const s1Classification = classifyWindowsShellStateChanges(input.s1, final);
  assertWindowsShellClassificationClean(s1Classification, "S1→final");
  const s0Changes = compareWindowsShellState(input.s0, final);
  return `removed exact post-S1 target links=${removed.length}${removed.length === 0 ? "" : `: ${removed.join(", ")}`}; S0→final=${formatWindowsShellStateChanges(s0Changes) || "(none)"}; S1→final allowed opaque=${formatWindowsShellStateChanges(s1Classification.allowedOpaqueModifications) || "(none)"}`;
}

/**
 * The sole COM cleanup route is deliberately local to the separately approved
 * Jump List journey. It proves that every affected real/isolated Recent file
 * is one new recovery-AUMID AutomaticDestinations artifact before recycling it.
 */
type JumpListShellCleanupState = {
  candidate?: { appData: string; relativePath: string };
  comInvocations: number;
  disposition?: string;
  j0?: WindowsShellStateSnapshot;
  j1?: WindowsShellStateSnapshot;
  recycleInvocations: number;
  removedShortcuts: string[];
  s1ToJ0AllowedOpaque: WindowsShellStateChange[];
  stage: "new" | "j0-captured" | "com-invoked" | "j1-captured" | "recycle-invoked" | "j2-verified" | "no-candidate";
  transitions: string[];
};

function createJumpListShellCleanupState(): JumpListShellCleanupState {
  return { comInvocations: 0, recycleInvocations: 0, removedShortcuts: [], s1ToJ0AllowedOpaque: [], stage: "new", transitions: [] };
}

async function restoreApprovedJumpListShellState(input: {
  allowNoCandidate?: boolean;
  before: WindowsShellStateSnapshot;
  documentPaths: readonly string[];
  profile: RecoveryJourneySession["profile"];
  root: string;
  s1RecentShortcutPaths: readonly string[];
  state: JumpListShellCleanupState;
  token: string;
}): Promise<string> {
  const realAppData = process.env.APPDATA;
  if (realAppData === undefined) throw new Error("Jump List cleanup requires the real APPDATA snapshot root.");
  requireNoTestOwnedRecentShortcuts(input.s1RecentShortcutPaths);
  if (input.state.stage === "new") {
    input.state.removedShortcuts.push(...await cleanupTestOwnedRecentShortcuts({
      appData: input.profile.appData,
      additionalAppData: [realAppData],
      root: input.root,
      documentPaths: input.documentPaths,
      s1: input.before
    }));
    const j0 = await resnapshotWindowsShellState(input.before);
    const s1ToJ0 = classifyWindowsShellStateChanges(input.before, j0, { allowNewRecoveryAutomaticDestination: true });
    assertWindowsShellClassificationClean(s1ToJ0, "S1-to-J0");
    input.state.j0 = j0;
    input.state.s1ToJ0AllowedOpaque = s1ToJ0.allowedOpaqueModifications;
    if (s1ToJ0.newRecoveryAutomaticDestinations.length === 0 && input.allowNoCandidate === true) {
      input.state.stage = "no-candidate";
      return formatJumpListShellDisposition(input.state);
    }
    input.state.candidate = requireSingleNewRecoveryAutomaticDestination(s1ToJ0, path.resolve(realAppData), "practical Jump List route");
    input.state.stage = "j0-captured";
  }
  if (input.state.stage === "no-candidate" || input.state.stage === "j2-verified") return formatJumpListShellDisposition(input.state);

  const { candidate, j0 } = input.state;
  if (candidate === undefined || j0 === undefined) throw new Error(`Jump List cleanup state ${input.state.stage} lacks its stored J0 candidate.`);
  if (input.state.stage === "j0-captured") {
    const current = await resnapshotWindowsShellState(j0);
    assertWindowsShellCheckpointStable(j0, current, "J0 before first COM invocation");
    input.state.stage = "com-invoked";
    input.state.comInvocations += 1;
    input.state.transitions.push(`COM invocation #${input.state.comInvocations}`);
    await removeRecoveryShellAutomaticDestinations(input.token);
  }
  if (input.state.stage === "com-invoked") {
    let j1 = await resnapshotWindowsShellState(j0);
    let comProgress = classifyJumpListComProgress({ candidate, current: j1, j0 });
    if (comProgress === "com-not-applied") {
      input.state.transitions.push(`COM invocation #${input.state.comInvocations} candidate observed not applied; retrying`);
      input.state.comInvocations += 1;
      input.state.transitions.push(`COM invocation #${input.state.comInvocations}`);
      await removeRecoveryShellAutomaticDestinations(input.token);
      j1 = await resnapshotWindowsShellState(j0);
      comProgress = classifyJumpListComProgress({ candidate, current: j1, j0 });
    }
    input.state.transitions.push(`COM invocation #${input.state.comInvocations} candidate observed ${comProgress === "com-applied" ? "applied" : "not applied"}`);
    input.state.j1 = assertExactJumpListCandidateMutation(j0, j1, candidate);
    input.state.stage = "j1-captured";
  }
  if (input.state.stage === "j1-captured") {
    const j1 = input.state.j1;
    if (j1 === undefined) throw new Error("Jump List J1 was not stored before recycle.");
    const current = await resnapshotWindowsShellState(j0);
    if (classifyJumpListRecycleProgress({ candidate, j0, j1, current }) === "candidate-recycled") {
      input.state.transitions.push("Recycle invocation #0 candidate observed absent");
      input.state.stage = "j2-verified";
      return formatJumpListShellDisposition(input.state);
    }
    const currentCandidate = findExactSnapshotFile(current, candidate);
    input.state.stage = "recycle-invoked";
    input.state.transitions.push("Recycle candidate observed present");
    input.state.recycleInvocations += 1;
    input.state.transitions.push(`Recycle invocation #${input.state.recycleInvocations}`);
    input.state.disposition = await recycleProvenRecoveryAutomaticDestination({ appData: realAppData, file: currentCandidate });
  }
  if (input.state.stage === "recycle-invoked") {
    const j1 = input.state.j1;
    if (j1 === undefined) throw new Error("Jump List J1 was not stored for recycle retry.");
    const current = await resnapshotWindowsShellState(j0);
    if (classifyJumpListRecycleProgress({ candidate, j0, j1, current }) === "candidate-present") {
      input.state.transitions.push(`Recycle invocation #${input.state.recycleInvocations} candidate observed present; retrying`);
      const currentCandidate = findExactSnapshotFile(current, candidate);
      input.state.recycleInvocations += 1;
      input.state.transitions.push(`Recycle invocation #${input.state.recycleInvocations}`);
      input.state.disposition = await recycleProvenRecoveryAutomaticDestination({ appData: realAppData, file: currentCandidate });
      return restoreApprovedJumpListShellState(input);
    }
    input.state.transitions.push(`Recycle invocation #${input.state.recycleInvocations} candidate observed absent`);
    input.state.stage = "j2-verified";
  }
  return formatJumpListShellDisposition(input.state);
}

function assertExactJumpListCandidateMutation(
  j0: WindowsShellStateSnapshot,
  j1: WindowsShellStateSnapshot,
  candidate: { appData: string; relativePath: string }
): WindowsShellStateSnapshot {
  const postFile = requireExactRecoveryCandidateMutation(compareWindowsShellState(j0, j1), candidate, "app-scoped COM cleanup");
  if (postFile.size !== 2560) throw new Error(`Jump List cleanup did not leave the expected 2560-byte recovery artifact: ${candidate.relativePath}.`);
  const currentCandidate = findExactSnapshotFile(j1, candidate);
  if (currentCandidate.sha256 !== postFile.sha256 || currentCandidate.size !== postFile.size) {
    throw new Error(`Jump List cleanup candidate changed before Recycle verification: ${candidate.relativePath}.`);
  }
  return j1;
}

function findExactSnapshotFile(snapshot: WindowsShellStateSnapshot, candidate: { appData: string; relativePath: string }): { path: string; sha256: string; size: number } {
  const file = snapshot.roots.find((root) => path.resolve(root.appData) === path.resolve(candidate.appData))?.files
    .find((entry) => entry.path === candidate.relativePath);
  if (file === undefined) throw new Error(`Jump List exact candidate is absent when it must be present: ${candidate.relativePath}.`);
  return file;
}

function formatJumpListShellDisposition(state: JumpListShellCleanupState): string {
  const candidate = state.candidate?.relativePath ?? "(no recovery candidate created before launch failure)";
  return `${state.disposition ?? "no Recycle action required"}; removed exact post-S1 Recent shortcuts=${state.removedShortcuts.length}${state.removedShortcuts.length === 0 ? "" : `: ${state.removedShortcuts.join(", ")}`}; S1-to-J0 allowed opaque=${formatWindowsShellStateChanges(state.s1ToJ0AllowedOpaque) || "(none)"}; candidate=${candidate}; Jump transitions=${state.transitions.join(" | ") || "(none)"}; stage=${state.stage}.`;
}

function requireSingleNewRecoveryAutomaticDestination(
  classification: ReturnType<typeof classifyWindowsShellStateChanges>,
  realAppData: string,
  stage: string
): { appData: string; relativePath: string } {
  if (classification.newRecoveryAutomaticDestinations.length !== 1) {
    throw new Error(`${stage} did not produce exactly one new recovery AutomaticDestinations candidate: ${formatWindowsShellStateChanges(classification.newRecoveryAutomaticDestinations) || "(none)"}.`);
  }
  const [change] = classification.newRecoveryAutomaticDestinations;
  if (
    change === undefined || change.appData !== realAppData || change.before !== null || change.after === null
  ) {
    throw new Error(`${stage} produced a recovery candidate outside the exact real shell root.`);
  }
  return { appData: change.appData, relativePath: change.after.path };
}

function requireExactRecoveryCandidateMutation(
  changes: WindowsShellStateChange[],
  candidate: { appData: string; relativePath: string },
  stage: string
): { path: string; sha256: string; size: number } {
  if (
    changes.length !== 1 || changes[0]?.appData !== candidate.appData || changes[0]?.before?.path !== candidate.relativePath ||
    changes[0]?.after?.path !== candidate.relativePath
  ) {
    throw new Error(`${stage} changed anything other than the exact J0 recovery candidate: ${formatWindowsShellStateChanges(changes) || "(none)"}.`);
  }
  return changes[0].after;
}

type ShellFinalizationAttempt = {
  action: string;
  candidatePath: string | null;
  disposition: string | null;
  exactProcessAbsenceProven: boolean;
  failure: string | null;
  finishedAt: string;
  jumpStageAfter: string | null;
  jumpStageBefore: string | null;
  jumpTransitions: string[] | null;
  outcome: "passed" | "failed" | "blocked";
};

type ShellFinalizationSidecar = {
  attempts: ShellFinalizationAttempt[];
  durabilityFailureObserved: boolean;
  durabilityProven: boolean;
  identity: JourneyBuildIdentity;
  journeyId: string;
  path: string;
  route: string;
};

async function createShellFinalizationSidecar(journeyId: string, route: string): Promise<ShellFinalizationSidecar> {
  const evidence = journeyEvidencePaths(workspaceRoot, journeyId, "packaged", "committed", ["phase-0", "document-windows-integration", journeyId]);
  const identity = await collectJourneyBuildIdentity(workspaceRoot, "packaged");
  assertExactPackagedBuildIdentity(identity);
  const sidecar: ShellFinalizationSidecar = {
    attempts: [],
    durabilityFailureObserved: false,
    durabilityProven: false,
    identity,
    journeyId,
    path: path.join(evidence.root, "shell-finalization.json"),
    route
  };
  await writeShellFinalizationSidecar(sidecar);
  return sidecar;
}

async function recordShellFinalizationAttempt(input: {
  action: string;
  exactProcessAbsenceProven: boolean;
  jumpState?: JumpListShellCleanupState;
  sidecar: ShellFinalizationSidecar;
  sanitize: () => Promise<string>;
}): Promise<string> {
  if (!input.exactProcessAbsenceProven) {
    await recordShellFinalizationBlocked({
      action: input.action,
      jumpState: input.jumpState,
      reason: "Exact process absence was not proven; sanitation was not attempted.",
      sidecar: input.sidecar
    });
    throw new Error("Refusing shell sanitation without exact process-absence proof.");
  }
  const jumpStageBefore = input.jumpState?.stage ?? null;
  const jumpTransitionCountBefore = input.jumpState?.transitions.length ?? 0;
  try {
    const disposition = await input.sanitize();
    input.sidecar.attempts.push({
      action: input.action,
      candidatePath: input.jumpState?.candidate?.relativePath ?? null,
      disposition,
      exactProcessAbsenceProven: input.exactProcessAbsenceProven,
      failure: null,
      finishedAt: new Date().toISOString(),
      jumpStageAfter: input.jumpState?.stage ?? null,
      jumpStageBefore,
      jumpTransitions: input.jumpState?.transitions.slice(jumpTransitionCountBefore) ?? null,
      outcome: "passed"
    });
    await writeShellFinalizationSidecar(input.sidecar);
    return disposition;
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    input.sidecar.attempts.push({
      action: input.action,
      candidatePath: input.jumpState?.candidate?.relativePath ?? null,
      disposition: `failed: ${failure}`,
      exactProcessAbsenceProven: input.exactProcessAbsenceProven,
      failure,
      finishedAt: new Date().toISOString(),
      jumpStageAfter: input.jumpState?.stage ?? null,
      jumpStageBefore,
      jumpTransitions: input.jumpState?.transitions.slice(jumpTransitionCountBefore) ?? null,
      outcome: "failed"
    });
    try {
      await writeShellFinalizationSidecar(input.sidecar);
    } catch (sidecarError) {
      throw new AggregateError([error, sidecarError], "Shell sanitation and durable finalization evidence both failed.", { cause: sidecarError });
    }
    throw error;
  }
}

async function recordShellFinalizationBlocked(input: {
  action: string;
  exactProcessAbsenceProven?: boolean;
  jumpState?: JumpListShellCleanupState;
  reason: string;
  sidecar: ShellFinalizationSidecar;
}): Promise<void> {
  input.sidecar.attempts.push({
    action: input.action,
    candidatePath: input.jumpState?.candidate?.relativePath ?? null,
    disposition: `blocked: ${input.reason}`,
    exactProcessAbsenceProven: input.exactProcessAbsenceProven ?? false,
    failure: input.reason,
    finishedAt: new Date().toISOString(),
    jumpStageAfter: input.jumpState?.stage ?? null,
    jumpStageBefore: input.jumpState?.stage ?? null,
    jumpTransitions: null,
    outcome: "blocked"
  });
  await writeShellFinalizationSidecar(input.sidecar);
}

async function recordShellFinalizationBlockedOnce(input: Parameters<typeof recordShellFinalizationBlocked>[0]): Promise<void> {
  if (input.sidecar.attempts.some((attempt) => attempt.action === input.action)) return;
  await recordShellFinalizationBlocked(input);
}

async function writeShellFinalizationSidecar(sidecar: ShellFinalizationSidecar): Promise<void> {
  sidecar.durabilityProven = false;
  try {
    await mkdir(path.dirname(sidecar.path), { recursive: true });
    await writeFile(sidecar.path, `${JSON.stringify({
      attempts: sidecar.attempts,
      durabilityFailureObserved: sidecar.durabilityFailureObserved,
      identity: sidecar.identity,
      journeyId: sidecar.journeyId,
      route: sidecar.route,
      schemaVersion: 1
    }, null, 2)}\n`, "utf8");
    sidecar.durabilityProven = true;
  } catch (error) {
    sidecar.durabilityFailureObserved = true;
    throw error;
  }
}

async function ensureShellFinalizationSidecarDurable(sidecar: ShellFinalizationSidecar): Promise<boolean> {
  await writeShellFinalizationSidecar(sidecar);
  if (!sidecar.durabilityProven || sidecar.durabilityFailureObserved) {
    throw new Error("Shell finalization sidecar durability was not proven for this journey.");
  }
  return true;
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
  recoveryShellRecent = false,
  options: { afterLaunchFailureApplicationExit?: () => Promise<void> | void } = {}
): Promise<RecoveryJourneySession> {
  return launchRecoveryJourney({
    ...packagedJourneyConfig(workspaceRoot, journeyId),
    executablePath,
    declaration: blankAuthoringJourney(journeyId),
    evidenceMode: "committed",
    committedEvidencePath: ["phase-0", "document-windows-integration", journeyId],
    ...(profile === undefined ? { cleanupProfile: false } : { profile, cleanupProfile: false }),
    ...options,
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

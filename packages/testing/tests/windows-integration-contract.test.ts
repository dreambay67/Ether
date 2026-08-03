import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  RECOVERY_SHELL_IDENTITY_ARGUMENT,
  RECOVERY_SHELL_JOURNEY_ARGUMENT,
  RECOVERY_SHELL_JUMP_LIST_JOURNEY,
  RECOVERY_SHELL_RECENT_ARGUMENT,
  resolveRecoveryShellIdentity
} from "../../../apps/desktop/src/main/recoveryShellIdentity.js";
import { assertPackagedJourneyArgs, assertRecoveryShellRecentAdmission, packagedJourneyConfig } from "../recovery/journeyDriver.js";
import { removeRecoveryShellAutomaticDestinations } from "../recovery/windowsShellDestinations.js";

import {
  A02_WINDOWS_INTEGRATION_COVERAGE,
  ASSOCIATION_APPROVAL,
  ASSOCIATION_APPROVAL_VALUE,
  associationArtifactsMayBeCleaned,
  assertWindowsShellDeletionCandidatesAbsentAtS1,
  assertWindowsShellClassificationClean,
  assertWindowsShellCheckpointStable,
  assertWindowsShellMicroBaselineAfterRecycle,
  classifyWindowsShellStateChanges,
  classifyJumpListComProgress,
  classifyJumpListRecycleProgress,
  compareWindowsShellState,
  deriveWindowsShellDeletionCandidate,
  describeWindowsShellSetupDelta,
  ETHER_EXTENSION_KEY,
  SHELL_UI_APPROVAL,
  SHELL_UI_APPROVAL_VALUE,
  createWindowsIntegrationRoot,
  isAssociationMutationApproved,
  removeTestOwnedDisposableRoots,
  recoveryArtifactsMayBeCleanedAfterShellCheckpoint,
  requireNoTestOwnedRecentShortcuts,
  requireAssociationMutationApproval,
  requireShellUiApproval
} from "../recovery/windowsIntegration.js";

describe("A02 Windows integration harness contracts", () => {
  it("keeps normal recovery journeys out of Recent and custom Jump List APIs", async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const [bootstrap, main, cleanup, driver, integrationSpec] = await Promise.all([
      readFile(path.join(repositoryRoot, "apps/desktop/src/main/bootstrap.ts"), "utf8"),
      readFile(path.join(repositoryRoot, "apps/desktop/src/main/main.ts"), "utf8"),
      readFile(path.join(repositoryRoot, "packages/testing/recovery/windowsShellDestinations.ts"), "utf8"),
      readFile(path.join(repositoryRoot, "packages/testing/recovery/journeyDriver.ts"), "utf8"),
      readFile(path.join(repositoryRoot, "packages/testing/tests/recovery/document-windows-integration.spec.ts"), "utf8")
    ]);
    expect(bootstrap).not.toMatch(/setJumpList|clearRecentDocuments/u);
    expect(main).toContain('if (recoveryShell === null || recoveryShell.recentEnabled) app.addRecentDocument(documentPath);');
    expect(main).toContain('if (!credentialOnly && recoveryShell === null) app.setJumpList([{ type: "recent" }]);');
    expect(main).not.toContain("clearRecentDocuments");
    expect(cleanup).toMatch(/12337d35-94c6-48a0-bce7-6a9c69d4d600/iu);
    expect(cleanup).toMatch(/86c14003-4d6b-4ef3-a7b4-0506663b2e68/iu);
    expect(cleanup).toMatch(/SetAppID\(appId\).*RemoveAllDestinations/su);
    expect(cleanup).not.toMatch(/SHAddToRecentDocs|setJumpList/u);
    const windowsIntegration = await readFile(path.join(repositoryRoot, "packages/testing/recovery/windowsIntegration.ts"), "utf8");
    expect(windowsIntegration).toContain("Refusing to delete an S1-pre-existing shortcut pathname");
    expect(windowsIntegration).toContain("Shortcut bytes or target changed before deletion");
    expect(windowsIntegration).toContain("Get-FileHash -LiteralPath $candidatePath -Algorithm SHA256");
    expect(windowsIntegration).toContain("recentShortcutDeletionScript");
    expect(windowsIntegration).toContain("assertWindowsShellDeletionCandidatesAbsentAtS1(input.s1");
    expect(windowsIntegration).not.toContain("$s1Paths");
    expect(windowsIntegration).not.toContain("s1Root.files.map((file) => file.path)");
    expect(driver).toContain("afterLaunchFailureApplicationExit");
    expect(integrationSpec).toContain("let exactProcessAbsenceProven = false");
    expect(integrationSpec.match(/afterLaunchFailureApplicationExit/g)?.length).toBeGreaterThanOrEqual(5);
    expect(integrationSpec).toContain("shell-finalization.json");
    expect(integrationSpec).toContain("assertExactPackagedBuildIdentity(identity)");
    expect(integrationSpec).toContain("recordShellFinalizationAttempt");
    expect(integrationSpec).toContain("recordShellFinalizationBlocked");
    expect(integrationSpec).toContain("Refusing shell sanitation without exact process-absence proof");
    expect(integrationSpec).toContain("ensureShellFinalizationSidecarDurable");
    expect(integrationSpec).toContain("durabilityFailureObserved");
    expect(integrationSpec).toContain("Shell finalization sidecar durability was not proven for this journey.");
    expect(integrationSpec).toContain("jumpTransitions");
    expect(integrationSpec).toContain("COM invocation #");
    expect(integrationSpec).toContain("Recycle invocation #");
    expect(integrationSpec).toContain("Shell sanitation and durable finalization evidence both failed");
  });

  it("declares only representative packaged coverage and names the remaining Windows gaps", () => {
    expect(A02_WINDOWS_INTEGRATION_COVERAGE.packagedRepresentatives).toEqual(expect.arrayContaining([
      "AC-A02-010", "AC-A02-011", "AC-A02-013", "AC-A02-017", "AC-A02-019", "AC-A02-020", "AC-A02-026"
    ]));
    expect(A02_WINDOWS_INTEGRATION_COVERAGE.focusedAutomation).toHaveLength(14);
    expect(A02_WINDOWS_INTEGRATION_COVERAGE.knownPackagedGaps.join("\n")).toMatch(/drag\/drop|Jump List|removable-drive/iu);
    expect(ETHER_EXTENSION_KEY).toBe("HKCU\\Software\\Classes\\.ether");
  });

  it("requires explicit main-worker approval before any association mutation", () => {
    expect(isAssociationMutationApproved({})).toBe(false);
    expect(() => requireAssociationMutationApproval({})).toThrow(/dry-run only/u);
    expect(isAssociationMutationApproved({ [ASSOCIATION_APPROVAL]: ASSOCIATION_APPROVAL_VALUE })).toBe(true);
    expect(() => requireAssociationMutationApproval({ [ASSOCIATION_APPROVAL]: ASSOCIATION_APPROVAL_VALUE })).not.toThrow();
  });

  it("preserves association recovery artifacts unless no mutation was armed or restoration is proven", () => {
    expect(associationArtifactsMayBeCleaned({ mutationAttempted: false, watchdogActive: false, restorationProven: false })).toBe(true);
    expect(associationArtifactsMayBeCleaned({ mutationAttempted: false, watchdogActive: true, restorationProven: false })).toBe(false);
    expect(associationArtifactsMayBeCleaned({ mutationAttempted: true, watchdogActive: false, restorationProven: false })).toBe(false);
    expect(associationArtifactsMayBeCleaned({ mutationAttempted: true, watchdogActive: true, restorationProven: true })).toBe(true);
  });

  it("records S0 setup deltas but rejects every post-S1 shell change", () => {
    const s0 = { roots: [{ appData: "C:\\real", files: [] }] };
    const s1 = { roots: [{ appData: "C:\\real", files: [{ path: "CustomDestinations/setup.customDestinations-ms", sha256: "a".repeat(64), size: 12 }] }] };
    const postS1 = { roots: [{ appData: "C:\\real", files: [{ path: "CustomDestinations/setup.customDestinations-ms", sha256: "b".repeat(64), size: 12 }] }] };
    expect(compareWindowsShellState(s0, s1)).toHaveLength(1);
    expect(describeWindowsShellSetupDelta(s0, s1)).toMatch(/S0→S1 OS-native setup delta.*without restoration claim/u);
    expect(() => assertWindowsShellCheckpointStable(s1, s1)).not.toThrow();
    expect(() => assertWindowsShellCheckpointStable(s1, postS1)).toThrow(/S1 checkpoint changed after setup/u);
  });

  it("allows only in-place opaque destination modifications and a declared new recovery automatic destination", () => {
    const s1 = { roots: [{ appData: "C:\\real", files: [
      { path: "CustomDestinations/existing.customDestinations-ms", sha256: "a".repeat(64), size: 12 },
      { path: "Recent\\unsafe.lnk", sha256: "b".repeat(64), size: 4 }
    ] }] };
    const j0 = { roots: [{ appData: "C:\\real", files: [
      { path: "CustomDestinations/existing.customDestinations-ms", sha256: "c".repeat(64), size: 12 },
      { path: "Recent\\unsafe.lnk", sha256: "d".repeat(64), size: 4 },
      { path: "AutomaticDestinations/recovery.automaticDestinations-ms", sha256: "e".repeat(64), size: 64 }
    ] }] };
    const classification = classifyWindowsShellStateChanges(s1, j0, { allowNewRecoveryAutomaticDestination: true });
    expect(classification.allowedOpaqueModifications).toHaveLength(1);
    expect(classification.newRecoveryAutomaticDestinations).toHaveLength(1);
    expect(classification.violations).toHaveLength(1);
    expect(() => assertWindowsShellClassificationClean(classification, "S1→J0")).toThrow(/unsafe Windows shell changes/u);
  });

  it("requires J2 to be exactly J0 without the recycled candidate", () => {
    const j0 = { roots: [{ appData: "C:\\real", files: [
      { path: "AutomaticDestinations/recovery.automaticDestinations-ms", sha256: "a".repeat(64), size: 2560 },
      { path: "CustomDestinations/existing.customDestinations-ms", sha256: "b".repeat(64), size: 12 }
    ] }] };
    const j2 = { roots: [{ appData: "C:\\real", files: [{ path: "CustomDestinations/existing.customDestinations-ms", sha256: "b".repeat(64), size: 12 }] }] };
    expect(() => assertWindowsShellMicroBaselineAfterRecycle(j0, j2, { appData: "C:\\real", relativePath: "AutomaticDestinations/recovery.automaticDestinations-ms" })).not.toThrow();
    const concurrentWrite = { roots: [{ appData: "C:\\real", files: [{ path: "CustomDestinations/existing.customDestinations-ms", sha256: "c".repeat(64), size: 12 }] }] };
    expect(() => assertWindowsShellMicroBaselineAfterRecycle(j0, concurrentWrite, { appData: "C:\\real", relativePath: "AutomaticDestinations/recovery.automaticDestinations-ms" })).toThrow(/J2 did not equal J0/u);
    expect(classifyJumpListRecycleProgress({ candidate: { appData: "C:\\real", relativePath: "AutomaticDestinations/recovery.automaticDestinations-ms" }, j0, j1: j0, current: j0 })).toBe("candidate-present");
    expect(classifyJumpListRecycleProgress({ candidate: { appData: "C:\\real", relativePath: "AutomaticDestinations/recovery.automaticDestinations-ms" }, j0, j1: j0, current: j2 })).toBe("candidate-recycled");
    expect(() => classifyJumpListRecycleProgress({ candidate: { appData: "C:\\real", relativePath: "AutomaticDestinations/recovery.automaticDestinations-ms" }, j0, j1: j0, current: concurrentWrite })).toThrow(/J2 did not equal J0/u);
    const j1 = { roots: [{ appData: "C:\\real", files: [
      { path: "AutomaticDestinations/recovery.automaticDestinations-ms", sha256: "d".repeat(64), size: 2560 },
      { path: "CustomDestinations/existing.customDestinations-ms", sha256: "b".repeat(64), size: 12 }
    ] }] };
    expect(classifyJumpListComProgress({ candidate: { appData: "C:\\real", relativePath: "AutomaticDestinations/recovery.automaticDestinations-ms" }, current: j0, j0 })).toBe("com-not-applied");
    expect(classifyJumpListComProgress({ candidate: { appData: "C:\\real", relativePath: "AutomaticDestinations/recovery.automaticDestinations-ms" }, current: j1, j0 })).toBe("com-applied");
    expect(() => classifyJumpListComProgress({ candidate: { appData: "C:\\real", relativePath: "AutomaticDestinations/recovery.automaticDestinations-ms" }, current: concurrentWrite, j0 })).toThrow(/COM retry state changed/u);
  });

  it("refuses deletion of a shortcut pathname that existed in the full S1 root", () => {
    const s1 = { roots: [
      { appData: "C:\\real", files: [{ path: "retargeted.lnk", sha256: "a".repeat(64), size: 4 }] },
      { appData: "C:\\isolated", files: [] }
    ] };
    expect(() => assertWindowsShellDeletionCandidatesAbsentAtS1(s1, [{ appData: "C:\\real", relativePath: "retargeted.lnk" }])).toThrow(/S1-pre-existing shortcut/u);
    expect(() => assertWindowsShellDeletionCandidatesAbsentAtS1(s1, [{ appData: "C:\\isolated", relativePath: "new-target.lnk" }])).not.toThrow();
    expect(() => assertWindowsShellDeletionCandidatesAbsentAtS1(s1, [{ appData: "C:\\missing", relativePath: "new-target.lnk" }])).toThrow(/No S1 shell root/u);
    expect(() => assertWindowsShellDeletionCandidatesAbsentAtS1(s1, [{ appData: "C:\\isolated", relativePath: "not-a-link.txt" }])).toThrow(/non-shortcut/u);
  });

  it("derives only exact top-level Recent candidates and rejects traversal", () => {
    const recentRoot = "C:\\owned\\Recent";
    expect(deriveWindowsShellDeletionCandidate({ appData: "C:\\owned", recentRoot, candidatePath: "C:\\owned\\Recent\\new-target.lnk" })).toEqual({ appData: "C:\\owned", relativePath: "new-target.lnk" });
    expect(() => deriveWindowsShellDeletionCandidate({ appData: "C:\\owned", recentRoot, candidatePath: "C:\\owned\\Recent\\..\\outside.lnk" })).toThrow(/outside its exact root|path traversal/u);
    expect(() => deriveWindowsShellDeletionCandidate({ appData: "C:\\owned", recentRoot, candidatePath: "C:\\owned\\Recent\\nested\\new-target.lnk" })).toThrow(/outside its exact root/u);
    expect(() => deriveWindowsShellDeletionCandidate({ appData: "C:\\owned", recentRoot, candidatePath: "C:\\owned\\Recent\\not-a-link.txt" })).toThrow(/non-shortcut/u);
  });

  it("fails every removal and new or changed non-opaque shell file", () => {
    const before = { roots: [{ appData: "C:\\real", files: [
      { path: "CustomDestinations/existing.customDestinations-ms", sha256: "a".repeat(64), size: 12 },
      { path: "exact-target.lnk", sha256: "b".repeat(64), size: 4 }
    ] }] };
    const after = { roots: [{ appData: "C:\\real", files: [
      { path: "exact-target.lnk", sha256: "c".repeat(64), size: 4 },
      { path: "unexpected.txt", sha256: "d".repeat(64), size: 1 },
      { path: "CustomDestinations/new.customDestinations-ms", sha256: "e".repeat(64), size: 12 }
    ] }] };
    const classification = classifyWindowsShellStateChanges(before, after, { allowNewRecoveryAutomaticDestination: true });
    expect(classification.allowedOpaqueModifications).toHaveLength(0);
    expect(classification.newRecoveryAutomaticDestinations).toHaveLength(0);
    expect(classification.violations).toHaveLength(4);
    expect(() => assertWindowsShellClassificationClean(classification, "removal/new/non-opaque")).toThrow(/unsafe Windows shell changes/u);
  });

  it("requires an empty exact-target Recent-link baseline before Recent mode", () => {
    expect(() => requireNoTestOwnedRecentShortcuts([])).not.toThrow();
    expect(() => requireNoTestOwnedRecentShortcuts(["C:\\real\\Recent\\Jump List.lnk"])).toThrow(/S1 contains matching test-owned Recent shortcuts/u);
  });

  it("requires explicit exact-process proof, failure-free finalization, and S1 cleanup before deletion", () => {
    const base = { checkpointCaptured: true, exactProcessAbsenceProven: true, finalizationFailuresAbsent: true, journeyFailedAfterCheckpoint: false, shellCheckpointRestored: true, sidecarDurabilityProven: true };
    expect(recoveryArtifactsMayBeCleanedAfterShellCheckpoint({ ...base, exactProcessAbsenceProven: false })).toBe(false);
    expect(recoveryArtifactsMayBeCleanedAfterShellCheckpoint({ ...base, finalizationFailuresAbsent: false })).toBe(false);
    expect(recoveryArtifactsMayBeCleanedAfterShellCheckpoint({ ...base, shellCheckpointRestored: false })).toBe(false);
    expect(recoveryArtifactsMayBeCleanedAfterShellCheckpoint({ ...base, journeyFailedAfterCheckpoint: true })).toBe(false);
    expect(recoveryArtifactsMayBeCleanedAfterShellCheckpoint({ ...base, sidecarDurabilityProven: false })).toBe(false);
    expect(recoveryArtifactsMayBeCleanedAfterShellCheckpoint(base)).toBe(true);
    expect(recoveryArtifactsMayBeCleanedAfterShellCheckpoint({ ...base, checkpointCaptured: false, shellCheckpointRestored: false })).toBe(true);
  });

  it("requires a separate explicit approval before pointer/taskbar shell interaction", () => {
    expect(() => requireShellUiApproval({})).toThrow(/shell interaction is disabled/u);
    expect(() => requireShellUiApproval({ [SHELL_UI_APPROVAL]: SHELL_UI_APPROVAL_VALUE })).not.toThrow();
  });

  it("refuses app-scoped COM destination cleanup before any COM work without both approvals", async () => {
    await expect(removeRecoveryShellAutomaticDestinations("0123456789abcdef0123456789abcdef", {})).rejects.toThrow(/requires both explicit/u);
  });

  it("accepts recovery shell identity only for the disposable journey profile shape", () => {
    const token = "0123456789abcdef0123456789abcdef";
    const root = path.join(os.tmpdir(), "ether-recovery-journey-contract");
    const appData = path.join(root, "AppData", "Roaming");
    const userData = path.join(root, "AppData", "Local", "Ether-Recovery-Profile");
    expect(resolveRecoveryShellIdentity({ appData, argv: [`${RECOVERY_SHELL_IDENTITY_ARGUMENT}${token}`], platform: "win32", tempRoot: os.tmpdir(), userData })).toEqual({
      appUserModelId: `com.dreambay.ether.recovery.${token}`,
      recentEnabled: false,
      taskbarName: "Ether Recovery 01234567",
      token
    });
    const approvals = {
      [SHELL_UI_APPROVAL]: SHELL_UI_APPROVAL_VALUE,
      [ASSOCIATION_APPROVAL]: ASSOCIATION_APPROVAL_VALUE
    };
    const recentArgv = [`${RECOVERY_SHELL_RECENT_ARGUMENT}${token}`, `${RECOVERY_SHELL_JOURNEY_ARGUMENT}${RECOVERY_SHELL_JUMP_LIST_JOURNEY}`];
    expect(resolveRecoveryShellIdentity({ appData, argv: recentArgv, environment: approvals, isPackaged: true, platform: "win32", tempRoot: os.tmpdir(), userData })?.recentEnabled).toBe(true);
    expect(() => resolveRecoveryShellIdentity({ appData, argv: recentArgv, environment: {}, isPackaged: true, platform: "win32", tempRoot: os.tmpdir(), userData })).toThrow(/requires the packaged approved/u);
    expect(() => resolveRecoveryShellIdentity({ appData, argv: [`${RECOVERY_SHELL_RECENT_ARGUMENT}${token}`], environment: approvals, isPackaged: true, platform: "win32", tempRoot: os.tmpdir(), userData })).toThrow(/requires the packaged approved/u);
    expect(() => resolveRecoveryShellIdentity({ appData, argv: [`${RECOVERY_SHELL_RECENT_ARGUMENT}${token}`, `${RECOVERY_SHELL_JOURNEY_ARGUMENT}wrong`], environment: approvals, isPackaged: true, platform: "win32", tempRoot: os.tmpdir(), userData })).toThrow(/requires the packaged approved/u);
    expect(() => resolveRecoveryShellIdentity({ appData, argv: recentArgv, environment: approvals, isPackaged: false, platform: "win32", tempRoot: os.tmpdir(), userData })).toThrow(/requires the packaged approved/u);
    expect(() => resolveRecoveryShellIdentity({ appData: process.env.APPDATA, argv: [`${RECOVERY_SHELL_IDENTITY_ARGUMENT}${token}`], platform: "win32", tempRoot: os.tmpdir(), userData: path.join(os.tmpdir(), "Ether") })).toThrow(/non-disposable profile/u);
    expect(() => assertPackagedJourneyArgs([`${RECOVERY_SHELL_IDENTITY_ARGUMENT}${token}`])).toThrow(/driver-owned isolation/u);
    expect(() => assertPackagedJourneyArgs([`${RECOVERY_SHELL_RECENT_ARGUMENT}${token}`])).toThrow(/driver-owned isolation/u);
    expect(() => assertPackagedJourneyArgs([`${RECOVERY_SHELL_JOURNEY_ARGUMENT}${RECOVERY_SHELL_JUMP_LIST_JOURNEY}`])).toThrow(/driver-owned isolation/u);

    const profile = { root, appData, localAppData: path.join(root, "AppData", "Local"), userData, kind: "fresh-isolated" as const };
    const contenderUserData = path.join(root, "contender", "Ether-Recovery-Profile");
    expect(resolveRecoveryShellIdentity({ appData, argv: [`${RECOVERY_SHELL_IDENTITY_ARGUMENT}${token}`], platform: "win32", tempRoot: os.tmpdir(), userData: contenderUserData })?.token).toBe(token);
    expect(() => resolveRecoveryShellIdentity({ appData, argv: [`${RECOVERY_SHELL_IDENTITY_ARGUMENT}${token}`], platform: "win32", tempRoot: os.tmpdir(), userData: path.join(root, "contender-user-data") })).toThrow(/non-disposable profile/u);
    const permitted = { ...packagedJourneyConfig("C:\\repo", "a02-windows-jump-list"), profile, cleanupProfile: false, recoveryShellRecent: true };
    expect(() => assertRecoveryShellRecentAdmission(permitted, approvals)).not.toThrow();
    expect(() => assertRecoveryShellRecentAdmission({ ...permitted, journeyId: "other" }, approvals)).toThrow(/restricted/u);
    expect(() => assertRecoveryShellRecentAdmission({ ...permitted, mode: "source-electron" }, approvals)).toThrow(/restricted/u);
    expect(() => assertRecoveryShellRecentAdmission({ ...permitted, cleanupProfile: true }, approvals)).toThrow(/restricted/u);
    expect(() => assertRecoveryShellRecentAdmission(permitted, {})).toThrow(/restricted/u);
  });

  it("deletes only named disposable roots below a driver-created test root", async () => {
    const root = await createWindowsIntegrationRoot();
    const outside = await mkdtemp(path.join(os.tmpdir(), "ether-a02-outside-"));
    try {
      const cache = path.join(root, "profile", "cache");
      const staging = path.join(root, "profile", "provider-staging");
      const liveOutput = path.join(root, "profile", "live-output");
      await Promise.all([mkdir(cache, { recursive: true }), mkdir(staging, { recursive: true }), mkdir(liveOutput, { recursive: true })]);
      await removeTestOwnedDisposableRoots(root, [cache, staging, liveOutput]);
      await expect(removeTestOwnedDisposableRoots(root, [outside])).rejects.toThrow(/outside the test-owned root/u);
      await expect(removeTestOwnedDisposableRoots(root, [path.join(root, "profile", "documents")])).rejects.toThrow(/non-disposable/u);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

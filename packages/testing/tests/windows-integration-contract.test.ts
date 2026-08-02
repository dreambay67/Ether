import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  RECOVERY_SHELL_CLEANUP_ARGUMENT,
  RECOVERY_SHELL_IDENTITY_ARGUMENT,
  resolveRecoveryShellIdentity
} from "../../../apps/desktop/src/main/recoveryShellIdentity.js";
import { assertPackagedJourneyArgs } from "../recovery/journeyDriver.js";

import {
  A02_WINDOWS_INTEGRATION_COVERAGE,
  ASSOCIATION_APPROVAL,
  ASSOCIATION_APPROVAL_VALUE,
  ETHER_EXTENSION_KEY,
  SHELL_UI_APPROVAL,
  SHELL_UI_APPROVAL_VALUE,
  createWindowsIntegrationRoot,
  isAssociationMutationApproved,
  removeTestOwnedDisposableRoots,
  requireAssociationMutationApproval,
  requireShellUiApproval
} from "../recovery/windowsIntegration.js";

describe("A02 Windows integration harness contracts", () => {
  it("isolates recovery AUMIDs without custom or globally cleared Jump Lists", async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const [bootstrap, main, cleanup] = await Promise.all([
      readFile(path.join(repositoryRoot, "apps/desktop/src/main/bootstrap.ts"), "utf8"),
      readFile(path.join(repositoryRoot, "apps/desktop/src/main/main.ts"), "utf8"),
      readFile(path.join(repositoryRoot, "packages/testing/recovery/windowsShellDestinations.ts"), "utf8")
    ]);
    expect(bootstrap).not.toMatch(/setJumpList|clearRecentDocuments/u);
    expect(main).toContain('if (!credentialOnly && recoveryShell === null) app.setJumpList([{ type: "recent" }]);');
    expect(main).not.toContain("clearRecentDocuments");
    expect(cleanup).toMatch(/12337d35-94c6-48a0-bce7-6a9c69d4d600/iu);
    expect(cleanup).toMatch(/86c14003-4d6b-4ef3-a7b4-0506663b2e68/iu);
    expect(cleanup).toMatch(/SetAppID\(appId\).*RemoveAllDestinations/su);
    expect(cleanup).not.toMatch(/SHAddToRecentDocs|setJumpList/u);
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

  it("requires a separate explicit approval before pointer/taskbar shell interaction", () => {
    expect(() => requireShellUiApproval({})).toThrow(/shell interaction is disabled/u);
    expect(() => requireShellUiApproval({ [SHELL_UI_APPROVAL]: SHELL_UI_APPROVAL_VALUE })).not.toThrow();
  });

  it("accepts recovery shell identity only for the disposable journey profile shape", () => {
    const token = "0123456789abcdef0123456789abcdef";
    const root = path.join(os.tmpdir(), "ether-recovery-journey-contract");
    const appData = path.join(root, "AppData", "Roaming");
    const userData = path.join(root, "AppData", "Local", "Ether-Recovery-Profile");
    expect(resolveRecoveryShellIdentity({ appData, argv: [`${RECOVERY_SHELL_IDENTITY_ARGUMENT}${token}`], platform: "win32", tempRoot: os.tmpdir(), userData })).toEqual({
      appUserModelId: `com.dreambay.ether.recovery.${token}`,
      cleanupOnly: false,
      taskbarName: "Ether Recovery 01234567",
      token
    });
    expect(resolveRecoveryShellIdentity({ appData, argv: [`${RECOVERY_SHELL_CLEANUP_ARGUMENT}${token}`], platform: "win32", tempRoot: os.tmpdir(), userData })?.cleanupOnly).toBe(true);
    expect(() => resolveRecoveryShellIdentity({ appData: process.env.APPDATA, argv: [`${RECOVERY_SHELL_IDENTITY_ARGUMENT}${token}`], platform: "win32", tempRoot: os.tmpdir(), userData: path.join(os.tmpdir(), "Ether") })).toThrow(/non-disposable profile/u);
    expect(() => assertPackagedJourneyArgs([`${RECOVERY_SHELL_IDENTITY_ARGUMENT}${token}`])).toThrow(/driver-owned isolation/u);
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

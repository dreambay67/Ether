import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  A02_WINDOWS_INTEGRATION_COVERAGE,
  ASSOCIATION_APPROVAL,
  ASSOCIATION_APPROVAL_VALUE,
  ETHER_EXTENSION_KEY,
  createWindowsIntegrationRoot,
  isAssociationMutationApproved,
  removeTestOwnedDisposableRoots,
  requireAssociationMutationApproval
} from "../recovery/windowsIntegration.js";

describe("A02 Windows integration harness contracts", () => {
  it("declares only representative packaged coverage and names the remaining Windows gaps", () => {
    expect(A02_WINDOWS_INTEGRATION_COVERAGE.packagedRepresentatives).toEqual(expect.arrayContaining([
      "AC-A02-010", "AC-A02-011", "AC-A02-013", "AC-A02-018", "AC-A02-020", "AC-A02-026"
    ]));
    expect(A02_WINDOWS_INTEGRATION_COVERAGE.focusedAutomation).toHaveLength(15);
    expect(A02_WINDOWS_INTEGRATION_COVERAGE.knownPackagedGaps.join("\n")).toMatch(/drag\/drop|Jump List|removable-drive/iu);
    expect(ETHER_EXTENSION_KEY).toBe("HKCU\\Software\\Classes\\.ether");
  });

  it("requires explicit main-worker approval before any association mutation", () => {
    expect(isAssociationMutationApproved({})).toBe(false);
    expect(() => requireAssociationMutationApproval({})).toThrow(/dry-run only/u);
    expect(isAssociationMutationApproved({ [ASSOCIATION_APPROVAL]: ASSOCIATION_APPROVAL_VALUE })).toBe(true);
    expect(() => requireAssociationMutationApproval({ [ASSOCIATION_APPROVAL]: ASSOCIATION_APPROVAL_VALUE })).not.toThrow();
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

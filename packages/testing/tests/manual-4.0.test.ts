import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nodeLibraryItems } from "@ether/graph-kernel";
import { describe, expect, it } from "vitest";

import { assertAuthoringJourneySourceSafety } from "../recovery/journeyDriver.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (relative: string) => readFile(path.join(root, relative), "utf8");

describe("Ether 4.0 recovery manual", () => {
  it("binds every screenshot to a passing exact-package action journey", async () => {
    const { validateRecoveryManualEvidence } = await import("../../../docs/manual/recovery-evidence.mjs");
    const { manifest, captures } = await validateRecoveryManualEvidence(root, { verifyPackageFiles: false });

    expect(manifest.source).toBe("packaged-blank-document-journeys");
    expect(manifest.sourceProfile).toBe("fresh-isolated");
    expect(captures).toHaveLength(13);
    expect(new Set(captures.map((capture: { sourceResult: string }) => capture.sourceResult))).toEqual(new Set([
      "docs/evidence/ether-4.0-recovery/phase-1/blank-gui-checkpoint/packaged/result.json",
      "docs/evidence/ether-4.0-recovery/phase-5/manual-packaged/packaged/result.json"
    ]));
    expect(captures.every((capture: { actionSequence: number; sha256: string; width: number; height: number }) =>
      capture.actionSequence > 0 && /^[a-f0-9]{64}$/u.test(capture.sha256) && capture.width >= 300 && capture.height >= 100
    )).toBe(true);
  });

  it("derives node coverage from the live registry and omits retired commands", async () => {
    const manual = await read("docs/product/ether-4.0-user-manual.md");
    const nodeSection = manual.slice(manual.indexOf("### Canonical nodes and controls"), manual.indexOf("## Run plans, batches, and Job Center"));
    const documentedIds = [...nodeSection.matchAll(/\(`([a-z]+\.[a-z]+)`\)/gu)].map((match) => match[1]);
    expect(documentedIds).toEqual(nodeLibraryItems.map((item) => item.definitionId));

    const headings = [...manual.matchAll(/^## (.+)$/gmu)].map((match) => match[1]);
    expect(headings).toEqual([
      "Contents",
      "Start safely",
      "Workspaces",
      "Documents, references, and recovery",
      "Canvas, nodes, connections, and Inspector",
      "Run plans, batches, and Job Center",
      "Review, collections, and export",
      "Providers and intelligent work",
      "Recipes and Codex plugin",
      "Settings, accessibility, and privacy",
      "Examples",
      "Reference index"
    ]);
    for (const retired of ["Historical rejected-candidate manual", "Quick prompt", "Quick image", "Run Branch", "Refresh Upstream", "Run Recipe", "A Group is visual organization only"]) {
      expect(manual).not.toContain(retired);
    }
  });

  it("keeps the default manual route inside the safe packaged GUI boundary", async () => {
    const [packageText, readme, spec, build, verify] = await Promise.all([
      read("package.json"),
      read("docs/manual/README.md"),
      read("packages/testing/tests/recovery/manual-recovery.spec.ts"),
      read("docs/manual/build-pdf.mjs"),
      read("docs/manual/verify-manual.py")
    ]);
    const scripts = JSON.parse(packageText).scripts as Record<string, string>;
    expect(scripts["manual:capture"]).toBe("pnpm test:gui-checkpoint:packaged && pnpm test:manual-recovery:packaged && pnpm manual:manifest");
    expect(scripts["manual:installed:capture"]).toBe("node docs/manual/capture-release.mjs");
    expect(scripts["manual:capture"]).not.toContain("installed");
    expect(scripts["manual:capture"]).not.toContain("capture-release");
    assertAuthoringJourneySourceSafety(spec, "manual recovery spec");
    expect(readme).toContain("must not run them");
    expect(build).toContain("validateRecoveryManualEvidence");
    expect(verify).toContain("packaged-blank-document-journeys");
  });
});

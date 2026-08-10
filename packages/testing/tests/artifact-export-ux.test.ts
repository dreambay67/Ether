import { describe, expect, it } from "vitest";
import { OutputExportConfigSchema } from "../../../packages/schema/src/nodes";
import { reconcileArtifactSelection } from "../../../apps/desktop/src/renderer/artifacts/ArtifactBrowser";
import { persistedExportFolderDisplayName } from "../../../apps/desktop/src/renderer/canvas/inspector/RegistryConfigFields";

describe("artifact and export UX contracts", () => {
  it("reconciles selected artifact IDs against the currently visible filtered results", () => {
    expect(reconcileArtifactSelection(["artifact-visible", "artifact-hidden", "artifact-stale"], ["artifact-visible"])).toEqual(["artifact-visible"]);
    expect(reconcileArtifactSelection(["artifact-visible", "artifact-visible"], ["artifact-visible"])).toEqual(["artifact-visible"]);
  });

  it("keeps the export folder identity as a safe display label", () => {
    const config = OutputExportConfigSchema.parse({
      kind: "output.export",
      pathGrantId: "grant-export",
      pathGrantDisplayName: "Review Exports",
      namingTemplate: "{node}-{index}",
      format: "original",
      collisionPolicy: "rename",
      includeMetadata: true
    });
    expect(persistedExportFolderDisplayName(config.pathGrantDisplayName)).toBe("Review Exports");
    expect(OutputExportConfigSchema.safeParse({ ...config, pathGrantDisplayName: String.raw`C:\Users\deny7\Review Exports` }).success).toBe(false);
    expect(persistedExportFolderDisplayName(undefined, "Choose export folder…")).toBe("Choose export folder…");
  });
});

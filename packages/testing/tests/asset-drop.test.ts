import { describe, expect, it } from "vitest";
import { linkDroppedReferenceFilesSequentially } from "../../../apps/desktop/src/renderer/canvas/assetDrop";

describe("asset drop helpers", () => {
  it("links dropped reference files sequentially to avoid linked-index read/write races", async () => {
    const activeCalls: string[] = [];
    const completedCalls: string[] = [];

    const assets = await linkDroppedReferenceFilesSequentially("project-1", ["first.png", "second.png"], async (
      projectId,
      filePath
    ) => {
      expect(projectId).toBe("project-1");
      expect(activeCalls).toEqual(completedCalls);
      activeCalls.push(filePath);
      await Promise.resolve();
      completedCalls.push(filePath);
      return { id: filePath, kind: "reference", path: filePath, metadata: {}, createdAt: "", updatedAt: "" };
    });

    expect(assets.map((asset) => asset.id)).toEqual(["first.png", "second.png"]);
    expect(completedCalls).toEqual(["first.png", "second.png"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  classifyCanvasFileDrop,
  importReferenceFilesSequentially
} from "../../../apps/desktop/src/renderer/canvas/commands/useDropCommands";

describe("canvas reference drop routing", () => {
  it("imports ordinary files in order while preserving .ether pass-through", async () => {
    const files = [
      { name: "moodboard.png" },
      { name: "brief.txt" }
    ] as File[];
    expect(classifyCanvasFileDrop(files)).toBe("reference");
    expect(classifyCanvasFileDrop([{ name: "saved.ether" }])).toBe("document");
    expect(classifyCanvasFileDrop([])).toBe("none");

    const imported: string[] = [];
    const results = await importReferenceFilesSequentially(files, async (file) => {
      imported.push(file.name);
      return { cancelled: false, referenceId: `linked:${file.name}` };
    });
    expect(imported).toEqual(["moodboard.png", "brief.txt"]);
    expect(results).toHaveLength(2);
  });
});

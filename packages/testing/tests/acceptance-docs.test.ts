import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");

describe("Phase 11 acceptance documentation", () => {
  it("documents packaging, settings, recovery, visual QA, and the full manual workflow", async () => {
    const document = await readFile(
      path.join(root, "docs/product/phase-11-acceptance.md"),
      "utf8"
    );

    expect(document).toContain("pnpm desktop:package:win");
    expect(document).toContain("Local Settings");
    expect(document).toContain("Provider Failure Recovery");
    expect(document).toContain("Visual QA");
    expect(document).toContain("Manual Acceptance Workflow");
    expect(document).toContain("ChatGPT Image 2");
    expect(document).toContain("Execute selected node from Codex on explicit command");
  });
});

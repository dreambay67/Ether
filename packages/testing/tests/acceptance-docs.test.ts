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
    expect(document).not.toContain("better-sqlite3");
    expect(document).toContain("node:sqlite");
  });

  it("states that Ether 2.0 supersedes and extends the Phase 11 path", async () => {
    const document = await readFile(
      path.join(root, "docs/product/phase-11-acceptance.md"),
      "utf8"
    );

    expect(document).toContain("Ether 2.0 supersedes and extends this Phase 11 path");
    expect(document).toContain("docs/product/ether-2.0-acceptance.md");
  });
});

describe("Ether 2.0 acceptance documentation", () => {
  it("documents the public-grade Windows acceptance workflow and safety gates", async () => {
    const document = await readFile(
      path.join(root, "docs/product/ether-2.0-acceptance.md"),
      "utf8"
    );

    for (const expected of [
      "create project",
      "check providers",
      "add prompt/reference/generation",
      "preview run",
      "generate real asset when provider is available",
      "branch to edit",
      "draw mask",
      "compare",
      "evaluate",
      "filter to collection",
      "reopen project",
      "recover failed job",
      "inspect lineage",
      "Codex propose branch and apply diff",
      "Project Health/privacy cleanup",
      "no hidden API fallback",
      "Codex CLI default",
      "API providers opt-in only",
      "package shape",
      "manual source"
    ]) {
      expect(document.toLowerCase()).toContain(expected.toLowerCase());
    }
  });

  it("guards the exact public acceptance gate commands", async () => {
    const document = await readFile(
      path.join(root, "docs/product/ether-2.0-acceptance.md"),
      "utf8"
    );

    expect(document).toContain("pnpm test");
    expect(document).toContain("pnpm desktop:build");
    expect(document).toContain("pnpm desktop:package:win");
    expect(document).toContain("pnpm acceptance:smoke");
    expect(document).toContain("packaged Electron UI smoke");
  });
});

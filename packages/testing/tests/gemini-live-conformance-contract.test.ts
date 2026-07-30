import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (relative: string) => readFile(path.join(root, relative), "utf8");

describe("Gemini paid live-conformance contract", () => {
  it("uses only the protected main-process store and enforces a conservative per-run image ceiling", async () => {
    const [bootstrap, runner] = await Promise.all([
      read("apps/desktop/src/main/bootstrap.ts"),
      read("apps/desktop/src/main/geminiLiveConformance.ts")
    ]);

    expect(bootstrap).toContain('process.argv.includes("--validate-gemini-live")');
    expect(bootstrap).toContain("app.exit(1)");
    expect(runner).toContain("const INTERNAL_RUN_GENERATED_IMAGE_LIMIT = 8");
    expect(runner).toContain("const PLANNED_GENERATED_IMAGES = 8");
    expect(runner).toContain("if (PLANNED_GENERATED_IMAGES > INTERNAL_RUN_GENERATED_IMAGE_LIMIT)");
    expect(runner).toContain("credentialState: \"verified\"");
    expect(runner).toContain("createGeminiCredentialStore");
    expect(runner).toContain("searchGrounding: false");
    expect(runner).toContain("imageSearchGrounding: false");
    expect(runner).not.toContain("process.env");
    expect(runner).not.toMatch(/\btools\s*:/u);
    const publicSummary = runner.slice(runner.indexOf("function publicSummary"));
    expect(publicSummary).not.toContain("evidencePath");
  });

  it("records only redacted conformance facts, never credentials or prompts, in evidence results", async () => {
    const runner = await read("apps/desktop/src/main/geminiLiveConformance.ts");
    const evidenceType = runner.slice(
      runner.indexOf("type LiveEvidence"),
      runner.indexOf("export async function runGeminiLiveConformance")
    );
    const resultType = runner.slice(
      runner.indexOf("type ConformanceResult"),
      runner.indexOf("type LiveEvidence")
    );

    expect(`${evidenceType}\n${resultType}`).not.toMatch(/apiKey|credentialValue|prompt|instruction|sourcePath|assetPath/u);
    expect(resultType).toContain('state: "passed" | "failed"');
    expect(resultType).toContain("sha256: string");
    expect(resultType).toContain("code: string");
    expect(resultType).toContain("category: string");
  });
});

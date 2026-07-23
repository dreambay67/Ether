import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const self = path.resolve(import.meta.filename);
const sourceExtensions = new Set([
  ".cjs",
  ".css",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml"
]);
const ignoredSegments = new Set(["dist", "node_modules", "tmp"]);

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return ignoredSegments.has(entry.name) ? [] : filesUnder(target);
    }
    return sourceExtensions.has(path.extname(entry.name)) ? [target] : [];
  }));
  return nested.flat();
}

async function existingFiles(candidates: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      files.push(candidate);
    } catch {
      // Optional workspace configuration is absent.
    }
  }
  return files;
}

async function scan(
  files: readonly string[],
  rules: ReadonlyArray<{ label: string; pattern: RegExp }>
): Promise<string[]> {
  const violations: string[] = [];
  for (const file of files) {
    if (path.resolve(file) === self) continue;
    const source = await readFile(file, "utf8");
    for (const rule of rules) {
      if (rule.pattern.test(source)) {
        violations.push(`${path.relative(workspaceRoot, file)}: ${rule.label}`);
      }
    }
  }
  return violations;
}

describe("Ether 4.0 legacy retirement", () => {
  it("has no legacy engine package, renderer path helper, or folder-project fixtures", async () => {
    const retired = [
      "packages/engine/package.json",
      "apps/desktop/src/renderer/artifacts/localImageSource.ts",
      "packages/testing/fixtures/legacy-isolation/workspace-entry.ts"
    ];
    for (const relativePath of retired) {
      await expect(access(path.join(workspaceRoot, relativePath))).rejects.toThrow();
    }
  });

  it("contains no engine imports or package references in source and test code", async () => {
    const files = [
      ...await filesUnder(path.join(workspaceRoot, "apps")),
      ...await filesUnder(path.join(workspaceRoot, "packages")),
      ...await filesUnder(path.join(workspaceRoot, "scripts")),
      ...await existingFiles([
        path.join(workspaceRoot, "package.json"),
        path.join(workspaceRoot, "pnpm-lock.yaml"),
        path.join(workspaceRoot, "pnpm-workspace.yaml")
      ])
    ];
    expect(await scan(files, [
      { label: "legacy @ether/engine dependency or import", pattern: /@ether\/engine/u }
    ])).toEqual([]);
  });

  it("keeps production, delivery, MCP, plugin, and test configuration on 4.0 contracts", async () => {
    const productionFiles = [
      ...await filesUnder(path.join(workspaceRoot, "apps", "desktop", "src")),
      ...await filesUnder(path.join(workspaceRoot, "packages", "application", "src")),
      ...await filesUnder(path.join(workspaceRoot, "packages", "document", "src")),
      ...await filesUnder(path.join(workspaceRoot, "packages", "execution", "src")),
      ...await filesUnder(path.join(workspaceRoot, "packages", "graph-kernel", "src")),
      ...await filesUnder(path.join(workspaceRoot, "packages", "mcp-server")),
      ...await filesUnder(path.join(workspaceRoot, "packages", "providers", "src")),
      ...await filesUnder(path.join(workspaceRoot, "packages", "codex-plugin")),
      ...await filesUnder(path.join(workspaceRoot, "scripts")),
      ...await existingFiles([
        path.join(workspaceRoot, "package.json"),
        path.join(workspaceRoot, "pnpm-workspace.yaml"),
        path.join(workspaceRoot, "apps", "desktop", "package.json"),
        path.join(workspaceRoot, "apps", "desktop", "vite.config.ts"),
        path.join(workspaceRoot, "packages", "testing", "package.json"),
        path.join(workspaceRoot, "packages", "testing", "testSuites.ts"),
        path.join(workspaceRoot, "packages", "testing", "vitest.config.ts"),
        path.join(workspaceRoot, "packages", "testing", "vitest.integration.config.ts"),
        path.join(workspaceRoot, "packages", "testing", "vitest.performance.config.ts")
      ])
    ];
    expect(await scan(productionFiles, [
      { label: "legacy CanvasNodeData contract", pattern: /\bCanvasNodeData\b/u },
      { label: "Ether 2.5 graph alias", pattern: /(?:["']2\.5["']|\bEther 2\.5\b|2\.5 Node Role Channel Model)/u },
      { label: "directory-project API", pattern: /\b(?:createProject|openProject|ProjectStore|projectPath)\b/u },
      { label: "directory-project metadata", pattern: /\b(?:project\.json|graph\.json|ether\.db)\b/u },
      { label: "legacy project-path MCP tool", pattern: /\bether_project_[a-z_]+\b/u },
      { label: "unrestricted dropped-file path", pattern: /\bdroppedPath\b/u }
    ])).toEqual([]);
  });

  it("renders document media only through the embedded asset protocol", async () => {
    const rendererFiles = await filesUnder(path.join(workspaceRoot, "apps", "desktop", "src", "renderer"));
    expect(await scan(rendererFiles, [
      { label: "raw renderer file URL", pattern: /file:\/\//iu }
    ])).toEqual([]);
    const owner = await readFile(
      path.join(workspaceRoot, "apps", "desktop", "src", "renderer", "artifacts", "embeddedArtifactSource.ts"),
      "utf8"
    );
    expect(owner).toContain("ether-asset://");
  });
});

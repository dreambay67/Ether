import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const activeEntryPoints = [
  "apps/desktop/src/main/main.ts",
  "apps/desktop/src/preload/preload.ts",
  "apps/desktop/src/renderer/main.tsx"
] as const;
const ether40Packages = new Set([
  "@ether/application",
  "@ether/brand",
  "@ether/document",
  "@ether/execution",
  "@ether/graph-kernel",
  "@ether/providers",
  "@ether/schema"
]);
const forbiddenPersistence = [
  { label: "project.json", pattern: /project\.json/iu },
  { label: "graph.json", pattern: /graph\.json/iu },
  { label: "ether.db", pattern: /ether\.db/iu },
  { label: "directory-project creation", pattern: /\bcreateProject\b/u },
  { label: "2.5 migration", pattern: /(?:^|[/\\])project[/\\]migrations?(?:\.[cm]?[jt]sx?)?$/iu }
] as const;

type SourceGraph = {
  files: Set<string>;
  etherImports: Set<string>;
  moduleSpecifiers: Array<{ importer: string; specifier: string }>;
};

async function readRepositoryFile(relativePath: string): Promise<string> {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

function repositoryPath(filePath: string): string {
  return path.relative(repositoryRoot, filePath).replaceAll("\\", "/");
}

function moduleSpecifiers(source: string, filePath: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const result: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      result.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      result.push(node.arguments[0]!.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function sourceCandidates(basePath: string): string[] {
  const extension = path.extname(basePath);
  if ([".js", ".mjs", ".cjs"].includes(extension)) {
    const stem = basePath.slice(0, -extension.length);
    return [`.ts`, `.tsx`, `.mts`, `.cts`].map((candidate) => `${stem}${candidate}`);
  }
  if (extension.length > 0) return [basePath];
  return [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mts`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx")
  ];
}

async function firstExisting(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return null;
}

async function resolveWorkspaceSource(importer: string, specifier: string): Promise<string | null> {
  if (specifier.startsWith(".")) {
    return firstExisting(sourceCandidates(path.resolve(path.dirname(importer), specifier)));
  }
  const workspaceImport = /^@ether\/([^/]+)(?:\/(.+))?$/u.exec(specifier);
  if (workspaceImport === null) return null;
  const [, packageName, subpath] = workspaceImport;
  const sourcePath = path.join(
    repositoryRoot,
    "packages",
    packageName!,
    "src",
    subpath ?? "index"
  );
  return firstExisting(sourceCandidates(sourcePath));
}

async function collectActiveSourceGraph(): Promise<SourceGraph> {
  const pending = activeEntryPoints.map((entry) => path.join(repositoryRoot, entry));
  const graph: SourceGraph = {
    files: new Set(),
    etherImports: new Set(),
    moduleSpecifiers: []
  };
  while (pending.length > 0) {
    const filePath = pending.pop()!;
    const relativePath = repositoryPath(filePath);
    if (graph.files.has(relativePath)) continue;
    graph.files.add(relativePath);
    const source = await readFile(filePath, "utf8");
    for (const specifier of moduleSpecifiers(source, filePath)) {
      graph.moduleSpecifiers.push({ importer: relativePath, specifier });
      const workspacePackage = /^(@ether\/[^/]+)/u.exec(specifier)?.[1];
      if (workspacePackage !== undefined) graph.etherImports.add(workspacePackage);
      const resolved = await resolveWorkspaceSource(filePath, specifier);
      if (resolved !== null) pending.push(resolved);
    }
  }
  return graph;
}

describe("Ether 4.0 legacy isolation", () => {
  it("keeps New, Open, Save, and fake-run source resolution inside 4.0 packages", async () => {
    const graph = await collectActiveSourceGraph();
    const violations: string[] = [];

    for (const workspacePackage of graph.etherImports) {
      if (!ether40Packages.has(workspacePackage)) {
        violations.push(`workspace import ${workspacePackage}`);
      }
    }
    for (const file of graph.files) {
      if (file.startsWith("packages/engine/")) violations.push(`legacy source ${file}`);
      const source = await readRepositoryFile(file);
      for (const forbidden of forbiddenPersistence.slice(0, 4)) {
        if (forbidden.pattern.test(source)) violations.push(`${forbidden.label} in ${file}`);
      }
    }
    for (const { importer, specifier } of graph.moduleSpecifiers) {
      if (forbiddenPersistence[4].pattern.test(specifier)) {
        violations.push(`2.5 migration import ${specifier} from ${importer}`);
      }
    }

    expect([...new Set(violations)].sort()).toEqual([]);
  });

  it("keeps the desktop runtime and build resolver independent of @ether/engine", async () => {
    const manifest = JSON.parse(await readRepositoryFile("apps/desktop/package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const viteConfig = await readRepositoryFile("apps/desktop/vite.config.ts");
    const violations = [
      ...Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
        .filter((dependency) => dependency === "@ether/engine")
        .map((dependency) => `desktop dependency ${dependency}`),
      ...Object.entries(manifest.scripts ?? {})
        .filter(([, command]) => command.includes("@ether/engine"))
        .map(([name]) => `desktop script ${name} invokes @ether/engine`),
      ...(viteConfig.includes("@ether/engine") || viteConfig.includes("packages/engine")
        ? ["desktop Vite resolver aliases the legacy engine"]
        : [])
    ];

    expect(violations.sort()).toEqual([]);
  });
});

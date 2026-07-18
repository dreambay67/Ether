import { realpathSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const repositoryRoot = realpathSync.native(fileURLToPath(new URL("../../..", import.meta.url)));
const desktopRoot = path.join(repositoryRoot, "apps", "desktop");
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
const scriptExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

type DesktopManifest = {
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type WorkspaceManifest = {
  name?: string;
  exports?: unknown;
};

type SourceGraph = {
  files: Set<string>;
  etherImports: Set<string>;
  moduleSpecifiers: Array<{ importer: string; specifier: string }>;
};

const configCache = new Map<string, ts.ParsedCommandLine>();
let workspaceExportsPromise: Promise<Map<string, string>> | undefined;

async function readRepositoryFile(relativePath: string): Promise<string> {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function canonicalFilePath(filePath: string): string {
  try {
    return path.normalize(realpathSync.native(path.resolve(filePath)));
  } catch (error) {
    throw new Error(`Cannot canonicalize missing path ${JSON.stringify(filePath)}.`, { cause: error });
  }
}

function canonicalPathKey(filePath: string): string {
  const canonical = canonicalFilePath(filePath);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function repositoryPath(filePath: string): string {
  const canonical = canonicalFilePath(filePath);
  const relative = path.relative(repositoryRoot, canonical);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Resolved path escapes the repository: ${canonical}`);
  }
  return relative.replaceAll("\\", "/");
}

function parseTsConfig(configPath: string): ts.ParsedCommandLine {
  const canonicalConfig = canonicalFilePath(configPath);
  const key = canonicalPathKey(canonicalConfig);
  const cached = configCache.get(key);
  if (cached !== undefined) return cached;
  const loaded = ts.readConfigFile(canonicalConfig, ts.sys.readFile);
  if (loaded.error !== undefined) throw new Error(formatDiagnostics([loaded.error]));
  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    path.dirname(canonicalConfig),
    undefined,
    canonicalConfig
  );
  if (parsed.errors.length > 0) throw new Error(formatDiagnostics(parsed.errors));
  configCache.set(key, parsed);
  return parsed;
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => process.platform === "win32" ? fileName.toLowerCase() : fileName,
    getCurrentDirectory: () => repositoryRoot,
    getNewLine: () => "\n"
  });
}

function moduleSpecifiers(source: string, filePath: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
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

function exportedTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const conditions = value as Record<string, unknown>;
  for (const condition of ["types", "import", "default", "browser", "require"]) {
    const target = exportedTarget(conditions[condition]);
    if (target !== null) return target;
  }
  return null;
}

function manifestExportEntries(exportsField: unknown): Array<[string, unknown]> {
  if (typeof exportsField === "string") return [[".", exportsField]];
  if (exportsField === null || typeof exportsField !== "object" || Array.isArray(exportsField)) return [];
  const entries = Object.entries(exportsField as Record<string, unknown>);
  return entries.some(([key]) => key.startsWith(".")) ? entries : [[".", exportsField]];
}

function sourceCandidatesForOutput(relativeOutput: string): string[] {
  if (relativeOutput.endsWith(".d.ts")) {
    const stem = relativeOutput.slice(0, -5);
    return [`${stem}.ts`, `${stem}.tsx`];
  }
  if (relativeOutput.endsWith(".d.mts")) return [`${relativeOutput.slice(0, -6)}.mts`];
  if (relativeOutput.endsWith(".d.cts")) return [`${relativeOutput.slice(0, -6)}.cts`];
  const extension = path.extname(relativeOutput);
  const stem = relativeOutput.slice(0, -extension.length);
  if (extension === ".js") return [`${stem}.ts`, `${stem}.tsx`];
  if (extension === ".mjs") return [`${stem}.mts`, `${stem}.ts`];
  if (extension === ".cjs") return [`${stem}.cts`, `${stem}.ts`];
  return [relativeOutput];
}

function sourceForExportTarget(packageRoot: string, target: string): string | null {
  const targetPath = path.resolve(packageRoot, target);
  const configPath = path.join(packageRoot, "tsconfig.json");
  if (ts.sys.fileExists(configPath)) {
    const config = parseTsConfig(configPath);
    const outDir = config.options.outDir;
    const rootDir = config.options.rootDir;
    if (outDir !== undefined && rootDir !== undefined) {
      const relativeOutput = path.relative(outDir, targetPath);
      if (
        relativeOutput !== ".." &&
        !relativeOutput.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativeOutput)
      ) {
        for (const candidate of sourceCandidatesForOutput(relativeOutput)) {
          const sourcePath = path.join(rootDir, candidate);
          if (ts.sys.fileExists(sourcePath)) return canonicalFilePath(sourcePath);
        }
      }
    }
  }
  return ts.sys.fileExists(targetPath) ? canonicalFilePath(targetPath) : null;
}

async function workspaceExportSources(): Promise<Map<string, string>> {
  workspaceExportsPromise ??= loadWorkspaceExportSources();
  return workspaceExportsPromise;
}

async function loadWorkspaceExportSources(): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const workspaceFolder of ["packages", "apps"]) {
    const workspaceRoot = path.join(repositoryRoot, workspaceFolder);
    const entries = await readdir(workspaceRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packageRoot = path.join(workspaceRoot, entry.name);
      const manifestPath = path.join(packageRoot, "package.json");
      if (!ts.sys.fileExists(manifestPath)) continue;
      const manifest = await readJson<WorkspaceManifest>(manifestPath);
      if (manifest.name?.startsWith("@ether/") !== true) continue;
      for (const [exportName, value] of manifestExportEntries(manifest.exports)) {
        if (exportName !== "." && !exportName.startsWith("./")) continue;
        const target = exportedTarget(value);
        if (target === null) continue;
        const source = sourceForExportTarget(packageRoot, target);
        if (source === null) continue;
        const specifier = exportName === "."
          ? manifest.name
          : `${manifest.name}/${exportName.slice(2)}`;
        result.set(specifier, source);
      }
    }
  }
  return result;
}

function tsConfigForSource(filePath: string): string {
  const relative = repositoryPath(filePath);
  if (relative.startsWith("apps/desktop/src/main/") || relative.startsWith("apps/desktop/src/shared/")) {
    return path.join(desktopRoot, "tsconfig.electron.json");
  }
  if (relative.startsWith("apps/desktop/src/preload/")) {
    return path.join(desktopRoot, "tsconfig.preload.json");
  }
  if (relative.startsWith("apps/desktop/src/renderer/")) {
    return path.join(desktopRoot, "tsconfig.renderer.json");
  }
  const packageMatch = /^(packages\/[^/]+)\//u.exec(relative);
  if (packageMatch !== null) return path.join(repositoryRoot, packageMatch[1]!, "tsconfig.json");
  return path.join(repositoryRoot, "tsconfig.base.json");
}

function localAssetFallback(importer: string, specifier: string): string | null {
  const candidate = path.resolve(path.dirname(importer), specifier.split("?", 1)[0]!);
  if (!ts.sys.fileExists(candidate) || scriptExtensions.has(path.extname(candidate))) return null;
  return canonicalFilePath(candidate);
}

async function resolveWorkspaceSource(importer: string, specifier: string): Promise<string | null> {
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const workspacePackage = /^@ether\/[^/]+/u.exec(specifier)?.[0];
  if (!isRelative && workspacePackage === undefined) return null;

  const exports = await workspaceExportSources();
  const exportedSource = workspacePackage === undefined ? undefined : exports.get(specifier);
  if (workspacePackage !== undefined && exportedSource === undefined) {
    throw new Error(
      `Unresolved workspace import ${JSON.stringify(specifier)} from ${repositoryPath(importer)}: ` +
      "the package or subpath is not exported."
    );
  }

  const config = parseTsConfig(tsConfigForSource(importer));
  const paths = Object.fromEntries([...exports].map(([name, source]) => [name, [source]]));
  const resolution = ts.resolveModuleName(
    specifier,
    canonicalFilePath(importer),
    { ...config.options, baseUrl: repositoryRoot, paths: { ...config.options.paths, ...paths } },
    {
      ...ts.sys,
      getCurrentDirectory: () => repositoryRoot,
      realpath: (candidate) => {
        try {
          return realpathSync.native(candidate);
        } catch {
          return candidate;
        }
      }
    }
  );
  let resolved = resolution.resolvedModule?.resolvedFileName;
  if (workspacePackage !== undefined && resolved !== undefined && exportedSource !== undefined) {
    resolved = exportedSource;
  }
  if (resolved === undefined) {
    const asset = exportedSource ?? (isRelative ? localAssetFallback(importer, specifier) : null);
    if (asset !== null && asset !== undefined && !scriptExtensions.has(path.extname(asset))) return asset;
    throw new Error(
      `Unresolved ${workspacePackage === undefined ? "relative" : "workspace"} import ` +
      `${JSON.stringify(specifier)} from ${repositoryPath(importer)} using ` +
      `${repositoryPath(tsConfigForSource(importer))}.`
    );
  }
  return canonicalFilePath(resolved);
}

function compiledEntrySource(outputPath: string, config: ts.ParsedCommandLine): string {
  const outDir = config.options.outDir;
  const rootDir = config.options.rootDir;
  if (outDir === undefined || rootDir === undefined) {
    throw new Error("Desktop Electron TypeScript config must declare rootDir and outDir.");
  }
  const relativeOutput = path.relative(outDir, outputPath);
  if (
    relativeOutput === ".." ||
    relativeOutput.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeOutput)
  ) {
    throw new Error(`Packaged desktop main ${outputPath} is outside TypeScript outDir ${outDir}.`);
  }
  for (const candidate of sourceCandidatesForOutput(relativeOutput)) {
    const sourcePath = path.join(rootDir, candidate);
    if (ts.sys.fileExists(sourcePath)) return canonicalFilePath(sourcePath);
  }
  throw new Error(`No TypeScript source emits packaged desktop main ${outputPath}.`);
}

async function activeEntryPoints(): Promise<string[]> {
  const manifest = await readJson<DesktopManifest>(path.join(desktopRoot, "package.json"));
  if (manifest.main === undefined) throw new Error("Desktop package.json must declare its packaged main entry.");
  const electronConfig = parseTsConfig(path.join(desktopRoot, "tsconfig.electron.json"));
  const packagedMain = compiledEntrySource(path.resolve(desktopRoot, manifest.main), electronConfig);

  const buildElectron = manifest.scripts?.["build:electron"];
  const preloadMatch = buildElectron === undefined
    ? null
    : /(?:^|\s)esbuild\s+(?:"([^"]+)"|'([^']+)'|(\S+))/u.exec(buildElectron);
  const preloadEntry = preloadMatch?.[1] ?? preloadMatch?.[2] ?? preloadMatch?.[3];
  if (preloadEntry === undefined) {
    throw new Error("Desktop build:electron must expose its esbuild preload entry.");
  }

  const html = await readFile(path.join(desktopRoot, "index.html"), "utf8");
  const viteEntries = [...html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)]
    .map((match) => match[1]!)
    .map((source) => path.join(desktopRoot, source.replace(/^\//u, "").split("?", 1)[0]!));
  if (viteEntries.length === 0) throw new Error("Desktop index.html has no Vite module entry.");

  const entries = [
    packagedMain,
    canonicalFilePath(path.resolve(desktopRoot, preloadEntry)),
    ...viteEntries.map(canonicalFilePath)
  ];
  return [...new Map(entries.map((entry) => [canonicalPathKey(entry), entry])).values()];
}

async function collectActiveSourceGraph(): Promise<SourceGraph> {
  const pending = await activeEntryPoints();
  const visited = new Set<string>();
  const graph: SourceGraph = {
    files: new Set(),
    etherImports: new Set(),
    moduleSpecifiers: []
  };
  while (pending.length > 0) {
    const filePath = canonicalFilePath(pending.pop()!);
    const key = canonicalPathKey(filePath);
    if (visited.has(key)) continue;
    visited.add(key);
    const relativePath = repositoryPath(filePath);
    graph.files.add(relativePath);
    const source = await readFile(filePath, "utf8");
    if (!scriptExtensions.has(path.extname(filePath))) continue;
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
  it("starts traversal from the packaged main, preload build, and Vite HTML entries", async () => {
    const graph = await collectActiveSourceGraph();

    expect([...graph.files].sort()).toEqual(expect.arrayContaining([
      "apps/desktop/src/main/bootstrap.ts",
      "apps/desktop/src/preload/preload.ts",
      "apps/desktop/src/renderer/main.tsx",
      "packages/application/src/application.ts"
    ]));
    expect([...graph.files].filter((file) => file.includes("/dist/"))).toEqual([]);
  });

  it("fails closed when a relative or workspace import cannot be resolved", async () => {
    const importer = path.join(repositoryRoot, "apps/desktop/src/renderer/main.tsx");

    await expect(resolveWorkspaceSource(importer, "./missing-local-module.js"))
      .rejects.toThrow(/missing-local-module/u);
    await expect(resolveWorkspaceSource(importer, "@ether/missing-workspace"))
      .rejects.toThrow(/@ether\/missing-workspace/u);
  });

  it("honors workspace package exports instead of exposing arbitrary source subpaths", async () => {
    const importer = path.join(repositoryRoot, "apps/desktop/src/renderer/main.tsx");

    await expect(resolveWorkspaceSource(importer, "@ether/brand/brand.css"))
      .resolves.toMatch(/packages[/\\]brand[/\\]src[/\\]brand\.css$/u);
    await expect(resolveWorkspaceSource(importer, "@ether/schema/nodes"))
      .rejects.toThrow(/@ether\/schema\/nodes/u);
  });

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
    const manifest = await readJson<DesktopManifest>(path.join(desktopRoot, "package.json"));
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

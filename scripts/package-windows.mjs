import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, lstat, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, listPackage, statFile, uncache } from "@electron/asar";

import { createInstallerAssets } from "./create-installer-assets.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const workspaceRoot = path.resolve(scriptDirectory, "..");
export const desktopDirectory = path.join(workspaceRoot, "apps", "desktop");
export const releaseDirectory = path.join(workspaceRoot, "release", "windows");
export const installerFileName = "Ether-4.0.0-Setup.exe";
export const installerPath = path.join(releaseDirectory, installerFileName);
export const unpackedDirectory = path.join(releaseDirectory, "win-unpacked");
export const packagedExecutablePath = path.join(unpackedDirectory, "Ether.exe");
export const releaseAuditFileName = "release-audit.json";
export const stagedInventoryFileName = "release-inventory.json";
export const reviewedBuilderConfigFileName = "electron-builder.generated.yml";
const releaseVersion = "4.0.0";
const allowedReleaseRootEntries = new Set([
  "win-unpacked",
  installerFileName,
  `${installerFileName}.blockmap`,
  reviewedBuilderConfigFileName,
  releaseAuditFileName
]);
const electronBuilderDiagnosticFileNames = [
  "builder-debug.yml",
  "builder-effective-config.yaml",
  "builder-effective-config.yml"
];
const forbiddenDirectoryNames = new Set([
  "__tests__", "doc", "docs", "example", "examples", "source", "src", "test", "tests"
]);
const forbiddenFileExtensions = new Set([
  ".cts", ".db", ".ether", ".jsx", ".key", ".log", ".map", ".markdown", ".md",
  ".mts", ".p12", ".pem", ".pfx", ".sqlite", ".sqlite3", ".ts", ".tsx"
]);
const forbiddenFileNames = new Set([
  ".env", ".env.local", ".npmrc", "auth.json", "credentials.json", "cookies.json",
  "npm-debug.log", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"
]);
const workspacePackages = [
  ["@ether/application", "packages/application"],
  ["@ether/document", "packages/document"],
  ["@ether/execution", "packages/execution"],
  ["@ether/graph-kernel", "packages/graph-kernel"],
  ["@ether/mcp-server", "packages/mcp-server"],
  ["@ether/providers", "packages/providers"],
  ["@ether/recipes", "packages/recipes"],
  ["@ether/schema", "packages/schema"]
];
const workspacePackagePaths = new Map(workspacePackages);

export async function readReleaseMetadata(rootDir = workspaceRoot) {
  const [rootPackage, desktopPackage] = await Promise.all([
    readJson(path.join(rootDir, "package.json")),
    readJson(path.join(rootDir, "apps", "desktop", "package.json"))
  ]);
  return { rootPackage, desktopPackage };
}

export async function assertReleaseInputs(rootDir = workspaceRoot) {
  const inputs = [
    "apps/desktop/dist/index.html",
    "apps/desktop/dist-electron/main/bootstrap.js",
    "apps/desktop/dist-electron/main/main.js",
    "apps/desktop/dist-electron/preload/preload.cjs",
    "apps/desktop/electron-builder.yml",
    "build/installer/ether.ico",
    "build/installer/ether.png",
    "build/installer/dreambay.png"
  ];
  const missing = [];
  for (const relativePath of inputs) {
    try {
      await access(path.join(rootDir, relativePath));
    } catch {
      missing.push(relativePath);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Build the Ether desktop release inputs before packaging. Missing: ${missing.join(", ")}`);
  }
}

export async function packageWindowsApp(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? workspaceRoot);
  const releaseDir = path.join(rootDir, "release", "windows");
  try {
    await createInstallerAssets(rootDir);
    await assertReleaseInputs(rootDir);

    // Stage twice before invoking electron-builder. This proves the release
    // input is deterministic without relying on NSIS timestamps or signatures.
    await prepareProductionRuntime(rootDir);
    let releaseProject = await prepareReleaseProject(rootDir);
    const firstInventory = await createStagedInventory(releaseProject);
    await cleanupReleaseStaging(rootDir);
    await prepareProductionRuntime(rootDir);
    releaseProject = await prepareReleaseProject(rootDir);
    const secondInventory = await createStagedInventory(releaseProject);
    if (firstInventory.hash !== secondInventory.hash) {
      throw new Error(`Release staging is not deterministic: ${firstInventory.hash} != ${secondInventory.hash}.`);
    }
    await assertGeneratedBuilderConfig(releaseProject, rootDir);

    // electron-builder deliberately prunes package metadata and rewrites
    // dependency package.json manifests. Calibrate against a real directory
    // package first instead of pretending the pre-builder tree is the ASAR.
    // The placeholder keeps the builder file set identical while remaining
    // excluded from the recursive inventory it will eventually contain.
    await writeFile(path.join(releaseProject, stagedInventoryFileName), "{}\n");
    await rm(releaseDir, { recursive: true, force: true });
    await runElectronBuilder(rootDir, releaseProject, ["--dir"]);
    const calibratedInventory = await calibratePackagedRelease({
      outputDir: releaseDir,
      sourceInventory: secondInventory,
      sourceRepeatHash: firstInventory.hash
    });
    await writeFile(
      path.join(releaseProject, stagedInventoryFileName),
      `${JSON.stringify(calibratedInventory, null, 2)}\n`
    );

    await rm(releaseDir, { recursive: true, force: true });
    await runElectronBuilder(rootDir, releaseProject, ["--win", "nsis"]);
    await removeElectronBuilderDiagnostics(releaseDir);
    await cp(
      path.join(releaseProject, "electron-builder.yml"),
      path.join(releaseDir, reviewedBuilderConfigFileName)
    );
    const audit = await auditPackagedRelease({
      rootDir,
      outputDir: releaseDir,
      stagedInventory: secondInventory,
      repeatHash: firstInventory.hash,
      calibratedInventory
    });
    return {
      audit,
      releaseDir,
      installerPath: path.join(releaseDir, installerFileName),
      executablePath: path.join(releaseDir, "win-unpacked", "Ether.exe")
    };
  } finally {
    await cleanupReleaseStaging(rootDir);
  }
}

async function runElectronBuilder(rootDir, releaseProject, targetArgs) {
  await run(process.execPath, [
    path.join(rootDir, "node_modules", "electron-builder", "cli.js"),
    "--projectDir",
    releaseProject,
    "--config",
    "electron-builder.yml",
    ...targetArgs,
    "--x64",
    "--publish",
    "never"
  ], rootDir);
}

async function removeElectronBuilderDiagnostics(outputDir) {
  for (const fileName of electronBuilderDiagnosticFileNames) {
    await rm(path.join(outputDir, fileName), { force: true });
  }
}

async function calibratePackagedRelease({ outputDir, sourceInventory, sourceRepeatHash }) {
  const asarPath = path.join(outputDir, "win-unpacked", "resources", "app.asar");
  const archivePayload = inventoryAsarPayload(asarPath);
  const unpackedEntries = await inventoryUnpackedFiles(asarPath);
  assertUnpackedPathSet(archivePayload.unpackedPaths, unpackedEntries);
  return createCalibratedReleaseInventory({
    archiveEntries: archivePayload.entries,
    sourceInventory,
    sourceRepeatHash,
    unpackedEntries
  });
}

export function createCalibratedReleaseInventory({
  archiveEntries,
  sourceInventory,
  sourceRepeatHash = sourceInventory.hash,
  unpackedEntries
}) {
  return {
    algorithm: "sha256",
    entries: archiveEntries,
    hash: hashInventory(archiveEntries),
    repeatHash: hashInventory(archiveEntries),
    sourceEntries: sourceInventory.entries,
    sourceHash: sourceInventory.hash,
    sourceRepeatHash,
    unpackedEntries,
    unpackedHash: hashInventory(unpackedEntries),
    unpackedRepeatHash: hashInventory(unpackedEntries),
    version: releaseVersion
  };
}

/**
 * Build a physical, production-only dependency tree before electron-builder
 * turns it into app.asar. pnpm workspace links point outside the application,
 * so copying them directly would either leak source files or fail at runtime.
 */
export async function prepareProductionRuntime(rootDir = workspaceRoot) {
  const targetRoot = path.join(rootDir, "apps", "desktop", ".release-runtime");
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });
  const state = { copiedTargets: new Set(), rootPackages: new Map() };
  for (const [packageName, sourceRelativePath] of workspacePackages) {
    await copyWorkspacePackage(rootDir, targetRoot, packageName, sourceRelativePath, state);
  }
  // Rewalk the official SDK from its physical root. pnpm may surface it through
  // multiple workspace links; this guarantees its optional/transitive closure
  // is present at the release root rather than relying on a link escape.
  const sdkSource = await realpath(path.join(rootDir, "packages", "mcp-server", "node_modules", "@modelcontextprotocol", "sdk"));
  await copyRuntimePackage(sdkSource, path.join(targetRoot, "@modelcontextprotocol", "sdk"), targetRoot, {
    copiedTargets: new Set(),
    rootPackages: state.rootPackages
  }, new Set());
  await assertProductionRuntime(targetRoot);
  return targetRoot;
}

export async function assertProductionRuntime(targetRoot) {
  const required = [
    "@ether/application/dist/index.js",
    "@ether/document/dist/schema/40000.sql",
    "@ether/providers/protocol/codex-0.144.2/manifest.json",
    "@modelcontextprotocol/sdk/package.json",
    "zod-to-json-schema/package.json",
    "@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.3.node",
    "@img/sharp-win32-x64/lib/libvips-42.dll"
  ];
  const missing = [];
  for (const relativePath of required) {
    try {
      if (!(await stat(path.join(targetRoot, relativePath))).isFile()) missing.push(relativePath);
    } catch {
      missing.push(relativePath);
    }
  }
  if (missing.length > 0) throw new Error(`The staged Ether runtime is incomplete: ${missing.join(", ")}`);
}

export async function cleanupReleaseStaging(rootDir = workspaceRoot) {
  const resolvedRoot = path.resolve(rootDir);
  const targets = [
    path.join(resolvedRoot, "apps", "desktop", ".release-runtime"),
    path.join(resolvedRoot, "apps", "desktop", ".release-project")
  ];
  for (const target of targets) {
    if (!isWithin(resolvedRoot, target)) throw new Error(`Refusing to clean release staging outside ${resolvedRoot}.`);
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

export async function createStagedInventory(projectRoot) {
  const entries = await inventoryFiles(projectRoot, { auditPaths: true });
  const serialized = entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`).join("\n");
  return {
    entries,
    hash: createHash("sha256").update(serialized).digest("hex")
  };
}

export async function assertGeneratedBuilderConfig(
  configDirectory,
  rootDir = workspaceRoot,
  configFileName = "electron-builder.yml"
) {
  const configPath = path.join(configDirectory, configFileName);
  const config = await readFile(configPath, "utf8");
  const normalizedRoot = path.resolve(rootDir).replaceAll("\\", "/").toLocaleLowerCase();
  if (config.replaceAll("\\", "/").toLocaleLowerCase().includes(normalizedRoot)) {
    throw new Error("Generated electron-builder config contains the absolute workspace path.");
  }
  if (/["']?[a-z]:[\\/]/iu.test(config)) {
    throw new Error("Generated electron-builder config contains an absolute Windows path.");
  }
  if (!config.includes("output: ../../../release/windows") || !config.includes("buildResources: ../../../build/installer")) {
    throw new Error("Generated electron-builder config must use reviewed relative release paths.");
  }
  return {
    path: configFileName,
    sha256: createHash("sha256").update(config).digest("hex")
  };
}

/**
 * electron-builder asks npm to discover dependencies from projectDir even when
 * a custom files list is present. A tiny release-only project prevents it from
 * traversing pnpm workspace links while retaining the physical runtime closure.
 */
export async function prepareReleaseProject(rootDir = workspaceRoot) {
  const desktopRoot = path.join(rootDir, "apps", "desktop");
  const projectRoot = path.join(desktopRoot, ".release-project");
  await rm(projectRoot, { recursive: true, force: true });
  await mkdir(projectRoot, { recursive: true });
  await Promise.all([
    copyProductionTree(path.join(desktopRoot, "dist"), path.join(projectRoot, "dist")),
    copyProductionTree(path.join(desktopRoot, "dist-electron"), path.join(projectRoot, "dist-electron")),
    copyProductionTree(path.join(desktopRoot, ".release-runtime"), path.join(projectRoot, "node_modules"))
  ]);
  await writeFile(path.join(projectRoot, "package.json"), `${JSON.stringify({
    name: "ether-desktop-release",
    version: releaseVersion,
    private: true,
    author: "DreamBay",
    type: "module",
    main: "dist-electron/main/bootstrap.js",
    description: "ETHER by DreamBay - a local-first creative node canvas for portable .ether documents.",
    dependencies: {
      "@ether/application": "4.0.0",
      "@ether/document": "4.0.0",
      "@ether/execution": "4.0.0",
      "@ether/graph-kernel": "4.0.0",
      "@ether/mcp-server": "4.0.0",
      "@ether/providers": "4.0.0",
      "@ether/recipes": "4.0.0",
      "@ether/schema": "4.0.0",
      "@img/sharp-win32-x64": "0.35.3",
      "@modelcontextprotocol/sdk": "1.29.0",
      "sharp": "0.35.3",
      "zod": "3.25.76"
    }
  }, null, 2)}\n`);
  await writeFile(path.join(projectRoot, "electron-builder.yml"), [
    "appId: com.dreambay.ether",
    "productName: Ether",
    "copyright: \"Copyright \\u00A9 2026 DreamBay\"",
    "asar: true",
    "electronVersion: 43.1.1",
    "npmRebuild: false",
    "directories:",
    "  output: ../../../release/windows",
    "  buildResources: ../../../build/installer",
    "files:",
    "  - dist/**/*",
    "  - dist-electron/**/*",
    "  - node_modules/**/*",
    "  - package.json",
    `  - ${stagedInventoryFileName}`,
    "asarUnpack:",
    "  - node_modules/sharp/**/*",
    "  - node_modules/@img/**/*",
    "win:",
    "  target: nsis",
    "  icon: ether.ico",
    "  artifactName: Ether-${version}-Setup.${ext}",
    "  requestedExecutionLevel: asInvoker",
    "nsis:",
    "  guid: ad6cd9b2-3723-5b60-a3d0-3938212aac8e",
    "  oneClick: false",
    "  perMachine: false",
    "  allowElevation: false",
    "  allowToChangeInstallationDirectory: true",
    "  deleteAppDataOnUninstall: false",
    "  createDesktopShortcut: true",
    "  createStartMenuShortcut: true",
    "  shortcutName: Ether",
    "  installerIcon: ether.ico",
    "  uninstallerIcon: ether.ico",
    "fileAssociations:",
    "  - ext: ether",
    "    name: DreamBay.Ether.Document",
    "    description: Ether 4.0 Document",
    "    icon: ether.ico",
    ""
  ].join("\n"));
  return projectRoot;
}

async function copyProductionTree(sourceRoot, targetRoot) {
  await cp(sourceRoot, targetRoot, {
    recursive: true,
    dereference: true,
    filter: (candidate) => productionPathAllowed(sourceRoot, candidate)
  });
}

function productionPathAllowed(sourceRoot, candidate) {
  const relative = normalizeArchivePath(path.relative(sourceRoot, candidate));
  if (relative === "") return true;
  return packagePathViolation(relative) === null;
}

function packagePathViolation(relativePath) {
  const normalized = normalizeArchivePath(relativePath).replace(/^\/+/u, "");
  const segments = normalized.toLocaleLowerCase().split("/");
  const fileName = segments.at(-1) ?? "";
  if (segments.some((segment) => forbiddenDirectoryNames.has(segment))) {
    return "source, test, example, or documentation directory";
  }
  if (
    forbiddenFileNames.has(fileName) ||
    fileName.startsWith(".env.") ||
    fileName.endsWith("-journal") ||
    fileName.endsWith("-shm") ||
    fileName.endsWith("-wal") ||
    /^(readme|changelog|contributing)(?:\.|$)/iu.test(fileName)
  ) {
    return "documentation, environment, credential, or lock file";
  }
  if (forbiddenFileExtensions.has(path.posix.extname(fileName))) {
    return "source, documentation, or source-map extension";
  }
  return null;
}

export function releasePathViolation(relativePath) {
  return packagePathViolation(relativePath);
}

async function copyWorkspacePackage(rootDir, targetRoot, packageName, sourceRelativePath, state) {
  const sourceRoot = path.join(rootDir, sourceRelativePath);
  const targetPackageRoot = path.join(targetRoot, ...packageName.split("/"));
  if (state.copiedTargets.has(targetPackageRoot)) return;
  state.copiedTargets.add(targetPackageRoot);
  await mkdir(targetPackageRoot, { recursive: true });
  await copyProductionTree(path.join(sourceRoot, "dist"), path.join(targetPackageRoot, "dist"));
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8"));
  const requiredDependencies = Object.keys(manifest.dependencies ?? {});
  const optionalDependencies = Object.keys(manifest.optionalDependencies ?? {});
  for (const dependencyName of [...requiredDependencies, ...optionalDependencies]) {
    if (workspacePackagePaths.has(dependencyName)) manifest.dependencies[dependencyName] = "4.0.0";
  }
  await writeFile(path.join(targetPackageRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (packageName === "@ether/providers") {
    await copyProductionTree(path.join(sourceRoot, "protocol"), path.join(targetPackageRoot, "protocol"));
  }
  for (const dependencyName of Object.keys(manifest.dependencies ?? {})) {
    const workspaceSource = workspacePackagePaths.get(dependencyName);
    if (workspaceSource !== undefined) {
      await copyWorkspacePackage(rootDir, targetRoot, dependencyName, workspaceSource, state);
      continue;
    }
    await copyRuntimeDependency(sourceRoot, targetRoot, dependencyName, state);
  }
}

async function copyRuntimeDependency(packageRoot, targetRoot, dependencyName, state) {
  const sourceRoot = await resolveInstalledPackageRoot(packageRoot, dependencyName);
  const canonicalSource = await realpath(sourceRoot);
  const knownRoot = state.rootPackages.get(dependencyName);
  const dependencyTarget = knownRoot === canonicalSource
    ? path.join(targetRoot, ...dependencyName.split("/"))
    : knownRoot === undefined
      ? path.join(targetRoot, ...dependencyName.split("/"))
      : path.join(targetRoot, ".nested", ...dependencyName.split("/"));
  if (knownRoot === undefined) state.rootPackages.set(dependencyName, canonicalSource);
  await copyRuntimePackage(canonicalSource, dependencyTarget, targetRoot, state, new Set());
}

async function copyRuntimePackage(sourceRoot, targetRoot, appNodeModulesRoot, state, ancestors) {
  const canonicalSource = await realpath(sourceRoot);
  if (ancestors.has(canonicalSource) || state.copiedTargets.has(targetRoot)) return;
  state.copiedTargets.add(targetRoot);
  await cp(canonicalSource, targetRoot, {
    recursive: true,
    dereference: true,
    filter: (candidate) =>
      path.basename(candidate) !== "node_modules" &&
      productionPathAllowed(canonicalSource, candidate)
  });
  const manifest = JSON.parse(await readFile(path.join(canonicalSource, "package.json"), "utf8"));
  const requiredDependencies = Object.keys(manifest.dependencies ?? {});
  const optionalDependencies = Object.keys(manifest.optionalDependencies ?? {});
  const nextAncestors = new Set(ancestors).add(canonicalSource);
  for (const dependencyName of [...requiredDependencies, ...optionalDependencies]) {
    const workspaceSource = workspacePackagePaths.get(dependencyName);
    if (workspaceSource !== undefined) continue;
    let dependencySource;
    try {
      dependencySource = await resolveInstalledPackageRoot(canonicalSource, dependencyName);
    } catch (error) {
      if (optionalDependencies.includes(dependencyName) && !requiredDependencies.includes(dependencyName)) continue;
      throw error;
    }
    const canonicalDependency = await realpath(dependencySource);
    const knownRoot = state.rootPackages.get(dependencyName);
    const dependencyTarget = knownRoot === canonicalDependency || knownRoot === undefined
      ? path.join(appNodeModulesRoot, ...dependencyName.split("/"))
      : path.join(targetRoot, "node_modules", ...dependencyName.split("/"));
    if (knownRoot === undefined) state.rootPackages.set(dependencyName, canonicalDependency);
    await copyRuntimePackage(canonicalDependency, dependencyTarget, appNodeModulesRoot, state, nextAncestors);
  }
}

async function resolveInstalledPackageRoot(packageRoot, dependencyName) {
  // Some native optional packages (including @img/sharp-win32-x64) intentionally
  // do not export their package.json or a JavaScript main entry. Resolve the
  // physical pnpm link first, before falling back to Node's export-aware resolver.
  const directManifest = path.join(packageRoot, "node_modules", ...dependencyName.split("/"), "package.json");
  try {
    return path.dirname(await realpath(directManifest));
  } catch {
    // The dependency may be hoisted elsewhere; use Node's resolver below.
  }
  const requireFromPackage = createRequire(path.join(packageRoot, "package.json"));
  try {
    return path.dirname(await realpath(requireFromPackage.resolve(`${dependencyName}/package.json`)));
  } catch {
    const entryPath = await realpath(requireFromPackage.resolve(dependencyName));
    let candidate = path.dirname(entryPath);
    const filesystemRoot = path.parse(candidate).root;
    while (candidate !== filesystemRoot) {
      try {
        const manifest = JSON.parse(await readFile(path.join(candidate, "package.json"), "utf8"));
        if (manifest.name === dependencyName) return candidate;
      } catch {
        // Continue toward the package root when a package exposes no package.json.
      }
      candidate = path.dirname(candidate);
    }
    throw new Error(`Could not resolve production dependency ${dependencyName} from ${packageRoot}.`);
  }
}

export function releaseRootArtifactViolation(entryName) {
  return allowedReleaseRootEntries.has(entryName)
    ? null
    : "unreviewed top-level release artifact";
}

async function assertReleaseArtifactContract(outputDir) {
  const expected = [
    path.join(outputDir, installerFileName),
    path.join(outputDir, `${installerFileName}.blockmap`),
    path.join(outputDir, reviewedBuilderConfigFileName),
    path.join(outputDir, "win-unpacked", "Ether.exe"),
    path.join(outputDir, "win-unpacked", "resources", "app.asar")
  ];
  const missing = [];
  for (const entry of expected) {
    try {
      if (!(await stat(entry)).isFile()) missing.push(entry);
    } catch {
      missing.push(entry);
    }
  }
  if (missing.length > 0) throw new Error(`electron-builder did not create the Ether release contract: ${missing.join(", ")}`);
  const contents = await readdir(outputDir, { withFileTypes: true });
  const unexpected = contents
    .filter((entry) => releaseRootArtifactViolation(entry.name) !== null)
    .map((entry) => entry.name);
  if (unexpected.length > 0) {
    throw new Error(`The Windows release contains unreviewed top-level artifacts: ${unexpected.join(", ")}.`);
  }
  const invalidKinds = contents.filter((entry) =>
    entry.name === "win-unpacked" ? !entry.isDirectory() : !entry.isFile()
  );
  if (invalidKinds.length > 0) {
    throw new Error(`The Windows release contains invalid top-level artifact types: ${invalidKinds.map((entry) => entry.name).join(", ")}.`);
  }
  const names = contents.map((entry) => entry.name);
  if (!names.includes(installerFileName) || !names.includes("win-unpacked")) {
    throw new Error("The Windows release must contain both an NSIS installer and an unpacked acceptance target.");
  }
}

export async function assertReleaseArtifacts(outputDir = releaseDirectory) {
  await assertReleaseArtifactContract(outputDir);
  await prepareProductionRuntime(workspaceRoot);
  try {
    const releaseProject = await prepareReleaseProject(workspaceRoot);
    const currentInventory = await createStagedInventory(releaseProject);
    return await auditPackagedRelease({
      outputDir,
      rootDir: workspaceRoot,
      stagedInventory: currentInventory
    });
  } finally {
    await cleanupReleaseStaging(workspaceRoot);
  }
}

export async function auditPackagedRelease(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? workspaceRoot);
  const outputDir = path.resolve(options.outputDir ?? path.join(rootDir, "release", "windows"));
  await assertReleaseArtifactContract(outputDir);
  const stagedProjectRoot = path.join(rootDir, "apps", "desktop", ".release-project");
  const stagedConfigPresent = await stat(path.join(stagedProjectRoot, "electron-builder.yml"))
    .then((entry) => entry.isFile(), () => false);
  const builderConfig = await assertGeneratedBuilderConfig(
    stagedConfigPresent ? stagedProjectRoot : outputDir,
    rootDir,
    stagedConfigPresent ? "electron-builder.yml" : reviewedBuilderConfigFileName
  );
  const asarPath = path.join(outputDir, "win-unpacked", "resources", "app.asar");
  uncache(asarPath);
  const unpackedRoot = path.join(outputDir, "win-unpacked", "resources", "app.asar.unpacked");
  const archivePaths = (await listPackage(asarPath))
    .map((entry) => normalizeArchivePath(entry).replace(/^\/+/u, ""))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  assertSortedUnique(archivePaths, "ASAR path");
  for (const archivePath of archivePaths) {
    const violation = packagePathViolation(archivePath);
    if (violation !== null) throw new Error(`ASAR privacy audit refused ${archivePath}: ${violation}.`);
  }
  const requiredArchivePaths = [
    "dist/index.html",
    "dist-electron/main/bootstrap.js",
    "dist-electron/main/diagnostics/localDiagnostics.js",
    "dist-electron/main/main.js",
    "dist-electron/main/protocol/etherAssetProtocol.js",
    "dist-electron/main/security/navigationPolicy.js",
    "dist-electron/main/security/pathGrants.js",
    "dist-electron/preload/preload.cjs",
    "node_modules/@ether/application/dist/atomicExportPublisher.js",
    "node_modules/@ether/document/dist/sqliteSecurity.js",
    "node_modules/@ether/mcp-server/dist/index.js",
    "node_modules/@modelcontextprotocol/sdk/package.json",
    stagedInventoryFileName
  ];
  const missingArchivePaths = requiredArchivePaths.filter((entry) => !archivePaths.includes(entry));
  if (missingArchivePaths.length > 0) {
    throw new Error(`ASAR runtime closure is incomplete: ${missingArchivePaths.join(", ")}.`);
  }
  const runtimeImportContracts = [
    {
      imports: [
        "./protocol/etherAssetProtocol.js",
        "./security/navigationPolicy.js",
        "installChromiumNetworkContainment(app.commandLine)",
        "import(\"./main.js\")"
      ],
      path: "dist-electron/main/bootstrap.js"
    },
    {
      imports: ["./diagnostics/localDiagnostics.js", "./security/navigationPolicy.js"],
      path: "dist-electron/main/main.js"
    },
    {
      imports: ["../security/pathGrants.js"],
      path: "dist-electron/main/services/applicationService.js"
    }
  ];
  for (const contract of runtimeImportContracts) {
    const source = extractFile(asarPath, contract.path.split("/").join(path.sep)).toString("utf8");
    const missingImports = contract.imports.filter((specifier) => !source.includes(specifier));
    if (missingImports.length > 0) {
      throw new Error(`ASAR runtime import contract is incomplete in ${contract.path}: ${missingImports.join(", ")}.`);
    }
  }
  await auditArchiveText(asarPath, archivePaths, rootDir);

  const unpackedEntries = await inventoryFiles(unpackedRoot, { auditPaths: true });
  const unpackedPaths = new Set(unpackedEntries.map((entry) => entry.path));
  const requiredUnpackedPaths = [
    "node_modules/@img/sharp-win32-x64/lib/libvips-42.dll",
    "node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.3.node"
  ];
  const missingUnpackedPaths = requiredUnpackedPaths.filter((entry) => !unpackedPaths.has(entry));
  if (missingUnpackedPaths.length > 0) {
    throw new Error(`Unpacked native runtime closure is incomplete: ${missingUnpackedPaths.join(", ")}.`);
  }
  await auditPhysicalText(unpackedRoot, unpackedEntries, rootDir);

  const packagedInventory = JSON.parse(
    extractFile(asarPath, stagedInventoryFileName).toString("utf8")
  );
  const actualArchivePayload = inventoryAsarPayload(asarPath, archivePaths);
  const expectedInventory = options.stagedInventory;
  const verifiedInventory = assertPackagedInventoryMatches(
    packagedInventory,
    actualArchivePayload.entries,
    {
      actualUnpackedEntries: unpackedEntries,
      actualUnpackedPaths: actualArchivePayload.unpackedPaths,
      expectedCalibratedInventory: options.calibratedInventory,
      expectedSourceInventory: expectedInventory
    }
  );
  if (options.repeatHash !== undefined && packagedInventory.sourceRepeatHash !== options.repeatHash) {
    throw new Error("Packaged source repeat inventory hash differs from the first staging pass.");
  }

  const audit = {
    archivePathCount: archivePaths.length,
    archivePathHash: createHash("sha256").update(archivePaths.join("\n")).digest("hex"),
    builderConfig,
    nativeFileCount: unpackedEntries.length,
    nativeInventoryHash: verifiedInventory.unpackedHash,
    packagedByteInventoryHash: verifiedInventory.hash,
    packagedFileCount: verifiedInventory.entries.length,
    stagedFileCount: verifiedInventory.sourceEntries.length,
    stagedInventoryHash: verifiedInventory.sourceHash,
    stagedRepeatHash: packagedInventory.sourceRepeatHash,
    version: releaseVersion
  };
  await writeFile(path.join(outputDir, releaseAuditFileName), `${JSON.stringify(audit, null, 2)}\n`);
  const releaseSideTextPaths = await auditReleaseSideText(outputDir, rootDir);
  audit.releaseSideTextFileCount = releaseSideTextPaths.length;
  audit.releaseSideTextPathHash = createHash("sha256")
    .update(releaseSideTextPaths.join("\n"))
    .digest("hex");
  await writeFile(path.join(outputDir, releaseAuditFileName), `${JSON.stringify(audit, null, 2)}\n`);
  const verifiedReleaseSideTextPaths = await auditReleaseSideText(outputDir, rootDir);
  if (JSON.stringify(verifiedReleaseSideTextPaths) !== JSON.stringify(releaseSideTextPaths)) {
    throw new Error("The retained release-side text file set changed while writing the release audit.");
  }
  await assertReleaseArtifactContract(outputDir);
  return audit;
}

export function inventoryAsarPayload(asarPath, archivePaths) {
  if (archivePaths === undefined) {
    // Calibration and final packaging intentionally reuse the same output
    // path. @electron/asar caches headers by path, so invalidate it before
    // independently reading a newly written archive.
    uncache(asarPath);
    archivePaths = listPackage(asarPath);
  }
  const entries = [];
  const unpackedPaths = [];
  for (const candidate of archivePaths) {
    const archivePath = normalizeArchivePath(candidate).replace(/^\/+/u, "");
    if (archivePath.length === 0 || archivePath === stagedInventoryFileName) continue;
    const nativeArchivePath = archivePath.split("/").join(path.sep);
    const information = statFile(asarPath, nativeArchivePath);
    if (typeof information?.size !== "number") continue;
    if (information.unpacked === true) {
      unpackedPaths.push(archivePath);
      continue;
    }
    const bytes = extractFile(asarPath, nativeArchivePath);
    entries.push({
      path: archivePath,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex")
    });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  unpackedPaths.sort((left, right) => left.localeCompare(right));
  assertSortedUnique(entries.map((entry) => entry.path), "actual ASAR byte");
  assertSortedUnique(unpackedPaths, "ASAR unpacked header");
  return { entries, unpackedPaths };
}

export function inventoryAsarFiles(asarPath, archivePaths) {
  return inventoryAsarPayload(asarPath, archivePaths).entries;
}

export async function inventoryUnpackedFiles(asarPath) {
  return inventoryFiles(`${asarPath}.unpacked`, { auditPaths: true });
}

export function assertPackagedInventoryMatches(
  packagedInventory,
  actualEntries,
  options = {}
) {
  const {
    actualUnpackedEntries,
    actualUnpackedPaths,
    expectedCalibratedInventory,
    expectedSourceInventory
  } = options;
  if (
    packagedInventory?.algorithm !== "sha256" ||
    packagedInventory?.version !== releaseVersion ||
    !Array.isArray(packagedInventory?.entries) ||
    !Array.isArray(packagedInventory?.sourceEntries) ||
    !Array.isArray(packagedInventory?.unpackedEntries) ||
    typeof packagedInventory?.hash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(packagedInventory.hash) ||
    packagedInventory.hash !== packagedInventory.repeatHash ||
    typeof packagedInventory?.sourceHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(packagedInventory.sourceHash) ||
    packagedInventory.sourceHash !== packagedInventory.sourceRepeatHash ||
    typeof packagedInventory?.unpackedHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(packagedInventory.unpackedHash) ||
    packagedInventory.unpackedHash !== packagedInventory.unpackedRepeatHash
  ) {
    throw new Error("Packaged release inventory does not prove deterministic staging and calibration.");
  }
  const parseEntries = (entries, label, allowInventory = false) => entries.map((entry) => {
    if (
      typeof entry?.path !== "string" ||
      entry.path.length === 0 ||
      (!allowInventory && entry.path === stagedInventoryFileName) ||
      !Number.isSafeInteger(entry?.bytes) ||
      entry.bytes < 0 ||
      typeof entry?.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256)
    ) {
      throw new Error(`Packaged ${label} inventory contains an invalid file entry.`);
    }
    return { path: entry.path, bytes: entry.bytes, sha256: entry.sha256 };
  });
  const claimedEntries = parseEntries(packagedInventory.entries, "ASAR");
  const claimedSourceEntries = parseEntries(packagedInventory.sourceEntries, "source");
  const claimedUnpackedEntries = parseEntries(packagedInventory.unpackedEntries, "unpacked");
  assertSortedUnique(claimedEntries.map((entry) => entry.path), "packaged release");
  assertSortedUnique(claimedSourceEntries.map((entry) => entry.path), "packaged source");
  assertSortedUnique(claimedUnpackedEntries.map((entry) => entry.path), "packaged unpacked");
  const claimedHash = hashInventory(claimedEntries);
  if (claimedHash !== packagedInventory.hash) {
    throw new Error("Packaged release inventory digest does not match its claimed entries.");
  }
  const claimedSourceHash = hashInventory(claimedSourceEntries);
  if (claimedSourceHash !== packagedInventory.sourceHash) {
    throw new Error("Packaged source inventory digest does not match its claimed entries.");
  }
  const claimedUnpackedHash = hashInventory(claimedUnpackedEntries);
  if (claimedUnpackedHash !== packagedInventory.unpackedHash) {
    throw new Error("Packaged unpacked inventory digest does not match its claimed entries.");
  }
  if (actualEntries.some((entry) => entry.path === stagedInventoryFileName)) {
    throw new Error("Actual ASAR byte inventory must exclude its recursive inventory file.");
  }
  const actualHash = hashInventory(actualEntries);
  if (
    actualHash !== claimedHash ||
    JSON.stringify(actualEntries) !== JSON.stringify(claimedEntries)
  ) {
    throw new Error("Packaged release inventory differs from the actual ASAR entry bytes.");
  }
  if (actualUnpackedEntries === undefined) {
    throw new Error("Packaged release audit requires an independent unpacked byte inventory.");
  }
  if (actualUnpackedPaths === undefined) {
    throw new Error("Packaged release audit requires ASAR unpacked header paths.");
  }
  assertUnpackedPathSet(actualUnpackedPaths, actualUnpackedEntries);
  const actualUnpackedHash = hashInventory(actualUnpackedEntries);
  if (
    actualUnpackedHash !== claimedUnpackedHash ||
    JSON.stringify(actualUnpackedEntries) !== JSON.stringify(claimedUnpackedEntries)
  ) {
    throw new Error("Packaged release inventory differs from the actual unpacked entry bytes.");
  }
  if (
    expectedSourceInventory !== undefined &&
    (
      expectedSourceInventory.hash !== claimedSourceHash ||
      JSON.stringify(expectedSourceInventory.entries) !== JSON.stringify(claimedSourceEntries)
    )
  ) {
    throw new Error("Packaged source inventory differs from the current audited staging inventory.");
  }
  if (
    expectedCalibratedInventory !== undefined &&
    (
      expectedCalibratedInventory.hash !== actualHash ||
      JSON.stringify(expectedCalibratedInventory.entries) !== JSON.stringify(actualEntries) ||
      expectedCalibratedInventory.unpackedHash !== actualUnpackedHash ||
      JSON.stringify(expectedCalibratedInventory.unpackedEntries) !== JSON.stringify(actualUnpackedEntries)
    )
  ) {
    throw new Error("Final packaged bytes differ from the calibrated electron-builder directory package.");
  }
  return {
    entries: actualEntries,
    hash: actualHash,
    sourceEntries: claimedSourceEntries,
    sourceHash: claimedSourceHash,
    unpackedEntries: actualUnpackedEntries,
    unpackedHash: actualUnpackedHash
  };
}

function assertUnpackedPathSet(headerPaths, physicalEntries) {
  const expectedPaths = [...headerPaths].sort((left, right) => left.localeCompare(right));
  const physicalPaths = physicalEntries.map((entry) => entry.path);
  assertSortedUnique(expectedPaths, "ASAR unpacked header");
  assertSortedUnique(physicalPaths, "physical unpacked");
  if (JSON.stringify(expectedPaths) !== JSON.stringify(physicalPaths)) {
    throw new Error("ASAR unpacked headers differ from the physical unpacked file set.");
  }
}

async function inventoryFiles(rootDirectory, options = {}) {
  const resolvedRoot = path.resolve(rootDirectory);
  const entries = [];
  async function visit(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = normalizeArchivePath(path.relative(resolvedRoot, absolute));
      const information = await lstat(absolute);
      if (information.isSymbolicLink()) throw new Error(`Release inventory refuses symbolic link ${relative}.`);
      if (information.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!information.isFile()) throw new Error(`Release inventory refuses non-file ${relative}.`);
      if (
        relative === stagedInventoryFileName ||
        relative === "electron-builder.yml"
      ) continue;
      if (options.auditPaths === true) {
        const violation = packagePathViolation(relative);
        if (violation !== null) throw new Error(`Release inventory refused ${relative}: ${violation}.`);
      }
      const bytes = await readFile(absolute);
      entries.push({
        path: relative,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex")
      });
    }
  }
  await visit(resolvedRoot);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  assertSortedUnique(entries.map((entry) => entry.path), "release inventory");
  return entries;
}

export function hashInventory(entries) {
  return createHash("sha256")
    .update(entries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`).join("\n"))
    .digest("hex");
}

function assertSortedUnique(entries, label) {
  const sorted = [...entries].sort((left, right) => left.localeCompare(right));
  if (new Set(entries).size !== entries.length || entries.some((entry, index) => entry !== sorted[index])) {
    throw new Error(`${label} inventory must be sorted and unique.`);
  }
}

async function auditArchiveText(asarPath, archivePaths, rootDir) {
  for (const archivePath of archivePaths.filter(isAuditableTextPath)) {
    // @electron/asar expects native separators when extracting on Windows even
    // though the release inventory is normalized to portable forward slashes.
    const nativeArchivePath = archivePath.split("/").join(path.sep);
    if (typeof statFile(asarPath, nativeArchivePath)?.size !== "number") continue;
    const bytes = extractFile(asarPath, nativeArchivePath);
    assertPrivateText(bytes.toString("utf8"), archivePath, rootDir);
  }
}

async function auditPhysicalText(rootDirectory, entries, rootDir) {
  for (const entry of entries.filter((candidate) => isAuditableTextPath(candidate.path))) {
    assertPrivateText(await readFile(path.join(rootDirectory, ...entry.path.split("/")), "utf8"), entry.path, rootDir);
  }
}

async function auditReleaseSideText(outputDir, rootDir) {
  const resolvedOutput = path.resolve(outputDir);
  const auditedPaths = [];
  async function visit(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = normalizeArchivePath(path.relative(resolvedOutput, absolute));
      const information = await lstat(absolute);
      if (information.isSymbolicLink()) {
        throw new Error(`Release privacy audit refuses symbolic link ${relative}.`);
      }
      if (information.isDirectory()) {
        if (relative === "win-unpacked/resources/app.asar.unpacked") continue;
        await visit(absolute);
        continue;
      }
      if (!information.isFile()) {
        throw new Error(`Release privacy audit refuses non-file ${relative}.`);
      }
      if (!isAuditableTextPath(relative)) continue;
      assertPrivateText(await readFile(absolute, "utf8"), relative, rootDir);
      auditedPaths.push(relative);
    }
  }
  await visit(resolvedOutput);
  auditedPaths.sort((left, right) => left.localeCompare(right));
  assertSortedUnique(auditedPaths, "release-side text");
  return auditedPaths;
}

function assertPrivateText(content, label, rootDir) {
  const normalized = content.replaceAll("\\", "/").toLocaleLowerCase();
  const absoluteWorkspace = path.resolve(rootDir).replaceAll("\\", "/").toLocaleLowerCase();
  if (normalized.includes(absoluteWorkspace)) {
    throw new Error(`Packaged content ${label} contains the absolute workspace path.`);
  }
  const personalRoot = /^(?:[a-z]:\/users\/[^/]+|\/home\/[^/]+)/iu.exec(
    absoluteWorkspace
  )?.[0];
  if (personalRoot !== undefined && normalized.includes(personalRoot)) {
    throw new Error(`Packaged content ${label} contains the release builder's user-profile path.`);
  }
  if (/(?:^|[="'\s])(?:[a-z]:\/users\/[^/\s"']+|\/home\/[^/\s"']+)\/(?:appdata|desktop|documents|downloads)\//iu.test(normalized)) {
    throw new Error(`Packaged content ${label} contains a personal user path.`);
  }
  const credentialPatterns = [
    {
      name: "private key",
      pattern: /-----BEGIN ((?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY)-----\r?\n(?:[A-Za-z0-9+/=]{20,}\r?\n){2,}-----END \1-----/u
    },
    { name: "OpenAI token", pattern: /\bsk-(?:(?:proj|svcacct|admin)-)?[A-Za-z0-9_-]{20,}\b/u },
    { name: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})\b/u },
    { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u },
    { name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u },
    {
      name: "assigned credential",
      pattern: /\b(?:OPENAI_API_KEY|GITHUB_TOKEN|SLACK_(?:APP|BOT|USER)_TOKEN|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*["'`][A-Za-z0-9_./+=-]{20,}["'`]/u
    },
    {
      name: "assigned bearer credential",
      pattern: /\b(?:authorization|proxy-authorization)\s*[:=]\s*["'`]Bearer [A-Za-z0-9._~+/=-]{20,}["'`]/iu
    }
  ];
  for (const credential of credentialPatterns) {
    if (credential.pattern.test(content)) {
      throw new Error(`Packaged content ${label} contains ${credential.name} material.`);
    }
  }
}

export function assertReleaseTextPrivate(content, label = "test-content", rootDir = workspaceRoot) {
  assertPrivateText(content, label, rootDir);
}

function isAuditableTextPath(relativePath) {
  return new Set([".cjs", ".config", ".css", ".html", ".js", ".json", ".manifest", ".mjs", ".sql", ".txt", ".xml", ".yaml", ".yml"])
    .has(path.posix.extname(relativePath).toLocaleLowerCase());
}

function normalizeArchivePath(value) {
  return value.replaceAll("\\", "/");
}

function isWithin(rootDirectory, candidate) {
  const relative = path.relative(rootDirectory, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? "an unknown code"}.`));
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  packageWindowsApp().then(
    (result) => console.log(`Ether 4.0.0 Windows installer created at ${result.installerPath}`),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  );
}

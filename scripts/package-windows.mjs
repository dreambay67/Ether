import { cp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootFromScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const codexProtocolManifest = "packages/providers/protocol/codex-0.144.2/manifest.json";
const runtimeDependencies = [
  {
    packageName: "zod",
    sourceRelativePath: "packages/schema/node_modules/zod"
  },
  {
    packageName: "@modelcontextprotocol/sdk",
    sourceRelativePath: "packages/mcp-server/node_modules/@modelcontextprotocol/sdk"
  }
];
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

export function requiredPackageInputs(rootDir = rootFromScript) {
  const buildInputs = [
    "node_modules/electron/dist/electron.exe",
    "apps/desktop/dist/index.html",
    "apps/desktop/dist-electron/main/bootstrap.js",
    "apps/desktop/dist-electron/main/main.js",
    ...workspacePackages.map(([, sourceRelativePath]) => `${sourceRelativePath}/dist/index.js`),
    codexProtocolManifest
  ];
  const dependencyInputs = runtimeDependencies.map(
    (dependency) => `${dependency.sourceRelativePath}/package.json`
  );

  return [...buildInputs, ...dependencyInputs].map((relativePath) => ({
    relativePath,
    path: path.join(rootDir, relativePath)
  }));
}

export async function packageWindowsApp(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? rootFromScript);
  const outputDir = path.resolve(options.outputDir ?? path.join(rootDir, "release", "ether-windows-unpacked"));

  await assertPackageInputs(rootDir);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  await cp(path.join(rootDir, "node_modules/electron/dist"), outputDir, { recursive: true });
  await rm(path.join(outputDir, "electron.exe"), { force: true });
  await cp(path.join(rootDir, "node_modules/electron/dist/electron.exe"), path.join(outputDir, "Ether.exe"));

  const appRoot = path.join(outputDir, "resources", "app");
  await mkdir(appRoot, { recursive: true });
  await cp(path.join(rootDir, "apps/desktop/dist"), path.join(appRoot, "dist"), { recursive: true });
  await cp(path.join(rootDir, "apps/desktop/dist-electron"), path.join(appRoot, "dist-electron"), {
    recursive: true
  });
  await writeFile(
    path.join(appRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "ether-desktop-package",
        version: "0.0.0",
        private: true,
        type: "module",
        main: "dist-electron/main/bootstrap.js"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await packageApplicationRuntime(rootDir, appRoot);

  return {
    outputDir,
    executablePath: path.join(outputDir, "Ether.exe")
  };
}

export async function packageApplicationRuntime(rootDir, appRoot) {
  for (const [packageName, sourceRelativePath] of workspacePackages) {
    await copyWorkspacePackage(rootDir, appRoot, packageName, sourceRelativePath);
  }
  const runtimeCopyState = {
    copiedTargets: new Set(),
    rootPackages: new Map()
  };
  for (const dependency of runtimeDependencies) {
    await copyRuntimeDependency(rootDir, appRoot, dependency, runtimeCopyState);
  }
}

async function assertPackageInputs(rootDir) {
  const missing = [];

  for (const input of requiredPackageInputs(rootDir)) {
    try {
      await stat(input.path);
    } catch {
      missing.push(input.relativePath);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Build the desktop app before packaging. Missing: ${missing.join(", ")}`);
  }
}

async function copyWorkspacePackage(rootDir, appRoot, packageName, sourceRelativePath) {
  const sourceRoot = path.join(rootDir, sourceRelativePath);
  const targetRoot = path.join(appRoot, "node_modules", ...packageName.split("/"));

  await mkdir(targetRoot, { recursive: true });
  await cp(path.join(sourceRoot, "dist"), path.join(targetRoot, "dist"), { recursive: true });
  await cp(path.join(sourceRoot, "package.json"), path.join(targetRoot, "package.json"));
  if (packageName === "@ether/providers") {
    await cp(path.join(sourceRoot, "protocol"), path.join(targetRoot, "protocol"), { recursive: true });
  }
}

async function copyRuntimeDependency(rootDir, appRoot, dependency, state) {
  const canonicalSource = await realpath(path.join(rootDir, dependency.sourceRelativePath));
  state.rootPackages.set(dependency.packageName, canonicalSource);
  await copyRuntimePackage(
    canonicalSource,
    path.join(appRoot, "node_modules", ...dependency.packageName.split("/")),
    appRoot,
    state,
    new Set()
  );
}

async function copyRuntimePackage(sourceRoot, targetRoot, appRoot, state, ancestors) {
  const canonicalSource = await realpath(sourceRoot);
  if (ancestors.has(canonicalSource) || state.copiedTargets.has(targetRoot)) return;
  const nextAncestors = new Set(ancestors).add(canonicalSource);
  const manifest = JSON.parse(await readFile(path.join(canonicalSource, "package.json"), "utf8"));
  state.copiedTargets.add(targetRoot);

  await cp(canonicalSource, targetRoot, {
    recursive: true,
    dereference: true,
    filter: (candidate) => path.basename(candidate) !== "node_modules"
  });

  const requiredDependencies = Object.keys(manifest.dependencies ?? {});
  const optionalDependencies = Object.keys(manifest.optionalDependencies ?? {});
  for (const dependencyName of [...new Set([...requiredDependencies, ...optionalDependencies])]) {
    let dependencyRoot;
    try {
      dependencyRoot = await resolveInstalledPackageRoot(canonicalSource, dependencyName);
    } catch (error) {
      if (optionalDependencies.includes(dependencyName) && !requiredDependencies.includes(dependencyName)) continue;
      throw error;
    }
    const canonicalDependency = await realpath(dependencyRoot);
    const rootDependency = state.rootPackages.get(dependencyName);
    let dependencyTarget;
    if (rootDependency === undefined) {
      state.rootPackages.set(dependencyName, canonicalDependency);
      dependencyTarget = path.join(appRoot, "node_modules", ...dependencyName.split("/"));
    } else if (rootDependency === canonicalDependency) {
      dependencyTarget = path.join(appRoot, "node_modules", ...dependencyName.split("/"));
    } else {
      dependencyTarget = path.join(targetRoot, "node_modules", ...dependencyName.split("/"));
    }
    await copyRuntimePackage(
      canonicalDependency,
      dependencyTarget,
      appRoot,
      state,
      nextAncestors
    );
  }
}

async function resolveInstalledPackageRoot(packageRoot, dependencyName) {
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
        // Continue toward the package root.
      }
      candidate = path.dirname(candidate);
    }
    throw new Error(`Could not resolve installed runtime dependency ${dependencyName} from ${packageRoot}.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  packageWindowsApp()
    .then((result) => {
      console.log(`Ether Windows package created at ${result.outputDir}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}

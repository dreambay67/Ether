import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootFromScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const codexProtocolManifest = "packages/providers/protocol/codex-0.144.2/manifest.json";
const runtimeDependencies = [
  {
    packageName: "zod",
    sourceRelativePath: "packages/schema/node_modules/zod"
  }
];
const workspacePackages = [
  ["@ether/application", "packages/application"],
  ["@ether/document", "packages/document"],
  ["@ether/execution", "packages/execution"],
  ["@ether/graph-kernel", "packages/graph-kernel"],
  ["@ether/providers", "packages/providers"],
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

  for (const [packageName, sourceRelativePath] of workspacePackages) {
    await copyWorkspacePackage(rootDir, appRoot, packageName, sourceRelativePath);
  }
  for (const dependency of runtimeDependencies) {
    await copyRuntimeDependency(rootDir, appRoot, dependency);
  }

  return {
    outputDir,
    executablePath: path.join(outputDir, "Ether.exe")
  };
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

async function copyRuntimeDependency(rootDir, appRoot, dependency) {
  await cp(
    path.join(rootDir, dependency.sourceRelativePath),
    path.join(appRoot, "node_modules", dependency.packageName),
    { recursive: true, dereference: true }
  );
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

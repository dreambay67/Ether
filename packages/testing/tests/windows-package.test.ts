import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  packageWindowsApp,
  requiredPackageInputs
} from "../../../scripts/package-windows.mjs";

const execFileAsync = promisify(execFile);

async function createFile(filePath: string, content = "") {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function createLinkedPackage(root: string, linkRelativePath: string, realRelativePath: string) {
  const linkPath = path.join(root, linkRelativePath);
  const realPath = path.join(root, realRelativePath);

  await createFile(path.join(realPath, "package.json"), "{}");
  await mkdir(path.dirname(linkPath), { recursive: true });
  await symlink(realPath, linkPath, process.platform === "win32" ? "junction" : "dir");
}

async function createFakePackageRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-package-"));

  await createFile(path.join(root, "node_modules/electron/dist/electron.exe"), "fake exe");
  await createFile(path.join(root, "node_modules/electron/dist/LICENSE"), "license");
  await createFile(path.join(root, "apps/desktop/dist/index.html"), "<main>Ether</main>");
  await createFile(path.join(root, "apps/desktop/dist-electron/main/main.js"), "require('@ether/engine');");
  await createFile(
    path.join(root, "apps/desktop/package.json"),
    JSON.stringify({ name: "@ether/desktop", main: "dist-electron/main/main.js", type: "commonjs" })
  );
  await createFile(path.join(root, "packages/engine/dist/index.js"), "module.exports = {};");
  await createFile(
    path.join(root, "packages/engine/package.json"),
    JSON.stringify({ name: "@ether/engine", main: "dist/index.js", type: "commonjs" })
  );
  await createFile(path.join(root, "packages/providers/dist/index.js"), "module.exports = {};");
  await createFile(
    path.join(root, "packages/providers/package.json"),
    JSON.stringify({ name: "@ether/providers", main: "dist/index.js", type: "commonjs" })
  );
  await createLinkedPackage(root, "packages/engine/node_modules/zod", "store/zod");

  return root;
}

describe("Windows desktop package", () => {
  it("declares the build artifacts required for a runnable unpacked app", async () => {
    const root = await createFakePackageRoot();

    expect(requiredPackageInputs(root).map((entry) => path.relative(root, entry.path))).toEqual([
      "node_modules\\electron\\dist\\electron.exe",
      "apps\\desktop\\dist\\index.html",
      "apps\\desktop\\dist-electron\\main\\main.js",
      "packages\\engine\\dist\\index.js",
      "packages\\providers\\dist\\index.js",
      "packages\\engine\\node_modules\\zod\\package.json"
    ]);
  });

  it("creates a Windows unpacked package with app runtime dependencies", async () => {
    const root = await createFakePackageRoot();
    const result = await packageWindowsApp({
      rootDir: root,
      outputDir: path.join(root, "release/ether-windows-unpacked")
    });

    expect(path.relative(root, result.outputDir)).toBe("release\\ether-windows-unpacked");
    await expect(readFile(path.join(result.outputDir, "Ether.exe"), "utf8")).resolves.toBe("fake exe");
    await expect(
      readFile(path.join(result.outputDir, "resources/app/package.json"), "utf8")
    ).resolves.toContain("\"name\": \"ether-desktop-package\"");
    await expect(
      readFile(path.join(result.outputDir, "resources/app/node_modules/@ether/engine/dist/index.js"), "utf8")
    ).resolves.toContain("module.exports");
    await expect(
      readFile(path.join(result.outputDir, "resources/app/node_modules/@ether/providers/dist/index.js"), "utf8")
    ).resolves.toContain("module.exports");
    expect(
      (await lstat(path.join(result.outputDir, "resources/app/node_modules/zod"))).isSymbolicLink()
    ).toBe(false);
  });

  it.skipIf(process.platform !== "win32")(
    "creates a project through the packaged Electron runtime",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ether-package-runtime-"));

      try {
        const result = await packageWindowsApp({
          outputDir: path.join(root, "release", "ether-windows-unpacked")
        });
        const appRoot = path.join(result.outputDir, "resources", "app");
        const projectParent = path.join(root, "Documents", "Ether Projects");
        const script = `
          const { createProject } = require(${JSON.stringify(path.join(appRoot, "node_modules", "@ether", "engine"))});
          createProject({ parentDirectory: ${JSON.stringify(projectParent)}, name: "Packaged Runtime" })
            .then((project) => {
              console.log("PACKAGED_PROJECT_CREATED");
              console.log(project.path);
              console.log(project.database.tables.join(","));
            })
            .catch((error) => {
              console.error(error && error.stack ? error.stack : error);
              process.exit(1);
            });
        `;

        const { stdout, stderr } = await execFileAsync(result.executablePath, ["-e", script], {
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1"
          },
          timeout: 30000,
          windowsHide: true
        });

        expect(stderr).not.toContain("NODE_MODULE_VERSION");
        expect(stdout).toContain("PACKAGED_PROJECT_CREATED");
        expect(stdout).toContain("asset_moves,assets,health_issues,runs,snapshots");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    60000
  );
});

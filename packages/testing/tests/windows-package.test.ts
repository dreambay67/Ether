import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  packageWindowsApp,
  requiredPackageInputs
} from "../../../scripts/package-windows.mjs";

const repoRoot = path.resolve(__dirname, "../../..");

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
  const engineManifest = await readFile(path.join(repoRoot, "packages/engine/package.json"), "utf8");

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
    path.join(root, "packages/engine/dist/browser.mjs"),
    'export const LATEST_GRAPH_VERSION = "2.5";\n'
  );
  await createFile(
    path.join(root, "packages/engine/dist/browser.d.mts"),
    'export declare const LATEST_GRAPH_VERSION: "2.5";\n'
  );
  await createFile(path.join(root, "packages/engine/package.json"), engineManifest);
  await createFile(path.join(root, "packages/providers/dist/index.js"), "module.exports = {};");
  await createFile(
    path.join(root, "packages/providers/package.json"),
    JSON.stringify({ name: "@ether/providers", main: "dist/index.js", type: "commonjs" })
  );
  await createLinkedPackage(root, "packages/engine/node_modules/zod", "store/zod");

  return root;
}

describe("Windows desktop package", () => {
  it("exposes root and desktop scripts for the public Windows acceptance path", async () => {
    const rootPackage = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    const desktopPackage = JSON.parse(
      await readFile(path.join(repoRoot, "apps/desktop/package.json"), "utf8")
    );
    const testingPackage = JSON.parse(
      await readFile(path.join(repoRoot, "packages/testing/package.json"), "utf8")
    );

    expect(rootPackage.scripts).toMatchObject({
      build: expect.stringContaining("@ether/desktop"),
      "test:unit": "pnpm --filter @ether/testing test:unit",
      "test:smoke": "pnpm --filter @ether/testing test:smoke",
      "acceptance:smoke": "pnpm --filter @ether/testing test:acceptance",
      "test:acceptance": "pnpm run acceptance:smoke",
      "desktop:build": "pnpm --filter @ether/desktop build",
      "desktop:package:win": "pnpm desktop:build && node scripts/package-windows.mjs"
    });
    expect(desktopPackage.scripts).toMatchObject({
      "test:unit": "pnpm --workspace-root test:unit",
      "test:smoke": "pnpm --workspace-root test:smoke",
      "acceptance:smoke": "pnpm --workspace-root acceptance:smoke",
      build: expect.stringContaining("vite build"),
      "package:win": "pnpm --workspace-root desktop:package:win"
    });
    expect(testingPackage.scripts).toMatchObject({
      "test:smoke": "playwright test --config playwright.config.ts",
      "test:packaged": "playwright test --config playwright.packaged.config.ts",
      "test:acceptance": "pnpm run test:smoke && pnpm run test:packaged"
    });
  });

  it("declares the build artifacts required for a runnable unpacked app", async () => {
    const root = await createFakePackageRoot();

    try {
      expect(requiredPackageInputs(root).map((entry) => path.relative(root, entry.path))).toEqual([
        "node_modules\\electron\\dist\\electron.exe",
        "apps\\desktop\\dist\\index.html",
        "apps\\desktop\\dist-electron\\main\\main.js",
        "packages\\engine\\dist\\index.js",
        "packages\\providers\\dist\\index.js",
        "packages\\engine\\node_modules\\zod\\package.json"
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates a Windows unpacked package with app runtime dependencies", async () => {
    const root = await createFakePackageRoot();
    try {
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
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ships the engine browser entry and declarations across the copied package boundary", async () => {
    const root = await createFakePackageRoot();
    try {
      const result = await packageWindowsApp({
        rootDir: root,
        outputDir: path.join(root, "release/ether-windows-unpacked")
      });
      const appRoot = path.join(result.outputDir, "resources", "app");
      const engineRoot = path.join(appRoot, "node_modules", "@ether", "engine");
      const packageJson = JSON.parse(
        await readFile(path.join(engineRoot, "package.json"), "utf8")
      ) as {
        exports: { ".": { browser: { types: string; default: string } } };
      };

      expect(packageJson.exports["."]).toMatchObject({
        browser: {
          types: "./dist/browser.d.mts",
          default: "./dist/browser.mjs"
        }
      });
      await expect(readFile(path.join(engineRoot, "dist/browser.mjs"), "utf8"))
        .resolves.toContain("LATEST_GRAPH_VERSION");
      await expect(readFile(path.join(engineRoot, "dist/browser.d.mts"), "utf8"))
        .resolves.toContain("LATEST_GRAPH_VERSION");
      expect(
        execFileSync(
          process.execPath,
          [
            "--conditions=browser",
            "--input-type=module",
            "--eval",
            "import(\"@ether/engine\").then((engine) => console.log(engine.LATEST_GRAPH_VERSION))"
          ],
          { cwd: appRoot, encoding: "utf8" }
        ).trim()
      ).toBe("2.5");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import {
  packageApplicationRuntime,
  packageWindowsApp,
  requiredPackageInputs
} from "../../../scripts/package-windows.mjs";

const repoRoot = path.resolve(__dirname, "../../..");
const workspacePackages = ["application", "document", "execution", "graph-kernel", "mcp-server", "providers", "recipes", "schema"];

async function createFile(filePath: string, content = "") {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function createFakePackageRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-package-"));
  await createFile(path.join(root, "node_modules/electron/dist/electron.exe"), "fake exe");
  await createFile(path.join(root, "node_modules/electron/dist/LICENSE"), "license");
  await createFile(path.join(root, "apps/desktop/dist/index.html"), "<main>Ether</main>");
  await createFile(path.join(root, "apps/desktop/dist-electron/main/bootstrap.js"), "import './main.js';");
  await createFile(path.join(root, "apps/desktop/dist-electron/main/main.js"), "export const main = true;");
  await createFile(path.join(root, "apps/desktop/dist-electron/preload/preload.cjs"), "module.exports = {};");

  for (const packageDirectory of workspacePackages) {
    const manifest = await readFile(path.join(repoRoot, `packages/${packageDirectory}/package.json`), "utf8");
    await createFile(path.join(root, `packages/${packageDirectory}/package.json`), manifest);
    await createFile(
      path.join(root, `packages/${packageDirectory}/dist/index.js`),
      `export const packagedName = ${JSON.stringify(packageDirectory)};\n`
    );
  }
  await createFile(
    path.join(root, "packages/mcp-server/dist/index.js"),
    [
      'import { sdkMarker } from "@modelcontextprotocol/sdk/server/mcp.js";',
      'export const packagedName = "mcp-server";',
      'if (process.argv.includes("--stdio-probe")) {',
      '  process.stdin.setEncoding("utf8");',
      '  process.stdin.once("data", (input) => process.stdout.write(`${sdkMarker}:${input.trim()}\\n`));',
      '}'
    ].join("\n")
  );
  await createFile(path.join(root, "packages/document/dist/schema/40000.sql"), "-- packaged schema");
  await createFile(
    path.join(root, "packages/providers/protocol/codex-0.144.2/manifest.json"),
    JSON.stringify({ version: "0.144.2", manifestSha256: "fixture" })
  );

  const zodStore = path.join(root, "store/zod");
  await createFile(path.join(zodStore, "package.json"), JSON.stringify({ name: "zod", type: "module" }));
  const zodLink = path.join(root, "packages/schema/node_modules/zod");
  await mkdir(path.dirname(zodLink), { recursive: true });
  await symlink(zodStore, zodLink, process.platform === "win32" ? "junction" : "dir");

  const sdkStore = path.join(root, "store/modelcontextprotocol-sdk");
  await createFile(path.join(sdkStore, "package.json"), JSON.stringify({
    name: "@modelcontextprotocol/sdk",
    version: "1.29.0",
    type: "module",
    exports: { "./server/mcp.js": "./dist/server/mcp.js" },
    dependencies: { "mcp-sdk-leaf": "1.0.0" }
  }));
  await createFile(
    path.join(sdkStore, "dist/server/mcp.js"),
    'import { marker } from "mcp-sdk-leaf"; export const sdkMarker = `official-sdk:${marker}`;\n'
  );
  await createFile(
    path.join(sdkStore, "node_modules/mcp-sdk-leaf/package.json"),
    JSON.stringify({ name: "mcp-sdk-leaf", version: "1.0.0", type: "module", exports: "./index.js" })
  );
  await createFile(
    path.join(sdkStore, "node_modules/mcp-sdk-leaf/index.js"),
    'export const marker = "transitive";\n'
  );
  const sdkLink = path.join(root, "packages/mcp-server/node_modules/@modelcontextprotocol/sdk");
  await mkdir(path.dirname(sdkLink), { recursive: true });
  await symlink(sdkStore, sdkLink, process.platform === "win32" ? "junction" : "dir");
  return root;
}

describe("Windows desktop package", () => {
  it("exposes the desktop build, package, and packaged-test commands", async () => {
    const rootPackage = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    const testingPackage = JSON.parse(await readFile(path.join(repoRoot, "packages/testing/package.json"), "utf8"));
    expect(rootPackage.scripts).toMatchObject({
      "desktop:build": "pnpm --filter @ether/desktop build",
      "desktop:package:win": "pnpm desktop:build && node scripts/package-windows.mjs",
      "test:packaged": "pnpm --filter @ether/testing test:packaged"
    });
    expect(testingPackage.scripts["test:packaged"]).toBe(
      "playwright test --config playwright.packaged.config.ts"
    );
  });

  it("requires the Electron 43 ESM entry and complete 4.0 runtime graph", async () => {
    const root = await createFakePackageRoot();
    try {
      expect(requiredPackageInputs(root).map((entry) => path.relative(root, entry.path))).toEqual([
        "node_modules\\electron\\dist\\electron.exe",
        "apps\\desktop\\dist\\index.html",
        "apps\\desktop\\dist-electron\\main\\bootstrap.js",
        "apps\\desktop\\dist-electron\\main\\main.js",
        "packages\\application\\dist\\index.js",
        "packages\\document\\dist\\index.js",
        "packages\\execution\\dist\\index.js",
        "packages\\graph-kernel\\dist\\index.js",
        "packages\\mcp-server\\dist\\index.js",
        "packages\\providers\\dist\\index.js",
        "packages\\recipes\\dist\\index.js",
        "packages\\schema\\dist\\index.js",
        "packages\\providers\\protocol\\codex-0.144.2\\manifest.json",
        "packages\\schema\\node_modules\\zod\\package.json",
        "packages\\mcp-server\\node_modules\\@modelcontextprotocol\\sdk\\package.json"
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates an unpacked package with dereferenced 4.0 dependencies and schema", async () => {
    const root = await createFakePackageRoot();
    try {
      const result = await packageWindowsApp({
        rootDir: root,
        outputDir: path.join(root, "release/ether-windows-unpacked")
      });
      const appRoot = path.join(result.outputDir, "resources", "app");
      await expect(readFile(path.join(result.outputDir, "Ether.exe"), "utf8")).resolves.toBe("fake exe");
      await expect(readFile(path.join(appRoot, "package.json"), "utf8")).resolves.toContain(
        '"main": "dist-electron/main/bootstrap.js"'
      );
      for (const packageDirectory of workspacePackages) {
        await expect(
          readFile(path.join(appRoot, `node_modules/@ether/${packageDirectory}/dist/index.js`), "utf8")
        ).resolves.toContain("packagedName");
      }
      await expect(
        readFile(path.join(appRoot, "node_modules/@ether/document/dist/schema/40000.sql"), "utf8")
      ).resolves.toContain("packaged schema");
      await expect(
        readFile(
          path.join(appRoot, "node_modules/@ether/providers/protocol/codex-0.144.2/manifest.json"),
          "utf8"
        )
      ).resolves.toContain('"version":"0.144.2"');
      expect((await lstat(path.join(appRoot, "node_modules/zod"))).isSymbolicLink()).toBe(false);
      expect((await lstat(path.join(appRoot, "node_modules/@modelcontextprotocol/sdk"))).isSymbolicLink()).toBe(false);
      expect((await lstat(
        path.join(appRoot, "node_modules/mcp-sdk-leaf")
      )).isSymbolicLink()).toBe(false);
      expect(execFileSync(process.execPath, [
        "--input-type=module",
        "--eval",
        "import('@ether/application').then((value) => console.log(value.packagedName))"
      ], { cwd: appRoot, encoding: "utf8" }).trim()).toBe("application");
      expect(execFileSync(process.execPath, [
        path.join(appRoot, "node_modules/@ether/mcp-server/dist/index.js"),
        "--stdio-probe"
      ], { cwd: appRoot, encoding: "utf8", input: "ping\n" }).trim()).toBe(
        "official-sdk:transitive:ping"
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("launches the actual packaged MCP server over stdio with the official SDK closure", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-mcp-package-runtime-"));
    const appRoot = path.join(root, "app");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(appRoot, "node_modules/@ether/mcp-server/dist/index.js")],
      cwd: appRoot,
      env: getDefaultEnvironment(),
      stderr: "pipe"
    });
    const client = new Client({ name: "ether-packaged-runtime-test", version: "4.0.0" });
    try {
      await packageApplicationRuntime(repoRoot, appRoot);
      await client.connect(transport);
      await expect(client.listTools()).resolves.toMatchObject({
        tools: expect.arrayContaining([expect.objectContaining({ name: "ether.document.inspect" })])
      });
    } finally {
      await client.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

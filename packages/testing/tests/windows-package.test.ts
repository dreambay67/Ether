import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPackageWithOptions, listPackage } from "@electron/asar";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

import {
  assertGeneratedBuilderConfig,
  assertPackagedInventoryMatches,
  assertReleaseArtifacts,
  assertReleaseInputs,
  assertReleaseTextPrivate,
  cleanupReleaseStaging,
  createCalibratedReleaseInventory,
  createStagedInventory,
  installerFileName,
  inventoryAsarFiles,
  inventoryAsarPayload,
  inventoryUnpackedFiles,
  prepareProductionRuntime,
  prepareReleaseProject,
  readReleaseMetadata,
  releaseAuditFileName,
  releaseDirectory,
  releasePathViolation,
  releaseRootArtifactViolation,
  reviewedBuilderConfigFileName,
  thirdPartyNoticesFileName
} from "../../../scripts/package-windows.mjs";

const repoRoot = path.resolve(__dirname, "../../..");

describe("Windows installer release contract", () => {
  it("aligns root, desktop, workspace, and document metadata at 4.0.0", async () => {
    const metadata = await readReleaseMetadata(repoRoot);
    expect(metadata.rootPackage.version).toBe("4.0.0");
    expect(metadata.desktopPackage).toMatchObject({ version: "4.0.0", main: "dist-electron/main/bootstrap.js" });
    const workspaceVersions = await Promise.all([
      "application", "brand", "codex-plugin", "document", "execution", "graph-kernel", "intelligence", "mcp-server", "providers", "recipes", "schema", "testing"
    ].map(async (directory) => JSON.parse(await readFile(path.join(repoRoot, "packages", directory, "package.json"), "utf8")).version));
    expect(workspaceVersions).toEqual(Array(workspaceVersions.length).fill("4.0.0"));
    const [mainSource, handlerSource, settingsSource, providerStatusSource] = await Promise.all([
      readFile(path.join(repoRoot, "apps/desktop/src/main/main.ts"), "utf8"),
      readFile(path.join(repoRoot, "apps/desktop/src/main/ipc/registerDocumentHandlers.ts"), "utf8"),
      readFile(path.join(repoRoot, "apps/desktop/src/renderer/project/SettingsPanel.tsx"), "utf8"),
      readFile(path.join(repoRoot, "apps/desktop/src/renderer/project/ProviderStatusPanel.tsx"), "utf8")
    ]);
    expect(mainSource).toContain("const appVersion = app.getVersion()");
    expect(mainSource).toMatch(/new LocalDiagnosticLogger\(\{\s*appDataRoot,\s*appVersion\s*\}\)/u);
    expect(mainSource).toMatch(/const serviceOptions:[\s\S]*?appDataRoot,\s*appVersion,/u);
    expect(handlerSource).toMatch(/runtime\.versions[\s\S]*?app: appVersion/u);
    expect(settingsSource).toContain('data-testid="about-ether"');
    expect(providerStatusSource).toContain('query("provider.health")');
    expect(providerStatusSource).toContain('query("provider.capabilities")');
    expect(providerStatusSource).not.toContain('query(documentId, "provider.');
  });

  it("keeps the manual main-process inspector outside production scripts, config, bootstrap, and packaging", async () => {
    const productionPaths = [
      "package.json",
      "apps/desktop/package.json",
      "apps/desktop/electron-builder.yml",
      "apps/desktop/src/main/bootstrap.ts",
      "apps/desktop/src/main/main.ts",
      "scripts/package-windows.mjs"
    ];
    const forbiddenCaptureMarkers = [
      "--inspect=",
      "--remote-debugging-port=",
      "captureMenuActions",
      "invokeCaptureMenuAction",
      "fixedMenuInvocationExpression",
      "Debugger listening on",
      'method: "Runtime.evaluate"'
    ];
    for (const relativePath of productionPaths) {
      const source = await readFile(path.join(repoRoot, relativePath), "utf8");
      for (const marker of forbiddenCaptureMarkers) {
        expect(source, `${relativePath} must not contain capture-only marker ${marker}`).not.toContain(marker);
      }
    }
  });

  it("fails closed on private release paths and assigned credential material", () => {
    for (const rejected of [
      "src/main.ts", "tests/runtime.test.js", "examples/demo.js", "docs/readme.txt", "bundle.js.map",
      "user.ether", "cache.sqlite3", "cache.db-wal", "diagnostics.log", "certificate.pem", "private.key",
      "module.cts", "module.mts", "component.jsx", ".env.production", "credentials.json",
      "benchmark/throughput.js", "spec/index.spec.js", "fixtures/schema.js", ".nycrc",
      ".editorconfig", ".runkit_example.js", "eslint.config.mjs", "tsconfig.json"
    ]) {
      expect(releasePathViolation(rejected), rejected).not.toBeNull();
    }
    for (const allowed of [
      "dist/main.js", "dist/index.html", "package.json", "LICENSE", "LICENSE.md", "license.md",
      "NOTICE.txt", thirdPartyNoticesFileName, "protocol/manifest.json",
      "dist-electron/main/security/pathGrants.js", "lib/sharp-win32-x64-0.35.3.node", "lib/libvips-42.dll"
    ]) {
      expect(releasePathViolation(allowed), allowed).toBeNull();
    }
    for (const secret of [
      `-----BEGIN PRIVATE KEY-----\n${"a".repeat(64)}\n${"b".repeat(64)}\n-----END PRIVATE KEY-----`,
      `OPENAI_API_KEY="${`sk-${"a".repeat(32)}`}"`,
      `GITHUB_TOKEN="${`ghp_${"b".repeat(36)}`}"`,
      `SLACK_BOT_TOKEN="${`xoxb-${"c".repeat(32)}`}"`,
      `AWS_ACCESS_KEY_ID=${`AKIA${"D".repeat(16)}`}`,
      `authorization: "Bearer ${"e".repeat(32)}"`
    ]) {
      expect(() => assertReleaseTextPrivate(secret, "synthetic-test", repoRoot)).toThrow(/credential|token|key|bearer/i);
    }
    for (const allowedRootArtifact of [
      "win-unpacked",
      "Ether-4.0.0-Setup.exe",
      "Ether-4.0.0-Setup.exe.blockmap",
      "electron-builder.generated.yml",
      "release-audit.json"
    ]) {
      expect(releaseRootArtifactViolation(allowedRootArtifact), allowedRootArtifact).toBeNull();
    }
    for (const rejectedRootArtifact of [
      "builder-debug.yml",
      "builder-effective-config.yaml",
      "latest.yml",
      "notes.txt"
    ]) {
      expect(releaseRootArtifactViolation(rejectedRootArtifact), rejectedRootArtifact).not.toBeNull();
    }
    for (const privatePath of [
      `${repoRoot}\\node_modules\\electron\\dist`,
      "C:\\Users\\release-user\\AppData\\Local\\Temp\\electron-builder\\messages.yml",
      "/home/release-user/Documents/Ether/release.yml"
    ]) {
      expect(() => assertReleaseTextPrivate(privatePath, "synthetic-side-artifact", repoRoot))
        .toThrow(/workspace|user-profile|personal user path/i);
    }
    expect(() => assertReleaseTextPrivate(
      "const header = `Authorization: Bearer ${token}`; const prefix = 'sk-'; const pemHeader = '-----BEGIN PRIVATE KEY-----';",
      "safe-sdk-source",
      repoRoot
    )).not.toThrow();
  });

  it("derives the Windows icon reproducibly from reviewed Ether and DreamBay assets", async () => {
    await assertReleaseInputs(repoRoot);
    const [ether, dreambay, icon] = await Promise.all([
      readFile(path.join(repoRoot, "packages/brand/src/assets/Ether_logo.png")),
      readFile(path.join(repoRoot, "packages/brand/src/assets/DB_logo.png")),
      readFile(path.join(repoRoot, "build/installer/ether.ico"))
    ]);
    expect(await readFile(path.join(repoRoot, "build/installer/ether.png"))).toEqual(ether);
    expect(await readFile(path.join(repoRoot, "build/installer/dreambay.png"))).toEqual(dreambay);
    expect(icon.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
    expect(icon.subarray(22, 30)).toEqual(Buffer.from("89504e470d0a1a0a", "hex"));
    expect(createHash("sha256").update(icon).digest("hex")).toHaveLength(64);
  });

  it("calibrates builder omissions and rewrites, excludes its own inventory, and rehashes both ASAR stores", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-asar-inventory-"));
    try {
      const source = path.join(root, "source");
      const project = path.join(root, "builder-output");
      const archive = path.join(root, "app.asar");
      const calibrationArchive = archive;
      await mkdir(path.join(source, ".github"), { recursive: true });
      await mkdir(path.join(source, "dist"), { recursive: true });
      await mkdir(path.join(project, "dist"), { recursive: true });
      await writeFile(
        path.join(source, "package.json"),
        '{"name":"inventory-fixture","version":"4.0.0","scripts":{"test":"vitest"},"keywords":["source-only"]}\n',
        "utf8"
      );
      await writeFile(path.join(source, ".github", "FUNDING.yml"), "github: source-only\n", "utf8");
      await writeFile(path.join(source, "dist", "main.js"), "export const value = 'reviewed';\n", "utf8");
      await writeFile(path.join(source, "runtime.node"), Buffer.from("reviewed-native-runtime"));
      const reviewedSource = await createStagedInventory(source);

      // Model electron-builder's real behavior: metadata is omitted and
      // package.json is rewritten before the ASAR is created.
      await writeFile(path.join(project, "package.json"), '{"name":"inventory-fixture","version":"4.0.0"}\n', "utf8");
      await writeFile(path.join(project, "dist", "main.js"), "export const value = 'reviewed';\n", "utf8");
      await writeFile(path.join(project, "runtime.node"), Buffer.from("reviewed-native-runtime"));
      await writeFile(path.join(project, "release-inventory.json"), "{}\n", "utf8");
      await createPackageWithOptions(project, calibrationArchive, { unpack: "**/*.node" });
      const calibratedPayload = inventoryAsarPayload(calibrationArchive);
      const calibratedUnpacked = await inventoryUnpackedFiles(calibrationArchive);
      const manifest = createCalibratedReleaseInventory({
        archiveEntries: calibratedPayload.entries,
        sourceInventory: reviewedSource,
        unpackedEntries: calibratedUnpacked
      });
      expect(reviewedSource.entries.map((entry) => entry.path)).toContain(".github/FUNDING.yml");
      expect(calibratedPayload.entries.map((entry) => entry.path)).not.toContain(".github/FUNDING.yml");
      expect(reviewedSource.entries.find((entry) => entry.path === "package.json")?.sha256)
        .not.toBe(calibratedPayload.entries.find((entry) => entry.path === "package.json")?.sha256);

      await rm(calibrationArchive, { force: true });
      await rm(`${calibrationArchive}.unpacked`, { recursive: true, force: true });
      await writeFile(
        path.join(project, "release-inventory.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8"
      );
      await createPackageWithOptions(project, archive, { unpack: "**/*.node" });
      const actualPayload = inventoryAsarPayload(archive);
      const actualUnpacked = await inventoryUnpackedFiles(archive);
      expect(listPackage(archive, { isPack: false }).map((entry) => entry.replace(/^[/\\]+/u, "")))
        .toContain("release-inventory.json");
      expect(actualPayload.entries.map((entry) => entry.path)).not.toContain("release-inventory.json");
      expect(manifest.entries.map((entry: { path: string }) => entry.path)).not.toContain("release-inventory.json");
      expect(assertPackagedInventoryMatches(manifest, actualPayload.entries, {
        actualUnpackedEntries: actualUnpacked,
        actualUnpackedPaths: actualPayload.unpackedPaths,
        expectedCalibratedInventory: manifest,
        expectedSourceInventory: reviewedSource
      })).toMatchObject({
        hash: manifest.hash,
        entries: manifest.entries,
        sourceHash: reviewedSource.hash,
        unpackedHash: manifest.unpackedHash
      });

      await writeFile(`${archive}.unpacked${path.sep}runtime.node`, Buffer.from("tampered-native-runtime"));
      const tamperedPayload = inventoryAsarPayload(archive);
      const tamperedUnpacked = await inventoryUnpackedFiles(archive);
      expect(() => assertPackagedInventoryMatches(manifest, inventoryAsarFiles(archive), {
        actualUnpackedEntries: tamperedUnpacked,
        actualUnpackedPaths: tamperedPayload.unpackedPaths,
        expectedSourceInventory: reviewedSource
      })).toThrow(/actual unpacked entry bytes/i);
      await writeFile(`${archive}.unpacked${path.sep}runtime.node`, Buffer.from("reviewed-native-runtime"));
      await writeFile(`${archive}.unpacked${path.sep}extra.node`, Buffer.from("unreferenced-native-runtime"));
      const extraPayload = inventoryAsarPayload(archive);
      const extraUnpacked = await inventoryUnpackedFiles(archive);
      expect(() => assertPackagedInventoryMatches(manifest, inventoryAsarFiles(archive), {
        actualUnpackedEntries: extraUnpacked,
        actualUnpackedPaths: extraPayload.unpackedPaths,
        expectedSourceInventory: reviewedSource
      })).toThrow(/headers differ from the physical unpacked file set/i);
      await rm(`${archive}.unpacked${path.sep}extra.node`, { force: true });

      await writeFile(path.join(project, "dist", "main.js"), "export const value = 'tampered';\n", "utf8");
      const staleArchive = path.join(root, "stale.asar");
      await createPackageWithOptions(project, staleArchive, { unpack: "**/*.node" });
      const stalePayload = inventoryAsarPayload(staleArchive);
      const staleUnpacked = await inventoryUnpackedFiles(staleArchive);
      expect(() => assertPackagedInventoryMatches(manifest, stalePayload.entries, {
        actualUnpackedEntries: staleUnpacked,
        actualUnpackedPaths: stalePayload.unpackedPaths,
        expectedSourceInventory: reviewedSource
      }))
        .toThrow(/actual ASAR entry bytes/i);

      await writeFile(path.join(source, "dist", "main.js"), "export const value = 'new-source';\n", "utf8");
      const staleSource = await createStagedInventory(source);
      expect(() => assertPackagedInventoryMatches(manifest, actualPayload.entries, {
        actualUnpackedEntries: actualUnpacked,
        actualUnpackedPaths: actualPayload.unpackedPaths,
        expectedSourceInventory: staleSource
      })).toThrow(/current audited staging inventory/i);
      expect(() => assertPackagedInventoryMatches(
        { ...manifest, hash: "0".repeat(64), repeatHash: "0".repeat(64) },
        actualPayload.entries,
        { actualUnpackedEntries: actualUnpacked, actualUnpackedPaths: actualPayload.unpackedPaths }
      ))
        .toThrow(/digest does not match/i);
      expect(() => assertPackagedInventoryMatches(
        manifest,
        [...actualPayload.entries, { path: "release-inventory.json", bytes: 2, sha256: createHash("sha256").update("{}").digest("hex") }],
        { actualUnpackedEntries: actualUnpacked, actualUnpackedPaths: actualPayload.unpackedPaths }
      )).toThrow(/exclude its recursive inventory file/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("audits a built release only when explicitly required so ordinary integration stays artifact-independent", async () => {
    const installer = path.join(releaseDirectory, installerFileName);
    const present = await stat(installer).then(() => true, () => false);
    const auditRequired = process.env.ETHER_REQUIRE_RELEASE_AUDIT === "1";
    if (!present && auditRequired) {
      throw new Error("Release audit requires a real Ether-4.0.0-Setup.exe. Run pnpm desktop:package:win first.");
    }
    if (!auditRequired) return;
    await assertReleaseArtifacts(releaseDirectory);
    const audit = JSON.parse(await readFile(path.join(releaseDirectory, releaseAuditFileName), "utf8"));
    expect(audit).toMatchObject({
      version: "4.0.0",
      stagedInventoryHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      stagedRepeatHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      archivePathHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(audit.stagedInventoryHash).toBe(audit.stagedRepeatHash);
    const generatedConfig = await readFile(path.join(releaseDirectory, reviewedBuilderConfigFileName), "utf8");
    expect(generatedConfig).toContain("appId: com.dreambay.ether");
    expect(generatedConfig).toContain("asar: true");
    expect(generatedConfig).toContain("oneClick: false");
    expect(generatedConfig).toContain("createDesktopShortcut: true");
    expect(generatedConfig).toContain("createStartMenuShortcut: true");
    expect(generatedConfig).toContain("shortcutName: Ether");
    expect(generatedConfig).toContain("guid: ad6cd9b2-3723-5b60-a3d0-3938212aac8e");
    expect(generatedConfig).toContain("DreamBay.Ether.Document");
    expect(generatedConfig.replaceAll("\\", "/").toLocaleLowerCase())
      .not.toContain(repoRoot.replaceAll("\\", "/").toLocaleLowerCase());
  }, 120_000);

  it("stages a sorted physical SDK/runtime closure and launches its MCP server", async () => {
    try {
      await prepareProductionRuntime(repoRoot);
      const releaseProject = await prepareReleaseProject(repoRoot);
      const runtimeRoot = path.join(releaseProject, "node_modules");
      const builder = await assertGeneratedBuilderConfig(releaseProject, repoRoot);
      expect(builder.sha256).toMatch(/^[a-f0-9]{64}$/);
      const generatedConfig = await readFile(path.join(releaseProject, "electron-builder.yml"), "utf8");
      expect(generatedConfig).not.toMatch(/[a-z]:[\\/]/i);
      expect(generatedConfig).toContain("output: ../../../release/windows");
      expect(generatedConfig).toContain(`  - ${thirdPartyNoticesFileName}`);
      const notices = await readFile(path.join(releaseProject, thirdPartyNoticesFileName), "utf8");
      expect(notices).toContain("ETHER 4.0 THIRD-PARTY NOTICES");
      expect(notices).toContain("@img/sharp-win32-x64");
      expect(notices).toContain("libvips");
      expect(notices).toContain("LGPLv3");
      const inventory = await createStagedInventory(releaseProject);
      expect(inventory.entries.length).toBeGreaterThan(100);
      expect(inventory.entries.some((entry) => entry.path === "electron-builder.yml")).toBe(false);
      expect(inventory.entries.some((entry) => entry.path.startsWith("docs/manual/"))).toBe(false);
      expect(inventory.entries.map((entry) => entry.path))
        .toContain("node_modules/@ether/application/dist/atomicExportPublisher.js");
      expect(inventory.entries.map((entry) => entry.path)).toEqual(expect.arrayContaining([
        thirdPartyNoticesFileName,
        "node_modules/@img/colour/LICENSE.md",
        "node_modules/express-rate-limit/license.md",
        "node_modules/jose/LICENSE.md",
        "node_modules/json-schema-typed/LICENSE.md",
        "node_modules/ms/license.md",
        "node_modules/qs/LICENSE.md"
      ]));
      expect(inventory.entries.map((entry) => entry.path)).not.toEqual(expect.arrayContaining([
        "node_modules/@ether/document/dist/benchmark/pageSizeBenchmark.js",
        "node_modules/fast-uri/benchmark/benchmark.mjs",
        "node_modules/json-schema-traverse/spec/index.spec.js"
      ]));
      expect(inventory.entries.map((entry) => entry.path)).toEqual(
        [...inventory.entries.map((entry) => entry.path)].sort((left, right) => left.localeCompare(right))
      );
      for (const relativePath of [
        "../dist-electron/main/diagnostics/localDiagnostics.js",
        "../dist-electron/main/protocol/etherAssetProtocol.js",
        "../dist-electron/main/security/navigationPolicy.js",
        "../dist-electron/main/security/pathGrants.js",
        "@ether/application/dist/index.js", "@ether/document/dist/schema/40000.sql",
        "@ether/document/dist/sqliteSecurity.js",
        "@ether/providers/protocol/codex-0.144.2/manifest.json", "@modelcontextprotocol/sdk/package.json", "zod/package.json",
        "zod-to-json-schema/package.json", "ajv/package.json", "express/package.json", "hono/package.json",
        "@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.3.node", "@img/sharp-win32-x64/lib/libvips-42.dll"
      ]) {
        const absolutePath = path.join(runtimeRoot, relativePath);
        expect((await stat(absolutePath)).isFile()).toBe(true);
        expect((await lstat(absolutePath)).isSymbolicLink()).toBe(false);
      }
      const [packagedBootstrap, packagedMain, packagedApplicationService] = await Promise.all([
        readFile(path.join(releaseProject, "dist-electron/main/bootstrap.js"), "utf8"),
        readFile(path.join(releaseProject, "dist-electron/main/main.js"), "utf8"),
        readFile(path.join(releaseProject, "dist-electron/main/services/applicationService.js"), "utf8")
      ]);
      expect(packagedBootstrap).toContain("./protocol/etherAssetProtocol.js");
      expect(packagedBootstrap).toContain("./security/navigationPolicy.js");
      expect(packagedBootstrap).toContain("installChromiumNetworkContainment(app.commandLine)");
      expect(packagedBootstrap).toContain('import("./main.js")');
      expect(packagedMain).toContain("./diagnostics/localDiagnostics.js");
      expect(packagedMain).toContain("./security/navigationPolicy.js");
      expect(packagedApplicationService).toContain("../security/pathGrants.js");
      for (const packagedSource of [packagedBootstrap, packagedMain, packagedApplicationService]) {
        for (const marker of [
          "--inspect=",
          "--remote-debugging-port=",
          "captureMenuActions",
          "invokeCaptureMenuAction",
          "fixedMenuInvocationExpression",
          "Debugger listening on",
          'method: "Runtime.evaluate"'
        ]) {
          expect(packagedSource).not.toContain(marker);
        }
      }
      const client = new Client({ name: "ether-packaged-runtime-test", version: "4.0.0" });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(runtimeRoot, "@ether/mcp-server/dist/index.js")],
        cwd: releaseProject
      });
      try {
        await client.connect(transport);
        await expect(client.listTools()).resolves.toMatchObject({
          tools: expect.arrayContaining([expect.objectContaining({ name: "ether.document.inspect" })])
        });
      } finally {
        await client.close().catch(() => undefined);
      }
    } finally {
      await cleanupReleaseStaging(repoRoot);
    }
  }, 120_000);
});

import { DatabaseSync } from "node:sqlite";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeImageProvider } from "@ether/providers";
import { createEtherDocument, inspectEtherDocument } from "@ether/document";
import {
  EtherApplication,
  prepareExportDestinationParent
} from "../../application/src/application";
import {
  publishAtomicExportBundle,
  publishAtomicExportFile,
  stableExportPublicationId,
  type ExportPublicationCheckpoint
} from "../../application/src/atomicExportPublisher";

import {
  MAX_ETHER_ASSET_BYTES,
  MAX_ETHER_ASSET_RANGE_BYTES,
  createEtherAssetProtocolHandler
} from "../../../apps/desktop/src/main/protocol/etherAssetProtocol";
import { isAllowedRendererNavigation } from "../../../apps/desktop/src/main/security/navigationPolicy";
import { canonicalGrantPath, pathGrantKey } from "../../../apps/desktop/src/main/security/pathGrants";
import {
  DesktopApplicationService,
  DesktopPathGrantAuthority
} from "../../../apps/desktop/src/main/services/applicationService";
import { registerDocumentHandlers } from "../../../apps/desktop/src/main/ipc/registerDocumentHandlers";
import { openEtherDocumentConnection } from "../../document/src/database";
import {
  ETHER_SQLITE_SECURITY_UNAVAILABLE,
  hardenEtherSqliteConnection,
  inspectEtherSqliteSecurityCapabilities,
  withEtherVacuumCapability
} from "../../document/src/sqliteSecurity";
import { createMainWindowOptions } from "../../../apps/desktop/src/main/windowOptions";
import {
  assertAuthorizedSenderFrame,
  assertTrustedIpcSender,
  desktopIpcContracts
} from "../../../apps/desktop/src/shared/ipc/contracts";
import { desktopIpcChannels } from "../../../apps/desktop/src/shared/ipc/channels";

const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), "ether-security-"));
  roots.push(value);
  return value;
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await lstat(filePath).then(() => true).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${filePath}.`);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (directory) => {
    await (await import("node:fs/promises")).rm(directory, { recursive: true, force: true });
  }));
});

describe("desktop security boundaries", () => {
  it("keeps the renderer isolated and rejects foreign frame, sender, and payload input", () => {
    expect(createMainWindowOptions("preload.cjs").webPreferences).toMatchObject({
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      allowRunningInsecureContent: false, webviewTag: false
    });
    const frame = {};
    expect(() => assertAuthorizedSenderFrame({}, frame)).toThrowError(expect.objectContaining({ code: "IPC_SENDER_REJECTED" }));
    expect(() => assertTrustedIpcSender(
      { webContentsId: 4, senderFrameUrl: "https://attacker.invalid/", origin: "https://attacker.invalid" },
      { webContentsId: 4, rendererUrl: "http://127.0.0.1:5173/" }
    )).toThrowError(expect.objectContaining({ code: "IPC_SENDER_REJECTED" }));
    expect(desktopIpcContracts[desktopIpcChannels.permissions.grantDroppedFile].request.safeParse({
      documentId: "document-1", purpose: "reference", nativePath: "C:\\private\\image.png", extra: true
    }).success).toBe(false);
  });

  it("allows only the exact configured renderer URL and no popup destination", () => {
    expect(isAllowedRendererNavigation("http://127.0.0.1:5173/", "http://127.0.0.1:5173/")).toBe(true);
    for (const url of ["http://127.0.0.1:5173/settings", "file:///C:/Windows/System32/calc.exe", "https://example.com/"]) {
      expect(isAllowedRendererNavigation(url, "http://127.0.0.1:5173/")).toBe(false);
    }
  });

  it("canonicalizes grants through symlinks and rejects relative, NUL, and delimiter-injection input", async () => {
    const directory = await root();
    const target = path.join(directory, "target.png");
    const link = path.join(directory, "link.png");
    await writeFile(target, "not used");
    try {
      await symlink(target, link, "file");
      expect(canonicalGrantPath(link)).toBe(canonicalGrantPath(target));
    } catch (error) {
      // Symlink privilege can be unavailable on locked-down Windows profiles; path validation remains deterministic.
      expect(["EPERM", "EACCES"]).toContain((error as { code?: string }).code);
    }
    expect(() => canonicalGrantPath("relative.png")).toThrowError(expect.objectContaining({ code: "PATH_GRANT_INVALID" }));
    expect(() => canonicalGrantPath(`${directory}\0escape`)).toThrowError(expect.objectContaining({ code: "PATH_GRANT_INVALID" }));
    expect(() => pathGrantKey("grant\0other", "document-1")).toThrowError(expect.objectContaining({ code: "PATH_GRANT_INVALID" }));
  });

  it("uses canonical identity in the real grant authority and fails closed after revoke or path replacement", async () => {
    const directory = await root();
    const documentPath = path.join(directory, "Scope.ether");
    const target = path.join(directory, "reference.png");
    const replacement = path.join(directory, "replacement.png");
    await writeFile(documentPath, "scope identity");
    await writeFile(target, "original");
    await writeFile(replacement, "replacement");
    const storagePath = path.join(directory, "grants", "reference-grants.json");
    const authority = new DesktopPathGrantAuthority({ storagePath });
    authority.activateDocument("document-1", documentPath);
    const grantId = authority.grant("document-1", "link", target);
    expect(authority.resolveDroppedFileGrant({
      documentId: "document-1", pathGrantId: grantId, operation: "link"
    }).path).toBe(canonicalGrantPath(target));

    const reloaded = new DesktopPathGrantAuthority({ storagePath });
    reloaded.activateDocument("document-1", documentPath);
    expect(reloaded.resolveDroppedFileGrant({
      documentId: "document-1", pathGrantId: grantId, operation: "link"
    }).path).toBe(canonicalGrantPath(target));

    await rename(target, path.join(directory, "original-away.png"));
    await rename(replacement, target);
    expect(() => reloaded.resolveDroppedFileGrant({
      documentId: "document-1", pathGrantId: grantId, operation: "link"
    })).toThrowError(expect.objectContaining({ code: "PATH_PERMISSION_REQUIRED" }));
    expect(reloaded.revoke(grantId, "document-1")).toBe("revoked");
    expect(() => reloaded.resolveDroppedFileGrant({
      documentId: "document-1", pathGrantId: grantId, operation: "link"
    })).toThrowError(expect.objectContaining({ code: "PATH_PERMISSION_REQUIRED" }));
    expect(() => authority.grant("document-1", "link", `${directory}\0escape`))
      .toThrowError(expect.objectContaining({ code: "PATH_GRANT_INVALID" }));
  });

  it("revalidates a cached export grant before every use and writes nothing after a root swap", async () => {
    const directory = await root();
    const documentPath = path.join(directory, "Export.ether");
    const exportRoot = path.join(directory, "exports");
    const displacedRoot = path.join(directory, "exports-original");
    await mkdir(exportRoot);
    const authority = new DesktopPathGrantAuthority({
      storagePath: path.join(directory, "grants", "reference-grants.json")
    });
    const app = new EtherApplication({
      appDataRoot: path.join(directory, "appdata"),
      appVersion: "4.0.0",
      provider: new FakeImageProvider(),
      pathGrantResolver: {
        resolve: (input) => authority.resolveApplicationPathGrant(input)
      }
    });
    await app.createDocument({
      path: documentPath,
      title: "Export",
      initialGraph: {
        id: "root",
        title: "Export",
        kind: "root",
        createdAt: "2026-07-23T00:00:00.000Z",
        updatedAt: "2026-07-23T00:00:00.000Z",
        nodes: [],
        edges: [],
        groups: [],
        modules: [],
        viewState: {
          viewport: { x: 0, y: 0, zoom: 1 },
          selectedNodeIds: [],
          selectedEdgeIds: [],
          inspectorTarget: null
        }
      }
    });
    const document = await app.queryDocument();
    authority.activateDocument(document.documentId, documentPath);
    const grantId = authority.grant(document.documentId, "export", exportRoot);
    await app.grantPathPermit("grant-export", grantId, "export");

    await rename(exportRoot, displacedRoot);
    await mkdir(exportRoot);
    await expect(app.exportArtifacts({
      artifactIds: ["never-read-after-revocation"],
      collisionPolicy: "error",
      commandId: "export-after-swap",
      namingTemplate: "{artifactId}",
      pathGrantId: grantId
    })).rejects.toMatchObject({ code: "PATH_PERMISSION_REQUIRED" });
    expect(await readdir(exportRoot)).toEqual([]);
    await app.closeDocument();
  });

  it("rejects a descendant directory junction before creating or publishing an export", async () => {
    const directory = await root();
    const exportRoot = path.join(directory, "exports");
    const outside = path.join(directory, "outside");
    const collection = path.join(exportRoot, "Collection");
    await mkdir(exportRoot);
    await mkdir(outside);
    try {
      await symlink(outside, collection, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      expect(["EPERM", "EACCES"]).toContain((error as { code?: string }).code);
      return;
    }
    await expect(prepareExportDestinationParent(
      exportRoot,
      path.join(collection, "escaped.png")
    )).rejects.toMatchObject({ code: "PATH_ESCAPE" });
    expect(await readdir(outside)).toEqual([]);
  });

  it("locks the exact parent across same-parent staging and publication for main and sidecar files", async () => {
    if (process.platform !== "win32") return;
    for (const checkpoint of ["after-stage-open", "after-stage-write"] satisfies ExportPublicationCheckpoint[]) {
      for (const fileName of ["artifact.png", "artifact.png.metadata.json"]) {
      const directory = await root();
      const exportRoot = path.join(directory, "exports");
      const collection = path.join(exportRoot, "Collection");
      const displaced = path.join(exportRoot, "Collection-original");
      const displacedRoot = path.join(directory, "exports-original");
      const outside = path.join(directory, "outside");
      const sourceRoot = path.join(directory, "appdata", "bundle");
      const sourcePath = path.join(sourceRoot, "output.bin");
      const markerPath = path.join(directory, `${checkpoint}-${fileName}.marker`);
      const releasePath = path.join(directory, `${checkpoint}-${fileName}.release`);
      const bytes = Buffer.from(`complete-${checkpoint}-${fileName}`);
      await mkdir(collection, { recursive: true });
      await mkdir(outside);
      await mkdir(sourceRoot, { recursive: true });
      await writeFile(sourcePath, bytes);
      const publication = publishAtomicExportFile({
        checkpoint,
        checkpointMarkerPath: markerPath,
        checkpointReleasePath: releasePath,
        destination: path.join(collection, fileName),
        expectedByteLength: bytes.byteLength,
        expectedHash: (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"),
        publicationId: stableExportPublicationId(checkpoint, fileName),
        root: exportRoot,
        sourcePath
      });
      await waitForFile(markerPath);
      await expect(rename(collection, displaced)).rejects.toMatchObject({
        code: expect.stringMatching(/EACCES|EBUSY|EPERM/u)
      });
      await expect(rename(exportRoot, displacedRoot)).rejects.toMatchObject({
        code: expect.stringMatching(/EACCES|EBUSY|EPERM/u)
      });
      await writeFile(releasePath, "release");
      await expect(publication).resolves.toBe("published");
      expect(await readdir(outside)).toEqual([]);
      expect(await readFile(path.join(collection, fileName))).toEqual(bytes);
      expect(await readdir(collection)).toEqual([fileName]);
      expect(await lstat(displaced).then(() => true).catch(() => false)).toBe(false);
      expect(await lstat(displacedRoot).then(() => true).catch(() => false)).toBe(false);
      }
    }
  }, 180_000);

  it("publishes with atomic no-overwrite collision semantics", async () => {
    const directory = await root();
    const exportRoot = path.join(directory, "exports");
    const sourceRoot = path.join(directory, "appdata", "bundle");
    const destination = path.join(exportRoot, "artifact.png");
    const sourcePath = path.join(sourceRoot, "output.bin");
    const expected = Buffer.from("new complete export");
    const existing = Buffer.from("existing user file");
    await mkdir(exportRoot, { recursive: true });
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(sourcePath, expected);
    await writeFile(destination, existing);
    await expect(publishAtomicExportFile({
      destination,
      expectedByteLength: expected.byteLength,
      expectedHash: (await import("node:crypto")).createHash("sha256").update(expected).digest("hex"),
      publicationId: stableExportPublicationId("collision", "artifact.png"),
      root: exportRoot,
      sourcePath
    })).rejects.toMatchObject({ code: "EXPORT_COLLISION" });
    expect(await readFile(destination)).toEqual(existing);
    expect(await readdir(exportRoot)).toEqual(["artifact.png"]);
  });

  it("publishes beneath a real Windows drive-root grant", async () => {
    if (process.platform !== "win32") return;
    const directory = await root();
    const sourceRoot = path.join(directory, "appdata", "bundle");
    const sourcePath = path.join(sourceRoot, "drive-root-source.bin");
    const destination = path.join(directory, "drive-root-publication.bin");
    const bytes = Buffer.from("drive-root-publication");
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(sourcePath, bytes);

    await expect(publishAtomicExportFile({
      destination,
      expectedByteLength: bytes.byteLength,
      expectedHash: (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"),
      publicationId: stableExportPublicationId("drive-root", destination),
      root: path.parse(directory).root,
      sourcePath
    })).resolves.toBe("published");
    expect(await readFile(destination)).toEqual(bytes);
  }, 120_000);

  it("rejects root and intermediate junction replacement before helper lock acquisition", async () => {
    if (process.platform !== "win32") return;
    for (const swappedComponent of ["root", "intermediate"] as const) {
      const directory = await root();
      const exportRoot = path.join(directory, "exports");
      const collection = path.join(exportRoot, "Collection");
      const outside = path.join(directory, "outside");
      const displaced = swappedComponent === "root"
        ? path.join(directory, "exports-original")
        : path.join(exportRoot, "Collection-original");
      const sourceRoot = path.join(directory, "appdata", "bundle");
      const sourcePath = path.join(sourceRoot, "output.bin");
      const destination = path.join(collection, "artifact.png");
      const bytes = Buffer.from(`junction-${swappedComponent}`);
      await mkdir(collection, { recursive: true });
      await mkdir(outside);
      await mkdir(sourceRoot, { recursive: true });
      await writeFile(sourcePath, bytes);
      await expect(publishAtomicExportFile({
        beforeAcquire: async () => {
          const target = swappedComponent === "root" ? exportRoot : collection;
          await rename(target, displaced);
          await symlink(outside, target, "junction");
        },
        destination,
        expectedByteLength: bytes.byteLength,
        expectedHash: (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"),
        publicationId: stableExportPublicationId("pre-acquire", swappedComponent),
        root: exportRoot,
        sourcePath
      })).rejects.toMatchObject({ code: "PATH_GRANT_CHANGED" });
      expect(await readdir(outside)).toEqual([]);
      const displacedCollection = swappedComponent === "root"
        ? path.join(displaced, "Collection")
        : displaced;
      expect(await readdir(displacedCollection)).toEqual([]);
    }
  }, 120_000);

  it("classifies a removed verified directory as a changed path grant", async () => {
    if (process.platform !== "win32") return;
    const directory = await root();
    const exportRoot = path.join(directory, "exports");
    const collection = path.join(exportRoot, "Collection");
    const displaced = path.join(exportRoot, "Collection-original");
    const sourceRoot = path.join(directory, "appdata", "bundle");
    const sourcePath = path.join(sourceRoot, "output.bin");
    const destination = path.join(collection, "artifact.png");
    const bytes = Buffer.from("removed-directory");
    await mkdir(collection, { recursive: true });
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(sourcePath, bytes);

    await expect(publishAtomicExportFile({
      beforeAcquire: async () => {
        await rename(collection, displaced);
      },
      destination,
      expectedByteLength: bytes.byteLength,
      expectedHash: (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"),
      publicationId: stableExportPublicationId("pre-acquire", "removed"),
      root: exportRoot,
      sourcePath
    })).rejects.toMatchObject({ code: "PATH_GRANT_CHANGED" });
    expect(await readdir(displaced)).toEqual([]);
  }, 120_000);

  it("serializes concurrent whole-bundle publication and adopts matching outputs", async () => {
    if (process.platform !== "win32") return;
    const directory = await root();
    const exportRoot = path.join(directory, "exports");
    const sourceRoot = path.join(directory, "appdata", "bundle");
    await mkdir(exportRoot, { recursive: true });
    await mkdir(sourceRoot, { recursive: true });
    const outputs = await Promise.all([
      ["artifact.png", "main"],
      ["artifact.png.metadata.json", "metadata"],
      ["artifact.png.lineage.json", "lineage"]
    ].map(async ([fileName, contents]) => {
      const bytes = Buffer.from(contents!);
      const sourcePath = path.join(sourceRoot, `${fileName}.bin`);
      await writeFile(sourcePath, bytes);
      return {
        destination: path.join(exportRoot, fileName!),
        expectedByteLength: bytes.byteLength,
        expectedHash: (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"),
        publicationId: stableExportPublicationId("concurrent", fileName!),
        sourcePath
      };
    }));
    const results = await Promise.all([
      publishAtomicExportBundle({ outputs, root: exportRoot }),
      publishAtomicExportBundle({ outputs, root: exportRoot })
    ]);
    for (let index = 0; index < outputs.length; index += 1) {
      expect(results.map((result) => result[index]).sort()).toEqual(["existing", "published"]);
    }
    expect((await readdir(exportRoot)).sort()).toEqual(outputs
      .map((output) => path.basename(output.destination))
      .sort());
    expect(await lstat(path.join(sourceRoot, ".publisher")).then(() => true).catch(() => false))
      .toBe(false);
  }, 120_000);

  it("refuses a reparse point at the manifest-owned same-parent stage", async () => {
    if (process.platform !== "win32") return;
    const directory = await root();
    const exportRoot = path.join(directory, "exports");
    const outside = path.join(directory, "outside");
    const sourceRoot = path.join(directory, "appdata", "bundle");
    const sourcePath = path.join(sourceRoot, "output.bin");
    const bytes = Buffer.from("stage-reparse");
    const publicationId = stableExportPublicationId("stage", "reparse");
    await mkdir(exportRoot, { recursive: true });
    await mkdir(outside);
    await mkdir(sourceRoot, { recursive: true });
    await writeFile(sourcePath, bytes);
    await symlink(
      outside,
      path.join(exportRoot, `.ether-export-${publicationId}.stage`),
      "junction"
    );
    await expect(publishAtomicExportFile({
      destination: path.join(exportRoot, "artifact.png"),
      expectedByteLength: bytes.byteLength,
      expectedHash: (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex"),
      publicationId,
      root: exportRoot,
      sourcePath
    })).rejects.toMatchObject({ code: "PATH_GRANT_CHANGED" });
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(exportRoot)).toEqual([`.ether-export-${publicationId}.stage`]);
  });

  it("hardens every Ether SQLite connection and rejects hostile JSON and schema objects", async () => {
    const directory = await root();
    const documentPath = path.join(directory, "Hostile.ether");
    createEtherDocument(documentPath, {
      appVersion: "4.0.0",
      documentId: "hostile-document",
      title: "Hostile"
    });
    const connection = openEtherDocumentConnection(documentPath, false);
    try {
      expect(connection.database.prepare("PRAGMA trusted_schema").get()).toEqual({ trusted_schema: 0 });
      expect(() => connection.database.enableLoadExtension(true)).toThrow();
      expect(() => connection.database.exec("ATTACH DATABASE ':memory:' AS hostile"))
        .toThrow(/authoriz|not authorized/i);
      expect(connection.database.prepare("PRAGMA database_list").all())
        .toEqual([
          expect.objectContaining({ name: "main" }),
          expect.objectContaining({ name: "temp" })
        ]);
    } finally {
      connection.database.close();
    }

    const malformed = new DatabaseSync(documentPath);
    malformed.exec("PRAGMA ignore_check_constraints = ON; UPDATE document SET feature_flags_json = '{\"broken\":'");
    malformed.close();
    expect(() => inspectEtherDocument(documentPath))
      .toThrowError(expect.objectContaining({ code: "INVALID_DOCUMENT_METADATA" }));

    const triggerPath = path.join(directory, "HostileTrigger.ether");
    createEtherDocument(triggerPath, {
      appVersion: "4.0.0",
      documentId: "hostile-trigger",
      title: "Hostile trigger"
    });
    const trigger = new DatabaseSync(triggerPath);
    trigger.exec("CREATE TRIGGER hostile_trigger AFTER UPDATE ON document BEGIN SELECT 1; END");
    trigger.close();
    expect(() => inspectEtherDocument(triggerPath))
      .toThrowError(expect.objectContaining({ code: "SCHEMA_MISMATCH" }));
  });

  it("fails closed without required SQLite controls and restores the authorizer after VACUUM capability use", () => {
    expect(() => hardenEtherSqliteConnection({} as DatabaseSync)).toThrowError(
      expect.objectContaining({ code: ETHER_SQLITE_SECURITY_UNAVAILABLE })
    );

    const database = new DatabaseSync(":memory:");
    try {
      expect(inspectEtherSqliteSecurityCapabilities(database)).toEqual({
        defensiveMode: true,
        statementAuthorizer: true
      });
      hardenEtherSqliteConnection(database);
      expect(withEtherVacuumCapability(database, () => 42)).toBe(42);
      expect(() => database.exec("ATTACH DATABASE ':memory:' AS after_success"))
        .toThrow(/authoriz|not authorized/i);
      expect(() => withEtherVacuumCapability(database, () => {
        throw new Error("injected compact failure");
      })).toThrow("injected compact failure");
      expect(() => database.exec("ATTACH DATABASE ':memory:' AS after_failure"))
        .toThrow(/authoriz|not authorized/i);
    } finally {
      database.close();
    }
  });

  it("enforces hostile IPC through sender, schema, scope, and the real dropped-file authority", async () => {
    const directory = await root();
    const service = new DesktopApplicationService({
      appDataRoot: path.join(directory, "appdata"),
      appVersion: "4.0.0",
      dialogs: {
        openDocument: async () => null,
        saveDocument: async () => null,
        locateReference: async () => null,
        searchReferenceFolder: async () => null,
        confirmPortable: async () => false
      },
      provider: new FakeImageProvider(),
      simulationMode: true
    });
    const active = await service.bootstrap();
    const dropped = path.join(directory, "Dropped.ether");
    createEtherDocument(dropped, {
      appVersion: "4.0.0",
      documentId: "dropped-document",
      title: "Dropped"
    });
    const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
    const mainFrame = { url: "http://127.0.0.1:5173/" };
    const webContents = { id: 7, mainFrame, send: () => undefined };
    let openedPath: string | null = null;
    const dispose = registerDocumentHandlers({
      appVersion: "4.0.0",
      ipcMain: {
        handle: (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => handlers.set(channel, handler),
        removeHandler: (channel: string) => handlers.delete(channel)
      } as never,
      mainWindow: { isDestroyed: () => false, webContents } as never,
      rendererUrl: "http://127.0.0.1:5173/",
      service,
      openDocument: async () => active,
      repairDocument: async () => ({ kind: "cancelled" as const }),
      cancelRepair: () => undefined,
      openPath: async (filePath) => { openedPath = filePath; return active; }
    });
    const trustedEvent = {
      sender: { id: 7 },
      senderFrame: mainFrame
    };
    try {
      const grantHandler = handlers.get(desktopIpcChannels.permissions.grantDroppedFile)!;
      const foreign = await grantHandler(
        { sender: { id: 99 }, senderFrame: { url: "https://attacker.invalid/" } },
        { documentId: active.documentId, purpose: "open-document", nativePath: dropped }
      );
      expect(foreign).toMatchObject({ ok: false, error: { code: "IPC_SENDER_REJECTED" } });
      const malformed = await grantHandler(trustedEvent, {
        documentId: active.documentId,
        purpose: "open-document",
        nativePath: dropped,
        injected: true
      });
      expect(malformed).toMatchObject({ ok: false, error: { category: "validation" } });

      const granted = await grantHandler(trustedEvent, {
        documentId: active.documentId,
        purpose: "open-document",
        nativePath: dropped
      }) as { ok: true; value: { grantId: string } };
      expect(granted.ok).toBe(true);
      const openHandler = handlers.get(desktopIpcChannels.document.openDropped)!;
      expect(await openHandler(trustedEvent, {
        documentId: "foreign-document",
        pathGrantId: granted.value.grantId
      })).toMatchObject({ ok: false, error: { code: "DOCUMENT_SCOPE_REJECTED" } });
      expect(await openHandler(trustedEvent, {
        documentId: active.documentId,
        pathGrantId: granted.value.grantId
      })).toMatchObject({ ok: true });
      expect(openedPath).toBe(canonicalGrantPath(dropped));
      expect(await openHandler(trustedEvent, {
        documentId: active.documentId,
        pathGrantId: granted.value.grantId
      })).toMatchObject({ ok: false, error: { code: "PATH_PERMISSION_REQUIRED" } });
    } finally {
      dispose();
      await service.close();
      await rm(path.join(directory, "appdata"), { recursive: true, force: true });
    }
  });

  it("fails closed for executable, malformed, oversized, and oversized-range asset descriptors", async () => {
    const handler = createEtherAssetProtocolHandler({
      authorize: async (_documentId, artifactId) => artifactId === "good"
        ? { byteLength: MAX_ETHER_ASSET_RANGE_BYTES + 1, contentHash: "safe-hash", mediaType: "image/png" }
        : artifactId === "huge"
          ? { byteLength: MAX_ETHER_ASSET_BYTES + 1, contentHash: "safe-hash", mediaType: "image/png" }
          : { byteLength: 8, contentHash: "unsafe\"hash", mediaType: "application/x-msdownload" },
      streamRange: async function* () {
        yield* [];
        throw new Error("must not stream rejected data");
      }
    });
    expect((await handler(new Request("ether-asset://doc/bad/original"))).status).toBe(404);
    expect((await handler(new Request("ether-asset://doc/huge/original"))).status).toBe(404);
    expect((await handler(new Request("ether-asset://doc/good/original"))).status).toBe(416);
    expect((await handler(new Request("ether-asset://doc/good/original", { headers: { Range: "bytes=0-1" } }))).status).toBe(206);
    for (const range of [
      "bytes=-",
      `bytes=${MAX_ETHER_ASSET_RANGE_BYTES + 1}-${MAX_ETHER_ASSET_RANGE_BYTES + 2}`,
      "bytes=5-4",
      "bytes=0-1,4-5",
      "items=0-1"
    ]) {
      expect((await handler(new Request("ether-asset://doc/good/original", { headers: { Range: range } }))).status).toBe(416);
    }
    expect((await handler(new Request("ether-asset://doc/%2e%2e/original"))).status).toBe(400);
    expect((await handler(new Request("ether-asset://doc/good/original", { method: "POST" }))).status).toBe(405);
  });
});

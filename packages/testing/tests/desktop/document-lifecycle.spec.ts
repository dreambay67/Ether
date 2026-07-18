import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { EtherApplication } from "@ether/application";
import { DocumentStore, importBlob, linkReference } from "@ether/document";
import { FakeImageProvider } from "@ether/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AutosaveCoordinator,
  DesktopApplicationService,
  DesktopPathGrantAuthority,
  OpenDocumentController,
  OpenDocumentCoordinator,
  referenceCapabilities,
  type NativeDialogPort
} from "../../../../apps/desktop/src/main/services/applicationService";
import * as applicationServiceModule from "../../../../apps/desktop/src/main/services/applicationService";
import {
  createEtherAssetProtocolHandler,
  type EtherAssetSource
} from "../../../../apps/desktop/src/main/protocol/etherAssetProtocol";
import { reduceDocumentSession } from "../../../../apps/desktop/src/renderer/project/useDocumentSession";

const roots: string[] = [];

async function tempRoot(prefix: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function dialogs(overrides: Partial<NativeDialogPort> = {}): NativeDialogPort {
  return {
    openDocument: async () => null,
    saveDocument: async () => null,
    locateReference: async () => null,
    searchReferenceFolder: async () => null,
    confirmPortable: async () => true,
    ...overrides
  };
}

function pngBytes(size: number, fill: number) {
  const bytes = Buffer.alloc(Math.max(size, 8), fill);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  return bytes;
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("desktop document lifecycle", () => {
  it("creates an immediate untitled AppData-owned document without exposing its path", async () => {
    const appDataRoot = await tempRoot("ether-desktop-appdata-");
    const service = new DesktopApplicationService({
      appDataRoot,
      appVersion: "4.0.0-test",
      dialogs: dialogs(),
      provider: new FakeImageProvider()
    });

    const snapshot = await service.bootstrap();

    expect(snapshot).toMatchObject({ displayName: "Untitled", named: false, mode: "writable" });
    expect(snapshot).not.toHaveProperty("path");
    const untitledFiles = await readdir(path.join(appDataRoot, "untitled"));
    expect(untitledFiles).toHaveLength(1);
    expect(untitledFiles[0]).toMatch(/\.ether$/);
    await service.close();
  });

  it("saves, saves as, saves a copy, compacts, and reopens one validated Ether file", async () => {
    const root = await tempRoot("ether-desktop-lifecycle-");
    const appDataRoot = path.join(root, "appdata");
    const campaignPath = path.join(root, "Campaign with space.ether");
    const renamedPath = path.join(root, "Kampaň Ω.ether");
    const copyPath = path.join(root, "Campaign copy.ether");
    await mkdir(appDataRoot, { recursive: true });
    const saveDestinations = [campaignPath, renamedPath, copyPath];
    const service = new DesktopApplicationService({
      appDataRoot,
      appVersion: "4.0.0-test",
      dialogs: dialogs({ saveDocument: async () => saveDestinations.shift() ?? null }),
      provider: new FakeImageProvider()
    });

    const untitled = await service.bootstrap();
    const saved = await service.save(untitled.documentId);
    expect(saved).toMatchObject({ displayName: "Campaign with space.ether", named: true });
    expect((await stat(campaignPath)).isFile()).toBe(true);

    const renamed = await service.saveAs(saved.documentId);
    expect(renamed.displayName).toBe("Kampaň Ω.ether");
    expect((await stat(renamedPath)).isFile()).toBe(true);

    const copied = await service.saveCopy(renamed.documentId);
    expect(copied.documentId).toBe(renamed.documentId);
    expect(copied.displayName).toBe(renamed.displayName);
    expect((await stat(copyPath)).isFile()).toBe(true);

    const compacted = await service.compact(renamed.documentId);
    expect(compacted.afterBytes).toBeLessThanOrEqual(compacted.beforeBytes);
    await service.close();

    const reopened = new DesktopApplicationService({
      appDataRoot,
      appVersion: "4.0.0-test",
      dialogs: dialogs({ openDocument: async () => renamedPath }),
      provider: new FakeImageProvider()
    });
    await expect(reopened.open()).resolves.toMatchObject({
      displayName: "Kampaň Ω.ether",
      named: true
    });
    await reopened.close();
  });

  it("does not switch identity or damage an existing destination when Save As validation fails", async () => {
    const root = await tempRoot("ether-save-as-failure-");
    const destination = path.join(root, "Existing.ether");
    const originalBytes = Buffer.from("do not replace");
    await writeFile(destination, originalBytes);
    const service = new DesktopApplicationService({
      appDataRoot: path.join(root, "appdata"),
      appVersion: "4.0.0-test",
      dialogs: dialogs({ saveDocument: async () => destination }),
      provider: new FakeImageProvider()
    });
    const untitled = await service.bootstrap();

    await expect(service.saveAs(untitled.documentId)).rejects.toMatchObject({
      code: expect.any(String)
    });
    expect(await readFile(destination)).toEqual(originalBytes);
    expect(service.snapshot()).toMatchObject({ documentId: untitled.documentId, named: false });
    await service.close();
  });

  it.each(["corrupt", "unsupported"] as const)(
    "keeps the active document, graph, lease, and commands when %s Open validation fails",
    async (failureKind) => {
      const root = await tempRoot(`ether-provisional-open-${failureKind}-`);
      const appDataRoot = path.join(root, "appdata");
      const activePath = path.join(root, "Active.ether");
      const candidatePath = path.join(root, "Candidate.ether");
      if (failureKind === "corrupt") {
        await writeFile(candidatePath, "not a SQLite document");
      } else {
        const creator = new DesktopApplicationService({
          appDataRoot: path.join(root, "candidate-appdata"),
          appVersion: "4.0.0-test",
          dialogs: dialogs({ saveDocument: async () => candidatePath }),
          provider: new FakeImageProvider()
        });
        const candidate = await creator.bootstrap();
        await creator.save(candidate.documentId);
        await creator.close();
        const database = new DatabaseSync(candidatePath);
        database.exec("UPDATE document SET schema_version = 99999 WHERE singleton = 1; PRAGMA user_version = 99999;");
        database.close();
      }
      const service = new DesktopApplicationService({
        appDataRoot,
        appVersion: "4.0.0-test",
        dialogs: dialogs({ saveDocument: async () => activePath }),
        provider: new FakeImageProvider()
      });
      const untitled = await service.bootstrap();
      const active = await service.save(untitled.documentId);
      const graphBefore = await service.graphSnapshot(active.documentId);
      const events: unknown[] = [];
      service.subscribe((event) => events.push(event));

      await expect(service.openPath(candidatePath)).rejects.toMatchObject({ code: expect.any(String) });

      expect(service.snapshot()).toEqual(active);
      expect(await service.graphSnapshot(active.documentId)).toEqual(graphBefore);
      expect(service.snapshot().commands).toMatchObject({ save: true, saveAs: true, compact: true });
      expect(events).toEqual([]);
      const competitor = new DesktopApplicationService({
        appDataRoot,
        appVersion: "4.0.0-test",
        dialogs: dialogs(),
        provider: new FakeImageProvider()
      });
      expect(await competitor.openPath(activePath)).toMatchObject({
        mode: "read-only",
        readOnlyReason: "writer-active"
      });
      await competitor.close();
      await service.close();
    }
  );

  it("inspects a queued-job candidate without recovery when the active document cannot drain", async () => {
    const root = await tempRoot("ether-provisional-open-effects-");
    const appDataRoot = path.join(root, "appdata");
    const candidatePath = path.join(root, "Candidate B.ether");
    const candidateBuilder = new EtherApplication({
      appDataRoot: path.join(root, "candidate-appdata"),
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider(),
      dispatchMode: "manual"
    });
    await candidateBuilder.createDocument({
      path: candidatePath,
      title: "Candidate B",
      initialGraph: {
        id: "graph-root",
        title: "Candidate B",
        kind: "root",
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z",
        nodes: [], edges: [], groups: [], modules: [],
        viewState: {
          viewport: { x: 0, y: 0, zoom: 1 },
          selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null
        }
      }
    });
    const initial = await candidateBuilder.queryDocument();
    await candidateBuilder.applyGraphTransaction({
      commandId: "candidate-graph",
      transaction: {
        id: "candidate-graph-transaction",
        baseDocumentRevisionId: initial.documentRevisionId,
        baseGraphRevisions: { "graph-root": initial.graphRevisions["graph-root"]! },
        title: "Queued candidate workflow",
        actor: "user",
        layoutPolicy: "preserve",
        operations: [
          {
            type: "addNode", graphId: "graph-root",
            node: {
              id: "prompt", definitionId: "prompt.text", title: "Prompt",
              position: { x: 0, y: 0 }, size: { width: 220, height: 140 },
              config: { kind: "prompt.text", body: "Do not run during inspection.", assembly: "append" },
              presentation: { collapsed: false, accent: "default", previewMode: "content" }
            }
          },
          {
            type: "addNode", graphId: "graph-root",
            node: {
              id: "generator", definitionId: "generation.image", title: "Generator",
              position: { x: 300, y: 0 }, size: { width: 220, height: 140 },
              config: {
                kind: "generation.image", providerId: "ether-fake-local", profileId: "fake-image-default",
                aspectRatio: "1:1", resolution: { width: 32, height: 32 }, outputCount: 1
              },
              presentation: { collapsed: false, accent: "default", previewMode: "summary" }
            }
          },
          {
            type: "addEdge", graphId: "graph-root",
            edge: {
              id: "candidate-lane",
              from: { kind: "node", nodeId: "prompt", channel: "text" },
              to: { kind: "node", nodeId: "generator", channel: "text" },
              role: "subject", order: 0, selector: { kind: "latest-approved" },
              adapter: { kind: "auto" }, enabled: true
            }
          }
        ]
      }
    });
    const plan = await candidateBuilder.previewRun({
      commandId: "candidate-preview", graphId: "graph-root", scope: { kind: "graph" }
    });
    const permit = await candidateBuilder.grantRunPermit({
      commandId: "candidate-permit", planId: plan.id, contentHash: plan.contentHash
    });
    const queued = await candidateBuilder.startRun({
      commandId: "candidate-start", planId: plan.id,
      contentHash: plan.contentHash, runPermitId: permit.id
    });
    expect(queued.status).toBe("queued");
    await candidateBuilder.closeDocument();
    const candidateBytes = await readFile(candidatePath);

    const provider = new FakeImageProvider();
    const generate = vi.spyOn(provider, "generate");
    let failDrain = true;
    const service = new DesktopApplicationService({
      appDataRoot, appVersion: "4.0.0-test", dialogs: dialogs(), provider,
      autosaveOperation: async () => {
        if (failDrain) {
          throw Object.assign(new Error("active drain failed"), { code: "ENOSPC" });
        }
      }
    });
    try {
      const active = await service.bootstrap();
      await service.applyGraphTransaction(active.documentId, {
        id: "dirty-active",
        baseDocumentRevisionId: active.documentRevisionId,
        baseGraphRevisions: { [active.graphId]: active.graphRevisionId },
        title: "Dirty active document", actor: "user", layoutPolicy: "preserve",
        operations: [
          {
            type: "addNode",
            graphId: active.graphId,
            node: {
              id: "active-node", definitionId: "prompt.text", title: "Unsaved work",
              position: { x: 0, y: 0 }, size: { width: 220, height: 140 },
              config: { kind: "prompt.text", body: "Keep this active.", assembly: "append" },
              presentation: { collapsed: false, accent: "default", previewMode: "content" }
            }
          }
        ]
      });

      await expect(service.openPath(candidatePath)).rejects.toMatchObject({ code: "ENOSPC" });
      expect(service.snapshot().documentId).toBe(active.documentId);
      expect(await readFile(candidatePath)).toEqual(candidateBytes);
      expect(generate).not.toHaveBeenCalled();
      const database = new DatabaseSync(candidatePath, { readOnly: true });
      try {
        expect(database.prepare("SELECT status FROM execution_jobs WHERE job_id = ?").get(queued.id))
          .toMatchObject({ status: "queued" });
      } finally {
        database.close();
      }
    } finally {
      failDrain = false;
      await service.close();
    }
  }, 15_000);

  it("rejects legacy Ether directories and opens uncertain locations honestly read-only", async () => {
    const root = await tempRoot("ether-location-capability-");
    const sourceAppData = path.join(root, "source-appdata");
    const documentPath = path.join(root, "Network Campaign.ether");
    const creator = new DesktopApplicationService({
      appDataRoot: sourceAppData,
      appVersion: "4.0.0-test",
      dialogs: dialogs({ saveDocument: async () => documentPath }),
      provider: new FakeImageProvider()
    });
    const created = await creator.bootstrap();
    await creator.save(created.documentId);
    await creator.close();

    const legacyDirectory = path.join(root, "Legacy.ether");
    await mkdir(legacyDirectory);
    const opener = new DesktopApplicationService({
      appDataRoot: path.join(root, "open-appdata"),
      appVersion: "4.0.0-test",
      dialogs: dialogs(),
      locationCapability: { classify: () => "unknown" },
      provider: new FakeImageProvider()
    });

    await expect(opener.openPath(legacyDirectory)).rejects.toMatchObject({
      code: "LEGACY_DIRECTORY_UNSUPPORTED"
    });
    await expect(opener.openPath(documentPath)).resolves.toMatchObject({
      mode: "read-only",
      readOnlyReason: "location-unsupported"
    });
    await opener.close();
  });

  it("preserves a competing writer reason and exposes only read-only-safe document commands", async () => {
    const root = await tempRoot("ether-desktop-writer-active-");
    const appDataRoot = path.join(root, "appdata");
    const documentPath = path.join(root, "Writer owned.ether");
    const writer = new DesktopApplicationService({
      appDataRoot,
      appVersion: "4.0.0-test",
      dialogs: dialogs({ saveDocument: async () => documentPath }),
      provider: new FakeImageProvider()
    });
    const initial = await writer.bootstrap();
    await writer.save(initial.documentId);

    const competitor = new DesktopApplicationService({
      appDataRoot,
      appVersion: "4.0.0-test",
      dialogs: dialogs(),
      provider: new FakeImageProvider()
    });
    try {
      const opened = await competitor.openPath(documentPath);
      expect(opened).toMatchObject({
        mode: "read-only",
        readOnlyReason: "writer-active",
        commands: {
          save: false,
          saveAs: false,
          saveCopy: true,
          compact: false,
          makePortable: false
        }
      });
    } finally {
      await competitor.close();
      await writer.close();
    }
  });

  it("preserves sqlite-busy when a stale writer lease cannot be safely reclaimed", async () => {
    const root = await tempRoot("ether-desktop-sqlite-busy-");
    const appDataRoot = path.join(root, "appdata");
    const documentPath = path.join(root, "Busy.ether");
    const creator = new DesktopApplicationService({
      appDataRoot,
      appVersion: "4.0.0-test",
      dialogs: dialogs({ saveDocument: async () => documentPath }),
      provider: new FakeImageProvider()
    });
    const initial = await creator.bootstrap();
    await creator.save(initial.documentId);
    const leaseRoot = path.join(appDataRoot, "leases");
    const leaseName = (await readdir(leaseRoot)).find((name) => name.endsWith(".json"));
    if (leaseName === undefined) throw new Error("Expected an active writer lease.");
    const leasePath = path.join(leaseRoot, leaseName);
    const lease = JSON.parse(await readFile(leasePath, "utf8")) as Record<string, unknown>;
    await creator.close();
    await writeFile(leasePath, JSON.stringify({
      ...lease,
      heartbeatAt: 1,
      ownerToken: randomUUID(),
      pid: 999_999
    }));

    const blocker = new DatabaseSync(documentPath);
    blocker.exec("BEGIN IMMEDIATE");
    const opener = new DesktopApplicationService({
      appDataRoot,
      appVersion: "4.0.0-test",
      dialogs: dialogs(),
      provider: new FakeImageProvider()
    });
    try {
      await expect(opener.openPath(documentPath)).resolves.toMatchObject({
        mode: "read-only",
        readOnlyReason: "sqlite-busy"
      });
    } finally {
      await opener.close();
      blocker.exec("ROLLBACK");
      blocker.close();
    }
  });

  it("delivers heartbeat-failed access changes without waiting for another edit", async () => {
    const root = await tempRoot("ether-desktop-heartbeat-");
    const events: Array<{ snapshot?: { readOnlyReason?: string | null } }> = [];
    const service = new DesktopApplicationService({
      appDataRoot: path.join(root, "appdata"),
      appVersion: "4.0.0-test",
      dialogs: dialogs(),
      provider: new FakeImageProvider(),
      documentEnvironment: {
        heartbeatMs: 10,
        onHeartbeat: () => { throw new Error("injected heartbeat failure"); }
      }
    });
    try {
      service.subscribe((event) => events.push(event));
      await service.bootstrap();

      await vi.waitFor(() => {
        expect(service.snapshot()).toMatchObject({
          mode: "read-only",
          readOnlyReason: "heartbeat-failed",
          commands: { save: false, saveCopy: true }
        });
      });
      expect(events.some((event) => event.snapshot?.readOnlyReason === "heartbeat-failed")).toBe(true);
    } finally {
      await service.close();
    }
  });

  it("canonicalizes open requests and focuses an already-open identity", async () => {
    const root = await tempRoot("ether-open-coordinator-");
    const filePath = path.join(root, "Campaign.ether");
    await writeFile(filePath, "fixture");
    const opened: string[] = [];
    let focused = 0;
    const coordinator = new OpenDocumentCoordinator({
      focus: () => { focused += 1; },
      open: async (canonicalPath) => { opened.push(canonicalPath); }
    });

    await coordinator.request(filePath);
    await coordinator.request(path.join(root, ".", "Campaign.ether"));

    expect(opened).toHaveLength(1);
    expect(focused).toBe(1);
  });

  it("routes picker, drop, argv, second-instance, and open-file through one coordinator", async () => {
    const root = await tempRoot("ether-open-entrypoints-");
    const filePath = path.join(root, "Campaign.ether");
    await writeFile(filePath, "fixture");
    const opened: string[] = [];
    let focused = 0;
    const controller = new OpenDocumentController(
      new OpenDocumentCoordinator({
        focus: () => { focused += 1; },
        open: async (canonicalPath) => { opened.push(canonicalPath); }
      }),
      async () => filePath
    );

    await controller.request("picker");
    for (const source of ["drop", "argv", "second-instance", "open-file"] as const) {
      await controller.request(source, path.join(root, ".", "Campaign.ether"));
    }

    expect(opened).toHaveLength(1);
    expect(focused).toBe(4);
  });

  it("keeps a fake-provider PNG embedded after save, close, and reopen", async () => {
    const root = await tempRoot("ether-fake-artifact-");
    const documentPath = path.join(root, "Generated.ether");
    const options = {
      appDataRoot: path.join(root, "appdata"),
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider(),
      simulationMode: true
    };
    const service = new DesktopApplicationService({
      ...options,
      dialogs: dialogs({ saveDocument: async () => documentPath })
    });
    const untitled = await service.bootstrap();
    const saved = await service.save(untitled.documentId);
    const generated = await service.generateFakeArtifact(saved.documentId);

    expect(generated).toHaveLength(1);
    expect(generated[0]).toMatchObject({ mediaType: "image/png" });
    await service.close();

    const reopened = new DesktopApplicationService({ ...options, dialogs: dialogs() });
    const snapshot = await reopened.openPath(documentPath);
    const artifacts = await reopened.searchArtifacts(snapshot.documentId, "");
    expect(artifacts.map((artifact) => artifact.id)).toContain(generated[0]!.id);
    const bytes = await reopened.readArtifactRange(
      snapshot.documentId,
      generated[0]!.id,
      0,
      generated[0]!.byteLength
    );
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await reopened.close();
  });

  it("does not expose fake generation through a normal production service", async () => {
    const root = await tempRoot("ether-production-generation-");
    const service = new DesktopApplicationService({
      appDataRoot: path.join(root, "appdata"),
      appVersion: "4.0.0-test",
      dialogs: dialogs(),
      provider: new FakeImageProvider()
    });
    const snapshot = await service.bootstrap();

    await expect(service.generateFakeArtifact(snapshot.documentId)).rejects.toMatchObject({
      code: "SIMULATION_DISABLED"
    });
    await service.close();
  });

  it("reissues real linked-reference grants across reopen, Save As, and Save Copy", async () => {
    const root = await tempRoot("ether-reference-grant-lifecycle-");
    const appDataRoot = path.join(root, "appdata");
    const originalPath = path.join(root, "Original.ether");
    const renamedPath = path.join(root, "Renamed.ether");
    const copyPath = path.join(root, "Copy.ether");
    const previewPath = path.join(root, "preview.png");
    await writeFile(previewPath, pngBytes(256, 0x10));
    const sources = ["reopen", "remove", "save-as", "copy"].map((name, index) => ({
      id: `reference-${name}`,
      path: path.join(root, `${name}.png`),
      bytes: pngBytes(1024 + index * 512, 0x20 + index)
    }));
    await Promise.all(sources.map((source) => writeFile(source.path, source.bytes)));
    const authority = new DesktopPathGrantAuthority({
      storagePath: path.join(appDataRoot, "reference-grants.json")
    });
    const grantIds = new Map<string, string>();
    const store = await DocumentStore.create(originalPath, {
      appVersion: "4.0.0-test",
      documentId: "document-reference-lifecycle",
      environment: {
        leaseRoot: path.join(appDataRoot, "leases"),
        recoveryRoot: path.join(appDataRoot, "recovery"),
        referenceGrantAuthority: authority
      },
      initialGraph: {
        id: "graph-root",
        title: "References",
        kind: "root",
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z",
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
      },
      title: "References"
    });
    authority.activateDocument(store.documentId, originalPath);
    const preview = await importBlob(store, {
      sourcePath: previewPath,
      mediaType: "image/png"
    }, { appDataRoot });
    for (const source of sources) {
      const grantId = authority.grant(store.documentId, "link", source.path);
      grantIds.set(source.id, grantId);
      await linkReference(store, {
        id: source.id,
        displayName: path.basename(source.path),
        sourcePath: source.path,
        mediaType: "image/png",
        pathGrantId: grantId,
        previewContentKey: preview.contentKey
      });
      authority.allowResolve(grantId, store.documentId);
    }
    await store.close();
    authority.deactivateDocument("document-reference-lifecycle");

    let failNextSidecarRename = false;
    const serviceOptions = {
      appDataRoot,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider(),
      pathGrantPersistenceCheckpoint: (stage: "write" | "fsync" | "rename") => {
        if (failNextSidecarRename && stage === "rename") {
          failNextSidecarRename = false;
          throw Object.assign(new Error("injected grant rename failure"), { code: "ENOSPC" });
        }
      }
    };
    const first = new DesktopApplicationService({ ...serviceOptions, dialogs: dialogs() });
    await first.openPath(originalPath);
    await first.close();

    const reopened = new DesktopApplicationService({
      ...serviceOptions,
      dialogs: dialogs({ saveDocument: async (kind) => kind === "save-as" ? renamedPath : copyPath })
    });
    const original = await reopened.openPath(originalPath);
    failNextSidecarRename = true;
    await expect(reopened.actOnReference(original.documentId, "reference-reopen", "embed-available-copy"))
      .rejects.toMatchObject({ code: "ENOSPC" });
    await expect(reopened.listReferences(original.documentId))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "reference-reopen", state: "embedded" })]));
    const bindingsAfterEmbed = JSON.parse(
      await readFile(path.join(appDataRoot, "reference-grants.json"), "utf8")
    ) as Array<{ grantId: string }>;
    expect(bindingsAfterEmbed.some(({ grantId }) => grantId === grantIds.get("reference-reopen"))).toBe(false);
    failNextSidecarRename = true;
    await expect(reopened.actOnReference(original.documentId, "reference-remove", "remove"))
      .rejects.toMatchObject({ code: "ENOSPC" });
    await expect(reopened.listReferences(original.documentId))
      .resolves.toEqual(expect.not.arrayContaining([expect.objectContaining({ id: "reference-remove" })]));
    const bindingsAfterRemove = JSON.parse(
      await readFile(path.join(appDataRoot, "reference-grants.json"), "utf8")
    ) as Array<{ grantId: string }>;
    expect(bindingsAfterRemove.some(({ grantId }) => grantId === grantIds.get("reference-remove"))).toBe(false);
    const renamed = await reopened.saveAs(original.documentId);
    failNextSidecarRename = true;
    await expect(reopened.saveCopy(renamed.documentId)).rejects.toMatchObject({ code: "ENOSPC" });
    await expect(reopened.actOnReference(renamed.documentId, "reference-save-as", "embed-available-copy"))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "reference-save-as", state: "embedded" })]));
    await reopened.close();

    const copied = new DesktopApplicationService({ ...serviceOptions, dialogs: dialogs() });
    const copy = await copied.openPath(copyPath);
    await expect(copied.actOnReference(copy.documentId, "reference-copy", "embed-available-copy"))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "reference-copy", state: "embedded" })]));
    await copied.close();

    const sourceAgain = new DesktopApplicationService({ ...serviceOptions, dialogs: dialogs() });
    const sourceSnapshot = await sourceAgain.openPath(originalPath);
    await expect(sourceAgain.actOnReference(sourceSnapshot.documentId, "reference-save-as", "embed-available-copy"))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "reference-save-as", state: "embedded" })]));
    await sourceAgain.close();
  });

  it("keeps a published Save As identity and recovers its durable grant sidecar with attention", async () => {
    const root = await tempRoot("ether-save-as-grant-recovery-");
    const appDataRoot = path.join(root, "appdata");
    const originalPath = path.join(root, "Original.ether");
    const destinationPath = path.join(root, "Destination.ether");
    const referencePath = path.join(root, "Reference.png");
    await writeFile(referencePath, pngBytes(128, 0x42));
    const creator = new DesktopApplicationService({
      appDataRoot, appVersion: "4.0.0-test",
      dialogs: dialogs({ saveDocument: async () => originalPath }),
      provider: new FakeImageProvider()
    });
    const untitled = await creator.bootstrap();
    const original = await creator.save(untitled.documentId);
    await creator.close();

    const authority = new DesktopPathGrantAuthority({
      storagePath: path.join(appDataRoot, "reference-grants.json")
    });
    authority.activateDocument(original.documentId, originalPath);
    const grantId = authority.grant(original.documentId, "link", referencePath);
    authority.allowResolve(grantId, original.documentId);
    authority.deactivateDocument(original.documentId);

    let armed = false;
    const service = new DesktopApplicationService({
      appDataRoot, appVersion: "4.0.0-test",
      dialogs: dialogs({ saveDocument: async () => destinationPath }),
      provider: new FakeImageProvider(),
      pathGrantPersistenceCheckpoint: (stage) => {
        if (armed && stage === "rename") {
          armed = false;
          throw Object.assign(new Error("sidecar rename failed"), { code: "ENOSPC" });
        }
      }
    });
    const opened = await service.openPath(originalPath);
    armed = true;
    await expect(service.saveAs(opened.documentId)).rejects.toMatchObject({ code: "ENOSPC" });
    const destination = service.snapshot();
    expect(service.activePath()).toBe(await realpath(destinationPath));
    expect(destination).toMatchObject({ named: true, saveState: "needs-attention" });
    expect(destination.documentId).not.toBe(original.documentId);
    await service.close();

    const recovered = new DesktopPathGrantAuthority({
      storagePath: path.join(appDataRoot, "reference-grants.json")
    });
    recovered.activateDocument(original.documentId, originalPath);
    expect(recovered.authorizePath({
      documentId: original.documentId, operation: "resolve", grantId, path: referencePath
    })).toBe(true);
    recovered.activateDocument(destination.documentId, destinationPath);
    expect(recovered.authorizePath({
      documentId: destination.documentId, operation: "resolve", grantId, path: referencePath
    })).toBe(true);
  });

  it("preflights portable references, confirms natively, and makes no change on cancellation", async () => {
    const root = await tempRoot("ether-portable-confirm-");
    const confirmPortable = vi.fn(async () => false);
    const service = new DesktopApplicationService({
      appDataRoot: path.join(root, "appdata"),
      appVersion: "4.0.0-test",
      dialogs: dialogs({ confirmPortable }),
      provider: new FakeImageProvider()
    });
    const snapshot = await service.bootstrap();
    const commandResults: unknown[] = [];
    service.subscribe((event) => {
      if (event.commandResult !== undefined) commandResults.push(event.commandResult);
    });
    const application = (service as unknown as { application: {
      queryReferences(): Promise<unknown[]>;
      preflightDocumentPortable(): Promise<{ expectedBytes: number; expectedCount: number; missingReferenceIds: string[] }>;
      makeDocumentPortable(): Promise<{ embeddedCount: number; embeddedBytes: number; missingReferenceIds: string[] }>;
    } }).application;
    vi.spyOn(application, "queryReferences").mockResolvedValue([{
      id: "missing-1",
      displayName: "offline source.png"
    }]);
    vi.spyOn(application, "preflightDocumentPortable").mockResolvedValue({
      expectedBytes: 8192,
      expectedCount: 2,
      missingReferenceIds: ["missing-1"]
    });
    const makePortable = vi.spyOn(application, "makeDocumentPortable");

    try {
      await expect(service.makePortable(snapshot.documentId)).resolves.toEqual({
        cancelled: true,
        embeddedCount: 0,
        embeddedBytes: 0,
        expectedBytes: 8192,
        expectedCount: 2,
        missingReferences: [{ id: "missing-1", displayName: "offline source.png" }]
      });
      expect(confirmPortable).toHaveBeenCalledWith({
        expectedBytes: 8192,
        expectedCount: 2,
        missingReferences: [{ id: "missing-1", displayName: "offline source.png" }]
      });
      expect(makePortable).not.toHaveBeenCalled();
      expect(commandResults).toContainEqual({
        kind: "portable",
        cancelled: true,
        embeddedCount: 0,
        embeddedBytes: 0,
        expectedBytes: 8192,
        expectedCount: 2,
        missingReferences: [{ id: "missing-1", displayName: "offline source.png" }]
      });
    } finally {
      await service.close();
    }
  });

  it("reports successful portable byte counts and identifiable missing references", async () => {
    const root = await tempRoot("ether-portable-result-");
    const service = new DesktopApplicationService({
      appDataRoot: path.join(root, "appdata"),
      appVersion: "4.0.0-test",
      dialogs: dialogs(),
      provider: new FakeImageProvider()
    });
    const snapshot = await service.bootstrap();
    const application = (service as unknown as { application: {
      queryReferences(): Promise<unknown[]>;
      preflightDocumentPortable(): Promise<{ expectedBytes: number; expectedCount: number; missingReferenceIds: string[] }>;
      makeDocumentPortable(): Promise<{ embeddedCount: number; embeddedBytes: number; missingReferenceIds: string[] }>;
    } }).application;
    vi.spyOn(application, "queryReferences").mockResolvedValue([
      { id: "available-1", displayName: "available.png" },
      { id: "missing-1", displayName: "missing source.psd" }
    ]);
    vi.spyOn(application, "preflightDocumentPortable").mockResolvedValue({
      expectedBytes: 4096,
      expectedCount: 1,
      missingReferenceIds: ["missing-1"]
    });
    vi.spyOn(application, "makeDocumentPortable").mockResolvedValue({
      embeddedCount: 1,
      embeddedBytes: 4096,
      missingReferenceIds: ["missing-1"]
    });

    try {
      await expect(service.makePortable(snapshot.documentId)).resolves.toEqual({
        cancelled: false,
        embeddedCount: 1,
        embeddedBytes: 4096,
        expectedBytes: 4096,
        expectedCount: 1,
        missingReferences: [{ id: "missing-1", displayName: "missing source.psd" }]
      });
    } finally {
      await service.close();
    }
  });

  it("calculates portable embed count and byte size without mutating references", async () => {
    const root = await tempRoot("ether-portable-size-");
    const sourcePath = path.join(root, "available.png");
    await writeFile(sourcePath, Buffer.alloc(2048));
    const service = new DesktopApplicationService({
      appDataRoot: path.join(root, "appdata"),
      appVersion: "4.0.0-test",
      dialogs: dialogs(),
      provider: new FakeImageProvider()
    });
    await service.bootstrap();
    const application = (service as unknown as { application: {
      queryReferences(): Promise<unknown[]>;
      preflightDocumentPortable(): Promise<{
        expectedBytes: number;
        expectedCount: number;
        missingReferenceIds: string[];
      }>;
    } }).application;
    const timestamp = "2026-07-18T00:00:00.000Z";
    vi.spyOn(application, "queryReferences").mockResolvedValue([
      {
        id: "available",
        displayName: "available.png",
        mediaType: "image/png",
        state: "linked",
        originalPath: sourcePath,
        pathGrantId: "grant-available",
        contentKey: null,
        previewContentKey: null,
        identity: null,
        fingerprint: { byteLength: 2048, modifiedAt: 1, sampleSha256: "a".repeat(64) },
        createdAt: timestamp,
        updatedAt: timestamp
      },
      {
        id: "missing",
        displayName: "missing.png",
        mediaType: "image/png",
        state: "missing",
        originalPath: null,
        pathGrantId: null,
        contentKey: null,
        previewContentKey: null,
        identity: null,
        fingerprint: { byteLength: 4096, modifiedAt: 1, sampleSha256: "b".repeat(64) },
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ]);

    await expect(application.preflightDocumentPortable()).resolves.toEqual({
      expectedBytes: 2048,
      expectedCount: 1,
      missingReferenceIds: ["missing"]
    });
    await service.close();
  });

  it("propagates an unexpected Portable failure without partially embedding references and can retry", async () => {
    type ActivatableAuthority = DesktopPathGrantAuthority & {
      activateDocument?: (documentId: string, documentPath: string) => void;
    };
    const root = await tempRoot("ether-portable-transaction-");
    const appDataRoot = path.join(root, "appdata");
    const documentPath = path.join(root, "Portable.ether");
    const previewPath = path.join(root, "preview.png");
    const firstPath = path.join(root, "first.png");
    const secondPath = path.join(root, "second.png");
    await Promise.all([
      writeFile(previewPath, pngBytes(512, 0x10)),
      writeFile(firstPath, pngBytes(512 * 1024, 0x20)),
      writeFile(secondPath, pngBytes(768 * 1024, 0x30))
    ]);
    const authority = Reflect.construct(DesktopPathGrantAuthority, [{
      storagePath: path.join(appDataRoot, "reference-grants.json")
    }]) as ActivatableAuthority;
    const store = await DocumentStore.create(documentPath, {
      appVersion: "4.0.0-test",
      documentId: "document-portable-transaction",
      environment: {
        leaseRoot: path.join(appDataRoot, "leases"),
        recoveryRoot: path.join(appDataRoot, "recovery"),
        referenceGrantAuthority: authority
      },
      initialGraph: {
        id: "graph-root",
        title: "Portable",
        kind: "root",
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z",
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
      },
      title: "Portable"
    });
    authority.activateDocument?.(store.documentId, documentPath);
    const preview = await importBlob(
      store,
      { sourcePath: previewPath, mediaType: "image/png" },
      { appDataRoot }
    );
    for (const [index, sourcePath] of [firstPath, secondPath].entries()) {
      const grantId = authority.grant(store.documentId, "link", sourcePath);
      await linkReference(store, {
        id: `reference-${index + 1}`,
        displayName: path.basename(sourcePath),
        sourcePath,
        mediaType: "image/png",
        pathGrantId: grantId,
        previewContentKey: preview.contentKey
      });
      authority.allowResolve(grantId, store.documentId);
    }
    await store.close();

    let fail = true;
    let prepared = 0;
    const createApplication = () => new EtherApplication({
      appDataRoot,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider(),
      dispatchMode: "manual",
      documentEnvironment: { referenceGrantAuthority: authority },
      portableCheckpoint: (stage: string) => {
        if (stage === "prepared" && ++prepared === 2 && fail) {
          throw Object.assign(new Error("disk full during Portable"), { code: "ENOSPC" });
        }
      }
    } as unknown as ConstructorParameters<typeof EtherApplication>[0]);
    let application = createApplication();
    await application.openDocument({ path: documentPath, access: "require-write" });
    let applicationOpen = true;
    try {
      const activeStore = (application as unknown as { store: DocumentStore }).store;
      const beforeBlobs = await activeStore.read(({ blobs }) => blobs.list().map(({ contentKey }) => contentKey));
      const beforeDirty = (await application.queryDocument()).dirty;
      const beforeGrants = await readFile(path.join(appDataRoot, "reference-grants.json"));
      const beforeBytes = (await stat(documentPath)).size;
      await expect(application.makeDocumentPortable()).rejects.toMatchObject({ code: "ENOSPC" });
      expect((await application.queryReferences()).map(({ state }) => state)).toEqual(["linked", "linked"]);
      expect(await activeStore.read(({ blobs }) => blobs.list().map(({ contentKey }) => contentKey))).toEqual(beforeBlobs);
      expect((await application.queryDocument()).dirty).toBe(beforeDirty);
      expect(await readFile(path.join(appDataRoot, "reference-grants.json"))).toEqual(beforeGrants);
      expect((await stat(documentPath)).size).toBeLessThanOrEqual(beforeBytes + 16 * 1024);

      await application.closeDocument();
      applicationOpen = false;
      application = createApplication();
      await application.openDocument({ path: documentPath, access: "require-write" });
      applicationOpen = true;
      expect((await application.queryReferences()).map(({ state }) => state)).toEqual(["linked", "linked"]);
      expect(await (application as unknown as { store: DocumentStore }).store.read(
        ({ blobs }) => blobs.list().map(({ contentKey }) => contentKey)
      )).toEqual(beforeBlobs);
      expect((await application.queryDocument()).dirty).toBe(beforeDirty);

      fail = false;
      prepared = 0;
      await expect(application.makeDocumentPortable()).resolves.toMatchObject({
        embeddedCount: 2,
        embeddedBytes: 1280 * 1024,
        missingReferenceIds: []
      });
      expect((await application.queryReferences()).map(({ state }) => state)).toEqual(["embedded", "embedded"]);
    } finally {
      if (applicationOpen) await application.closeDocument();
    }
  });
});

describe("reference action capabilities", () => {
  const missingReference = {
    id: "reference-1",
    displayName: "source.png",
    mediaType: "image/png",
    state: "missing" as const,
    originalPath: "C:\\source.png",
    pathGrantId: "grant-1",
    contentKey: null,
    previewContentKey: null,
    identity: null,
    fingerprint: { byteLength: 1024, modifiedAt: 1, sampleSha256: "a".repeat(64) },
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z"
  };

  it("enables only applicable recovery actions", () => {
    expect(referenceCapabilities(missingReference, {
      writable: true,
      sourceAvailable: false,
      hasMissingReferences: true
    })).toEqual(["locate", "search-folder", "relink-all", "remove"]);
    expect(referenceCapabilities({ ...missingReference, previewContentKey: "b".repeat(64) }, {
      writable: true,
      sourceAvailable: true,
      hasMissingReferences: true
    })).toEqual([
      "locate",
      "search-folder",
      "relink-all",
      "use-embedded-preview",
      "embed-available-copy",
      "remove"
    ]);
  });

  it("disables every mutating reference action in read-only mode", () => {
    expect(referenceCapabilities(missingReference, {
      writable: false,
      sourceAvailable: true,
      hasMissingReferences: true
    })).toEqual([]);
  });
});

describe("autosave and event ordering", () => {
  it("starts after 1.5 seconds idle, caps first-dirty age at 10 seconds, and serializes saves", async () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    let releaseFirst!: () => void;
    const firstSave = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const coordinator = new AutosaveCoordinator(async () => {
      calls.push(Date.now());
      if (calls.length === 1) await firstSave;
    });

    coordinator.markDirty();
    await vi.advanceTimersByTimeAsync(1_000);
    coordinator.markDirty();
    await vi.advanceTimersByTimeAsync(1_499);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);

    coordinator.markDirty();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toHaveLength(1);
    releaseFirst();
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(2);
  });

  it("preserves dirty state and reports attention after a failed save", async () => {
    vi.useFakeTimers();
    const coordinator = new AutosaveCoordinator(async () => {
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    });

    coordinator.markDirty();
    await vi.advanceTimersByTimeAsync(1_500);

    expect(coordinator.state()).toMatchObject({ dirty: true, saveState: "needs-attention" });
  });

  it("keeps an edit dirty when it arrives immediately before an in-flight save resolves", async () => {
    let release!: () => void;
    let calls = 0;
    const firstSave = new Promise<void>((resolve) => { release = resolve; });
    const coordinator = new AutosaveCoordinator(async () => {
      calls += 1;
      if (calls === 1) await firstSave;
    });

    coordinator.markDirty();
    const firstFlush = coordinator.flush();
    coordinator.markDirty();
    release();
    await firstFlush;

    await vi.waitFor(() => expect(calls).toBe(2));
    expect(coordinator.state()).toEqual({ dirty: false, saveState: "saved" });
  });

  it("waits for an in-flight autosave before closing the active document", async () => {
    let release!: () => void;
    const saving = new Promise<void>((resolve) => { release = resolve; });
    const root = await tempRoot("ether-close-autosave-drain-");
    const service = new DesktopApplicationService({
      appDataRoot: path.join(root, "appdata"),
      appVersion: "4.0.0-test",
      autosaveOperation: async () => saving,
      dialogs: dialogs(),
      provider: new FakeImageProvider()
    });
    await service.bootstrap();
    const coordinator = (service as unknown as { autosaveCoordinator: AutosaveCoordinator }).autosaveCoordinator;
    coordinator.markDirty();
    const flush = coordinator.flush();
    let closed = false;
    const close = service.close().then(() => { closed = true; });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(closed).toBe(false);
    release();
    await flush;
    await close;
    expect(closed).toBe(true);
  });

  it("serializes Close behind an in-progress Save As", async () => {
    const root = await tempRoot("ether-save-as-close-drain-");
    const destination = path.join(root, "Saved while closing.ether");
    let chooseDestination!: (value: string) => void;
    const selected = new Promise<string>((resolve) => { chooseDestination = resolve; });
    const service = new DesktopApplicationService({
      appDataRoot: path.join(root, "appdata"),
      appVersion: "4.0.0-test",
      dialogs: dialogs({ saveDocument: async () => selected }),
      provider: new FakeImageProvider()
    });
    const untitled = await service.bootstrap();

    const saveAs = service.saveAs(untitled.documentId);
    const close = service.close();
    chooseDestination(destination);

    await expect(saveAs).resolves.toMatchObject({ named: true, displayName: "Saved while closing.ether" });
    await close;
    expect((await stat(destination)).isFile()).toBe(true);
  });

  it("drains an admitted graph mutation and rejects graph admission after close starts", async () => {
    const root = await tempRoot("ether-graph-close-drain-");
    const service = new DesktopApplicationService({
      appDataRoot: path.join(root, "appdata"), appVersion: "4.0.0-test",
      dialogs: dialogs(), provider: new FakeImageProvider()
    });
    const snapshot = await service.bootstrap();
    const application = (service as unknown as { application: EtherApplication }).application;
    let release!: () => void;
    let announce!: () => void;
    const started = new Promise<void>((resolve) => { announce = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(application, "applyGraphTransaction").mockImplementation(async () => {
      announce();
      await gate;
      return { documentRevisionId: snapshot.documentRevisionId, graphRevisions: { [snapshot.graphId]: snapshot.graphRevisionId } };
    });
    const transaction = {
      id: "graph-drain", baseDocumentRevisionId: snapshot.documentRevisionId,
      baseGraphRevisions: { [snapshot.graphId]: snapshot.graphRevisionId },
      title: "Graph drain", actor: "user", layoutPolicy: "preserve", operations: []
    } as unknown as Parameters<DesktopApplicationService["applyGraphTransaction"]>[1];
    const mutation = service.applyGraphTransaction(snapshot.documentId, transaction);
    await started;
    let closed = false;
    const close = service.close().then(() => { closed = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closed).toBe(false);
    await expect(service.applyGraphTransaction(snapshot.documentId, transaction)).rejects.toMatchObject({
      code: "LIFECYCLE_CLOSING"
    });
    release();
    await mutation;
    await close;
  });

  it("drains admitted reference and Portable mutations before close", async () => {
    const root = await tempRoot("ether-reference-portable-close-drain-");
    let portableRelease!: () => void;
    let portableAnnounce!: () => void;
    const portableStarted = new Promise<void>((resolve) => { portableAnnounce = resolve; });
    const portableGate = new Promise<void>((resolve) => { portableRelease = resolve; });
    const service = new DesktopApplicationService({
      appDataRoot: path.join(root, "appdata"), appVersion: "4.0.0-test",
      dialogs: dialogs({ confirmPortable: async () => { portableAnnounce(); await portableGate; return true; } }),
      provider: new FakeImageProvider()
    });
    const snapshot = await service.bootstrap();
    const application = (service as unknown as { application: EtherApplication }).application;
    vi.spyOn(service, "listReferences").mockResolvedValue([{
      id: "reference-1", displayName: "reference.png", mediaType: "image/png", state: "missing", actions: ["remove"]
    }]);
    let referenceRelease!: () => void;
    let referenceAnnounce!: () => void;
    const referenceStarted = new Promise<void>((resolve) => { referenceAnnounce = resolve; });
    const referenceGate = new Promise<void>((resolve) => { referenceRelease = resolve; });
    vi.spyOn(application, "queryReferences").mockResolvedValue([]);
    vi.spyOn(application, "removeDocumentReference").mockImplementation(async () => {
      referenceAnnounce();
      await referenceGate;
    });
    const referenceMutation = service.actOnReference(snapshot.documentId, "reference-1", "remove");
    await referenceStarted;
    let referenceClosed = false;
    const referenceClose = service.close().then(() => { referenceClosed = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(referenceClosed).toBe(false);
    referenceRelease();
    await referenceMutation;
    await referenceClose;

    const portableService = new DesktopApplicationService({
      appDataRoot: path.join(root, "portable-appdata"), appVersion: "4.0.0-test",
      dialogs: dialogs({ confirmPortable: async () => { portableAnnounce(); await portableGate; return true; } }),
      provider: new FakeImageProvider()
    });
    const portableSnapshot = await portableService.bootstrap();
    const portableMutation = portableService.makePortable(portableSnapshot.documentId);
    await portableStarted;
    let portableClosed = false;
    const portableClose = portableService.close().then(() => { portableClosed = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(portableClosed).toBe(false);
    portableRelease();
    await portableMutation;
    await portableClose;
  });

  it("ignores stale snapshots and events by monotonic revision", () => {
    const initial = {
      snapshot: null,
      revision: 0,
      saveState: "saved" as const,
      error: null,
      commandResult: null
    };
    const current = reduceDocumentSession(initial, {
      kind: "snapshot",
      revision: 8,
      snapshot: { documentId: "document-1" }
    });
    const stale = reduceDocumentSession(current, {
      kind: "event",
      revision: 7,
      saveState: "saving"
    });

    expect(stale).toBe(current);
  });

  it.each([
    ["saving", null],
    ["saved", null],
    ["needs-attention", "The disk is full."]
  ] as const)("delivers %s state and errors from snapshot-bearing events", (saveState, error) => {
    const current = reduceDocumentSession({
      snapshot: null,
      revision: 2,
      saveState: "saved",
      error: "An older error",
      commandResult: null
    }, {
      kind: "snapshot",
      revision: 3,
      snapshot: { documentId: "document-1" },
      saveState,
      error
    });

    expect(current).toMatchObject({ revision: 3, saveState, error });
  });

  it("ignores stale snapshot state and error payloads", () => {
    const current = {
      snapshot: { documentId: "document-1" },
      revision: 9,
      saveState: "needs-attention" as const,
      error: "Keep this error",
      commandResult: null
    };

    expect(reduceDocumentSession(current, {
      kind: "snapshot",
      revision: 8,
      snapshot: { documentId: "document-1" },
      saveState: "saved",
      error: null
    })).toBe(current);
  });
});

describe("desktop reference path grants", () => {
  it("binds grants to a document, operation, canonical path, and fingerprint", async () => {
    const root = await tempRoot("ether-path-grant-");
    const sourcePath = path.join(root, "Source image.png");
    await writeFile(sourcePath, "reference bytes");
    const canonicalPath = await realpath(sourcePath);
    const authority = new DesktopPathGrantAuthority();
    const grantId = authority.grant("document-1", "relink", sourcePath);
    const base = { documentId: "document-1", operation: "relink" as const, grantId, path: canonicalPath };

    expect(authority.authorizePath(base)).toBe(true);
    expect(authority.authorizePath({ ...base, documentId: "document-2" })).toBe(false);
    expect(authority.authorizePath({ ...base, operation: "resolve" })).toBe(false);
    expect(authority.authorizePath({ ...base, path: path.join(root, "other.png") })).toBe(false);

    const fingerprint = { byteLength: 15, sampleSha256: "fingerprint-1" };
    expect(authority.validateFingerprint({ ...base, fingerprint })).toBe(true);
    expect(authority.validateFingerprint({
      ...base,
      fingerprint: { ...fingerprint, sampleSha256: "fingerprint-2" }
    })).toBe(false);
    authority.revoke(grantId, "document-2");
    expect(authority.authorizePath(base)).toBe(true);
    authority.revoke(grantId, "document-1");
    expect(authority.authorizePath(base)).toBe(false);
  });

  it("revokes every grant for a closing document without touching another document", async () => {
    const root = await tempRoot("ether-path-grant-close-");
    const sourcePath = path.join(root, "Source.png");
    await writeFile(sourcePath, "reference bytes");
    const authority = new DesktopPathGrantAuthority();
    const firstId = authority.grant("document-1", "relink", sourcePath);
    const secondId = authority.grant("document-2", "relink", sourcePath);

    authority.revokeDocument("document-1");

    expect(authority.authorizePath({
      documentId: "document-1",
      operation: "relink",
      grantId: firstId,
      path: sourcePath
    })).toBe(false);
    expect(authority.authorizePath({
      documentId: "document-2",
      operation: "relink",
      grantId: secondId,
      path: sourcePath
    })).toBe(true);
  });

  it("reissues trusted grants after reopen and rebinds Save As and Save Copy identities", async () => {
    type DurableAuthority = DesktopPathGrantAuthority & {
      activateDocument(documentId: string, documentPath: string): void;
      deactivateDocument(documentId: string): void;
      rebindDocument(input: {
        sourceDocumentId: string;
        sourceDocumentPath: string;
        destinationDocumentId: string;
        destinationDocumentPath: string;
        retainSource: boolean;
        switchActive?: boolean;
      }): void;
    };
    const root = await tempRoot("ether-durable-path-grant-");
    const storagePath = path.join(root, "appdata", "reference-grants.json");
    const sourcePath = path.join(root, "Source.png");
    const originalDocumentPath = path.join(root, "Original.ether");
    const saveAsPath = path.join(root, "Renamed.ether");
    const copyPath = path.join(root, "Copy.ether");
    await writeFile(sourcePath, "reference bytes");
    await Promise.all([
      writeFile(originalDocumentPath, "document"),
      writeFile(saveAsPath, "renamed"),
      writeFile(copyPath, "copy")
    ]);
    const createAuthority = () => Reflect.construct(
      DesktopPathGrantAuthority,
      [{ storagePath }]
    ) as DurableAuthority;
    const first = createAuthority();
    first.activateDocument("document-original", originalDocumentPath);
    const grantId = first.grant("document-original", "relink", sourcePath);
    const fingerprint = { byteLength: 15, sampleSha256: "trusted-fingerprint" };
    expect(first.validateFingerprint({
      documentId: "document-original",
      operation: "relink",
      grantId,
      path: sourcePath,
      fingerprint
    })).toBe(true);
    first.allowResolve(grantId, "document-original");
    first.deactivateDocument("document-original");

    const reopened = createAuthority();
    reopened.activateDocument("document-original", originalDocumentPath);
    expect(reopened.validateFingerprint({
      documentId: "document-original",
      operation: "resolve",
      grantId,
      path: sourcePath,
      fingerprint
    })).toBe(true);

    reopened.rebindDocument({
      sourceDocumentId: "document-original",
      sourceDocumentPath: originalDocumentPath,
      destinationDocumentId: "document-renamed",
      destinationDocumentPath: saveAsPath,
      retainSource: true,
      switchActive: true
    });
    reopened.activateDocument("document-renamed", saveAsPath);
    expect(reopened.authorizePath({
      documentId: "document-renamed",
      operation: "resolve",
      grantId,
      path: sourcePath
    })).toBe(true);
    reopened.activateDocument("document-original", originalDocumentPath);
    expect(reopened.authorizePath({
      documentId: "document-original",
      operation: "resolve",
      grantId,
      path: sourcePath
    })).toBe(true);

    reopened.rebindDocument({
      sourceDocumentId: "document-renamed",
      sourceDocumentPath: saveAsPath,
      destinationDocumentId: "document-copy",
      destinationDocumentPath: copyPath,
      retainSource: true,
      switchActive: false
    });
    reopened.activateDocument("document-copy", copyPath);
    expect(reopened.authorizePath({
      documentId: "document-copy",
      operation: "resolve",
      grantId,
      path: sourcePath
    })).toBe(true);
    expect(reopened.authorizePath({
      documentId: "document-renamed",
      operation: "resolve",
      grantId,
      path: sourcePath
    })).toBe(true);
  });

  it.each(["write", "fsync", "rename"] as const)(
    "keeps the last durable grant map when %s publication fails",
    async (failureStage) => {
      const root = await tempRoot(`ether-grant-${failureStage}-`);
      const storagePath = path.join(root, "appdata", "reference-grants.json");
      const documentPath = path.join(root, "Document.ether");
      const sourcePath = path.join(root, "Source.png");
      await Promise.all([writeFile(documentPath, "document"), writeFile(sourcePath, "reference")]);
      let armed = false;
      const authority = new DesktopPathGrantAuthority({
        storagePath,
        persistenceCheckpoint: (stage) => {
          if (armed && stage === failureStage) throw Object.assign(new Error(`failed ${stage}`), { code: "ENOSPC" });
        }
      });
      authority.activateDocument("document-1", documentPath);
      const grantId = authority.grant("document-1", "relink", sourcePath);
      const request = { documentId: "document-1", operation: "relink" as const, grantId, path: sourcePath };
      expect(authority.authorizePath(request)).toBe(true);

      armed = true;
      expect(() => authority.revoke(grantId, "document-1")).toThrow(/failed/);
      expect(authority.authorizePath(request)).toBe(true);

      const reopened = new DesktopPathGrantAuthority({ storagePath });
      reopened.activateDocument("document-1", documentPath);
      expect(reopened.authorizePath(request)).toBe(true);
      expect((await readdir(path.dirname(storagePath))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    }
  );
});

describe("Windows writable location classification", () => {
  it.runIf(process.platform === "win32")("classifies an actual native fixed-volume path", async () => {
    const root = await tempRoot("ether-native-location-");
    const filePath = path.join(root, "Native location.ether");
    await writeFile(filePath, "location probe");
    const create = Reflect.get(applicationServiceModule, "createWindowsLocationCapability") as
      | (() => { classify(candidatePath: string): Promise<string> })
      | undefined;

    expect(create).toBeTypeOf("function");
    await expect(create!().classify(filePath)).resolves.toBe("local-fixed");
  });

  it.runIf(process.platform === "win32")("classifies a real junction by its final native cloud path", async () => {
    const root = await tempRoot("ether-native-junction-");
    const cloudRoot = path.join(root, "Cloud Ω");
    const junctionRoot = path.join(root, "Campaign Junction");
    await mkdir(cloudRoot);
    await writeFile(path.join(cloudRoot, "Campaign.ether"), "location probe");
    await symlink(cloudRoot, junctionRoot, "junction");
    const create = Reflect.get(applicationServiceModule, "createWindowsLocationCapability") as
      | (() => { classify(candidatePath: string): Promise<string> })
      | undefined;
    const previousOneDrive = process.env.OneDrive;
    process.env.OneDrive = cloudRoot;
    try {
      expect(create).toBeTypeOf("function");
      await expect(create!().classify(path.join(junctionRoot, "Campaign.ether")))
        .resolves.toBe("cloud-placeholder");
    } finally {
      if (previousOneDrive === undefined) delete process.env.OneDrive;
      else process.env.OneDrive = previousOneDrive;
    }
  });

  it.each([
    ["secondary fixed drive", "D:\\Projects\\Campaign.ether", "D:\\Projects\\Campaign.ether", "fixed", [], false, "local-fixed"],
    ["removable drive", "E:\\Campaign.ether", "E:\\Campaign.ether", "removable", [], false, "removable"],
    ["mapped drive", "Z:\\Campaign.ether", "Z:\\Campaign.ether", "network", [], false, "mapped-network"],
    ["UNC share", "\\\\server\\share\\Campaign.ether", "\\\\server\\share\\Campaign.ether", "fixed", [], false, "mapped-network"],
    ["OneDrive path", "C:\\Users\\Deny\\OneDrive\\Campaign.ether", "C:\\Users\\Deny\\OneDrive\\Campaign.ether", "fixed", ["C:\\Users\\Deny\\OneDrive"], false, "cloud-placeholder"],
    ["junction into cloud", "D:\\Junction\\Campaign.ether", "C:\\Users\\Deny\\OneDrive\\Campaign.ether", "fixed", ["C:\\Users\\Deny\\OneDrive"], false, "cloud-placeholder"],
    ["cloud placeholder attribute", "D:\\Cloud\\Campaign.ether", "D:\\Cloud\\Campaign.ether", "fixed", [], true, "cloud-placeholder"],
    ["Unicode fixed path", "D:\\Kampaň Ω\\Obrázok.ether", "D:\\Kampaň Ω\\Obrázok.ether", "fixed", [], false, "local-fixed"],
    ["extended-length fixed path", "\\\\?\\D:\\Very Long\\Campaign.ether", "\\\\?\\D:\\Very Long\\Campaign.ether", "fixed", [], false, "local-fixed"]
  ] as const)("classifies %s from its final native path and volume", async (
    _name,
    input,
    finalPath,
    volumeType,
    cloudRoots,
    cloudPlaceholder,
    expected
  ) => {
    const create = Reflect.get(applicationServiceModule, "createWindowsLocationCapability") as
      | ((port: {
          inspect(filePath: string, signal: AbortSignal): Promise<{
            finalPath: string;
            volumeType: string;
            cloudRoots: readonly string[];
            cloudPlaceholder: boolean;
          }>;
        }) => { classify(filePath: string): Promise<string> })
      | undefined;
    expect(create).toBeTypeOf("function");
    const capability = create!({ inspect: async () => ({ finalPath, volumeType, cloudRoots, cloudPlaceholder }) });

    await expect(capability.classify(input)).resolves.toBe(expected);
  });

  it("times out and cancels a hanging native probe without blocking the event loop", async () => {
    const create = Reflect.get(applicationServiceModule, "createWindowsLocationCapability") as (
      port: { inspect(filePath: string, signal: AbortSignal): Promise<never> },
      options: { timeoutMs: number }
    ) => { classify(filePath: string): Promise<string> };
    let aborted = false;
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 5);
    const capability = create({
      inspect: async (_filePath, signal) => new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(Object.assign(new Error("probe aborted"), { code: "ABORT_ERR" }));
        }, { once: true });
      })
    }, { timeoutMs: 40 });
    try {
      await expect(capability.classify("Z:\\hung\\Campaign.ether")).resolves.toBe("unknown");
      expect(aborted).toBe(true);
      expect(ticks).toBeGreaterThan(1);
    } finally {
      clearInterval(timer);
    }
  });

  it.runIf(process.platform === "win32")("cancels an actual hanging probe child without blocking the event loop", async () => {
    const runProbe = Reflect.get(applicationServiceModule, "runBoundedLocationProbe") as
      | ((script: string, filePath: string, signal: AbortSignal) => Promise<string>)
      | undefined;
    expect(runProbe).toBeTypeOf("function");
    const controller = new AbortController();
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 5);
    const abortTimer = setTimeout(() => controller.abort(), 60);
    try {
      await expect(runProbe!(
        "$null = [Console]::In.ReadToEnd(); Start-Sleep -Seconds 30",
        "D:\\Probe input Ω.ether",
        controller.signal
      )).rejects.toMatchObject({ code: "ABORT_ERR" });
      expect(ticks).toBeGreaterThan(1);
    } finally {
      clearTimeout(abortTimer);
      clearInterval(timer);
    }
  });
});

describe("incremental reference folder search", () => {
  type Search = (
    root: string,
    options?: {
      signal?: AbortSignal;
      extensions?: readonly string[];
      maxDepth?: number;
      maxDirectories?: number;
      maxEntries?: number;
    }
  ) => AsyncGenerator<string, void, void>;

  function searchFunction(): Search {
    const candidate = Reflect.get(applicationServiceModule, "searchReferenceFiles");
    expect(candidate).toBeTypeOf("function");
    return candidate as Search;
  }

  it("filters early and bounds work across a large deep tree", async () => {
    const root = await tempRoot("ether-reference-search-large-");
    const shallow = path.join(root, "shallow");
    const deep = path.join(root, "one", "two", "three", "four");
    await Promise.all([mkdir(shallow, { recursive: true }), mkdir(deep, { recursive: true })]);
    await Promise.all(Array.from({ length: 200 }, (_, index) =>
      writeFile(path.join(shallow, `ignored-${index}.txt`), "ignored")
    ));
    await Promise.all([
      writeFile(path.join(shallow, "match.png"), pngBytes(64, 0x11)),
      writeFile(path.join(deep, "too-deep.png"), pngBytes(64, 0x22))
    ]);

    const matches: string[] = [];
    for await (const candidate of searchFunction()(root, {
      extensions: [".png"],
      maxDepth: 2,
      maxDirectories: 10,
      maxEntries: 225
    })) matches.push(candidate);

    expect(matches.map((candidate) => path.basename(candidate))).toEqual(["match.png"]);
  });

  it("stops incrementally when cancelled and does not retain the remaining files", async () => {
    const root = await tempRoot("ether-reference-search-cancel-");
    await Promise.all(Array.from({ length: 500 }, (_, index) =>
      writeFile(path.join(root, `${String(index).padStart(4, "0")}.png`), pngBytes(64, index))
    ));
    const controller = new AbortController();
    const iterator = searchFunction()(root, { signal: controller.signal, maxEntries: 500 });
    const first = await iterator.next();
    controller.abort();

    expect(first.done).toBe(false);
    expect((await iterator.next()).done).toBe(true);
  });

  it("skips inaccessible, disappearing, and identity-mismatched candidates", async () => {
    const root = await tempRoot("ether-reference-search-errors-");
    const folder = path.join(root, "search");
    const danglingTarget = path.join(root, "gone");
    await mkdir(folder, { recursive: true });
    await Promise.all([
      writeFile(path.join(folder, "gone.png"), pngBytes(64, 0x10)),
      writeFile(path.join(folder, "denied.png"), pngBytes(64, 0x20)),
      writeFile(path.join(folder, "match.png"), pngBytes(64, 0x30))
    ]);
    await symlink(danglingTarget, path.join(folder, "inaccessible"), "junction");
    const checkpoint = vi.fn(async (candidate: string) => {
      if (path.basename(candidate) === "gone.png") await unlink(candidate);
    });
    const service = new DesktopApplicationService({
      appDataRoot: path.join(root, "appdata"),
      appVersion: "4.0.0-test",
      dialogs: dialogs({ searchReferenceFolder: async () => folder }),
      provider: new FakeImageProvider(),
      referenceCandidateCheckpoint: checkpoint
    });
    const snapshot = await service.bootstrap();
    const application = (service as unknown as { application: {
      queryReferences(): Promise<Array<Record<string, unknown>>>;
      relinkDocumentReference(input: { sourcePath: string }): Promise<void>;
    } }).application;
    vi.spyOn(service, "listReferences").mockResolvedValue([{
      id: "reference-1",
      displayName: "match.png",
      mediaType: "image/png",
      state: "missing",
      actions: ["search-folder"]
    }]);
    vi.spyOn(application, "queryReferences").mockResolvedValue([{
      id: "reference-1",
      displayName: "match.png",
      mediaType: "image/png",
      state: "missing"
    }]);
    const attempted: string[] = [];
    vi.spyOn(application, "relinkDocumentReference").mockImplementation(async ({ sourcePath }) => {
      const name = path.basename(sourcePath);
      attempted.push(name);
      if (name === "denied.png") throw Object.assign(new Error("denied"), { code: "EACCES" });
      if (name !== "match.png") throw Object.assign(new Error("mismatch"), { code: "REFERENCE_IDENTITY_MISMATCH" });
    });

    try {
      await expect(service.actOnReference(snapshot.documentId, "reference-1", "search-folder")).resolves.toBeDefined();
      expect(checkpoint).toHaveBeenCalled();
      expect(attempted).not.toContain("gone.png");
      expect(attempted).toContain("match.png");
      const grants = JSON.parse(await readFile(path.join(root, "appdata", "reference-grants.json"), "utf8")) as
        Array<{ path: string }>;
      expect(grants.some((grant) => path.basename(grant.path) === "gone.png")).toBe(false);
      expect((service as unknown as { referenceSearchController: AbortController | null }).referenceSearchController)
        .toBeNull();
    } finally {
      await service.close();
    }
  });
});

describe("ether-asset protocol", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const hash = createHash("sha256").update(png).digest("hex");
  let source: EtherAssetSource;

  beforeEach(() => {
    source = {
      authorize: async (documentId, artifactId, variant) =>
        documentId === "document-1" && artifactId === "artifact-1" && variant === "original"
          ? { byteLength: png.length, contentHash: hash, mediaType: "image/png" }
          : null,
      streamRange: async function* (_documentId, _artifactId, _variant, start, endExclusive) {
        yield png.subarray(start, endExclusive);
      }
    };
  });

  it("serves authorized GET, HEAD, single, and suffix ranges with cache metadata", async () => {
    const handler = createEtherAssetProtocolHandler(source);
    const url = "ether-asset://document-1/artifact-1/original";
    const get = await handler(new Request(url));
    const head = await handler(new Request(url, { method: "HEAD" }));
    const range = await handler(new Request(url, { headers: { Range: "bytes=2-5" } }));
    const suffix = await handler(new Request(url, { headers: { Range: "bytes=-4" } }));

    expect(get.status).toBe(200);
    expect(Buffer.from(await get.arrayBuffer())).toEqual(png);
    expect(get.headers.get("Content-Type")).toBe("image/png");
    expect(get.headers.get("ETag")).toBe(`"${hash}"`);
    expect(head.status).toBe(200);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    expect(range.status).toBe(206);
    expect(range.headers.get("Content-Range")).toBe(`bytes 2-5/${png.length}`);
    expect(Buffer.from(await suffix.arrayBuffer())).toEqual(png.subarray(-4));
  });

  it("returns 304, 416, or 404 for cache hits, invalid ranges, and unknown IDs", async () => {
    const handler = createEtherAssetProtocolHandler(source);
    const url = "ether-asset://document-1/artifact-1/original";

    expect((await handler(new Request(url, { headers: { "If-None-Match": `"${hash}"` } }))).status).toBe(304);
    for (const range of ["bytes=1-2,4-5", "bytes=oops", "bytes=99-100"]) {
      const response = await handler(new Request(url, { headers: { Range: range } }));
      expect(response.status).toBe(416);
      expect(response.headers.get("Content-Range")).toBe(`bytes */${png.length}`);
    }
    expect((await handler(new Request("ether-asset://document-1/unknown/original"))).status).toBe(404);
  });

  it("rejects traversal, encoded separators, double encoding, and unsupported methods", async () => {
    const handler = createEtherAssetProtocolHandler(source);
    for (const url of [
      "ether-asset://document-1/../artifact-1/original",
      "ether-asset://document-1/artifact%2F1/original",
      "ether-asset://document-1/artifact%252F1/original"
    ]) {
      const request = url.includes("/../")
        ? { method: "GET", url, headers: new Headers() } as Request
        : new Request(url);
      expect((await handler(request)).status).toBe(400);
    }
    expect((await handler(new Request(
      "ether-asset://document-1/artifact-1/original",
      { method: "POST" }
    ))).status).toBe(405);
  });

  it("pulls a multi-megabyte open-ended range incrementally and cancels its source", async () => {
    const byteLength = 6 * 1024 * 1024;
    const chunkSize = 64 * 1024;
    let reads = 0;
    let cancelled = false;
    const handler = createEtherAssetProtocolHandler({
      authorize: async () => ({ byteLength, contentHash: "large-hash", mediaType: "video/mp4" }),
      streamRange: async function* (_documentId, _artifactId, _variant, start, endExclusive) {
        try {
          for (let offset = start; offset < endExclusive; offset += chunkSize) {
            reads += 1;
            yield new Uint8Array(Math.min(chunkSize, endExclusive - offset));
          }
        } finally {
          cancelled = true;
        }
      }
    });

    const response = await handler(new Request(
      "ether-asset://document-1/artifact-1/original",
      { headers: { Range: "bytes=0-" } }
    ));
    expect(response.status).toBe(206);
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(reads).toBe(0);

    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(first.value?.byteLength).toBe(chunkSize);
    expect(reads).toBe(1);
    await reader.cancel();
    expect(cancelled).toBe(true);
    expect(reads).toBe(1);
  });
});

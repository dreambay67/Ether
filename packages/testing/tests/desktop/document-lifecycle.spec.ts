import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FakeImageProvider } from "@ether/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AutosaveCoordinator,
  DesktopApplicationService,
  OpenDocumentCoordinator,
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

  it("keeps a fake-provider PNG embedded after save, close, and reopen", async () => {
    const root = await tempRoot("ether-fake-artifact-");
    const documentPath = path.join(root, "Generated.ether");
    const options = {
      appDataRoot: path.join(root, "appdata"),
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider()
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
      error: null
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
      readRange: async (_documentId, _artifactId, _variant, start, endExclusive) =>
        png.subarray(start, endExclusive)
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
});

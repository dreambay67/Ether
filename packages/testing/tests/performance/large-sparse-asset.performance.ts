import {
  BlobImportError,
  DocumentStore,
  importBlob,
  MAX_EMBEDDED_BLOB_BYTES
} from "@ether/document";
import { execFile } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { EtherGraph } from "@ether/schema";
import {
  createEtherAssetProtocolHandler,
  MAX_ETHER_ASSET_BYTES
} from "../../../../apps/desktop/src/main/protocol/etherAssetProtocol.js";

const execFileAsync = promisify(execFile);
const sparseBytes = 4 * 1024 * 1024 * 1024 + 1024 * 1024;
const boundedReadBytes = 64 * 1024;
let root = "";

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("Windows sparse large-asset safety", () => {
  it("fails a >=4GB import closed and never streams an oversized asset", async () => {
    if (process.platform !== "win32") {
      if (process.env.ETHER_ALLOW_SPARSE_PERFORMANCE_SKIP !== "1") {
        throw new Error("The >=4GB sparse fixture requires Windows; set ETHER_ALLOW_SPARSE_PERFORMANCE_SKIP=1 only on an explicitly documented non-Windows runner.");
      }
      console.info("ETHER_PERFORMANCE_METRIC sparse-4gb-exception " + JSON.stringify({
        exception: "explicit",
        reason: "non-Windows runner",
        environmentVariable: "ETHER_ALLOW_SPARSE_PERFORMANCE_SKIP=1"
      }));
      return;
    }

    root = mkdtempSync(path.join(os.tmpdir(), "ether-sparse-4gb-"));
    const sourcePath = path.join(root, "Sparse 4GB.png");
    const descriptor = openSync(sourcePath, "w");
    try {
      writeSync(descriptor, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    } finally {
      closeSync(descriptor);
    }
    try {
      await execFileAsync("fsutil.exe", ["sparse", "setflag", sourcePath], { windowsHide: true });
    } catch (error) {
      if (process.env.ETHER_ALLOW_SPARSE_PERFORMANCE_SKIP !== "1") {
        throw new Error(
          "Windows could not create the required sparse >=4GB fixture. " +
          "The performance gate fails closed unless ETHER_ALLOW_SPARSE_PERFORMANCE_SKIP=1 is explicitly approved.",
          { cause: error }
        );
      }
      console.info("ETHER_PERFORMANCE_METRIC sparse-4gb-exception " + JSON.stringify({
        exception: "explicit",
        reason: error instanceof Error ? error.message : String(error),
        environmentVariable: "ETHER_ALLOW_SPARSE_PERFORMANCE_SKIP=1"
      }));
      return;
    }

    const sparse = await open(sourcePath, "r+");
    const bounded = Buffer.alloc(boundedReadBytes);
    let bytesRead: number;
    let boundedReadMs: number;
    try {
      await sparse.truncate(sparseBytes);
      const readStarted = performance.now();
      ({ bytesRead } = await sparse.read(
        bounded,
        0,
        bounded.byteLength,
        sparseBytes - bounded.byteLength
      ));
      boundedReadMs = performance.now() - readStarted;
    } finally {
      await sparse.close();
    }
    expect(bytesRead).toBe(boundedReadBytes);
    expect(bounded.every((byte) => byte === 0)).toBe(true);
    const sparseStat = await stat(sourcePath);
    expect(sparseStat.size).toBe(sparseBytes);

    const appDataRoot = path.join(root, "app-data");
    const store = await DocumentStore.create(path.join(root, "Sparse safety.ether"), {
      appVersion: "4.0.0-performance",
      documentId: "sparse-safety",
      environment: {
        leaseRoot: path.join(appDataRoot, "leases"),
        recoveryRoot: path.join(appDataRoot, "recovery"),
        locationCapability: { classify: () => "local-fixed" }
      },
      initialGraph: graph(),
      title: "Sparse safety"
    });
    const checkpoints: string[] = [];
    const importStarted = performance.now();
    let importRejectionMs: number;
    try {
      await expect(importBlob(store, {
        sourcePath,
        mediaType: "image/png"
      }, {
        appDataRoot,
        checkpoint: (checkpoint) => checkpoints.push(checkpoint)
      })).rejects.toMatchObject({ code: "BLOB_TOO_LARGE" } satisfies Partial<BlobImportError>);
      importRejectionMs = performance.now() - importStarted;
      expect(checkpoints).toEqual([]);
      expect(MAX_EMBEDDED_BLOB_BYTES).toBe(MAX_ETHER_ASSET_BYTES);
    } finally {
      await store.close();
    }

    let rangeStreams = 0;
    const handler = createEtherAssetProtocolHandler({
      authorize: async () => ({
        byteLength: sparseBytes,
        contentHash: "sparse4gb",
        mediaType: "image/png"
      }),
      streamRange: async function* () {
        rangeStreams += 1;
        yield Buffer.alloc(boundedReadBytes);
      }
    });
    const response = await handler(new Request("ether-asset://sparse-safety/artifact/original", {
      headers: { Range: `bytes=${sparseBytes - boundedReadBytes}-${sparseBytes - 1}` }
    }));
    expect(response.status).toBe(404);
    expect(rangeStreams).toBe(0);

    const allocation = await execFileAsync(
      "fsutil.exe",
      ["sparse", "queryrange", sourcePath],
      { windowsHide: true }
    ).then(({ stdout }) => stdout.trim(), (error) => `query unavailable: ${String(error)}`);
    console.info("ETHER_PERFORMANCE_METRIC sparse-4gb-safety " + JSON.stringify({
      logicalBytes: sparseStat.size,
      boundedReadBytes: bytesRead,
      boundedReadMs,
      importLimitBytes: MAX_EMBEDDED_BLOB_BYTES,
      importRejectionMs,
      streamInvocations: rangeStreams,
      allocationEvidence: allocation
    }));
  });
});

function graph(): EtherGraph {
  const timestamp = "2026-07-23T00:00:00.000Z";
  return {
    id: "sparse-graph",
    title: "Sparse safety",
    kind: "root",
    createdAt: timestamp,
    updatedAt: timestamp,
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
  };
}

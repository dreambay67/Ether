import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  DocumentStore,
  importBlob,
  reconcileLiveOutput as reconcileDurableLiveOutput,
  reconcileStaging,
  repairDocument,
  writeRecoveryJournal
} from "@ether/document";
import {
  EtherApplication,
  publishAtomicExportFile,
  stableExportPublicationId,
  type ExportPublicationCheckpoint
} from "@ether/application";
import { FakeImageProvider } from "@ether/providers";
import type { NodeOutputVersion, PayloadEnvelope } from "@ether/schema";
import { createRepositoryContext } from "../../document/src/repositories/graphs";
import {
  LiveOutputRepository,
  type LiveOutputDirectoryGrant
} from "../../document/src/repositories/liveOutput";
import { materializeLiveOutput } from "../../document/src/liveOutput/materialize";
import { reconcileLiveOutput } from "../../document/src/liveOutput/reconcile";

const roots: string[] = [];
const openStores: DocumentStore[] = [];
const now = "2026-07-23T00:00:00.000Z";

const initialGraph = {
  id: "graph-root",
  title: "Chaos",
  kind: "root" as const,
  createdAt: now,
  updatedAt: now,
  nodes: [{
    id: "prompt-1",
    definitionId: "prompt.text" as const,
    title: "Recovery prompt",
    position: { x: 40, y: 60 },
    size: { width: 220, height: 140 },
    config: { kind: "prompt.text" as const, body: "Recover this", assembly: "append" as const },
    presentation: { collapsed: false, accent: "default" as const, previewMode: "summary" as const }
  }],
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

const providerGraph = {
  ...initialGraph,
  nodes: [
    initialGraph.nodes[0],
    {
      id: "image-1",
      definitionId: "generation.image" as const,
      title: "Recovered image",
      position: { x: 340, y: 60 },
      size: { width: 220, height: 180 },
      config: {
        kind: "generation.image" as const,
        providerId: "ether-fake-local",
        profileId: "fake-image-default",
        aspectRatio: "1:1",
        resolution: { width: 32, height: 32 },
        outputCount: 1
      },
      presentation: {
        collapsed: false,
        accent: "default" as const,
        previewMode: "summary" as const
      }
    }
  ],
  edges: [{
    id: "prompt-image",
    from: { kind: "node" as const, nodeId: "prompt-1", channel: "text" as const },
    to: { kind: "node" as const, nodeId: "image-1", channel: "text" as const },
    role: "subject" as const,
    order: 0,
    selector: { kind: "latest-approved" as const },
    adapter: { kind: "auto" as const },
    enabled: true
  }]
};

function tempRoot(prefix = "ether-chaos-"): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function environment(appDataRoot: string, overrides: Record<string, unknown> = {}) {
  return {
    appInstanceId: `chaos-${Math.random()}`,
    leaseRoot: path.join(appDataRoot, "leases"),
    machineId: "chaos-machine",
    recoveryRoot: path.join(appDataRoot, "recovery"),
    locationCapability: { classify: () => "local-fixed" as const },
    ...overrides
  };
}

async function createStore(root: string, name: string, overrides: Record<string, unknown> = {}) {
  const appDataRoot = path.join(root, "appdata");
  const documentPath = path.join(root, `${name}.ether`);
  const store = await DocumentStore.create(documentPath, {
    appVersion: "4.0.0",
    documentId: `document-${name.toLowerCase()}`,
    title: name,
    initialGraph,
    environment: environment(appDataRoot, overrides)
  });
  openStores.push(store);
  return { appDataRoot, documentPath, store };
}

function pngBytes(length: number, seed: number): Buffer {
  const bytes = Buffer.alloc(length, seed);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  return bytes;
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the crash checkpoint.");
}

async function hardKillAtMarker(input: {
  env: Record<string, string>;
  label: string;
  markerPath: string;
  source: string;
  timeoutMs?: number;
}): Promise<void> {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", input.source], {
    cwd: path.dirname(import.meta.dirname),
    env: { ...process.env, ...input.env },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  try {
    await waitFor(() => {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`${input.label} child exited before its checkpoint: ${stderr}`);
      }
      return existsSync(input.markerPath);
    }, input.timeoutMs);
    child.kill("SIGKILL");
    await exited;
    expect(child.signalCode).not.toBeNull();
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
}

async function createProvenance(
  store: DocumentStore,
  outputVersionId: string,
  payloadId: string
): Promise<void> {
  const head = await store.read(({ revisions }) => revisions.head());
  const version: NodeOutputVersion = {
    id: outputVersionId,
    nodeId: "prompt-1",
    graphId: "graph-root",
    graphRevisionId: head.graphRevisions["graph-root"]!,
    inputPayloadIds: [],
    selectedOutputVersionIds: [],
    compiledContextHash: "sha256:chaos-recovery",
    producer: { kind: "local", executor: "deterministic-assembly" },
    outputPayloadIds: [payloadId],
    parentOutputVersionId: null,
    approval: { state: "unreviewed" },
    runId: null,
    stepId: null,
    workItemId: null,
    attemptId: null,
    timing: { startedAt: now, completedAt: "2026-07-23T00:00:01.000Z" },
    failure: null,
    createdAt: "2026-07-23T00:00:01.000Z"
  };
  const payload: PayloadEnvelope = {
    id: payloadId,
    channel: "image",
    role: "general",
    content: { kind: "object", value: { recovered: true } },
    source: { nodeId: "prompt-1", outputVersionId, lineageKey: `lineage-${payloadId}` },
    metadata: {}
  };
  await store.transaction(({ outputs }) => outputs.insert(version, [payload]));
}

afterEach(async () => {
  await Promise.all(openStores.splice(0).map(async (store) => {
    try { await store.close(); } catch { /* A killed/injected store can already be closed. */ }
  }));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("document crash and recovery boundaries", () => {
  it("waits for a timed-out crash child to exit before test cleanup", async () => {
    const root = tempRoot("ether-crash-helper-timeout-");
    const markerPath = path.join(root, "never-created.marker");
    const pidPath = path.join(root, "child.pid");
    await expect(hardKillAtMarker({
      label: "Timeout regression",
      markerPath,
      timeoutMs: 150,
      env: { ETHER_CHILD_PID: pidPath },
      source: `
        import { writeFileSync } from "node:fs";
        writeFileSync(process.env.ETHER_CHILD_PID, String(process.pid));
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
      `
    })).rejects.toThrow("Timed out waiting for the crash checkpoint.");
    const pid = Number(readFileSync(pidPath, "utf8"));
    expect(Number.isInteger(pid)).toBe(true);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("awaits an autosave crash child that fails before reaching its marker", async () => {
    const root = tempRoot("ether-autosave-early-failure-");
    const markerPath = path.join(root, "never-created.marker");
    await expect(hardKillAtMarker({
      label: "Autosave early-failure",
      markerPath,
      timeoutMs: 2_000,
      env: {},
      source: `throw new Error("forced autosave child startup failure");`
    })).rejects.toThrow(/Autosave early-failure child exited before its checkpoint/);
  });

  it("rolls back an in-flight document transaction after a real hard kill", async () => {
    const root = tempRoot("ether-autosave-kill-");
    const appDataRoot = path.join(root, "appdata");
    const documentPath = path.join(root, "Autosave.ether");
    const markerPath = path.join(root, "inside-transaction.marker");
    const childSource = `
      import { writeFileSync } from "node:fs";
      import { DocumentStore } from "@ether/document";
      const graph = ${JSON.stringify(initialGraph)};
      const store = await DocumentStore.create(process.env.ETHER_CHILD_DOCUMENT, {
        appVersion: "4.0.0",
        documentId: "document-autosave-kill",
        title: "Autosave kill",
        initialGraph: graph,
        environment: {
          appInstanceId: "child",
          leaseRoot: process.env.ETHER_CHILD_LEASES,
          machineId: "chaos-machine",
          recoveryRoot: process.env.ETHER_CHILD_RECOVERY,
          locationCapability: { classify: () => "local-fixed" }
        }
      });
      await store.transaction(({ settings }) => {
        settings.setTitle("Uncommitted title");
        writeFileSync(process.env.ETHER_CHILD_MARKER, "inside");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
      });
    `;
    await hardKillAtMarker({
      label: "Autosave transaction",
      markerPath,
      env: {
        ETHER_CHILD_DOCUMENT: documentPath,
        ETHER_CHILD_LEASES: path.join(appDataRoot, "leases"),
        ETHER_CHILD_MARKER: markerPath,
        ETHER_CHILD_RECOVERY: path.join(appDataRoot, "recovery")
      },
      source: childSource
    });
    const reopened = await DocumentStore.open(documentPath, {
      access: "require-write",
      environment: environment(appDataRoot, {
        appInstanceId: "reopened",
        processIsAlive: () => false,
        staleMs: 0
      })
    });
    openStores.push(reopened);
    expect(reopened.dirty).toBe(false);
    expect((await reopened.read(({ settings }) => settings.getHeader())).title).toBe("Autosave kill");
    expect((await reopened.read(({ graphs }) => graphs.get("graph-root")))?.title).toBe("Chaos");
    await reopened.close();
    openStores.pop();
    const journalPath = `${documentPath}-journal`;
    if (existsSync(journalPath)) {
      const rollbackJournalMagic = Buffer.from([0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7]);
      expect(readFileSync(journalPath).subarray(0, rollbackJournalMagic.length))
        .not.toEqual(rollbackJournalMagic);
    }
  }, 20_000);

  it("reclaims a real hard-killed blob import without exposing a partial blob or artifact", async () => {
    const root = tempRoot("ether-blob-kill-");
    const created = await createStore(root, "BlobKill");
    const sourcePath = path.join(root, "large.png");
    const markerPath = path.join(root, "blob-import.marker");
    writeFileSync(sourcePath, pngBytes(4 * 1024 * 1024, 0x5a));
    await created.store.close();
    openStores.splice(openStores.indexOf(created.store), 1);
    await hardKillAtMarker({
      label: "Blob import",
      markerPath,
      env: {
        ETHER_CHILD_APPDATA: created.appDataRoot,
        ETHER_CHILD_DOCUMENT: created.documentPath,
        ETHER_CHILD_MARKER: markerPath,
        ETHER_CHILD_SOURCE: sourcePath
      },
      source: `
        import { writeFileSync } from "node:fs";
        import { DocumentStore, importBlob } from "@ether/document";
        const appDataRoot = process.env.ETHER_CHILD_APPDATA;
        const store = await DocumentStore.open(process.env.ETHER_CHILD_DOCUMENT, {
          access: "require-write",
          environment: {
            appInstanceId: "blob-child",
            leaseRoot: appDataRoot + "/leases",
            machineId: "chaos-machine",
            recoveryRoot: appDataRoot + "/recovery",
            locationCapability: { classify: () => "local-fixed" }
          }
        });
        await importBlob(store, {
          sourcePath: process.env.ETHER_CHILD_SOURCE,
          mediaType: "image/png"
        }, {
          appDataRoot,
          checkpoint: (stage) => {
            if (stage === "before-finalize") {
              writeFileSync(process.env.ETHER_CHILD_MARKER, stage);
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
            }
          }
        });
      `
    });
    const reopened = await DocumentStore.open(created.documentPath, {
      access: "require-write",
      environment: environment(created.appDataRoot, {
        appInstanceId: "blob-reopened",
        processIsAlive: () => false,
        staleMs: 0
      })
    });
    openStores.push(reopened);
    expect((await reopened.read(({ graphs }) => graphs.get("graph-root")))?.title).toBe("Chaos");
    expect(await reopened.read(({ blobs }) => blobs.list())).toEqual([]);
    expect(await reopened.read(({ artifacts }) => artifacts.list())).toEqual([]);
    expect(readdirSync(path.join(created.appDataRoot, "recovery"))).toEqual([]);
    expect(statSync(created.documentPath).isFile()).toBe(true);
  }, 20_000);

  it("reconciles a real hard kill after provider completion is staged but before document import", async () => {
    const root = tempRoot("ether-provider-kill-");
    const appDataRoot = path.join(root, "appdata");
    const documentPath = path.join(root, "ProviderKill.ether");
    const markerPath = path.join(root, "provider-import.marker");
    const readyPath = path.join(root, "provider-job.json");
    await hardKillAtMarker({
      label: "Provider import",
      markerPath,
      env: {
        ETHER_CHILD_APPDATA: appDataRoot,
        ETHER_CHILD_DOCUMENT: documentPath,
        ETHER_CHILD_MARKER: markerPath,
        ETHER_CHILD_READY: readyPath
      },
      source: `
        import { writeFileSync } from "node:fs";
        import { EtherApplication } from "@ether/application";
        import { FakeImageProvider } from "@ether/providers";
        const correlationId = "provider-hard-kill-correlation";
        const application = new EtherApplication({
          appDataRoot: process.env.ETHER_CHILD_APPDATA,
          appVersion: "4.0.0",
          provider: new FakeImageProvider(),
          dispatchMode: "manual",
          executionCheckpoint: (stage) => {
            if (stage === "provider-output-staged") {
              writeFileSync(process.env.ETHER_CHILD_MARKER, stage);
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
            }
          }
        });
        const created = await application.createDocument({
          path: process.env.ETHER_CHILD_DOCUMENT,
          title: "Provider kill",
          initialGraph: ${JSON.stringify(providerGraph)}
        });
        const preview = await application.execute({
          kind: "command",
          id: "provider-kill-preview",
          correlationId,
          documentId: created.documentId,
          name: "run.preview",
          payload: { graphId: "graph-root", scope: { kind: "graph" } }
        });
        const permit = await application.execute({
          kind: "command",
          id: "provider-kill-permit",
          correlationId,
          documentId: created.documentId,
          name: "permission.grantRun",
          payload: { planId: preview.payload.plan.id, contentHash: preview.payload.plan.contentHash }
        });
        const started = await application.execute({
          kind: "command",
          id: "provider-kill-start",
          correlationId,
          documentId: created.documentId,
          name: "run.start",
          payload: {
            planId: preview.payload.plan.id,
            contentHash: preview.payload.plan.contentHash,
            runPermitId: permit.payload.permitId
          }
        });
        writeFileSync(process.env.ETHER_CHILD_READY, JSON.stringify({ jobId: started.payload.job.id }));
        await application.runPending(started.payload.job.id);
      `
    });
    const { jobId } = JSON.parse(readFileSync(readyPath, "utf8")) as { jobId: string };
    const reopened = new EtherApplication({
      appDataRoot,
      appVersion: "4.0.0",
      provider: new FakeImageProvider(),
      dispatchMode: "manual",
      documentEnvironment: { processIsAlive: () => false, staleMs: 0 }
    });
    try {
      await reopened.openDocument({ path: documentPath, access: "require-write" });
      expect((await reopened.queryJob(jobId)).status).toBe("completed");
      const artifacts = await reopened.searchArtifacts({ text: "" });
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]?.metadata.correlationId).toBe("provider-hard-kill-correlation");
      const thumbnail = await reopened.queryArtifactAssetDescriptor(
        artifacts[0]!.id,
        "thumbnail"
      );
      expect(thumbnail).toMatchObject({
        byteLength: expect.any(Number),
        contentKey: expect.stringMatching(/^[a-f0-9]{64}$/u),
        mediaType: "image/webp"
      });
      const thumbnailChunks: Buffer[] = [];
      for await (const chunk of reopened.streamArtifactAssetRange(
        artifacts[0]!.id,
        "thumbnail",
        0,
        thumbnail.byteLength
      )) {
        thumbnailChunks.push(chunk);
      }
      const thumbnailBytes = Buffer.concat(thumbnailChunks);
      expect(thumbnailBytes).toHaveLength(thumbnail.byteLength);
      expect(createHash("sha256").update(thumbnailBytes).digest("hex"))
        .toBe(thumbnail.contentKey);
      const thumbnailRange: Buffer[] = [];
      for await (const chunk of reopened.streamArtifactAssetRange(
        artifacts[0]!.id,
        "thumbnail",
        0,
        Math.min(16, thumbnail.byteLength)
      )) {
        thumbnailRange.push(chunk);
      }
      expect(Buffer.concat(thumbnailRange))
        .toEqual(thumbnailBytes.subarray(0, Math.min(16, thumbnail.byteLength)));
      expect(await reopened.boundaryStore().read(({ execution }) =>
        execution.getExecutionCorrelation(jobId)
      )).toMatchObject({
        correlationId: "provider-hard-kill-correlation",
        jobId,
        workItems: [{ attempts: [{ artifactIds: [artifacts[0]!.id] }] }]
      });
      expect(readdirSync(path.join(appDataRoot, "recovery"))).toEqual([]);
    } finally {
      await reopened.closeDocument();
    }
  }, 20_000);

  it("recovers same-parent export stages after real hard kills without exposing a partial final file", async () => {
    if (process.platform !== "win32") return;
    for (const checkpoint of ["after-stage-open", "after-stage-write"] satisfies ExportPublicationCheckpoint[]) {
      const root = tempRoot(`ether-export-${checkpoint}-kill-`);
      const exportRoot = path.join(root, "exports");
      const collection = path.join(exportRoot, "Collection");
      const sourceRoot = path.join(root, "appdata", "bundle");
      const sourcePath = path.join(sourceRoot, "output.bin");
      const destination = path.join(collection, "artifact.png");
      const markerPath = path.join(root, `${checkpoint}.marker`);
      const publicationId = stableExportPublicationId(checkpoint, "artifact.png");
      const bytes = pngBytes(256 * 1024, checkpoint === "after-stage-open" ? 31 : 47);
      const expectedHash = createHash("sha256").update(bytes).digest("hex");
      mkdirSync(collection, { recursive: true });
      mkdirSync(sourceRoot, { recursive: true });
      writeFileSync(sourcePath, bytes);

      await hardKillAtMarker({
        env: {
          ETHER_CHILD_CHECKPOINT: checkpoint,
          ETHER_CHILD_DESTINATION: destination,
          ETHER_CHILD_EXPORT_ROOT: exportRoot,
          ETHER_CHILD_HASH: expectedHash,
          ETHER_CHILD_MARKER: markerPath,
          ETHER_CHILD_PUBLICATION: publicationId,
          ETHER_CHILD_SOURCE: sourcePath
        },
        label: `Export ${checkpoint}`,
        markerPath,
        source: `
          import { publishAtomicExportFile } from "@ether/application";
          await publishAtomicExportFile({
            checkpoint: process.env.ETHER_CHILD_CHECKPOINT,
            checkpointMarkerPath: process.env.ETHER_CHILD_MARKER,
            destination: process.env.ETHER_CHILD_DESTINATION,
            expectedByteLength: ${bytes.byteLength},
            expectedHash: process.env.ETHER_CHILD_HASH,
            publicationId: process.env.ETHER_CHILD_PUBLICATION,
            root: process.env.ETHER_CHILD_EXPORT_ROOT,
            sourcePath: process.env.ETHER_CHILD_SOURCE
          });
        `
      });

      expect(existsSync(destination)).toBe(false);
      const stagePath = path.join(collection, `.ether-export-${publicationId}.stage`);
      await waitFor(() => existsSync(stagePath));
      if (checkpoint === "after-stage-write") {
        expect(statSync(stagePath).size).toBe(bytes.byteLength);
        expect(hashFile(stagePath)).toBe(expectedHash);
      }

      await expect(publishAtomicExportFile({
        destination,
        expectedByteLength: bytes.byteLength,
        expectedHash,
        publicationId,
        root: exportRoot,
        sourcePath
      })).resolves.toBe("published");
      expect(statSync(destination).size).toBe(bytes.byteLength);
      expect(hashFile(destination)).toBe(expectedHash);
      expect(readFileSync(destination).subarray(128, 512)).toEqual(bytes.subarray(128, 512));
      expect(readdirSync(collection)).toEqual(["artifact.png"]);
    }
  }, 40_000);

  it("preserves source and pre-existing destination across Save As and Compact publication failures", async () => {
    const root = tempRoot();
    let failSave = true;
    const source = await createStore(root, "Source", {
      onSaveStage: (stage: string) => {
        if (failSave && stage === "publication") throw new Error("stop Save As before publication");
      }
    });
    const destinationPath = path.join(root, "Destination.ether");
    const destination = await DocumentStore.create(destinationPath, {
      appVersion: "4.0.0",
      documentId: "document-existing-destination",
      title: "Existing destination",
      initialGraph,
      environment: environment(path.join(root, "destination-appdata"))
    });
    await destination.close();
    const sourceHash = hashFile(source.documentPath);
    const destinationHash = hashFile(destinationPath);
    await expect(source.store.saveAs(destinationPath)).rejects.toThrow("stop Save As");
    expect(hashFile(source.documentPath)).toBe(sourceHash);
    expect(hashFile(destinationPath)).toBe(destinationHash);
    expect(source.store.path).toBe(source.documentPath);
    failSave = false;

    const compactRoot = tempRoot();
    const compact = await createStore(compactRoot, "Compact", {
      onCompactStage: (stage: string) => {
        if (stage === "publication") throw new Error("stop Compact after replacement");
      }
    });
    const compactHash = hashFile(compact.documentPath);
    await expect(compact.store.compact()).rejects.toThrow("stop Compact");
    expect(hashFile(compact.documentPath)).toBe(compactHash);
    expect((await compact.store.read(({ graphs }) => graphs.get("graph-root")))?.title).toBe("Chaos");
  });

  it("preserves source and pre-existing destination after a real hard kill during Save As publication", async () => {
    const root = tempRoot("ether-save-as-kill-");
    const source = await createStore(root, "SaveAsSource");
    const destinationPath = path.join(root, "SaveAsDestination.ether");
    const destination = await DocumentStore.create(destinationPath, {
      appVersion: "4.0.0",
      documentId: "document-save-as-existing",
      title: "Existing Save As destination",
      initialGraph,
      environment: environment(path.join(root, "destination-appdata"))
    });
    await destination.close();
    await source.store.close();
    openStores.splice(openStores.indexOf(source.store), 1);
    const sourceHash = hashFile(source.documentPath);
    const destinationHash = hashFile(destinationPath);
    const markerPath = path.join(root, "save-as-publication.marker");
    await hardKillAtMarker({
      label: "Save As",
      markerPath,
      env: {
        ETHER_CHILD_APPDATA: source.appDataRoot,
        ETHER_CHILD_DESTINATION: destinationPath,
        ETHER_CHILD_DOCUMENT: source.documentPath,
        ETHER_CHILD_MARKER: markerPath
      },
      source: `
        import { writeFileSync } from "node:fs";
        import { DocumentStore } from "@ether/document";
        const appDataRoot = process.env.ETHER_CHILD_APPDATA;
        const store = await DocumentStore.open(process.env.ETHER_CHILD_DOCUMENT, {
          access: "require-write",
          environment: {
            appInstanceId: "save-as-child",
            leaseRoot: appDataRoot + "/leases",
            machineId: "chaos-machine",
            recoveryRoot: appDataRoot + "/recovery",
            locationCapability: { classify: () => "local-fixed" },
            onSaveStage: (stage) => {
              if (stage === "publication") {
                writeFileSync(process.env.ETHER_CHILD_MARKER, stage);
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
              }
            }
          }
        });
        await store.saveAs(process.env.ETHER_CHILD_DESTINATION);
      `
    });
    expect(hashFile(source.documentPath)).toBe(sourceHash);
    expect(hashFile(destinationPath)).toBe(destinationHash);
    const reopened = await DocumentStore.open(source.documentPath, {
      access: "require-write",
      environment: environment(source.appDataRoot, {
        appInstanceId: "save-as-reopened",
        processIsAlive: () => false,
        staleMs: 0
      })
    });
    openStores.push(reopened);
    expect(reopened.path).toBe(path.resolve(source.documentPath));
    expect((await reopened.read(({ settings }) => settings.getHeader())).title).toBe("SaveAsSource");
    expect((await reopened.read(({ graphs }) => graphs.get("graph-root")))?.title).toBe("Chaos");
    expect(hashFile(destinationPath)).toBe(destinationHash);
  }, 20_000);

  it("preserves the original after a real hard kill during Compact replacement preparation", async () => {
    const root = tempRoot("ether-compact-kill-");
    const created = await createStore(root, "CompactKill");
    await created.store.close();
    openStores.splice(openStores.indexOf(created.store), 1);
    const originalHash = hashFile(created.documentPath);
    const markerPath = path.join(root, "compact-rollback.marker");
    await hardKillAtMarker({
      label: "Compact",
      markerPath,
      env: {
        ETHER_CHILD_APPDATA: created.appDataRoot,
        ETHER_CHILD_DOCUMENT: created.documentPath,
        ETHER_CHILD_MARKER: markerPath
      },
      source: `
        import { writeFileSync } from "node:fs";
        import { DocumentStore } from "@ether/document";
        const appDataRoot = process.env.ETHER_CHILD_APPDATA;
        const store = await DocumentStore.open(process.env.ETHER_CHILD_DOCUMENT, {
          access: "require-write",
          environment: {
            appInstanceId: "compact-child",
            leaseRoot: appDataRoot + "/leases",
            machineId: "chaos-machine",
            recoveryRoot: appDataRoot + "/recovery",
            locationCapability: { classify: () => "local-fixed" },
            onCompactStage: (stage) => {
              if (stage === "rollback-created") {
                writeFileSync(process.env.ETHER_CHILD_MARKER, stage);
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
              }
            }
          }
        });
        await store.compact();
      `
    });
    expect(hashFile(created.documentPath)).toBe(originalHash);
    const reopened = await DocumentStore.open(created.documentPath, {
      access: "require-write",
      environment: environment(created.appDataRoot, {
        appInstanceId: "compact-reopened",
        processIsAlive: () => false,
        staleMs: 0
      })
    });
    openStores.push(reopened);
    expect((await reopened.read(({ settings }) => settings.getHeader())).title).toBe("CompactKill");
    expect((await reopened.read(({ graphs }) => graphs.get("graph-root")))?.title).toBe("Chaos");
    expect(hashFile(created.documentPath)).toBe(originalHash);
    expect(readdirSync(path.join(created.appDataRoot, "recovery"))).toEqual([]);
  }, 20_000);

  it("reclaims interrupted blob import staging and rejects executable and MIME-confused content", async () => {
    const root = tempRoot();
    const { appDataRoot, documentPath, store } = await createStore(root, "Imports");
    const executable = path.join(root, "payload.bin");
    const wrongMime = path.join(root, "image.bin");
    const interrupted = path.join(root, "interrupted.png");
    writeFileSync(executable, Buffer.from([0x4d, 0x5a, 0x90, 0x00]));
    writeFileSync(wrongMime, "not an image");
    writeFileSync(interrupted, pngBytes(2 * 1024 * 1024, 0x42));
    await expect(importBlob(store, {
      sourcePath: executable, mediaType: "application/octet-stream"
    }, { appDataRoot })).rejects.toMatchObject({ code: "EXECUTABLE_CONTENT" });
    await expect(importBlob(store, {
      sourcePath: wrongMime, mediaType: "image/png"
    }, { appDataRoot })).rejects.toMatchObject({ code: "MIME_MISMATCH" });
    await expect(importBlob(store, {
      sourcePath: interrupted, mediaType: "image/png"
    }, {
      appDataRoot,
      checkpoint: (stage) => {
        if (stage === "before-finalize") throw new Error("kill before blob finalize");
      }
    })).rejects.toThrow("kill before blob finalize");
    expect(readdirSync(path.join(appDataRoot, "recovery")).length).toBeGreaterThanOrEqual(1);
    await expect(reconcileStaging(store, { appDataRoot })).resolves.toMatchObject({
      removed: expect.arrayContaining([expect.stringMatching(/^blob-import-/)])
    });
    expect(readdirSync(path.join(appDataRoot, "recovery"))).toEqual([]);
    expect(statSync(documentPath).isFile()).toBe(true);
  });

  it("imports a durable provider completion once as review-required recovery", async () => {
    const root = tempRoot();
    const { appDataRoot, documentPath, store } = await createStore(root, "ProviderRecovery");
    await createProvenance(store, "output-provider", "payload-provider");
    const providerDirectory = path.join(appDataRoot, "staging", "provider", "attempt-1");
    const stagedPath = path.join(providerDirectory, "output.png");
    mkdirSync(providerDirectory, { recursive: true });
    writeFileSync(stagedPath, pngBytes(8_192, 0x41), { flag: "wx" });
    writeRecoveryJournal({
      appDataRoot,
      entry: {
        id: "provider-attempt-1",
        kind: "provider-output",
        state: "staged",
        documentId: store.documentId,
        documentPath,
        stagedPath,
        sourceName: "output.png",
        mediaType: "image/png",
        artifact: {
          id: "artifact-provider-recovered",
          channel: "image",
          mediaType: "image/png",
          source: { outputVersionId: "output-provider", payloadId: "payload-provider" },
          createdAt: now,
          metadata: { provider: "fake" }
        },
        createdAt: now,
        updatedAt: now
      }
    });
    expect(await reconcileStaging(store, { appDataRoot })).toMatchObject({
      recovered: ["provider-attempt-1"],
      quarantined: []
    });
    expect(store.dirty).toBe(true);
    expect(await store.read(({ artifacts }) => artifacts.get("artifact-provider-recovered")))
      .toMatchObject({
        metadata: { recovery: { reviewRequired: true, status: "recovered" } }
      });
    expect(await reconcileStaging(store, { appDataRoot }))
      .toEqual({ attention: [], recovered: [], quarantined: [], removed: [] });
  });

  it("reconciles a real hard kill during an optional Live Output move without touching the embedded original", async () => {
    const root = tempRoot("ether-live-move-kill-");
    const created = await createStore(root, "LiveMoveKill");
    await createProvenance(created.store, "output-live-move", "payload-live-move");
    const sourcePath = path.join(root, "embedded-source.png");
    const bytes = pngBytes(64 * 1024, 0x63);
    writeFileSync(sourcePath, bytes);
    const imported = await importBlob(created.store, {
      sourcePath,
      mediaType: "image/png"
    }, { appDataRoot: created.appDataRoot });
    const artifact = {
      id: "artifact-live-move",
      contentKey: imported.contentKey,
      channel: "image" as const,
      mediaType: "image/png",
      byteLength: bytes.byteLength,
      source: {
        outputVersionId: "output-live-move",
        payloadId: "payload-live-move"
      },
      createdAt: now,
      metadata: { durableOriginal: true }
    };
    await created.store.transaction(({ artifacts }) => artifacts.attach(artifact));
    await created.store.close();
    openStores.splice(openStores.indexOf(created.store), 1);
    const liveRoot = path.join(root, "live-output");
    mkdirSync(liveRoot, { recursive: true });
    const markerPath = path.join(root, "live-output-move.marker");
    await hardKillAtMarker({
      label: "Live Output move",
      markerPath,
      env: {
        ETHER_CHILD_APPDATA: created.appDataRoot,
        ETHER_CHILD_CONTENT_KEY: imported.contentKey,
        ETHER_CHILD_DOCUMENT: created.documentPath,
        ETHER_CHILD_LIVE_ROOT: liveRoot,
        ETHER_CHILD_MARKER: markerPath,
        ETHER_CHILD_SOURCE: sourcePath
      },
      source: `
        import { readFileSync, writeFileSync } from "node:fs";
        import { DocumentStore, materializeLiveOutput } from "@ether/document";
        const appDataRoot = process.env.ETHER_CHILD_APPDATA;
        const store = await DocumentStore.open(process.env.ETHER_CHILD_DOCUMENT, {
          access: "require-write",
          environment: {
            appInstanceId: "live-move-child",
            leaseRoot: appDataRoot + "/leases",
            machineId: "chaos-machine",
            recoveryRoot: appDataRoot + "/recovery",
            locationCapability: { classify: () => "local-fixed" }
          }
        });
        const grant = {
          documentId: store.documentId,
          grantId: "live-move-grant",
          purpose: "live-output",
          revoked: false,
          root: process.env.ETHER_CHILD_LIVE_ROOT
        };
        const bytes = readFileSync(process.env.ETHER_CHILD_SOURCE);
        const base = {
          artifactId: "artifact-live-move",
          byteLength: bytes.byteLength,
          collectionId: null,
          contentKey: process.env.ETHER_CHILD_CONTENT_KEY,
          expectedHash: process.env.ETHER_CHILD_CONTENT_KEY,
          bytes
        };
        await store.runLiveOutput(async (repository) => {
          repository.enable(grant, { transferPolicy: "move" });
          await materializeLiveOutput(repository, {
            grant,
            items: [{ ...base, relativePath: "old/original.png" }]
          });
          await materializeLiveOutput(repository, {
            grant,
            items: [{ ...base, relativePath: "new/original.png" }],
            checkpoint: async (stage) => {
              if (stage === "committed") {
                writeFileSync(process.env.ETHER_CHILD_MARKER, stage);
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
              }
            }
          });
        });
      `
    });
    expect(readFileSync(path.join(liveRoot, "old", "original.png"))).toEqual(bytes);
    expect(readFileSync(path.join(liveRoot, "new", "original.png"))).toEqual(bytes);
    const reopened = await DocumentStore.open(created.documentPath, {
      access: "require-write",
      environment: environment(created.appDataRoot, {
        appInstanceId: "live-move-reopened",
        processIsAlive: () => false,
        staleMs: 0
      })
    });
    openStores.push(reopened);
    const grant: LiveOutputDirectoryGrant = {
      documentId: reopened.documentId,
      grantId: "live-move-grant",
      purpose: "live-output",
      revoked: false,
      root: liveRoot
    };
    const reconciliation = await reopened.runLiveOutput((repository) =>
      reconcileDurableLiveOutput(repository, { grant })
    );
    expect(reconciliation.extraPaths).toContain("old/original.png");
    expect(await reopened.read(({ artifacts }) => artifacts.get(artifact.id))).toEqual(artifact);
    expect(await reopened.read(({ blobs }) => blobs.get(imported.contentKey))).toMatchObject({
      byteLength: bytes.byteLength,
      contentKey: imported.contentKey,
    });
    expect(readFileSync(path.join(liveRoot, "new", "original.png"))).toEqual(bytes);
  }, 20_000);

  it("reconciles an interrupted Live Output operation and resumes the same manifest operation", async () => {
    const root = tempRoot("ether-live-chaos-");
    const schemaPath = path.resolve(import.meta.dirname, "../../document/src/schema/40000.sql");
    const database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
    try {
      database.exec(readFileSync(schemaPath, "utf8"));
      database.prepare(
        `INSERT INTO document (
           singleton, document_id, format_marker, format_version, schema_version, title,
           created_at, updated_at, app_version, feature_flags_json
         ) VALUES (1, ?, 'ETHERDOC', '4.0.0', 40000, 'Live chaos', ?, ?, '4.0.0', '{}')`
      ).run("document-live-chaos", now, now);
      const repository = new LiveOutputRepository(createRepositoryContext(database));
      const bytes = Buffer.from("durable live output");
      const contentKey = createHash("sha256").update(bytes).digest("hex");
      database.prepare(
        `INSERT INTO blobs (
           content_key, status, byte_length, media_type, inline_data, chunk_count,
           compression, created_at, updated_at
         ) VALUES (?, 'ready', ?, 'application/octet-stream', ?, 0, 'none', ?, ?)`
      ).run(contentKey, bytes.byteLength, bytes, now, now);
      database.prepare(
        `INSERT INTO artifacts (
           artifact_id, content_key, kind, channel, media_type, byte_length,
           source_output_version_id, source_payload_id, title, description, metadata_json, created_at
         ) VALUES ('artifact-live', ?, 'generated', 'data', 'application/octet-stream', ?, '', '', 'Live', '', '{}', ?)`
      ).run(contentKey, bytes.byteLength, now);
      const grant: LiveOutputDirectoryGrant = {
        documentId: "document-live-chaos",
        grantId: "grant-live",
        purpose: "live-output",
        revoked: false,
        root
      };
      repository.enable(grant);
      const item = {
        artifactId: "artifact-live",
        byteLength: bytes.byteLength,
        collectionId: null,
        contentKey,
        expectedHash: contentKey,
        relativePath: "review/output.bin",
        bytes
      };
      await expect(materializeLiveOutput(repository, {
        grant,
        items: [item],
        checkpoint: async (stage) => {
          if (stage === "verified") throw new Error("interrupt verified Live Output");
        }
      })).rejects.toThrow("interrupt verified");
      const interrupted = repository.listOperations()[0]!;
      expect(interrupted.state).toBe("failed");
      expect((await reconcileLiveOutput(repository, { grant })).extraOwnedPaths)
        .toContain("review/output.bin");
      const resumed = await materializeLiveOutput(repository, { grant, items: [item] });
      expect(resumed.items[0]).toMatchObject({ operationId: interrupted.id, state: "committed" });
      expect(readFileSync(path.join(root, "review", "output.bin"))).toEqual(bytes);
    } finally {
      database.close();
    }
  });

  it("refuses concurrent, cloud, UNC-classified, and mapped-drive writers while keeping read-only access", async () => {
    const root = tempRoot();
    const active = await createStore(root, "Writer");
    const competing = await DocumentStore.open(active.documentPath, {
      access: "prefer-write",
      environment: environment(active.appDataRoot, { appInstanceId: "competitor" })
    });
    openStores.push(competing);
    expect(competing.mode).toEqual({ kind: "read-only", reason: "writer-active" });
    await competing.close();
    openStores.splice(openStores.indexOf(competing), 1);
    await active.store.close();
    openStores.splice(openStores.indexOf(active.store), 1);

    for (const [label, classification] of [
      ["cloud", "cloud-placeholder"],
      ["UNC", "mapped-network"],
      ["mapped", "mapped-network"]
    ] as const) {
      const opened = await DocumentStore.open(active.documentPath, {
        access: "prefer-write",
        environment: environment(path.join(root, `appdata-${label}`), {
          appInstanceId: `location-${label}`,
          locationCapability: { classify: () => classification }
        })
      });
      openStores.push(opened);
      expect(opened.mode, label).toEqual({ kind: "read-only", reason: "location-unsupported" });
      await opened.close();
      openStores.splice(openStores.indexOf(opened), 1);
    }
  });

  it("repairs into a reviewable new document and report without mutating the damaged source", async () => {
    const root = tempRoot();
    const { appDataRoot, documentPath, store } = await createStore(root, "Damaged");
    await store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const database = new DatabaseSync(documentPath);
    database.prepare("DELETE FROM metadata_fts WHERE entity_type = 'document'").run();
    database.close();
    const damagedHash = hashFile(documentPath);
    const destinationPath = path.join(root, "Recovered.ether");
    const report = await repairDocument(documentPath, destinationPath, {
      appDataRoot,
      environment: environment(appDataRoot)
    });
    expect(report).toMatchObject({
      destinationPath,
      losses: [],
      statement: "logical-row-repair-only",
      recovered: { graphs: 1 }
    });
    expect(destinationPath).not.toBe(documentPath);
    expect(hashFile(documentPath)).toBe(damagedHash);
    const recovered = await DocumentStore.open(destinationPath, {
      access: "read-only",
      environment: environment(appDataRoot)
    });
    openStores.push(recovered);
    expect(recovered.dirty).toBe(true);
    expect((await recovered.read(({ graphs }) => graphs.get("graph-root")))?.title).toBe("Chaos");
  });
});

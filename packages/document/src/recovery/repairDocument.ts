import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { open, rename } from "node:fs/promises";
import path from "node:path";
import type {
  Artifact,
  EtherGraph,
  GraphOperation,
  NodeOutputVersion,
  PayloadEnvelope,
  PreparedGraphCommit,
  RecoveryJournalEntry
} from "@ether/schema";

import { importBlob } from "../blob/importBlob.js";
import { readBlobRange } from "../blob/readBlobRange.js";
import {
  DocumentStore,
  DOCUMENT_STORE_INTERNAL,
  DOCUMENT_STORE_RECOVERY_OPEN,
  type DocumentStoreEnvironment
} from "../documentStore.js";
import {
  ensureOwnedRecoveryDirectory,
  removeOwnedStagingPath,
  removeRecoveryJournal,
  resolveRecoveryRoots,
  writeRecoveryJournal
} from "./recoveryJournal.js";
import { BLOB_CHUNK_SIZE } from "../repositories/blobs.js";
import type { ArtifactRepairMetadata } from "../repositories/artifacts.js";

export interface RepairLoss {
  entityId: string;
  reason: string;
  type:
    | "artifact"
    | "blob"
    | "collection"
    | "collection-membership"
    | "export-record"
    | "graph"
    | "lineage"
    | "provenance"
    | "rating"
    | "reference"
    | "tag";
}

export class RepairDocumentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RepairDocumentError";
    this.code = code;
  }
}

interface ProvenanceSnapshot {
  missing: string[];
  payloads: PayloadEnvelope[];
  versions: NodeOutputVersion[];
}

export interface RepairReport {
  destinationPath: string;
  losses: RepairLoss[];
  recovered: {
    artifacts: number;
    blobs: number;
    graphs: number;
    references: number;
  };
  statement: "logical-row-repair-only";
}

interface GraphRecoveryPlan {
  forward: GraphOperation[];
  initialGraph: EtherGraph;
  inverse: GraphOperation[];
  snapshots: EtherGraph[];
}

function collectProvenance(
  artifacts: Artifact[],
  outputs: {
    getPayload(id: string): PayloadEnvelope | undefined;
    getVersion(id: string): NodeOutputVersion | undefined;
  }
): ProvenanceSnapshot {
  const missing = new Set<string>();
  const payloads = new Map<string, PayloadEnvelope>();
  const versions = new Map<string, NodeOutputVersion>();
  const queue = artifacts.map((artifact) => artifact.source.outputVersionId);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (versions.has(id) || missing.has(id)) continue;
    const version = outputs.getVersion(id);
    if (version === undefined) {
      missing.add(id);
      continue;
    }
    versions.set(id, version);
    if (version.parentOutputVersionId !== null) queue.push(version.parentOutputVersionId);
    queue.push(...version.selectedOutputVersionIds);
    for (const payloadId of [...version.inputPayloadIds, ...version.outputPayloadIds]) {
      const payload = outputs.getPayload(payloadId);
      if (payload === undefined) {
        missing.add(payloadId);
        continue;
      }
      payloads.set(payload.id, payload);
      if (payload.source.outputVersionId !== version.id) {
        queue.push(payload.source.outputVersionId);
      }
    }
  }
  return {
    missing: [...missing].sort(),
    payloads: [...payloads.values()],
    versions: [...versions.values()]
  };
}

function planGraphRecovery(graphs: EtherGraph[], losses: RepairLoss[]): GraphRecoveryPlan {
  const root = graphs.find((graph) => graph.kind === "root");
  if (root === undefined) throw new Error("Repair source has no validated root graph.");
  const byId = new Map(graphs.map((graph) => [graph.id, graph]));
  const initialGraph = { ...root, modules: [] };
  const forward: GraphOperation[] = [];
  const inverse: GraphOperation[] = [];
  const visited = new Set([root.id]);
  const queue = [root];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const module of parent.modules) {
      const internal = byId.get(module.graphId);
      if (internal === undefined || internal.kind !== "module") {
        losses.push({
          type: "graph",
          entityId: module.graphId,
          reason: `Module ${module.id} has no validated internal graph.`
        });
        continue;
      }
      if (visited.has(internal.id)) {
        losses.push({
          type: "graph",
          entityId: internal.id,
          reason: `Module graph ${internal.id} is cyclic or referenced more than once.`
        });
        continue;
      }
      visited.add(internal.id);
      const stagedInternal = { ...internal, modules: [] };
      forward.push({
        type: "createModule",
        graphId: parent.id,
        module,
        internalGraph: stagedInternal
      });
      inverse.push({ type: "removeModule", graphId: parent.id, moduleId: module.id });
      queue.push(internal);
    }
  }
  for (const graph of graphs) {
    if (!visited.has(graph.id)) {
      losses.push({
        type: "graph",
        entityId: graph.id,
        reason: "Validated graph is not reachable from the root module hierarchy."
      });
    }
  }
  return {
    forward,
    initialGraph,
    inverse,
    snapshots: graphs.filter((graph) => visited.has(graph.id))
  };
}

async function materializeValidatedBlob(
  source: DocumentStore,
  contentKey: string,
  byteLength: number,
  destinationPath: string
): Promise<void> {
  const descriptor = await open(destinationPath, "wx", 0o600);
  try {
    for (let start = 0; start < byteLength; start += BLOB_CHUNK_SIZE) {
      const end = Math.min(byteLength, start + BLOB_CHUNK_SIZE);
      const bytes = await readBlobRange(source, contentKey, start, end);
      await descriptor.write(bytes, 0, bytes.length, start);
    }
    await descriptor.sync();
  } finally {
    await descriptor.close();
  }
}

export async function repairDocument(
  sourcePath: string,
  destinationPath: string,
  options: {
    allowLossy?: boolean;
    appDataRoot?: string;
    checkpoint?: (name: string) => void;
    environment?: DocumentStoreEnvironment;
  } = {}
): Promise<RepairReport> {
  const absoluteSource = path.resolve(sourcePath);
  const absoluteDestination = path.resolve(destinationPath);
  if (absoluteSource === absoluteDestination) {
    throw new RepairDocumentError("INVALID_REPAIR_DESTINATION", "Repair requires a new file path.");
  }
  if (existsSync(absoluteDestination)) {
    throw new RepairDocumentError(
      "REPAIR_DESTINATION_EXISTS",
      "Repair never replaces an existing destination."
    );
  }
  const roots = resolveRecoveryRoots(options.appDataRoot);
  const repairId = `repair-${randomUUID()}`;
  const stagingDirectory = path.join(roots.stagingRoot, "repair", repairId);
  const stagedDestination = path.join(stagingDirectory, "repaired.ether");
  const losses: RepairLoss[] = [];
  const recovered = { artifacts: 0, blobs: 0, graphs: 0, references: 0 };
  const source = await DocumentStore[DOCUMENT_STORE_RECOVERY_OPEN](
    absoluteSource,
    options.environment
  );
  const timestamp = new Date().toISOString();
  let journalEntry: RecoveryJournalEntry = {
    id: repairId,
    kind: "document-repair" as const,
    state: "staged" as const,
    documentId: source.documentId,
    documentPath: absoluteSource,
    stagedPath: stagingDirectory,
    destinationPath: absoluteDestination,
    sourceName: path.basename(absoluteSource),
    mediaType: "application/vnd.dreambay.ether",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  let journalPath: string | undefined;
  let destination: DocumentStore | undefined;
  try {
    journalPath = writeRecoveryJournal({
      appDataRoot: roots.appDataRoot,
      entry: journalEntry
    });
    options.checkpoint?.("journal-created");
    ensureOwnedRecoveryDirectory(stagingDirectory, roots.appDataRoot);
    options.checkpoint?.("staging-created");
    const snapshot = await source[DOCUMENT_STORE_INTERNAL]("read", (repositories) => {
      const artifacts = repositories.artifacts.list();
      return {
        artifacts,
        blobs: repositories.blobs.list(),
        graphs: repositories.graphs.list(),
        header: repositories.settings.getHeader(),
        mediaMetadata: repositories.artifacts.repairMetadata(),
        provenance: collectProvenance(artifacts, repositories.outputs),
        references: repositories.references.list()
      };
    });
    const graphPlan = planGraphRecovery(snapshot.graphs, losses);
    destination = await DocumentStore.create(stagedDestination, {
      appVersion: "4.0.0",
      documentId: randomUUID(),
      environment: options.environment,
      featureFlags: snapshot.header.featureFlags,
      initialGraph: graphPlan.initialGraph,
      title: snapshot.header.title
    });
    options.checkpoint?.("destination-created");
    if (graphPlan.forward.length > 0) {
      const head = await destination.read(({ revisions }) => revisions.head());
      const commit: PreparedGraphCommit = {
        id: `repair-graphs-${randomUUID()}`,
        baseDocumentRevisionId: head.documentRevisionId,
        baseGraphRevisions: head.graphRevisions,
        title: "Recover validated graph set",
        actor: "system",
        graphSnapshots: graphPlan.snapshots,
        forwardOperations: graphPlan.forward,
        inverseOperations: graphPlan.inverse
      };
      await destination.transaction(({ revisions }) => revisions.commit(commit));
    }
    recovered.graphs = graphPlan.snapshots.length;

    for (const id of snapshot.provenance.missing) {
      losses.push({
        type: "provenance",
        entityId: id,
        reason: "Required artifact provenance row is missing or invalid."
      });
    }
    const destinationHead = await destination.read(({ revisions }) => revisions.head());
    const payloadById = new Map(snapshot.provenance.payloads.map((payload) => [payload.id, payload]));
    const pending = new Map(snapshot.provenance.versions.map((version) => [version.id, version]));
    const copiedVersions = new Set<string>();
    const copiedPayloads = new Set<string>();
    while (pending.size > 0) {
      let progressed = false;
      for (const [id, version] of [...pending]) {
        const dependencies = [
          ...(version.parentOutputVersionId === null ? [] : [version.parentOutputVersionId]),
          ...version.selectedOutputVersionIds,
          ...version.inputPayloadIds.map((payloadId) => payloadById.get(payloadId)?.source.outputVersionId)
        ].filter((value): value is string => value !== undefined);
        if (dependencies.some((dependency) => pending.has(dependency))) continue;
        const graphRevisionId = destinationHead.graphRevisions[version.graphId];
        const payloads = version.outputPayloadIds.map((payloadId) => payloadById.get(payloadId));
        if (graphRevisionId === undefined || payloads.some((payload) => payload === undefined)) {
          losses.push({
            type: "provenance",
            entityId: id,
            reason: "Output provenance graph or payload dependency was not recoverable."
          });
          pending.delete(id);
          progressed = true;
          continue;
        }
        try {
          await destination.transaction(({ outputs }) =>
            outputs.insert(
              { ...version, graphRevisionId },
              payloads as PayloadEnvelope[]
            )
          );
          copiedVersions.add(id);
          for (const payload of payloads as PayloadEnvelope[]) copiedPayloads.add(payload.id);
        } catch (error) {
          losses.push({
            type: "provenance",
            entityId: id,
            reason: error instanceof Error ? error.message : "Output provenance validation failed."
          });
        }
        pending.delete(id);
        progressed = true;
      }
      if (progressed) continue;
      for (const id of pending.keys()) {
        losses.push({
          type: "provenance",
          entityId: id,
          reason: "Output provenance dependency graph is cyclic or incomplete."
        });
      }
      pending.clear();
    }

    const recoveredContent = new Set<string>();
    for (const blob of snapshot.blobs) {
      const stagedPath = path.join(stagingDirectory, `${blob.contentKey}.blob`);
      try {
        await materializeValidatedBlob(source, blob.contentKey, blob.byteLength, stagedPath);
        const imported = await importBlob(
          destination,
          { sourcePath: stagedPath, mediaType: blob.mediaType },
          { appDataRoot: roots.appDataRoot }
        );
        if (imported.contentKey !== blob.contentKey || imported.byteLength !== blob.byteLength) {
          throw new Error("Rehashed blob identity differs from its source logical row.");
        }
        recoveredContent.add(blob.contentKey);
        recovered.blobs += 1;
      } catch (error) {
        losses.push({
          type: "blob",
          entityId: blob.contentKey,
          reason: error instanceof Error ? error.message : "Blob validation failed."
        });
      } finally {
        removeOwnedStagingPath(stagedPath, roots.appDataRoot);
      }
    }

    for (const artifact of snapshot.artifacts) {
      if (!recoveredContent.has(artifact.contentKey)) {
        losses.push({
          type: "artifact",
          entityId: artifact.id,
          reason: `Content blob ${artifact.contentKey} was not recoverable.`
        });
        continue;
      }
      if (
        !copiedVersions.has(artifact.source.outputVersionId) ||
        !copiedPayloads.has(artifact.source.payloadId)
      ) {
        losses.push({
          type: "artifact",
          entityId: artifact.id,
          reason: "Artifact provenance output or payload was not recoverable."
        });
        continue;
      }
      try {
        await destination.transaction(({ artifacts }) => artifacts.attach(artifact));
        recovered.artifacts += 1;
      } catch (error) {
        losses.push({
          type: "artifact",
          entityId: artifact.id,
          reason: error instanceof Error ? error.message : "Artifact validation failed."
        });
      }
    }

    const recoveredArtifacts = new Set(
      (await destination.read(({ artifacts }) => artifacts.list())).map((artifact) => artifact.id)
    );
    const mediaMetadata: ArtifactRepairMetadata = {
      collections: snapshot.mediaMetadata.collections,
      exportRecords: [],
      lineage: [],
      memberships: [],
      ratings: [],
      tags: []
    };
    for (const row of snapshot.mediaMetadata.exportRecords) {
      losses.push({
        type: "export-record",
        entityId: row.id,
        reason: "Export path grants are document-bound and require a new export operation."
      });
    }
    for (const row of snapshot.mediaMetadata.lineage) {
      if (
        recoveredArtifacts.has(row.artifactId) &&
        recoveredArtifacts.has(row.parentArtifactId) &&
        (row.sourceOutputVersionId === null || copiedVersions.has(row.sourceOutputVersionId))
      ) {
        mediaMetadata.lineage.push(row);
      } else {
        losses.push({
          type: "lineage",
          entityId: `${row.artifactId}:${row.parentArtifactId}:${row.relation}`,
          reason: "Artifact lineage dependency was not recoverable."
        });
      }
    }
    for (const row of snapshot.mediaMetadata.tags) {
      if (recoveredArtifacts.has(row.artifactId)) mediaMetadata.tags.push(row);
      else losses.push({ type: "tag", entityId: `${row.artifactId}:${row.tag}`, reason: "Tagged artifact was not recoverable." });
    }
    for (const row of snapshot.mediaMetadata.ratings) {
      if (recoveredArtifacts.has(row.artifactId)) mediaMetadata.ratings.push(row);
      else losses.push({ type: "rating", entityId: row.id, reason: "Rated artifact was not recoverable." });
    }
    const collectionIds = new Set(mediaMetadata.collections.map((collection) => collection.id));
    for (const row of snapshot.mediaMetadata.memberships) {
      if (collectionIds.has(row.collectionId) && recoveredArtifacts.has(row.artifactId)) {
        mediaMetadata.memberships.push(row);
      } else {
        losses.push({
          type: "collection-membership",
          entityId: `${row.collectionId}:${row.artifactId}`,
          reason: "Collection membership artifact was not recoverable."
        });
      }
    }
    await destination[DOCUMENT_STORE_INTERNAL]("write", ({ artifacts }) =>
      artifacts.restoreRepairMetadata(mediaMetadata)
    );

    for (const sourceReference of snapshot.references) {
      const reference = sourceReference.pathGrantId === null
        ? sourceReference
        : {
            ...sourceReference,
            pathGrantId: null,
            state: "missing" as const,
            updatedAt: new Date().toISOString()
          };
      if (sourceReference.pathGrantId !== null) {
        losses.push({
          type: "reference",
          entityId: sourceReference.id,
          reason: "Reference path grant was bound to the source document and was revoked in repair."
        });
      }
      if (
        (reference.contentKey !== null && !recoveredContent.has(reference.contentKey)) ||
        (reference.previewContentKey !== null && !recoveredContent.has(reference.previewContentKey))
      ) {
        losses.push({
          type: "reference",
          entityId: reference.id,
          reason: "Embedded reference content or preview was not recoverable."
        });
        continue;
      }
      try {
        await destination[DOCUMENT_STORE_INTERNAL]("write", ({ references }) =>
          references.put(reference)
        );
        recovered.references += 1;
      } catch (error) {
        losses.push({
          type: "reference",
          entityId: reference.id,
          reason: error instanceof Error ? error.message : "Reference validation failed."
        });
      }
    }
    await destination.rebuildDerivedIndexes();
    if (losses.length > 0 && options.allowLossy !== true) {
      throw new RepairDocumentError(
        "LOSSY_REPAIR_REQUIRES_OPT_IN",
        `Repair found ${losses.length} logical row loss(es); pass allowLossy to create a partial copy.`
      );
    }
    await destination[DOCUMENT_STORE_INTERNAL]("write", ({ revisions }) =>
      revisions.markDirty()
    );
    await destination.close();
    destination = undefined;
    journalEntry = {
      ...journalEntry,
      state: "publishing",
      updatedAt: new Date().toISOString()
    };
    writeRecoveryJournal({ appDataRoot: roots.appDataRoot, entry: journalEntry });
    options.checkpoint?.("publishing");
    if (existsSync(absoluteDestination)) {
      throw new RepairDocumentError(
        "REPAIR_DESTINATION_EXISTS",
        "Repair destination appeared before publication."
      );
    }
    await rename(stagedDestination, absoluteDestination);
    journalEntry = {
      ...journalEntry,
      state: "committed",
      updatedAt: new Date().toISOString()
    };
    writeRecoveryJournal({ appDataRoot: roots.appDataRoot, entry: journalEntry });
    options.checkpoint?.("committed");
    removeOwnedStagingPath(stagingDirectory, roots.appDataRoot);
    removeRecoveryJournal(journalPath, roots.appDataRoot);
    return {
      destinationPath: absoluteDestination,
      losses,
      recovered,
      statement: "logical-row-repair-only"
    };
  } catch (error) {
    await destination?.close();
    if (journalPath !== undefined) {
      journalEntry = {
        ...journalEntry,
        state: "failed",
        updatedAt: new Date().toISOString()
      };
      try {
        writeRecoveryJournal({ appDataRoot: roots.appDataRoot, entry: journalEntry });
      } catch {
        // Preserve the original repair failure and any durable journal already present.
      }
    }
    throw error;
  } finally {
    await source.close();
  }
}

import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import type { EtherGraph, GraphOperation, PreparedGraphCommit } from "@ether/schema";

import { importBlob } from "../blob/importBlob.js";
import { readBlobRange } from "../blob/readBlobRange.js";
import {
  DocumentStore,
  type DocumentStoreEnvironment
} from "../documentStore.js";
import { resolveRecoveryRoots } from "./recoveryJournal.js";
import { BLOB_CHUNK_SIZE } from "../repositories/blobs.js";

export interface RepairLoss {
  entityId: string;
  reason: string;
  type: "artifact" | "blob" | "graph" | "reference";
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
  options: { appDataRoot?: string; environment?: DocumentStoreEnvironment } = {}
): Promise<RepairReport> {
  const absoluteSource = path.resolve(sourcePath);
  const absoluteDestination = path.resolve(destinationPath);
  const roots = resolveRecoveryRoots(options.appDataRoot);
  const repairId = `repair-${randomUUID()}`;
  const stagingDirectory = path.join(roots.stagingRoot, "repair", repairId);
  await mkdir(stagingDirectory, { recursive: true });
  const losses: RepairLoss[] = [];
  const recovered = { artifacts: 0, blobs: 0, graphs: 0, references: 0 };
  const source = await DocumentStore.open(absoluteSource, { access: "read-only" });
  let destination: DocumentStore | undefined;
  try {
    const snapshot = await source.read((repositories) => ({
      artifacts: repositories.artifacts.list(),
      blobs: repositories.blobs.list(),
      graphs: repositories.graphs.list(),
      header: repositories.settings.getHeader(),
      references: repositories.references.list()
    }));
    const graphPlan = planGraphRecovery(snapshot.graphs, losses);
    destination = await DocumentStore.create(absoluteDestination, {
      appVersion: "4.0.0",
      documentId: randomUUID(),
      environment: options.environment,
      featureFlags: snapshot.header.featureFlags,
      initialGraph: graphPlan.initialGraph,
      title: snapshot.header.title
    });
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
        await rm(stagedPath, { force: true });
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

    for (const reference of snapshot.references) {
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
        await destination.transaction(({ references }) => references.put(reference));
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
    await destination.close();
    destination = undefined;
    return {
      destinationPath: absoluteDestination,
      losses,
      recovered,
      statement: "logical-row-repair-only"
    };
  } catch (error) {
    await destination?.close();
    throw error;
  } finally {
    await source.close();
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSnapshot, insertSnapshot } from "./database.js";
import { projectPaths } from "./paths.js";
import { loadGraph, readProjectMetadata, saveGraph, writeJson, writeProjectMetadata } from "./projectStore.js";
import { EtherGraphSchema, SNAPSHOT_SLOTS, type RestoreSnapshotResult, type SnapshotRecord, type SnapshotSlot } from "./schema.js";

export async function createSnapshot(
  projectPath: string,
  slot: SnapshotSlot,
  label?: string
): Promise<SnapshotRecord> {
  if (!SNAPSHOT_SLOTS.includes(slot)) {
    throw new Error(`Snapshot slot must be one of ${SNAPSHOT_SLOTS.join(", ")}.`);
  }

  const paths = projectPaths(projectPath);
  const graph = await loadGraph(projectPath);
  const createdAt = new Date().toISOString();
  const id = `${slot}-${createdAt.replace(/[:.]/g, "-")}-${randomUUID()}`;
  const snapshotPath = path.join(paths.snapshots, `${id}.json`);
  const snapshot: SnapshotRecord = {
    id,
    slot,
    label: label ?? null,
    path: snapshotPath,
    createdAt
  };

  await writeJson(snapshotPath, { snapshot, graph });
  insertSnapshot(paths.database, snapshot, paths.snapshots);

  return snapshot;
}

export async function restoreSnapshot(
  projectPath: string,
  snapshotId: string
): Promise<RestoreSnapshotResult> {
  const paths = projectPaths(projectPath);
  const snapshot = getSnapshot(paths.database, snapshotId);
  const stored = JSON.parse(await readFile(snapshot.path, "utf8")) as { graph: unknown };
  const storedGraph = EtherGraphSchema.parse(stored.graph);
  const graph = EtherGraphSchema.parse({
    ...storedGraph,
    selectedSnapshotId: snapshot.id
  });
  const restoredGraph = await saveGraph(projectPath, graph);
  const currentMetadata = await readProjectMetadata(projectPath);
  const metadata = {
    ...currentMetadata,
    activeSnapshotId: snapshot.id,
    updatedAt: restoredGraph.updatedAt
  };

  await writeProjectMetadata(projectPath, metadata);

  return {
    metadata,
    graph: restoredGraph,
    snapshot
  };
}

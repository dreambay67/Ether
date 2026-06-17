import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProject,
  createSnapshot,
  loadGraph,
  openProject,
  restoreSnapshot,
  runHealthCheck,
  saveGraph,
  REQUIRED_DATABASE_TABLES,
  type EtherGraph,
  type SnapshotRecord
} from "@ether/engine";
import { insertSnapshot } from "../../engine/src/project/database";

const tempRoots: string[] = [];

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-project-store-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project store", () => {
  it("creates the expected bundle structure and default metadata", async () => {
    const parentDirectory = await createTempRoot();

    const project = await createProject({ parentDirectory, name: "My Test Project!" });

    expect(project.path).toBe(path.join(parentDirectory, "My Test Project.ether"));
    expect(project.metadata.displayName).toBe("My Test Project!");
    expect(project.metadata.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(project.metadata.autosave).toEqual({ enabled: true, intervalMs: 60000 });
    expect(project.metadata.brandLockup).toBe("ETHER by DreamBay");
    expect(project.metadata.activeSnapshotId).toBeNull();

    await expect(readFile(path.join(project.path, "project.json"), "utf8")).resolves.toContain(
      "My Test Project!"
    );
    await expect(readFile(path.join(project.path, "graph.json"), "utf8")).resolves.toContain(
      "\"nodes\": []"
    );
    await expect(
      readFile(path.join(project.path, "assets", "references", "linked-index.json"), "utf8")
    ).resolves.toContain("\"references\": []");
    await expect(readFile(path.join(project.path, "runs", "run-log.jsonl"), "utf8")).resolves.toBe("");

    const reopened = await openProject(project.path);
    expect(reopened.path).toBe(project.path);
    expect(reopened.database.tables.sort()).toEqual([...REQUIRED_DATABASE_TABLES].sort());
  });

  it("creates missing parent directories during first-run project creation", async () => {
    const root = await createTempRoot();
    const parentDirectory = path.join(root, "Documents", "Ether Projects");

    const project = await createProject({ parentDirectory, name: "Tryout 1" });

    expect(project.path).toBe(path.join(parentDirectory, "Tryout 1.ether"));
    await expect(readFile(path.join(project.path, "project.json"), "utf8")).resolves.toContain(
      "Tryout 1"
    );
  });

  it("round-trips graph JSON through saveGraph and loadGraph", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Graph Roundtrip" });
    const graph: EtherGraph = {
      nodes: [{ id: "prompt-1", type: "prompt", position: { x: 12, y: 34 }, data: { text: "sky" } }],
      edges: [{ id: "edge-1", source: "prompt-1", target: "generation-1" }],
      viewport: { x: 5, y: 6, zoom: 0.75 },
      selectedSnapshotId: null,
      updatedAt: "will-be-replaced"
    };

    await saveGraph(project.path, graph);
    const loaded = await loadGraph(project.path);

    expect(loaded.nodes).toEqual(graph.nodes);
    expect(loaded.edges).toEqual(graph.edges);
    expect(loaded.viewport).toEqual(graph.viewport);
    expect(new Date(loaded.updatedAt).toString()).not.toBe("Invalid Date");

    const rootEntries = await readdir(project.path);
    expect(rootEntries.filter((entry) => entry.includes(".tmp-"))).toEqual([]);
  });

  it("round-trips representative React Flow canvas graph state", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Canvas Roundtrip" });
    const graph: EtherGraph = {
      nodes: [
        {
          id: "ether-node-1",
          type: "etherNode",
          position: { x: 120, y: 180 },
          width: 240,
          height: 148,
          selected: true,
          data: {
            definitionId: "prompt-general",
            kind: "Prompt",
            subtype: "General",
            title: "Hero prompt",
            label: "Hero prompt",
            notes: "Keep it cinematic",
            instruction: "blue hour portrait",
            status: "idle"
          }
        },
        {
          id: "ether-node-2",
          type: "etherNode",
          position: { x: 480, y: 180 },
          width: 240,
          height: 148,
          data: {
            definitionId: "generation-image",
            kind: "Generation",
            subtype: "Image",
            title: "Image Generation",
            label: "Image Generation",
            notes: "",
            instruction: "Placeholder only",
            status: "idle"
          }
        }
      ],
      edges: [
        {
          id: "edge-1",
          source: "ether-node-1",
          target: "ether-node-2",
          label: "prompt",
          data: { label: "prompt" }
        }
      ],
      viewport: { x: -25, y: 40, zoom: 0.85 },
      selectedSnapshotId: null,
      updatedAt: new Date().toISOString()
    };

    await saveGraph(project.path, graph);
    const loaded = await loadGraph(project.path);
    const reopened = await openProject(project.path);

    expect(loaded.nodes).toEqual(graph.nodes);
    expect(loaded.edges).toEqual(graph.edges);
    expect(loaded.viewport).toEqual(graph.viewport);
    expect(reopened.graph.nodes).toEqual(graph.nodes);
    expect(reopened.graph.edges).toEqual(graph.edges);
  });

  it("rejects invalid graph updatedAt values when loading existing graph JSON", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Invalid Graph Date" });

    await writeFile(
      path.join(project.path, "graph.json"),
      JSON.stringify({
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        selectedSnapshotId: null,
        updatedAt: "not-a-date"
      })
    );

    await expect(loadGraph(project.path)).rejects.toThrow();
  });

  it("creates and restores an A slot snapshot", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Snapshots" });

    await saveGraph(project.path, {
      nodes: [{ id: "original", position: { x: 1, y: 2 } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "will-be-replaced"
    });
    const snapshot = await createSnapshot(project.path, "A", "First usable graph");

    await saveGraph(project.path, {
      nodes: [{ id: "changed", position: { x: 3, y: 4 } }],
      edges: [],
      viewport: { x: 10, y: 10, zoom: 2 },
      selectedSnapshotId: null,
      updatedAt: "will-be-replaced"
    });

    const restored = await restoreSnapshot(project.path, snapshot.id);

    expect(restored.graph.nodes).toEqual([{ id: "original", position: { x: 1, y: 2 } }]);
    expect(restored.metadata.activeSnapshotId).toBe(snapshot.id);
    expect(restored.graph.selectedSnapshotId).toBe(snapshot.id);
  });

  it("replaces the previous snapshot when the same slot is saved again", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Snapshot Replacement" });

    await saveGraph(project.path, {
      nodes: [{ id: "first", position: { x: 1, y: 2 } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: new Date().toISOString()
    });
    const firstSnapshot = await createSnapshot(project.path, "A", "First A");

    await saveGraph(project.path, {
      nodes: [{ id: "second", position: { x: 3, y: 4 } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: new Date().toISOString()
    });
    const secondSnapshot = await createSnapshot(project.path, "A", "Second A");

    const restored = await restoreSnapshot(project.path, secondSnapshot.id);
    const snapshotFiles = await readdir(path.join(project.path, "snapshots"));

    expect(secondSnapshot.id).not.toBe(firstSnapshot.id);
    expect(restored.graph.nodes).toEqual([{ id: "second", position: { x: 3, y: 4 } }]);
    expect(snapshotFiles).toEqual([path.basename(secondSnapshot.path)]);
    await expect(restoreSnapshot(project.path, firstSnapshot.id)).rejects.toThrow(
      `Snapshot "${firstSnapshot.id}" was not found.`
    );
  });

  it("keeps the previous same-slot snapshot file when replacement insert fails", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Snapshot Failure" });

    await saveGraph(project.path, {
      nodes: [{ id: "original-a", position: { x: 1, y: 2 } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: new Date().toISOString()
    });
    const originalA = await createSnapshot(project.path, "A", "Original A");

    await saveGraph(project.path, {
      nodes: [{ id: "slot-b", position: { x: 3, y: 4 } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: new Date().toISOString()
    });
    const slotB = await createSnapshot(project.path, "B", "Slot B");

    const replacementPath = path.join(project.path, "snapshots", "failed-replacement.json");
    await writeFile(replacementPath, JSON.stringify({ replacement: true }));

    expect(() =>
      insertSnapshot(path.join(project.path, "ether.db"), {
        id: slotB.id,
        slot: "A",
        label: "Conflicting replacement",
        path: replacementPath,
        createdAt: new Date().toISOString()
      })
    ).toThrow();

    await expect(readFile(originalA.path, "utf8")).resolves.toContain("original-a");

    const restored = await restoreSnapshot(project.path, originalA.id);
    expect(restored.graph.nodes).toEqual([{ id: "original-a", position: { x: 1, y: 2 } }]);
  });

  it("creates a replacement snapshot when stale same-slot file cleanup fails", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Snapshot Cleanup Failure" });
    const staleSnapshotPath = path.join(project.path, "snapshots", "stale-directory.json");

    await mkdir(staleSnapshotPath);
    insertSnapshot(path.join(project.path, "ether.db"), {
      id: "stale-snapshot",
      slot: "A",
      label: "Stale A",
      path: staleSnapshotPath,
      createdAt: new Date().toISOString()
    });

    await saveGraph(project.path, {
      nodes: [{ id: "replacement", position: { x: 5, y: 6 } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: new Date().toISOString()
    });

    const snapshot = await createSnapshot(project.path, "A", "Replacement A");
    const restored = await restoreSnapshot(project.path, snapshot.id);

    expect(restored.graph.nodes).toEqual([{ id: "replacement", position: { x: 5, y: 6 } }]);
    await expect(restoreSnapshot(project.path, "stale-snapshot")).rejects.toThrow(
      'Snapshot "stale-snapshot" was not found.'
    );
  });

  it("does not delete stale same-slot snapshot paths outside the snapshots directory", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Snapshot Cleanup Boundary" });
    const outsideSnapshotPath = path.join(parentDirectory, "outside-snapshot.json");

    await writeFile(outsideSnapshotPath, "do not delete");
    insertSnapshot(path.join(project.path, "ether.db"), {
      id: "stale-outside-snapshot",
      slot: "A",
      label: "Stale outside A",
      path: outsideSnapshotPath,
      createdAt: new Date().toISOString()
    });

    await saveGraph(project.path, {
      nodes: [{ id: "replacement", position: { x: 7, y: 8 } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: new Date().toISOString()
    });

    const snapshot = await createSnapshot(project.path, "A", "Replacement A");
    const restored = await restoreSnapshot(project.path, snapshot.id);

    await expect(readFile(outsideSnapshotPath, "utf8")).resolves.toBe("do not delete");
    expect(restored.graph.nodes).toEqual([{ id: "replacement", position: { x: 7, y: 8 } }]);
  });

  it("does not delete stale same-slot snapshot files through a linked snapshots directory", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Snapshot Cleanup Link Boundary" });
    const snapshotsDirectory = path.join(project.path, "snapshots");
    const outsideSnapshotsDirectory = path.join(parentDirectory, "outside-snapshots");
    const staleSnapshotPath = path.join(snapshotsDirectory, "victim.json");

    await rm(snapshotsDirectory, { recursive: true, force: true });
    await mkdir(outsideSnapshotsDirectory);

    try {
      await symlink(outsideSnapshotsDirectory, snapshotsDirectory, "junction");
    } catch {
      return;
    }

    await writeFile(staleSnapshotPath, "do not delete through link");
    insertSnapshot(path.join(project.path, "ether.db"), {
      id: "stale-linked-snapshot",
      slot: "A",
      label: "Stale linked A",
      path: staleSnapshotPath,
      createdAt: new Date().toISOString()
    });

    await saveGraph(project.path, {
      nodes: [{ id: "replacement", position: { x: 9, y: 10 } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: new Date().toISOString()
    });

    const snapshot = await createSnapshot(project.path, "A", "Replacement A");
    const restored = await restoreSnapshot(project.path, snapshot.id);

    await expect(readFile(staleSnapshotPath, "utf8")).resolves.toBe("do not delete through link");
    expect(restored.graph.nodes).toEqual([{ id: "replacement", position: { x: 9, y: 10 } }]);
  });

  it("does not delete an outside stale snapshot symlink pointing into snapshots", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Snapshot Cleanup Symlink Row" });
    const staleSnapshotTargetPath = path.join(project.path, "snapshots", "stale-target.json");
    const outsideSnapshotLinkPath = path.join(parentDirectory, "outside-stale-snapshot.json");

    await writeFile(staleSnapshotTargetPath, "do not delete outside link");

    try {
      await symlink(staleSnapshotTargetPath, outsideSnapshotLinkPath, "file");
    } catch {
      return;
    }

    insertSnapshot(path.join(project.path, "ether.db"), {
      id: "stale-outside-symlink-snapshot",
      slot: "A",
      label: "Stale outside symlink A",
      path: outsideSnapshotLinkPath,
      createdAt: new Date().toISOString()
    });

    await saveGraph(project.path, {
      nodes: [{ id: "replacement", position: { x: 11, y: 12 } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: new Date().toISOString()
    });

    const snapshot = await createSnapshot(project.path, "A", "Replacement A");
    const restored = await restoreSnapshot(project.path, snapshot.id);

    await expect(lstat(outsideSnapshotLinkPath)).resolves.toSatisfy((stats) => stats.isSymbolicLink());
    await expect(readFile(staleSnapshotTargetPath, "utf8")).resolves.toBe("do not delete outside link");
    expect(restored.graph.nodes).toEqual([{ id: "replacement", position: { x: 11, y: 12 } }]);
  });

  it("keeps only the latest same-slot snapshot during rapid saves", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Rapid Snapshots" });
    const snapshots: SnapshotRecord[] = [];

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T20:00:00.000Z"));

    for (let index = 0; index < 5; index += 1) {
      await saveGraph(project.path, {
        nodes: [{ id: `version-${index}`, position: { x: index, y: index } }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        selectedSnapshotId: null,
        updatedAt: new Date().toISOString()
      });
      snapshots.push(await createSnapshot(project.path, "A", `Version ${index}`));
    }

    const latestSnapshot = snapshots.at(-1);
    const snapshotFiles = await readdir(path.join(project.path, "snapshots"));

    expect(new Set(snapshots.map((snapshot) => snapshot.id)).size).toBe(snapshots.length);
    expect(latestSnapshot).toBeDefined();
    expect(snapshotFiles).toEqual([path.basename(latestSnapshot?.path ?? "")]);

    const restored = await restoreSnapshot(project.path, latestSnapshot?.id ?? "");
    expect(restored.graph.nodes).toEqual([{ id: "version-4", position: { x: 4, y: 4 } }]);
  });

  it("reports missing linked references and persists health issues", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Health" });
    const missingPath = path.join(parentDirectory, "missing-reference.png");

    await writeFile(
      path.join(project.path, "assets", "references", "linked-index.json"),
      JSON.stringify(
        {
          references: [
            {
              id: "ref-1",
              path: missingPath,
              linkedAt: new Date().toISOString()
            }
          ]
        },
        null,
        2
      )
    );

    const health = await runHealthCheck(project.path);
    const reopened = await openProject(project.path);

    expect(health.issues).toEqual([
      expect.objectContaining({
        code: "LINKED_REFERENCE_MISSING",
        path: missingPath,
        severity: "error"
      })
    ]);
    expect(reopened.database.healthIssueCount).toBe(1);
  });

  it("clears persisted health issues after linked references are fixed", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Health Clear" });
    const referencePath = path.join(parentDirectory, "fixed-reference.png");

    await writeFile(
      path.join(project.path, "assets", "references", "linked-index.json"),
      JSON.stringify({
        references: [{ id: "ref-1", path: referencePath, linkedAt: new Date().toISOString() }]
      })
    );

    await runHealthCheck(project.path);
    await writeFile(referencePath, "placeholder");
    const health = await runHealthCheck(project.path);
    const reopened = await openProject(project.path);

    expect(health.issues).toEqual([]);
    expect(reopened.database.healthIssueCount).toBe(0);
  });

  it("opens an existing project with an initialized database and required tables", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Existing DB" });

    const reopened = await openProject(project.path);

    expect(reopened.database.path).toBe(path.join(project.path, "ether.db"));
    expect(reopened.database.tables.sort()).toEqual([...REQUIRED_DATABASE_TABLES].sort());
  });
});

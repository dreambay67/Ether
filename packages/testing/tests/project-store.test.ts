import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createProject,
  createSnapshot,
  loadGraph,
  openProject,
  restoreSnapshot,
  runHealthCheck,
  saveGraph,
  REQUIRED_DATABASE_TABLES,
  type EtherGraph
} from "@ether/engine";

const tempRoots: string[] = [];

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-project-store-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project store", () => {
  it("creates the expected bundle structure and default metadata", async () => {
    const parentDirectory = await createTempRoot();

    const project = await createProject({ parentDirectory, name: "My Test Project!" });

    expect(project.path).toBe(path.join(parentDirectory, "My Test Project.ether"));
    expect(project.metadata.displayName).toBe("My Test Project!");
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

  it("opens an existing project with an initialized database and required tables", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Existing DB" });

    const reopened = await openProject(project.path);

    expect(reopened.database.path).toBe(path.join(project.path, "ether.db"));
    expect(reopened.database.tables.sort()).toEqual([...REQUIRED_DATABASE_TABLES].sort());
  });
});

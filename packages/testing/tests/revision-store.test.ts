import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInitialGraphRevision,
  getGraphRevision,
  getLatestGraphRevision,
  saveGraphRevision
} from "../../engine/src/revisions/revisionStore";
import {
  __setProjectStoreTestHooks,
  createProject,
  loadGraph,
  openProject,
  saveGraph
} from "../../engine/src/project/projectStore";
import type { EtherGraph, EtherGraphInput } from "../../engine/src/project/schema";
import { openDatabase } from "../../engine/src/project/sqlite";

const tempRoots: string[] = [];

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-revision-store-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  __setProjectStoreTestHooks({});
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function graphWithNode(nodeId: string): EtherGraphInput {
  return {
    nodes: [{ id: nodeId, position: { x: 1, y: 2 } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedSnapshotId: null,
    updatedAt: "2026-06-26T10:00:00.000Z"
  };
}

async function createLegacyProject(name: string, graph: EtherGraphInput) {
  const parentDirectory = await createTempRoot();
  const project = await createProject({ parentDirectory, name });
  const projectPath = project.path;

  await writeFile(
    path.join(projectPath, "project.json"),
    JSON.stringify(
      {
        id: "11111111-1111-4111-8111-111111111111",
        displayName: name,
        appVersion: "0.1.0",
        createdAt: "2026-06-26T10:00:00.000Z",
        updatedAt: "2026-06-26T10:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.join(projectPath, "graph.json"), `${JSON.stringify(graph, null, 2)}\n`, "utf8");

  return projectPath;
}

async function replaceWithUnmigratedDatabase(projectPath: string) {
  const databasePath = path.join(projectPath, "ether.db");

  await rm(databasePath, { force: true });
  await rm(`${databasePath}-shm`, { force: true });
  await rm(`${databasePath}-wal`, { force: true });

  const db = openDatabase(databasePath);
  try {
    db.exec(`
      CREATE TABLE assets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        graph_node_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE snapshots (
        id TEXT PRIMARY KEY,
        slot TEXT NOT NULL,
        label TEXT,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE asset_moves (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        from_path TEXT NOT NULL,
        to_path TEXT NOT NULL,
        reason TEXT,
        moved_at TEXT NOT NULL
      );

      CREATE TABLE health_issues (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        path TEXT,
        detected_at TEXT NOT NULL
      );
    `);
  } finally {
    db.close();
  }
}

describe("revision store", () => {
  it("creates the initial revision from an existing graph", async () => {
    const graph = graphWithNode("initial");
    const projectPath = await createLegacyProject("Initial Revision", graph);
    const revision = await createInitialGraphRevision(projectPath, {
      graph,
      reason: "legacy-import",
      actor: "test"
    });

    expect(revision.id).toBeDefined();
    expect(revision.parentRevisionId).toBeNull();
    expect(revision.reason).toBe("legacy-import");
    expect(revision.actor).toBe("test");
    expect(revision.graph.nodes).toEqual([{ id: "initial", position: { x: 1, y: 2 } }]);
    expect(revision.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const db = openDatabase(path.join(projectPath, "ether.db"), { readonly: true });
    try {
      const count = db.prepare("SELECT COUNT(*) as count FROM graph_revisions").get() as { count: number };
      expect(count.count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("saves a revision with a matching base revision", async () => {
    const projectPath = await createLegacyProject("Matching Base", graphWithNode("base"));
    const project = await openProject(projectPath);
    const base = await getLatestGraphRevision(project.path);
    const next = await saveGraphRevision(project.path, {
      graph: graphWithNode("next"),
      baseRevisionId: base?.id ?? "",
      reason: "manual",
      actor: "designer"
    });

    expect(next.parentRevisionId).toBe(base?.id);
    expect(next.reason).toBe("manual");
    expect(next.actor).toBe("designer");
    expect(next.graph.nodes).toEqual([{ id: "next", position: { x: 1, y: 2 } }]);
  });

  it("persists normalized graphVersion inside raw revision JSON for legacy inputs", async () => {
    const projectPath = await createLegacyProject("Raw Version Persistence", graphWithNode("base"));
    const project = await openProject(projectPath);
    const base = await getLatestGraphRevision(project.path);

    const next = await saveGraphRevision(project.path, {
      graph: graphWithNode("raw-version"),
      baseRevisionId: base?.id ?? "",
      reason: "manual",
      actor: "test"
    });

    const db = openDatabase(path.join(project.path, "ether.db"), { readonly: true });
    try {
      const row = db
        .prepare("SELECT graph_json as graphJson FROM graph_revisions WHERE id = ?")
        .get(next.id) as { graphJson: string };
      const graphJson = JSON.parse(row.graphJson) as EtherGraph;

      expect(graphJson.graphVersion).toBe("2.5");
      expect(graphJson.nodes).toEqual([{ id: "raw-version", position: { x: 1, y: 2 } }]);
    } finally {
      db.close();
    }
  });

  it("rejects a stale base revision", async () => {
    const projectPath = await createLegacyProject("Stale Base", graphWithNode("base"));
    const project = await openProject(projectPath);
    const base = await getLatestGraphRevision(project.path);

    await saveGraphRevision(project.path, {
      graph: graphWithNode("first-change"),
      baseRevisionId: base?.id ?? "",
      reason: "manual",
      actor: "test"
    });

    await expect(
      saveGraphRevision(project.path, {
        graph: graphWithNode("stale-change"),
        baseRevisionId: base?.id ?? "",
        reason: "manual",
        actor: "test"
      })
    ).rejects.toThrow(/stale graph revision/i);
  });

  it("rejects an explicit null base revision when a latest revision exists", async () => {
    const projectPath = await createLegacyProject("Explicit Null Base", graphWithNode("base"));
    const project = await openProject(projectPath);

    await expect(
      saveGraphRevision(project.path, {
        graph: graphWithNode("null-base-change"),
        baseRevisionId: null,
        reason: "manual",
        actor: "test"
      })
    ).rejects.toThrow(/stale graph revision/i);
  });

  it("reads the latest revision", async () => {
    const projectPath = await createLegacyProject("Latest Revision", graphWithNode("base"));
    const project = await openProject(projectPath);
    const base = await getLatestGraphRevision(project.path);
    const next = await saveGraphRevision(project.path, {
      graph: graphWithNode("latest"),
      baseRevisionId: base?.id ?? "",
      reason: "manual",
      actor: "test"
    });

    await expect(getLatestGraphRevision(project.path)).resolves.toMatchObject({
      id: next.id,
      graph: expect.objectContaining({
        nodes: [{ id: "latest", position: { x: 1, y: 2 } }]
      })
    });
  });

  it("retrieves a specific revision by id", async () => {
    const projectPath = await createLegacyProject("Specific Revision", graphWithNode("base"));
    const project = await openProject(projectPath);
    const base = await getLatestGraphRevision(project.path);
    const first = await saveGraphRevision(project.path, {
      graph: graphWithNode("specific-first"),
      baseRevisionId: base?.id ?? "",
      reason: "checkpoint",
      actor: "designer",
      metadata: { label: "first pass", score: 7 }
    });

    await saveGraphRevision(project.path, {
      graph: graphWithNode("specific-second"),
      baseRevisionId: first.id,
      reason: "follow-up",
      actor: "reviewer",
      metadata: { label: "second pass" }
    });

    const retrieved = await getGraphRevision(project.path, first.id);

    expect(retrieved).toMatchObject({
      id: first.id,
      parentRevisionId: base?.id,
      reason: "checkpoint",
      actor: "designer",
      metadata: { label: "first pass", score: 7 },
      graph: expect.objectContaining({
        nodes: [{ id: "specific-first", position: { x: 1, y: 2 } }]
      })
    });
    await expect(getGraphRevision(project.path, "missing-revision")).resolves.toBeNull();
  });

  it("uses rowid to break latest revision ties with identical timestamps", async () => {
    const projectPath = await createLegacyProject("Latest Rowid Tie", graphWithNode("base"));
    const project = await openProject(projectPath);
    const base = await getLatestGraphRevision(project.path);
    const first = await saveGraphRevision(project.path, {
      graph: graphWithNode("same-time-first"),
      baseRevisionId: base?.id ?? "",
      reason: "manual",
      actor: "test"
    });
    const second = await saveGraphRevision(project.path, {
      graph: graphWithNode("same-time-second"),
      baseRevisionId: first.id,
      reason: "manual",
      actor: "test"
    });

    const db = openDatabase(path.join(project.path, "ether.db"));
    try {
      db.prepare("UPDATE graph_revisions SET created_at = ? WHERE id IN (?, ?)").run(
        "2099-01-01T00:00:00.000Z",
        first.id,
        second.id
      );
    } finally {
      db.close();
    }

    await expect(getLatestGraphRevision(project.path)).resolves.toMatchObject({
      id: second.id,
      graph: expect.objectContaining({
        nodes: [{ id: "same-time-second", position: { x: 1, y: 2 } }]
      })
    });
  });

  it("mirrors the latest revision to graph.json", async () => {
    const projectPath = await createLegacyProject("Graph Mirror", graphWithNode("base"));
    const project = await openProject(projectPath);

    await saveGraph(project.path, graphWithNode("mirror"));

    const graphJson = JSON.parse(await readFile(path.join(project.path, "graph.json"), "utf8")) as EtherGraph;
    const latest = await getLatestGraphRevision(project.path);
    expect(graphJson.nodes).toEqual([{ id: "mirror", position: { x: 1, y: 2 } }]);
    expect(latest?.graph.nodes).toEqual(graphJson.nodes);
  });

  it("keeps the committed revision authoritative when graph.json mirroring fails", async () => {
    const projectPath = await createLegacyProject("Mirror Failure", graphWithNode("base"));
    const project = await openProject(projectPath);
    const previousRevision = await getLatestGraphRevision(project.path);
    const previousGraphJson = JSON.parse(await readFile(path.join(project.path, "graph.json"), "utf8")) as EtherGraph;

    __setProjectStoreTestHooks({
      writeJson: async (filePath, value, writeDefault) => {
        if (path.basename(filePath) === "graph.json") {
          throw new Error("Injected graph mirror failure");
        }

        await writeDefault(filePath, value);
      }
    });

    const saved = await saveGraph(project.path, graphWithNode("failed-mirror"));
    const latest = await getLatestGraphRevision(project.path);
    const loaded = await loadGraph(project.path);
    const opened = await openProject(project.path);
    const graphJson = JSON.parse(await readFile(path.join(project.path, "graph.json"), "utf8")) as EtherGraph;

    expect(saved.nodes).toEqual([{ id: "failed-mirror", position: { x: 1, y: 2 } }]);
    expect(latest?.id).not.toBe(previousRevision?.id);
    expect(latest?.graph.nodes).toEqual(saved.nodes);
    expect(loaded.nodes).toEqual(saved.nodes);
    expect(opened.graph.nodes).toEqual(saved.nodes);
    expect(graphJson.nodes).toEqual(previousGraphJson.nodes);
  });

  it("does not change graph.json or latest revision when saveGraph rejects a stale base", async () => {
    const projectPath = await createLegacyProject("Stale SaveGraph Base", graphWithNode("base"));
    const project = await openProject(projectPath);
    const base = await getLatestGraphRevision(project.path);

    const first = await saveGraph(project.path, graphWithNode("first-change"), {
      baseRevisionId: base?.id ?? ""
    });
    const graphJsonAfterFirst = JSON.parse(await readFile(path.join(project.path, "graph.json"), "utf8")) as EtherGraph;
    const latestAfterFirst = await getLatestGraphRevision(project.path);

    await expect(
      saveGraph(project.path, graphWithNode("stale-save"), {
        baseRevisionId: base?.id ?? ""
      })
    ).rejects.toThrow(/stale graph revision/i);

    const latest = await getLatestGraphRevision(project.path);
    const graphJson = JSON.parse(await readFile(path.join(project.path, "graph.json"), "utf8")) as EtherGraph;

    expect(first.nodes).toEqual([{ id: "first-change", position: { x: 1, y: 2 } }]);
    expect(latest?.id).toBe(latestAfterFirst?.id);
    expect(latest?.graph.nodes).toEqual(first.nodes);
    expect(graphJson.nodes).toEqual(graphJsonAfterFirst.nodes);
  });

  it("loads the latest DB revision when graph.json is corrupt", async () => {
    const projectPath = await createLegacyProject("Corrupt Mirror", graphWithNode("base"));
    const project = await openProject(projectPath);
    const saved = await saveGraph(project.path, graphWithNode("db-latest"));

    await writeFile(path.join(project.path, "graph.json"), "{ not json", "utf8");

    const loaded = await loadGraph(project.path);
    const opened = await openProject(project.path);

    expect(loaded.nodes).toEqual(saved.nodes);
    expect(opened.graph.nodes).toEqual(saved.nodes);
  });

  it("loads graph.json directly when an existing database has not been migrated", async () => {
    const graph = graphWithNode("unmigrated-legacy");
    const projectPath = await createLegacyProject("Unmigrated Direct Load", graph);
    await replaceWithUnmigratedDatabase(projectPath);

    const loaded = await loadGraph(projectPath);

    expect(loaded.nodes).toEqual([{ id: "unmigrated-legacy", position: { x: 1, y: 2 } }]);
  });

  it("openProject seeds a revision for a legacy project path", async () => {
    const projectPath = await createLegacyProject("Legacy Seed", graphWithNode("legacy"));

    const opened = await openProject(projectPath);
    const latest = await getLatestGraphRevision(opened.path);

    expect(opened.graph.nodes).toEqual([{ id: "legacy", position: { x: 1, y: 2 } }]);
    expect(latest?.graph.nodes).toEqual(opened.graph.nodes);
    expect(latest?.parentRevisionId).toBeNull();
  });

  it("openProject does not create duplicate initial revisions on repeated opens", async () => {
    const projectPath = await createLegacyProject("Repeated Legacy Seed", graphWithNode("legacy"));

    await openProject(projectPath);
    await openProject(projectPath);

    const db = openDatabase(path.join(projectPath, "ether.db"), { readonly: true });
    try {
      const count = db.prepare("SELECT COUNT(*) as count FROM graph_revisions").get() as { count: number };
      expect(count.count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("saveGraph remains backward-compatible without an explicit base revision", async () => {
    const projectPath = await createLegacyProject("Compatible Save", graphWithNode("base"));
    const project = await openProject(projectPath);

    const saved = await saveGraph(project.path, graphWithNode("compatible"));
    const latest = await getLatestGraphRevision(project.path);

    expect(saved.nodes).toEqual([{ id: "compatible", position: { x: 1, y: 2 } }]);
    expect(latest?.graph.nodes).toEqual(saved.nodes);
  });
});

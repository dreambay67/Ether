import * as documentPackage from "@ether/document";
import type {
  EtherGraph,
  GraphOperation,
  LiveOutputSettings,
  NodeOutputVersion,
  PayloadEnvelope,
  PreparedGraphCommit
} from "@ether/schema";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type StoreMode =
  | { kind: "writable" }
  | { kind: "read-only"; reason: string };

interface RevisionHead {
  documentRevisionId: string;
  graphRevisions: Record<string, string>;
}

interface CommitResult extends RevisionHead {
  documentRevision: { id: string; kind: string };
  graphRevisionsCreated: Array<{ graphId: string; revisionId: string }>;
}

interface RepositoryContext {
  graphs: {
    get(graphId: string): EtherGraph | undefined;
    list(): EtherGraph[];
  };
  revisions: {
    canRedo(): boolean;
    canUndo(): boolean;
    commit(commit: PreparedGraphCommit): CommitResult;
    createMilestone(name: string, kind: "autosave" | "manual"): {
      id: string;
      members: Record<string, string>;
    };
    getDocumentRevision(id: string): {
      id: string;
      kind: string;
      graphRevisions: Record<string, string>;
    };
    getOperations(documentRevisionId: string): Array<{
      direction: "forward" | "inverse";
      globalOrder: number;
      operation: GraphOperation;
    }>;
    head(): RevisionHead;
    listMilestones(): Array<{
      id: string;
      kind: "autosave" | "manual";
      name: string;
      members: Record<string, string>;
    }>;
    redo(): CommitResult;
    undo(): CommitResult;
  };
  outputs: {
    getPayload(id: string): PayloadEnvelope | undefined;
    getVersion(id: string): NodeOutputVersion | undefined;
    insert(version: NodeOutputVersion, payloads: PayloadEnvelope[]): void;
  };
  settings: {
    getHeader(): { documentId: string; featureFlags: Record<string, boolean>; title: string };
    getLiveOutput(): LiveOutputSettings;
    setFeatureFlag(name: string, enabled: boolean): void;
    setLiveOutput(settings: LiveOutputSettings): void;
    setTitle(title: string): void;
  };
}

interface ReadRepositoryContext {
  graphs: RepositoryContext["graphs"];
  outputs: Pick<RepositoryContext["outputs"], "getPayload" | "getVersion">;
  revisions: Pick<
    RepositoryContext["revisions"],
    | "canRedo"
    | "canUndo"
    | "getDocumentRevision"
    | "getOperations"
    | "head"
    | "listMilestones"
  >;
  settings: Pick<RepositoryContext["settings"], "getHeader" | "getLiveOutput">;
}

interface DocumentStoreInstance {
  readonly dirty: boolean;
  readonly documentId: string;
  readonly mode: StoreMode;
  readonly path: string;
  close(): Promise<void>;
  autosave(commit: PreparedGraphCommit): Promise<{
    commit: CommitResult;
    milestone: { id: string; members: Record<string, string> };
  }>;
  manualSave(name: string): Promise<{ id: string; members: Record<string, string> }>;
  read<T>(callback: (repositories: ReadRepositoryContext) => T): Promise<T>;
  transaction<T>(callback: (repositories: RepositoryContext) => T): Promise<T>;
}

interface DocumentStoreStatic {
  create(
    filePath: string,
    options: {
      appVersion: string;
      documentId: string;
      initialGraph: EtherGraph;
      title: string;
      environment?: Record<string, unknown>;
    }
  ): Promise<DocumentStoreInstance>;
  open(
    filePath: string,
    options: { access: "prefer-write" | "read-only" | "require-write"; environment?: Record<string, unknown> }
  ): Promise<DocumentStoreInstance>;
}

function storeClass(): DocumentStoreStatic {
  const candidate = Reflect.get(documentPackage, "DocumentStore");
  expect(candidate, "@ether/document must export DocumentStore").toBeTypeOf("function");
  return candidate as DocumentStoreStatic;
}

const timestamp = "2026-07-17T08:00:00.000Z";

function promptNode(id: string, body: string) {
  return {
    id,
    definitionId: "prompt.text" as const,
    title: id,
    position: { x: 40, y: 60 },
    size: { width: 220, height: 140 },
    config: { kind: "prompt.text" as const, body, assembly: "append" as const },
    presentation: { collapsed: false, accent: "default", previewMode: "summary" as const }
  };
}

function graph(
  id = "graph-root",
  kind: "root" | "module" = "root",
  nodes = [promptNode("prompt-1", "First prompt")]
): EtherGraph {
  return {
    id,
    title: id,
    kind,
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes,
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

function renamed(source: EtherGraph, title: string, updatedAt = "2026-07-17T08:01:00.000Z") {
  return { ...source, title, updatedAt };
}

function graphPropertyOperation(graphId: string, title: string): GraphOperation {
  return {
    type: "updateGraphProperties",
    graphId,
    title
  };
}

function prepared(
  head: RevisionHead,
  snapshots: EtherGraph[],
  suffix: string,
  operations = snapshots.map((snapshot) => graphPropertyOperation(snapshot.id, snapshot.title)),
  inverses = snapshots.map((snapshot) => graphPropertyOperation(snapshot.id, "previous"))
): PreparedGraphCommit {
  return {
    id: `transaction-${suffix}`,
    baseDocumentRevisionId: head.documentRevisionId,
    baseGraphRevisions: Object.fromEntries(
      snapshots
        .filter((snapshot) => head.graphRevisions[snapshot.id] !== undefined)
        .map((snapshot) => [snapshot.id, head.graphRevisions[snapshot.id]])
    ),
    title: `Commit ${suffix}`,
    actor: "user",
    graphSnapshots: snapshots,
    forwardOperations: operations,
    inverseOperations: inverses
  };
}

describe("transactional Ether document repositories", () => {
  let root: string;
  let filePath: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "ether-document-repositories-"));
    filePath = path.join(root, "Campaign.ether");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates genesis state, roundtrips an exact relational graph, reopens, and closes idempotently", async () => {
    const initialGraph = graph();
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-campaign",
      initialGraph,
      title: "Campaign"
    });

    expect(store.documentId).toBe("document-campaign");
    expect(store.mode).toEqual({ kind: "writable" });
    expect(store.dirty).toBe(false);
    await expect(store.read(({ graphs }) => graphs.get(initialGraph.id))).resolves.toEqual(initialGraph);
    await expect(
      store.read((repositories) => ({
        graphKeys: Object.keys(repositories.graphs).sort(),
        outputKeys: Object.keys(repositories.outputs).sort(),
        revisionKeys: Object.keys(repositories.revisions).sort(),
        settingKeys: Object.keys(repositories.settings).sort()
      }))
    ).resolves.toEqual({
      graphKeys: ["get", "list"],
      outputKeys: ["getPayload", "getVersion"],
      revisionKeys: [
        "canRedo",
        "canUndo",
        "getDocumentRevision",
        "getOperations",
        "head",
        "listMilestones"
      ],
      settingKeys: ["getHeader", "getLiveOutput"]
    });
    let escapedGraphs: RepositoryContext["graphs"] | undefined;
    await store.read((repositories) => {
      escapedGraphs = repositories.graphs;
    });
    expect(() => escapedGraphs?.get(initialGraph.id)).toThrowError(
      expect.objectContaining({ code: "TRANSACTION_CONTEXT_CLOSED" })
    );

    const genesis = await store.read(({ revisions }) => revisions.head());
    expect(genesis.documentRevisionId).toMatch(/^document-revision-/);
    expect(genesis.graphRevisions).toEqual({ "graph-root": expect.stringMatching(/^graph-revision-/) });

    await store.close();
    await store.close();

    const reopened = await storeClass().open(filePath, { access: "read-only" });
    expect(reopened.mode).toEqual({ kind: "read-only", reason: "requested" });
    await expect(reopened.read(({ graphs }) => graphs.get(initialGraph.id))).resolves.toEqual(initialGraph);
    await reopened.close();
  });

  it("commits parent and module graph revisions atomically with deterministic global operation order", async () => {
    const initial = graph();
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-module",
      initialGraph: initial,
      title: "Modules"
    });
    const head = await store.read(({ revisions }) => revisions.head());
    const internal = graph("graph-module", "module", [promptNode("module-prompt", "Inside")]);
    const module = {
      id: "module-1",
      title: "Reusable prompt",
      graphId: internal.id,
      position: { x: 320, y: 80 },
      size: { width: 240, height: 160 },
      interface: { inputs: [], outputs: [], parameters: [] },
      collapsed: false
    };
    const parent = { ...renamed(initial, "Parent with module"), modules: [module] };
    const commit = prepared(
      head,
      [parent, internal],
      "module",
      [
        { type: "createModule", graphId: initial.id, module, internalGraph: internal },
        graphPropertyOperation(initial.id, parent.title),
        graphPropertyOperation(internal.id, internal.title)
      ],
      [
        { type: "removeModule", graphId: initial.id, moduleId: module.id },
        graphPropertyOperation(initial.id, initial.title),
        graphPropertyOperation(internal.id, "removed")
      ]
    );

    const result = await store.transaction(({ revisions }) => revisions.commit(commit));
    expect(result.graphRevisionsCreated.map(({ graphId }) => graphId)).toEqual([
      "graph-module",
      "graph-root"
    ]);
    await expect(store.read(({ graphs }) => graphs.list())).resolves.toEqual([internal, parent]);
    const rows = await store.read(({ revisions }) => revisions.getOperations(result.documentRevisionId));
    expect(rows.map(({ direction, globalOrder }) => [direction, globalOrder])).toEqual([
      ["forward", 0],
      ["forward", 1],
      ["forward", 2],
      ["inverse", 0],
      ["inverse", 1],
      ["inverse", 2]
    ]);

    const beforeRollback = await store.read(({ revisions }) => revisions.head());
    await expect(
      store.transaction(({ revisions }) => {
        revisions.commit(prepared(beforeRollback, [renamed(parent, "Rolled back")], "rollback"));
        throw new Error("injected transaction failure");
      })
    ).rejects.toThrow("injected transaction failure");
    expect(await store.read(({ revisions }) => revisions.head())).toEqual(beforeRollback);
    expect(await store.read(({ graphs }) => graphs.get(parent.id))).toEqual(parent);

    const undoAudit = await store.transaction(({ revisions }) => revisions.undo());
    const undoOperations = await store.read(({ revisions }) =>
      revisions.getOperations(undoAudit.documentRevisionId)
    );
    expect(
      undoOperations
        .filter((entry) => entry.direction === "forward")
        .map((entry) => entry.operation.graphId)
    ).toEqual([internal.id, parent.id, parent.id]);
    expect(
      undoOperations
        .filter((entry) => entry.direction === "inverse")
        .map((entry) => entry.operation.graphId)
    ).toEqual([internal.id, parent.id, parent.id]);

    const redoAudit = await store.transaction(({ revisions }) => revisions.redo());
    const redoOperations = await store.read(({ revisions }) =>
      revisions.getOperations(redoAudit.documentRevisionId)
    );
    expect(
      redoOperations
        .filter((entry) => entry.direction === "forward")
        .map((entry) => entry.operation.graphId)
    ).toEqual([parent.id, parent.id, internal.id]);
    await store.close();
  });

  it("keeps runtime read facades pure and prevents sync or async mutation exploits", async () => {
    const initial = graph();
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-read-facade",
      initialGraph: initial,
      title: "Original title"
    });

    let syncMutatorWasExposed = false;
    await store.read((repositories) => {
      const mutators = [
        Reflect.get(repositories.revisions, "commit"),
        Reflect.get(repositories.revisions, "undo"),
        Reflect.get(repositories.revisions, "redo"),
        Reflect.get(repositories.revisions, "createMilestone"),
        Reflect.get(repositories.outputs, "insert"),
        Reflect.get(repositories.settings, "setTitle"),
        Reflect.get(repositories.settings, "setFeatureFlag"),
        Reflect.get(repositories.settings, "setLiveOutput")
      ];
      syncMutatorWasExposed = mutators.some((candidate) => typeof candidate === "function");
      const setTitle = Reflect.get(repositories.settings, "setTitle");
      if (typeof setTitle === "function") {
        Reflect.apply(setTitle, repositories.settings, ["Synchronous exploit"]);
      }
    });
    expect(syncMutatorWasExposed).toBe(false);
    expect((await store.read(({ settings }) => settings.getHeader())).title).toBe("Original title");

    await expect(
      store.read(async (repositories) => {
        const setTitle = Reflect.get(repositories.settings, "setTitle");
        if (typeof setTitle === "function") {
          Reflect.apply(setTitle, repositories.settings, ["Async exploit"]);
        }
        await Promise.resolve();
      })
    ).rejects.toMatchObject({ code: "ASYNC_TRANSACTION_CALLBACK" });
    expect((await store.read(({ settings }) => settings.getHeader())).title).toBe("Original title");
    await store.close();
  });

  it("rejects cross-graph entity ID theft before an unaffected graph can be mutated", async () => {
    const initial = graph();
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-id-ownership",
      initialGraph: initial,
      title: "Entity ownership"
    });
    const head = await store.read(({ revisions }) => revisions.head());
    const stealingGraph = graph("graph-module", "module", [promptNode("prompt-1", "Stolen")]);

    await expect(
      store.transaction(({ revisions }) =>
        revisions.commit(prepared(head, [stealingGraph], "steal-node"))
      )
    ).rejects.toMatchObject({ code: "ENTITY_ID_CONFLICT" });
    expect(await store.read(({ graphs }) => graphs.get(initial.id))).toEqual(initial);
    expect(await store.read(({ graphs }) => graphs.get(stealingGraph.id))).toBeUndefined();
    expect(await store.read(({ revisions }) => revisions.head())).toEqual(head);
    await store.close();
  });

  it("requires complete affected graph sets and graph-aligned operation pairs", async () => {
    const initial = graph();
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-affected-integrity",
      initialGraph: initial,
      title: "Affected integrity"
    });
    const head = await store.read(({ revisions }) => revisions.head());
    const parent = renamed(initial, "Parent");
    const internal = graph("graph-module", "module", [promptNode("module-prompt", "Inside")]);
    const forward = [
      graphPropertyOperation(parent.id, parent.title),
      graphPropertyOperation(internal.id, internal.title)
    ];

    await expect(
      store.transaction(({ revisions }) =>
        revisions.commit(
          prepared(head, [parent, internal], "misaligned", forward, [
            graphPropertyOperation(internal.id, "before module"),
            graphPropertyOperation(parent.id, "before parent")
          ])
        )
      )
    ).rejects.toThrow();
    await expect(
      store.transaction(({ revisions }) =>
        revisions.commit(
          prepared(
            head,
            [parent, internal],
            "incomplete",
            [graphPropertyOperation(parent.id, parent.title)],
            [graphPropertyOperation(parent.id, "before parent")]
          )
        )
      )
    ).rejects.toThrow();
    expect(await store.read(({ revisions }) => revisions.head())).toEqual(head);
    expect(await store.read(({ graphs }) => graphs.list())).toEqual([initial]);
    await store.close();
  });

  it("rejects promise-returning public callbacks and rolls back their writes", async () => {
    const initial = graph();
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-sync-callback",
      initialGraph: initial,
      title: "Sync callbacks"
    });
    const head = await store.read(({ revisions }) => revisions.head());

    await expect(
      store.transaction(({ revisions }) => {
        revisions.commit(prepared(head, [renamed(initial, "Must roll back")], "promise"));
        return Promise.resolve("not allowed");
      })
    ).rejects.toMatchObject({ code: "ASYNC_TRANSACTION_CALLBACK" });
    expect(await store.read(({ revisions }) => revisions.head())).toEqual(head);
    expect(await store.read(({ graphs }) => graphs.get(initial.id))).toEqual(initial);
    await store.close();
  });

  it("returns a structured exact optimistic conflict without changing state", async () => {
    const initial = graph();
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-conflict",
      initialGraph: initial,
      title: "Conflicts"
    });
    const genesis = await store.read(({ revisions }) => revisions.head());
    await store.transaction(({ revisions }) =>
      revisions.commit(prepared(genesis, [renamed(initial, "Current")], "current"))
    );
    const current = await store.read(({ revisions }) => revisions.head());

    await expect(
      store.transaction(({ revisions }) =>
        revisions.commit(prepared(genesis, [renamed(initial, "Stale")], "stale"))
      )
    ).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
      details: {
        actualDocumentRevisionId: current.documentRevisionId,
        expectedDocumentRevisionId: genesis.documentRevisionId,
        graphConflicts: [
          {
            graphId: "graph-root",
            actualRevisionId: current.graphRevisions["graph-root"],
            expectedRevisionId: genesis.graphRevisions["graph-root"]
          }
        ]
      }
    });
    expect((await store.read(({ graphs }) => graphs.get(initial.id)))?.title).toBe("Current");
    await store.close();
  });

  it("persists append-only multi-graph undo and redo ordering across reopen and clears redo on a branch", async () => {
    const initial = graph();
    let store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-history",
      initialGraph: initial,
      title: "History"
    });
    let head = await store.read(({ revisions }) => revisions.head());
    const second = renamed(initial, "Second");
    await store.transaction(({ revisions }) => revisions.commit(prepared(head, [second], "second")));
    head = await store.read(({ revisions }) => revisions.head());
    const third = renamed(second, "Third", "2026-07-17T08:02:00.000Z");
    const userCommit = await store.transaction(({ revisions }) =>
      revisions.commit(
        prepared(
          head,
          [third],
          "third",
          [graphPropertyOperation(initial.id, third.title)],
          [graphPropertyOperation(initial.id, second.title)]
        )
      )
    );

    const undo = await store.transaction(({ revisions }) => revisions.undo());
    expect(undo.documentRevision.kind).toBe("undo");
    expect((await store.read(({ graphs }) => graphs.get(initial.id)))?.title).toBe("Second");
    expect(await store.read(({ revisions }) => revisions.canRedo())).toBe(true);
    await store.close();

    store = await storeClass().open(filePath, { access: "require-write" });
    const redo = await store.transaction(({ revisions }) => revisions.redo());
    expect(redo.documentRevision.kind).toBe("redo");
    expect((await store.read(({ graphs }) => graphs.get(initial.id)))?.title).toBe("Third");
    expect((await store.read(({ revisions }) => revisions.getDocumentRevision(userCommit.documentRevisionId))).kind).toBe(
      "edit"
    );

    await store.transaction(({ revisions }) => revisions.undo());
    head = await store.read(({ revisions }) => revisions.head());
    await store.transaction(({ revisions }) =>
      revisions.commit(prepared(head, [renamed(second, "Branch")], "branch"))
    );
    expect(await store.read(({ revisions }) => revisions.canRedo())).toBe(false);
    await expect(store.transaction(({ revisions }) => revisions.redo())).rejects.toMatchObject({
      code: "NOTHING_TO_REDO"
    });
    await store.close();
  });

  it("fails undo atomically when stored inverse history is missing, invalid, or semantically wrong", async () => {
    for (const corruption of ["missing", "invalid", "wrong"] as const) {
      const corruptionPath = path.join(root, `History-${corruption}.ether`);
      const initial = graph();
      let store = await storeClass().create(corruptionPath, {
        appVersion: "4.0.0",
        documentId: `document-history-${corruption}`,
        initialGraph: initial,
        title: "Corrupt history"
      });
      const genesis = await store.read(({ revisions }) => revisions.head());
      const changed = renamed(initial, "Changed");
      const committed = await store.transaction(({ revisions }) =>
        revisions.commit(prepared(genesis, [changed], corruption))
      );
      await store.close();

      const database = new DatabaseSync(corruptionPath);
      if (corruption === "missing") {
        database
          .prepare("DELETE FROM graph_operations WHERE document_revision_id = ?")
          .run(committed.documentRevisionId);
      } else if (corruption === "invalid") {
        database
          .prepare(
            "UPDATE graph_operations SET inverse_json = '{}' WHERE document_revision_id = ?"
          )
          .run(committed.documentRevisionId);
      } else {
        database
          .prepare(
            "UPDATE graph_operations SET inverse_json = ? WHERE document_revision_id = ?"
          )
          .run(
            JSON.stringify(graphPropertyOperation(initial.id, "Wrong previous title")),
            committed.documentRevisionId
          );
      }
      database.close();

      store = await storeClass().open(corruptionPath, { access: "require-write" });
      const beforeUndo = await store.read(({ revisions }) => revisions.head());
      await expect(store.transaction(({ revisions }) => revisions.undo())).rejects.toMatchObject({
        code: "CORRUPT_REVISION_HISTORY"
      });
      expect(await store.read(({ revisions }) => revisions.head())).toEqual(beforeUndo);
      expect(await store.read(({ graphs }) => graphs.get(initial.id))).toEqual(changed);
      expect(await store.read(({ revisions }) => revisions.canUndo())).toBe(true);
      await store.close();
    }
  });

  it("stores autosave and manual milestones at document and all graph heads without empty graph revisions", async () => {
    const initial = graph();
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-milestones",
      initialGraph: initial,
      title: "Milestones"
    });
    const before = await store.read(({ revisions }) => revisions.head());
    const autosavedGraph = renamed(initial, "Autosaved");
    const autosave = await store.autosave(prepared(before, [autosavedGraph], "autosave"));
    const afterAutosave = await store.read(({ revisions }) => revisions.head());
    const manual = await store.manualSave("Launch candidate");
    const after = await store.read(({ revisions }) => revisions.head());

    expect(after.documentRevisionId).not.toBe(before.documentRevisionId);
    expect(after).toEqual(afterAutosave);
    expect(autosave.commit.documentRevisionId).toBe(after.documentRevisionId);
    expect(autosave.milestone.members).toEqual(after.graphRevisions);
    expect(manual.members).toEqual(after.graphRevisions);
    expect(await store.read(({ revisions }) => revisions.listMilestones())).toEqual([
      expect.objectContaining({ kind: "autosave", name: "Autosave", members: after.graphRevisions }),
      expect.objectContaining({ kind: "manual", name: "Launch candidate", members: after.graphRevisions })
    ]);
    expect(store.dirty).toBe(false);
    await store.close();
  });

  it("validates immutable outputs, requires same-node manual ancestry, and retains provenance after graph content removal", async () => {
    const initial = graph();
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-outputs",
      initialGraph: initial,
      title: "Outputs"
    });
    const head = await store.read(({ revisions }) => revisions.head());
    const baseVersion: NodeOutputVersion = {
      id: "output-1",
      nodeId: "prompt-1",
      graphId: "graph-root",
      graphRevisionId: head.graphRevisions["graph-root"],
      inputPayloadIds: [],
      selectedOutputVersionIds: [],
      compiledContextHash: "sha256:context",
      producer: { kind: "local", executor: "deterministic-assembly" },
      outputPayloadIds: ["payload-1"],
      parentOutputVersionId: null,
      approval: { state: "approved", actor: "user", at: "2026-07-17T08:03:00.000Z" },
      runId: null,
      stepId: null,
      workItemId: null,
      attemptId: null,
      timing: {
        startedAt: "2026-07-17T08:02:00.000Z",
        completedAt: "2026-07-17T08:03:00.000Z"
      },
      failure: null,
      createdAt: "2026-07-17T08:03:00.000Z"
    };
    const payload: PayloadEnvelope = {
      id: "payload-1",
      channel: "text",
      role: "general",
      content: { kind: "text", value: "Provider result" },
      source: { nodeId: "prompt-1", outputVersionId: "output-1", lineageKey: "lineage-1" },
      metadata: {}
    };
    await store.transaction(({ outputs }) => outputs.insert(baseVersion, [payload]));

    const manualVersion: NodeOutputVersion = {
      ...baseVersion,
      id: "output-2",
      outputPayloadIds: ["payload-2"],
      parentOutputVersionId: baseVersion.id,
      producer: { kind: "manual", actor: "user" },
      approval: { state: "unreviewed" },
      createdAt: "2026-07-17T08:04:00.000Z"
    };
    const manualPayload: PayloadEnvelope = {
      ...payload,
      id: "payload-2",
      content: { kind: "text", value: "Manual refinement" },
      source: { ...payload.source, outputVersionId: manualVersion.id, lineageKey: "lineage-2" }
    };
    await store.transaction(({ outputs }) => outputs.insert(manualVersion, [manualPayload]));
    await expect(
      store.transaction(({ outputs }) => outputs.insert(manualVersion, [manualPayload]))
    ).rejects.toMatchObject({ code: "IMMUTABLE_OUTPUT" });
    await expect(
      store.transaction(({ outputs }) => {
        const badVersion = {
          ...manualVersion,
          id: "output-bad",
          nodeId: "missing",
          outputPayloadIds: ["payload-bad"]
        };
        const badPayload = {
          ...manualPayload,
          id: "payload-bad",
          source: {
            ...manualPayload.source,
            nodeId: "missing",
            outputVersionId: "output-bad"
          }
        };
        outputs.insert(badVersion, [badPayload]);
      })
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT_ANCESTRY" });

    const current = await store.read(({ revisions }) => revisions.head());
    const emptied = { ...initial, nodes: [], updatedAt: "2026-07-17T08:05:00.000Z" };
    await store.transaction(({ revisions }) =>
      revisions.commit(prepared(current, [emptied], "remove-content"))
    );
    expect(await store.read(({ outputs }) => outputs.getVersion(manualVersion.id))).toEqual(manualVersion);
    expect(await store.read(({ outputs }) => outputs.getPayload(manualPayload.id))).toEqual(manualPayload);
    await store.close();
  });

  it("roundtrips validated header flags and typed disabled-by-default live output settings", async () => {
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-settings",
      initialGraph: graph(),
      title: "Settings"
    });
    const defaults = await store.read(({ settings }) => settings.getLiveOutput());
    expect(defaults.enabled).toBe(false);
    const enabled: LiveOutputSettings = {
      enabled: true,
      pathGrantId: "grant-1",
      namingPolicy: { template: "{node}-{version}" },
      collisionPolicy: "suffix",
      transferPolicy: "copy",
      lastReconciledAt: null
    };
    await store.transaction(({ settings }) => {
      settings.setFeatureFlag("experimental.modules", true);
      settings.setLiveOutput(enabled);
      settings.setTitle("Renamed settings");
    });
    expect(await store.read(({ settings }) => settings.getLiveOutput())).toEqual(enabled);
    expect(await store.read(({ settings }) => settings.getHeader())).toMatchObject({
      documentId: "document-settings",
      featureFlags: { "experimental.modules": true },
      title: "Renamed settings"
    });
    await store.close();
  });
});

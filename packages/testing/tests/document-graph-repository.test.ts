import * as documentPackage from "@ether/document";
import type {
  EtherGraph,
  GraphOperation,
  LiveOutputSettings,
  NodeOutputVersion,
  PayloadEnvelope,
  PreparedGraphCommit
} from "@ether/schema";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

interface DocumentHistoryEntry {
  createdAt: string;
  id: string;
  isHead: boolean;
  kind: "genesis" | "edit" | "undo" | "redo" | "recovery";
  milestones: Array<{
    createdAt: string;
    id: string;
    kind: "autosave" | "manual";
    name: string;
  }>;
  recovery: { id: string; reviewRequired: true; state: "recovered" } | null;
  title: string;
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
    listHistory(): DocumentHistoryEntry[];
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
    | "listHistory"
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
  inverses = snapshots.map((snapshot) => graphPropertyOperation(snapshot.id, snapshot.id))
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
      outputKeys: ["currentApproval", "getPayload", "getVersion", "listByNode"],
      revisionKeys: [
        "canRedo",
        "canUndo",
        "getDocumentRevision",
        "getOperations",
        "head",
        "listHistory",
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

  it("rejects malformed lanes and graph cycles through the DocumentStore semantic boundary", async () => {
    const malformed = graph("malformed", "root", [promptNode("source", "Source"), promptNode("target", "Target")]);
    malformed.edges = [{
      id: "bad-channel",
      from: { kind: "node", nodeId: "source", channel: "image" },
      to: { kind: "node", nodeId: "target", channel: "text" },
      role: "general", order: 0, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true
    }];
    const malformedPath = path.join(root, "Malformed.ether");
    const malformedError = await storeClass().create(malformedPath, {
      appVersion: "4.0.0", documentId: "malformed", initialGraph: malformed, title: "Malformed"
    }).then(async (store) => { await store.close(); return undefined; }, (error: unknown) => error);
    expect(malformedError).toMatchObject({ code: "INVALID_GRAPH_SEMANTICS" });
    expect(existsSync(malformedPath)).toBe(false);

    const cyclic = graph("cyclic", "root", [promptNode("cycle-a", "A"), promptNode("cycle-b", "B")]);
    const lane = (id: string, from: string, to: string): EtherGraph["edges"][number] => ({
      id, from: { kind: "node", nodeId: from, channel: "text" }, to: { kind: "node", nodeId: to, channel: "text" },
      role: "general", order: 0, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true
    });
    cyclic.edges = [lane("cycle-forward", "cycle-a", "cycle-b"), lane("cycle-back", "cycle-b", "cycle-a")];
    const cyclicPath = path.join(root, "Cyclic.ether");
    const cyclicError = await storeClass().create(cyclicPath, {
      appVersion: "4.0.0", documentId: "cyclic", initialGraph: cyclic, title: "Cyclic"
    }).then(async (store) => { await store.close(); return undefined; }, (error: unknown) => error);
    expect(cyclicError).toMatchObject({ code: "INVALID_GRAPH_SEMANTICS" });
    expect(existsSync(cyclicPath)).toBe(false);

    const preparedPath = path.join(root, "Prepared-cycle.ether");
    const initial = graph();
    const store = await storeClass().create(preparedPath, {
      appVersion: "4.0.0", documentId: "prepared-cycle", initialGraph: initial, title: "Prepared cycle"
    });
    try {
      const head = await store.read(({ revisions }) => revisions.head());
      const target = promptNode("cycle-target", "Target");
      const forward = lane("prepared-forward", "prompt-1", target.id);
      const backward = lane("prepared-backward", target.id, "prompt-1");
      const snapshot = { ...initial, nodes: [...initial.nodes, target], edges: [forward, backward] };
      await expect(store.transaction(({ revisions }) => revisions.commit({
        id: "prepared-cycle", baseDocumentRevisionId: head.documentRevisionId,
        baseGraphRevisions: head.graphRevisions, title: "Prepared cycle", actor: "user",
        graphSnapshots: [snapshot],
        forwardOperations: [
          { type: "addNode", graphId: initial.id, node: target },
          { type: "addEdge", graphId: initial.id, edge: forward },
          { type: "addEdge", graphId: initial.id, edge: backward }
        ],
        inverseOperations: [
          { type: "removeNode", graphId: initial.id, nodeId: target.id },
          { type: "removeEdge", graphId: initial.id, edgeId: forward.id },
          { type: "removeEdge", graphId: initial.id, edgeId: backward.id }
        ]
      }))).rejects.toMatchObject({ code: "INVALID_GRAPH_SEMANTICS" });
    } finally {
      await store.close();
    }
  });

  it("rejects an invalid explicit adapter before persistence and reopens the unchanged graph", async () => {
    const initial = graph("explicit-adapter", "root", [promptNode("source", "Source"), promptNode("target", "Target")]);
    const file = path.join(root, "Explicit-adapter.ether");
    const store = await storeClass().create(file, {
      appVersion: "4.0.0", documentId: "explicit-adapter", initialGraph: initial, title: "Explicit adapter"
    });
    const invalidEdge: EtherGraph["edges"][number] = {
      id: "invalid-explicit-adapter",
      from: { kind: "node", nodeId: "source", channel: "text" },
      to: { kind: "node", nodeId: "target", channel: "text" },
      role: "general",
      order: 0,
      selector: { kind: "latest" },
      adapter: { kind: "explicit", adapterId: "codex.image-to-text" },
      enabled: true
    };

    try {
      const head = await store.read(({ revisions }) => revisions.head());
      const invalid = { ...initial, edges: [invalidEdge] };
      await expect(store.transaction(({ revisions }) => revisions.commit({
        id: "invalid-explicit-adapter-commit",
        baseDocumentRevisionId: head.documentRevisionId,
        baseGraphRevisions: head.graphRevisions,
        title: "Invalid explicit adapter",
        actor: "user",
        graphSnapshots: [invalid],
        forwardOperations: [{ type: "addEdge", graphId: initial.id, edge: invalidEdge }],
        inverseOperations: [{ type: "removeEdge", graphId: initial.id, edgeId: invalidEdge.id }]
      }))).rejects.toMatchObject({
        code: "INVALID_GRAPH_SEMANTICS",
        message: expect.stringContaining("ADAPTER_UNAVAILABLE")
      });
    } finally {
      await store.close();
    }

    const reopened = await storeClass().open(file, { access: "read-only" });
    await expect(reopened.read(({ graphs }) => graphs.get(initial.id))).resolves.toEqual(initial);
    await reopened.close();
  });

  it("persists temporary-looking authored text but rejects reserved tokens in typed graph references", async () => {
    const authoredInitial = graph("graph-authored", "root", [
      promptNode("prompt-literal", "$temp: keep this literal"),
      promptNode("prompt-value", "$temp:value:body"),
      promptNode("prompt-reserved-looking", "$temp:node:authored-literal")
    ]);
    const authoredPath = path.join(root, "Authored-temp-text.ether");
    const authoredStore = await storeClass().create(authoredPath, {
      appVersion: "4.0.0", documentId: "document-authored-temp",
      initialGraph: authoredInitial, title: "Authored temp text"
    });
    const authoredHead = await authoredStore.read(({ revisions }) => revisions.head());
    const committedNode = promptNode("prompt-literal", "$temp:module:still-authored");
    const committedSnapshot = { ...authoredInitial, nodes: [committedNode, ...authoredInitial.nodes.slice(1)] };
    await authoredStore.transaction(({ revisions }) => revisions.commit({
      id: "authored-temp-commit", baseDocumentRevisionId: authoredHead.documentRevisionId,
      baseGraphRevisions: authoredHead.graphRevisions, title: "Keep authored temp text", actor: "user",
      graphSnapshots: [committedSnapshot],
      forwardOperations: [{ type: "updateNode", graphId: authoredInitial.id, nodeId: committedNode.id, node: committedNode }],
      inverseOperations: [{ type: "updateNode", graphId: authoredInitial.id, nodeId: authoredInitial.nodes[0]!.id, node: authoredInitial.nodes[0]! }]
    }));
    await authoredStore.close();
    const authoredReopened = await storeClass().open(authoredPath, { access: "read-only" });
    expect((await authoredReopened.read(({ graphs }) => graphs.get(authoredInitial.id)))?.nodes.map((node) => node.config)).toEqual([
      expect.objectContaining({ body: "$temp:module:still-authored" }),
      expect.objectContaining({ body: "$temp:value:body" }),
      expect.objectContaining({ body: "$temp:node:authored-literal" })
    ]);
    await authoredReopened.close();

    const unresolvedInitial = { ...graph(), id: "$temp:graph:initial" };
    const unresolvedInitialPath = path.join(root, "Unresolved-initial.ether");
    await expect(storeClass().create(unresolvedInitialPath, {
      appVersion: "4.0.0", documentId: "document-temp-initial",
      initialGraph: unresolvedInitial, title: "Unresolved initial"
    })).rejects.toMatchObject({ code: "UNRESOLVED_TEMP_ID" });
    expect(existsSync(unresolvedInitialPath)).toBe(false);

    const initial = graph();
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0", documentId: "document-temp-guard", initialGraph: initial, title: "Temp guard"
    });
    try {
      const head = await store.read(({ revisions }) => revisions.head());
      const tempNode = promptNode("$temp:node:unresolved", "Temporary");
      const tempSnapshot = { ...initial, nodes: [...initial.nodes, tempNode] };
      await expect(store.transaction(({ revisions }) => revisions.commit({
        id: "temp-node", baseDocumentRevisionId: head.documentRevisionId, baseGraphRevisions: head.graphRevisions,
        title: "Temp node", actor: "user", graphSnapshots: [tempSnapshot],
        forwardOperations: [{ type: "addNode", graphId: initial.id, node: tempNode }],
        inverseOperations: [{ type: "removeNode", graphId: initial.id, nodeId: tempNode.id }]
      }))).rejects.toMatchObject({ code: "UNRESOLVED_TEMP_ID" });

      const edgeReference = {
        id: "edge-temp-reference",
        from: { kind: "node" as const, nodeId: "$temp:node:source", channel: "text" as const },
        to: { kind: "node" as const, nodeId: "prompt-1", channel: "text" as const },
        role: "general" as const, order: 0, selector: { kind: "latest" as const },
        adapter: { kind: "auto" as const }, enabled: true
      };
      const moduleReference = {
        id: "module-temp-reference", title: "Temporary references", graphId: "$temp:graph:module",
        position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, collapsed: false,
        interface: {
          inputs: [{
            id: "input", name: "Input", channel: "text" as const,
            internalNodeId: "$temp:node:internal", internalChannel: "text" as const, required: true
          }],
          outputs: [],
          parameters: [{
            id: "parameter", name: "Parameter", nodeId: "$temp:node:parameter",
            configPath: ["body"], required: true
          }]
        }
      };
      const recursiveSnapshot = {
        ...initial,
        edges: [edgeReference],
        groups: [{
          id: "group", title: "Group", nodeIds: ["$temp:node:group-member"],
          position: { x: 0, y: 0 }, size: { width: 200, height: 100 }, color: "teal"
        }],
        modules: [moduleReference]
      };
      await expect(store.transaction(({ revisions }) => revisions.commit({
        id: "temp-recursive", baseDocumentRevisionId: head.documentRevisionId,
        baseGraphRevisions: head.graphRevisions, title: "Recursive temp refs", actor: "user",
        graphSnapshots: [recursiveSnapshot],
        forwardOperations: [{
          type: "updateModule", graphId: "$temp:graph:operation", moduleId: "$temp:module:selector",
          module: moduleReference,
          subtree: {
            rootGraphId: "$temp:graph:subtree-root",
            graphs: [{ ...graph("$temp:graph:subtree-graph", "module"), nodes: [] }]
          }
        }],
        inverseOperations: [{ type: "removeModule", graphId: initial.id, moduleId: moduleReference.id }]
      }))).rejects.toMatchObject({ code: "UNRESOLVED_TEMP_ID" });
    } finally {
      await store.close();
    }
  });

  it("rejects duplicate module parameter IDs in nested module commits without persisting them", async () => {
    const initial = graph();
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-duplicate-module-parameter",
      initialGraph: initial,
      title: "Duplicate module parameter"
    });
    const deep = graph("graph-deep", "module", [promptNode("deep-prompt", "Deep")]);
    const parameter = {
      id: "duplicate-parameter",
      name: "First",
      nodeId: "deep-prompt",
      configPath: ["body"],
      required: true
    };
    const nestedModule = {
      id: "nested-module",
      title: "Nested module",
      graphId: deep.id,
      position: { x: 0, y: 0 },
      size: { width: 220, height: 120 },
      interface: {
        inputs: [],
        outputs: [],
        parameters: [parameter, { ...parameter, name: "Second" }]
      },
      collapsed: false
    };
    const inner = {
      ...graph("graph-inner", "module", [promptNode("inner-prompt", "Inner")]),
      modules: [nestedModule]
    };
    const parentModule = {
      id: "parent-module",
      title: "Parent module",
      graphId: inner.id,
      position: { x: 0, y: 0 },
      size: { width: 240, height: 140 },
      interface: { inputs: [], outputs: [], parameters: [] },
      collapsed: false
    };
    const parent = { ...initial, modules: [parentModule] };
    const head = await store.read(({ revisions }) => revisions.head());

    try {
      await expect(store.transaction(({ revisions }) => revisions.commit({
        id: "duplicate-module-parameter",
        baseDocumentRevisionId: head.documentRevisionId,
        baseGraphRevisions: head.graphRevisions,
        title: "Reject duplicate module parameter",
        actor: "user",
        graphSnapshots: [parent, inner, deep],
        forwardOperations: [{
          type: "createModule",
          graphId: initial.id,
          module: parentModule,
          subtree: { rootGraphId: inner.id, graphs: [inner, deep] }
        }],
        inverseOperations: [{
          type: "removeModule",
          graphId: initial.id,
          moduleId: parentModule.id
        }]
      }))).rejects.toMatchObject({
        code: "INVALID_GRAPH_SEMANTICS",
        details: {
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code: "DUPLICATE_MODULE_PARAMETER",
              graphId: inner.id,
              entityId: nestedModule.id
            })
          ])
        }
      });
    } finally {
      await store.close();
    }

    const reopened = await storeClass().open(filePath, { access: "read-only" });
    await expect(reopened.read(({ graphs }) => graphs.list().map((item) => item.id))).resolves.toEqual([
      initial.id
    ]);
    await reopened.close();
  });

  it("commits, undoes, redoes, and reopens nested updateModule subtree edits", async () => {
    const initial = graph();
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0", documentId: "document-nested-update", initialGraph: initial, title: "Nested update"
    });
    const deep = graph("graph-deep", "module", [promptNode("deep-prompt", "Deep before")]);
    const nestedModule = {
      id: "nested-module", title: "Nested", graphId: deep.id, position: { x: 0, y: 0 },
      size: { width: 200, height: 100 }, interface: { inputs: [], outputs: [], parameters: [] }, collapsed: false
    };
    const inner = { ...graph("graph-inner", "module", [promptNode("inner-prompt", "Inner before")]), modules: [nestedModule] };
    const parentModule = {
      id: "parent-module", title: "Parent", graphId: inner.id, position: { x: 0, y: 0 },
      size: { width: 240, height: 120 }, interface: { inputs: [], outputs: [], parameters: [] }, collapsed: false
    };
    const parent = { ...initial, modules: [parentModule] };
    const genesis = await store.read(({ revisions }) => revisions.head());
    await store.transaction(({ revisions }) => revisions.commit({
      id: "create-nested", baseDocumentRevisionId: genesis.documentRevisionId, baseGraphRevisions: genesis.graphRevisions,
      title: "Create nested", actor: "user", graphSnapshots: [parent, inner, deep],
      forwardOperations: [{ type: "createModule", graphId: initial.id, module: parentModule, subtree: { rootGraphId: inner.id, graphs: [inner, deep] } }],
      inverseOperations: [{ type: "removeModule", graphId: initial.id, moduleId: parentModule.id }]
    }));
    const created = await store.read(({ revisions }) => revisions.head());
    const updatedInner = { ...inner, nodes: [promptNode("inner-prompt", "Inner after")] };
    const updatedDeep = { ...deep, nodes: [promptNode("deep-prompt", "Deep after")] };
    await store.transaction(({ revisions }) => revisions.commit({
      id: "update-nested", baseDocumentRevisionId: created.documentRevisionId, baseGraphRevisions: created.graphRevisions,
      title: "Update nested", actor: "user", graphSnapshots: [parent, updatedInner, updatedDeep],
      forwardOperations: [{ type: "updateModule", graphId: parent.id, moduleId: parentModule.id, module: parentModule, subtree: { rootGraphId: inner.id, graphs: [updatedInner, updatedDeep] } }],
      inverseOperations: [{ type: "updateModule", graphId: parent.id, moduleId: parentModule.id, module: parentModule, subtree: { rootGraphId: inner.id, graphs: [inner, deep] } }]
    }));
    expect((await store.read(({ graphs }) => graphs.get(deep.id)))?.nodes[0]?.config).toMatchObject({ body: "Deep after" });
    await store.transaction(({ revisions }) => revisions.undo());
    expect((await store.read(({ graphs }) => graphs.get(inner.id)))?.nodes[0]?.config).toMatchObject({ body: "Inner before" });
    await store.transaction(({ revisions }) => revisions.redo());
    expect((await store.read(({ graphs }) => graphs.get(deep.id)))?.nodes[0]?.config).toMatchObject({ body: "Deep after" });
    await store.close();

    const reopened = await storeClass().open(filePath, { access: "read-only" });
    expect((await reopened.read(({ graphs }) => graphs.get(inner.id)))?.nodes[0]?.config).toMatchObject({ body: "Inner after" });
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
      interface: {
        inputs: [{ id: "prompt-in", name: "Prompt", channel: "text" as const, internalNodeId: "module-prompt", internalChannel: "text" as const, required: true }],
        outputs: [],
        parameters: []
      },
      collapsed: false
    };
    const parent = {
      ...renamed(initial, "Parent with module"),
      modules: [module],
      edges: [{
        id: "edge-to-module",
        from: { kind: "node" as const, nodeId: "prompt-1", channel: "text" as const },
        to: { kind: "module" as const, moduleId: module.id, portId: "prompt-in", channel: "text" as const },
        role: "general" as const,
        order: 0,
        selector: { kind: "latest-approved" as const },
        adapter: { kind: "auto" as const },
        enabled: true
      }]
    };
    const commit = prepared(
      head,
      [parent, internal],
      "module",
      [
        { type: "createModule", graphId: initial.id, module, subtree: { rootGraphId: internal.id, graphs: [internal] } },
        { type: "addEdge", graphId: initial.id, edge: parent.edges[0] },
        graphPropertyOperation(initial.id, parent.title),
        graphPropertyOperation(internal.id, internal.title)
      ],
      [
        { type: "removeModule", graphId: initial.id, moduleId: module.id },
        { type: "removeEdge", graphId: initial.id, edgeId: parent.edges[0].id },
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
      ["forward", 3],
      ["inverse", 0],
      ["inverse", 1],
      ["inverse", 2],
      ["inverse", 3]
    ]);

    const beforeRollback = await store.read(({ revisions }) => revisions.head());
    await expect(
      store.transaction(({ revisions }) => {
        revisions.commit(
          prepared(
            beforeRollback,
            [renamed(parent, "Rolled back")],
            "rollback",
            [graphPropertyOperation(parent.id, "Rolled back")],
            [graphPropertyOperation(parent.id, parent.title)]
          )
        );
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
    ).toEqual([internal.id, parent.id, parent.id, parent.id]);
    expect(
      undoOperations
        .filter((entry) => entry.direction === "inverse")
        .map((entry) => entry.operation.graphId)
    ).toEqual([internal.id, parent.id, parent.id, parent.id]);

    const redoAudit = await store.transaction(({ revisions }) => revisions.redo());
    const redoOperations = await store.read(({ revisions }) =>
      revisions.getOperations(redoAudit.documentRevisionId)
    );
    expect(
      redoOperations
        .filter((entry) => entry.direction === "forward")
        .map((entry) => entry.operation.graphId)
    ).toEqual([parent.id, parent.id, parent.id, internal.id]);
    await store.close();
  });

  it("rejects declared snapshots and inverses that do not exactly replay before writing", async () => {
    const initial = graph();
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-prepared-integrity",
      initialGraph: initial,
      title: "Prepared integrity"
    });
    const head = await store.read(({ revisions }) => revisions.head());
    const declared = renamed(initial, "Declared result");
    const falseSnapshot = prepared(
      head,
      [declared],
      "false-snapshot",
      [graphPropertyOperation(initial.id, "Different replay result")],
      [graphPropertyOperation(initial.id, initial.title)]
    );
    await expect(
      store.transaction(({ revisions }) => revisions.commit(falseSnapshot))
    ).rejects.toMatchObject({ code: "INVALID_PREPARED_COMMIT" });
    expect(await store.read(({ revisions }) => revisions.head())).toEqual(head);
    expect(await store.read(({ graphs }) => graphs.get(initial.id))).toEqual(initial);

    const falseInverse = prepared(
      head,
      [declared],
      "false-inverse",
      [graphPropertyOperation(initial.id, declared.title)],
      [graphPropertyOperation(initial.id, "Wrong original")]
    );
    await expect(
      store.transaction(({ revisions }) => revisions.commit(falseInverse))
    ).rejects.toMatchObject({ code: "INVALID_PREPARED_COMMIT" });
    expect(await store.read(({ revisions }) => revisions.head())).toEqual(head);
    expect(await store.read(({ graphs }) => graphs.get(initial.id))).toEqual(initial);
    await store.close();
  });

  it("rejects a prepared commit that changes an existing graph creation timestamp", async () => {
    const initial = graph();
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-created-at-integrity",
      initialGraph: initial,
      title: "Creation timestamp integrity"
    });
    const head = await store.read(({ revisions }) => revisions.head());
    const forged = {
      ...initial,
      createdAt: "2026-07-17T09:00:00.000Z"
    };
    const commit = prepared(
      head,
      [forged],
      "forged-created-at",
      [graphPropertyOperation(initial.id, initial.title)],
      [graphPropertyOperation(initial.id, initial.title)]
    );

    await expect(
      store.transaction(({ revisions }) => revisions.commit(commit))
    ).rejects.toMatchObject({ code: "INVALID_PREPARED_COMMIT" });
    expect(await store.read(({ revisions }) => revisions.head())).toEqual(head);
    expect(await store.read(({ graphs }) => graphs.get(initial.id))).toEqual(initial);
    await store.close();
  });

  it("keeps revision heads and graph snapshots in one deferred read snapshot", async () => {
    const initial = graph();
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-read-snapshot",
      initialGraph: initial,
      title: "Read snapshot"
    });

    const observed = await store.read(({ graphs, revisions }) => {
      const head = revisions.head();
      const concurrent = new DatabaseSync(filePath);
      let writerWasBlocked = false;
      try {
        try {
          concurrent
            .prepare("UPDATE graphs SET title = ? WHERE graph_id = ?")
            .run("Concurrent graph", initial.id);
        } catch (error) {
          expect(error).toMatchObject({ message: expect.stringMatching(/locked|busy/i) });
          writerWasBlocked = true;
        }
        const snapshot = graphs.get(initial.id);
        if (!writerWasBlocked) {
          concurrent
            .prepare("UPDATE graphs SET title = ? WHERE graph_id = ?")
            .run(initial.title, initial.id);
        }
        return { head, snapshot, writerWasBlocked };
      } finally {
        concurrent.close();
      }
    });

    expect(observed.head.graphRevisions[initial.id]).toBeDefined();
    expect(observed.writerWasBlocked).toBe(true);
    expect(observed.snapshot).toEqual(initial);
    await store.close();
  });

  it("tombstones a removed module graph and restores it through undo, redo, and reopen", async () => {
    const initial = graph();
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-module-removal",
      initialGraph: initial,
      title: "Module removal"
    });
    const internal = graph("graph-module-remove", "module", [
      promptNode("module-remove-prompt", "Inside")
    ]);
    const module = {
      id: "module-remove",
      title: "Removable module",
      graphId: internal.id,
      position: { x: 320, y: 80 },
      size: { width: 240, height: 160 },
      interface: { inputs: [], outputs: [], parameters: [] },
      collapsed: false
    };
    const parent = { ...initial, modules: [module] };
    const genesis = await store.read(({ revisions }) => revisions.head());
    await store.transaction(({ revisions }) =>
      revisions.commit(
        prepared(
          genesis,
          [parent, internal],
          "create-removable-module",
          [{ type: "createModule", graphId: initial.id, module, subtree: { rootGraphId: internal.id, graphs: [internal] } }],
          [{ type: "removeModule", graphId: initial.id, moduleId: module.id }]
        )
      )
    );
    const created = await store.read(({ revisions }) => revisions.head());
    const removal = {
      id: "transaction-remove-module",
      baseDocumentRevisionId: created.documentRevisionId,
      baseGraphRevisions: {
        [initial.id]: created.graphRevisions[initial.id],
        [internal.id]: created.graphRevisions[internal.id]
      },
      title: "Remove module",
      actor: "user",
      graphSnapshots: [initial],
      deletedGraphIds: [internal.id],
      forwardOperations: [
        { type: "removeModule", graphId: initial.id, moduleId: module.id }
      ],
      inverseOperations: [
        { type: "createModule", graphId: initial.id, module, subtree: { rootGraphId: internal.id, graphs: [internal] } }
      ]
    } as unknown as PreparedGraphCommit;
    const removed = await store.transaction(({ revisions }) => revisions.commit(removal));
    expect(removed.graphRevisionsCreated.map(({ graphId }) => graphId).sort()).toEqual(
      [initial.id, internal.id].sort()
    );
    expect(await store.read(({ graphs }) => graphs.list())).toEqual([initial]);

    await store.transaction(({ revisions }) => revisions.undo());
    expect(await store.read(({ graphs }) => graphs.list())).toEqual([internal, parent]);
    await store.transaction(({ revisions }) => revisions.redo());
    expect(await store.read(({ graphs }) => graphs.list())).toEqual([initial]);
    await store.close();

    const reopened = await storeClass().open(filePath, { access: "read-only" });
    expect(await reopened.read(({ graphs }) => graphs.list())).toEqual([initial]);
    await reopened.close();
  });

  it("moves existing node and edge IDs into a module graph atomically", async () => {
    const source = promptNode("move-source", "Source");
    const target = promptNode("move-target", "Target");
    const lane: EtherGraph["edges"][number] = {
      id: "move-lane",
      from: { kind: "node", nodeId: source.id, channel: "text" },
      to: { kind: "node", nodeId: target.id, channel: "text" },
      role: "general",
      order: 0,
      selector: { kind: "latest" },
      adapter: { kind: "auto" },
      enabled: true
    };
    const initial = {
      ...graph("graph-move", "root", [source, target]),
      edges: [lane]
    };
    const store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-entity-move",
      initialGraph: initial,
      title: "Entity move"
    });
    const internal = graph("graph-move-module", "module", [source, target]);
    internal.edges = [lane];
    const module = {
      id: "module-move",
      title: "Moved selection",
      description: "Selection contents",
      accent: "electric-blue",
      locked: true,
      graphId: internal.id,
      position: { x: 320, y: 80 },
      size: { width: 240, height: 160 },
      interface: { inputs: [], outputs: [], parameters: [] },
      collapsed: false
    };
    const parent = { ...initial, nodes: [], edges: [], modules: [module] };
    const genesis = await store.read(({ revisions }) => revisions.head());
    const created = await store.transaction(({ revisions }) => revisions.commit({
      id: "move-selection-into-module",
      baseDocumentRevisionId: genesis.documentRevisionId,
      baseGraphRevisions: { [initial.id]: genesis.graphRevisions[initial.id]! },
      title: "Move selection into module",
      actor: "user",
      graphSnapshots: [parent, internal],
      forwardOperations: [
        {
          type: "createModule",
          graphId: initial.id,
          module,
          subtree: { rootGraphId: internal.id, graphs: [internal] }
        },
        { type: "removeEdge", graphId: initial.id, edgeId: lane.id },
        { type: "removeNode", graphId: initial.id, nodeId: source.id },
        { type: "removeNode", graphId: initial.id, nodeId: target.id }
      ],
      inverseOperations: [
        { type: "removeModule", graphId: initial.id, moduleId: module.id },
        { type: "addEdge", graphId: initial.id, edge: lane, index: 0 },
        { type: "addNode", graphId: initial.id, node: source, index: 0 },
        { type: "addNode", graphId: initial.id, node: target, index: 1 }
      ]
    }));
    expect(created.graphRevisionsCreated.map(({ graphId }) => graphId).sort()).toEqual([
      initial.id,
      internal.id
    ].sort());
    await expect(store.read(({ graphs }) => graphs.get(initial.id))).resolves.toEqual(parent);
    await expect(store.read(({ graphs }) => graphs.get(internal.id))).resolves.toEqual(internal);

    await store.transaction(({ revisions }) => revisions.undo());
    await expect(store.read(({ graphs }) => graphs.get(initial.id))).resolves.toEqual(initial);
    await expect(store.read(({ graphs }) => graphs.get(internal.id))).resolves.toBeUndefined();

    await store.transaction(({ revisions }) => revisions.redo());
    await expect(store.read(({ graphs }) => graphs.get(internal.id))).resolves.toEqual(internal);
    await store.close();

    const reopened = await storeClass().open(filePath, { access: "read-only" });
    await expect(reopened.read(({ graphs }) => graphs.get(initial.id))).resolves.toEqual(parent);
    await expect(reopened.read(({ graphs }) => graphs.get(internal.id))).resolves.toEqual(internal);
    await reopened.close();
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
    await expect(
      store.transaction(({ revisions }) =>
        revisions.commit(
          prepared(
            head,
            [parent, internal],
            "unproduced-snapshot",
            [graphPropertyOperation(parent.id, parent.title)],
            [graphPropertyOperation(parent.id, initial.title)]
          )
        )
      )
    ).rejects.toMatchObject({ code: "INVALID_PREPARED_COMMIT" });
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
      revisions.commit(
        prepared(
          head,
          [renamed(second, "Branch")],
          "branch",
          [graphPropertyOperation(initial.id, "Branch")],
          [graphPropertyOperation(initial.id, second.title)]
        )
      )
    );
    expect(await store.read(({ revisions }) => revisions.canRedo())).toBe(false);
    await expect(store.transaction(({ revisions }) => revisions.redo())).rejects.toMatchObject({
      code: "NOTHING_TO_REDO"
    });
    const history = await store.read(({ revisions }) => revisions.listHistory());
    expect(history.map(({ kind, title, isHead }) => ({ kind, title, isHead }))).toEqual([
      { kind: "edit", title: "Commit branch", isHead: true },
      { kind: "undo", title: "Undo: Commit third", isHead: false },
      { kind: "redo", title: "Redo: Commit third", isHead: false },
      { kind: "undo", title: "Undo: Commit third", isHead: false },
      { kind: "edit", title: "Commit third", isHead: false },
      { kind: "edit", title: "Commit second", isHead: false },
      { kind: "genesis", title: "Genesis", isHead: false }
    ]);
    expect(history.every((entry) => entry.milestones.length === 0 && entry.recovery === null)).toBe(true);
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

  it("persists dirty state across reopen until a valid milestone clears it", async () => {
    const initial = graph();
    let store = await storeClass().create(filePath, {
      appVersion: "4.0.0",
      documentId: "document-dirty-state",
      initialGraph: initial,
      title: "Dirty state"
    });
    const head = await store.read(({ revisions }) => revisions.head());
    await store.transaction(({ revisions }) =>
      revisions.commit(prepared(head, [renamed(initial, "Unsaved change")], "dirty-state"))
    );
    const dirtyAfterCommit = store.dirty;
    await store.close();
    expect(dirtyAfterCommit).toBe(true);

    store = await storeClass().open(filePath, { access: "require-write" });
    const dirtyAfterReopen = store.dirty;
    await store.manualSave("Reviewed change");
    const dirtyAfterMilestone = store.dirty;
    await store.close();
    expect(dirtyAfterReopen).toBe(true);
    expect(dirtyAfterMilestone).toBe(false);

    const reopened = await storeClass().open(filePath, { access: "read-only" });
    expect(reopened.dirty).toBe(false);
    await reopened.close();
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

    const provenanceCases: Array<[
      string,
      Partial<Pick<NodeOutputVersion, "inputPayloadIds" | "selectedOutputVersionIds">>
    ]> = [
      ["output-dangling-payload", { inputPayloadIds: ["payload-missing"] }],
      ["output-dangling-version", { selectedOutputVersionIds: ["output-missing"] }]
    ];
    for (const [id, provenance] of provenanceCases) {
      const danglingVersion: NodeOutputVersion = {
        ...baseVersion,
        ...provenance,
        id,
        outputPayloadIds: [`payload-${id}`]
      };
      const danglingPayload: PayloadEnvelope = {
        ...payload,
        id: `payload-${id}`,
        source: { ...payload.source, outputVersionId: id, lineageKey: `lineage-${id}` }
      };
      await expect(
        store.transaction(({ outputs }) => outputs.insert(danglingVersion, [danglingPayload]))
      ).rejects.toMatchObject({ code: "INVALID_OUTPUT_PROVENANCE" });
      expect(await store.read(({ outputs }) => outputs.getVersion(id))).toBeUndefined();
    }

    const manualVersion: NodeOutputVersion = {
      ...baseVersion,
      id: "output-2",
      inputPayloadIds: [payload.id],
      selectedOutputVersionIds: [baseVersion.id],
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
      revisions.commit(
        prepared(
          current,
          [emptied],
          "remove-content",
          [{ type: "removeNode", graphId: initial.id, nodeId: initial.nodes[0].id }],
          [{ type: "addNode", graphId: initial.id, node: initial.nodes[0] }]
        )
      )
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
      collisionPolicy: "rename",
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

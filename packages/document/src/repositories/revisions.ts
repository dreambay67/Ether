import {
  EtherGraphSchema,
  GraphOperationSchema,
  PreparedGraphCommitSchema,
  type EtherGraph,
  type GraphOperation,
  type PreparedGraphCommit,
  type RevisionActor
} from "@ether/schema";

import { GraphRepository, type RepositoryTransactionContext } from "./graphs.js";
import { replayGraphOperations } from "./operationReplay.js";

export type DocumentRevisionKind = "genesis" | "edit" | "undo" | "redo";

export class DocumentRepositoryError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly reason?: string;

  constructor(code: string, message: string, options: { details?: unknown; reason?: string } = {}) {
    super(message);
    this.name = "DocumentRepositoryError";
    this.code = code;
    this.details = options.details;
    this.reason = options.reason;
  }
}

export interface RevisionHead {
  documentRevisionId: string;
  graphRevisions: Record<string, string>;
}

export interface CommitResult extends RevisionHead {
  documentRevision: { id: string; kind: DocumentRevisionKind };
  graphRevisionsCreated: Array<{ graphId: string; revisionId: string }>;
}

interface DocumentRevisionRow {
  actor: RevisionActor;
  created_at: string;
  document_revision_id: string;
  kind: DocumentRevisionKind;
  title: string;
}

interface MemberRow {
  graph_id: string;
  graph_revision_id: string;
}

interface RevisionSnapshotRow {
  graph_id: string;
  previous_snapshot_json: string | null;
  snapshot_json: string | null;
}

interface HistoryRow {
  document_revision_id: string;
  history_order: number;
}

interface StoredOperationRow {
  global_order: number;
  inverse_json: string;
  operation_json: string;
}

function record(rows: MemberRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.graph_id, row.graph_revision_id]));
}

function parseSnapshot(serialized: string | null): EtherGraph | undefined {
  return serialized === null ? undefined : EtherGraphSchema.parse(JSON.parse(serialized));
}

function sameSnapshot(left: EtherGraph | undefined, right: EtherGraph | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class RevisionRepository {
  constructor(
    private readonly context: RepositoryTransactionContext,
    private readonly graphs: GraphRepository
  ) {}

  initializeGenesis(initialGraph: EtherGraph): CommitResult {
    const graph = this.graphs.persistMany([initialGraph])[0];
    const createdAt = this.context.now();
    const documentRevisionId = this.context.createId("document-revision");
    const graphRevisionId = this.context.createId("graph-revision");
    this.context.database
      .prepare(
        `INSERT INTO document_revisions (
           document_revision_id, parent_document_revision_id, actor, title, created_at,
           metadata_json, kind, transaction_id, revision_order
         ) VALUES (?, NULL, 'system', 'Genesis', ?, '{}', 'genesis', ?, 0)`
      )
      .run(documentRevisionId, createdAt, `genesis:${documentRevisionId}`);
    this.context.database
      .prepare(
        `INSERT INTO graph_revisions (
           revision_id, graph_id, parent_revision_id, actor, title, created_at,
           operation_count, metadata_json, kind, transaction_id, snapshot_json, previous_snapshot_json
         ) VALUES (?, ?, NULL, 'system', 'Genesis', ?, 0, '{}', 'genesis', ?, ?, NULL)`
      )
      .run(graphRevisionId, graph.id, createdAt, `genesis:${documentRevisionId}`, JSON.stringify(graph));
    this.insertMember(documentRevisionId, graph.id, graphRevisionId);
    this.context.database
      .prepare("INSERT INTO graph_heads (graph_id, graph_revision_id) VALUES (?, ?)")
      .run(graph.id, graphRevisionId);
    this.context.database
      .prepare(
        "INSERT INTO document_state (singleton, current_document_revision_id, dirty) VALUES (1, ?, 0)"
      )
      .run(documentRevisionId);
    return this.result(documentRevisionId, "genesis", [{ graphId: graph.id, revisionId: graphRevisionId }]);
  }

  head(): RevisionHead {
    const state = this.context.database
      .prepare("SELECT current_document_revision_id FROM document_state WHERE singleton = 1")
      .get() as { current_document_revision_id: string } | undefined;
    if (state === undefined) {
      throw new DocumentRepositoryError("MISSING_DOCUMENT_STATE", "Document genesis state is missing.");
    }
    const heads = this.context.database
      .prepare("SELECT graph_id, graph_revision_id FROM graph_heads ORDER BY graph_id")
      .all() as unknown as MemberRow[];
    return {
      documentRevisionId: state.current_document_revision_id,
      graphRevisions: record(heads)
    };
  }

  commit(input: PreparedGraphCommit): CommitResult {
    const commit = PreparedGraphCommitSchema.parse(input);
    const current = this.head();
    const graphConflicts = commit.graphSnapshots.flatMap((snapshot) => {
      const actualRevisionId = current.graphRevisions[snapshot.id];
      const expectedRevisionId = commit.baseGraphRevisions[snapshot.id];
      return actualRevisionId !== expectedRevisionId
        ? [{ graphId: snapshot.id, actualRevisionId, expectedRevisionId }]
        : [];
    });
    if (current.documentRevisionId !== commit.baseDocumentRevisionId || graphConflicts.length > 0) {
      throw new DocumentRepositoryError(
        "REVISION_CONFLICT",
        "The Ether document changed after this commit was prepared.",
        {
          details: {
            actualDocumentRevisionId: current.documentRevisionId,
            expectedDocumentRevisionId: commit.baseDocumentRevisionId,
            graphConflicts
          }
        }
      );
    }

    this.context.database
      .prepare("UPDATE history_entries SET state = 'cleared' WHERE state = 'undone'")
      .run();
    const before = new Map(
      commit.graphSnapshots.map((snapshot) => [snapshot.id, this.graphs.get(snapshot.id)])
    );
    const snapshots = this.graphs.persistMany(commit.graphSnapshots);
    const createdAt = this.context.now();
    const documentRevisionId = this.context.createId("document-revision");
    const revisionOrder = this.nextRevisionOrder();
    this.context.database
      .prepare(
        `INSERT INTO document_revisions (
           document_revision_id, parent_document_revision_id, actor, title, created_at,
           metadata_json, kind, transaction_id, revision_order
         ) VALUES (?, ?, ?, ?, ?, '{}', 'edit', ?, ?)`
      )
      .run(
        documentRevisionId,
        current.documentRevisionId,
        commit.actor,
        commit.title,
        createdAt,
        commit.id,
        revisionOrder
      );
    const graphRevisionsCreated = snapshots
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((snapshot) => {
        const revisionId = this.context.createId("graph-revision");
        this.context.database
          .prepare(
            `INSERT INTO graph_revisions (
               revision_id, graph_id, parent_revision_id, actor, title, created_at,
               operation_count, metadata_json, kind, transaction_id,
               snapshot_json, previous_snapshot_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 'edit', ?, ?, ?)`
          )
          .run(
            revisionId,
            snapshot.id,
            current.graphRevisions[snapshot.id] ?? null,
            commit.actor,
            commit.title,
            createdAt,
            commit.forwardOperations.filter((operation) => operation.graphId === snapshot.id).length,
            commit.id,
            JSON.stringify(snapshot),
            before.get(snapshot.id) === undefined ? null : JSON.stringify(before.get(snapshot.id))
          );
        this.insertMember(documentRevisionId, snapshot.id, revisionId);
        this.context.database
          .prepare(
            `INSERT INTO graph_heads (graph_id, graph_revision_id) VALUES (?, ?)
             ON CONFLICT(graph_id) DO UPDATE SET graph_revision_id = excluded.graph_revision_id`
          )
          .run(snapshot.id, revisionId);
        return { graphId: snapshot.id, revisionId };
      });
    this.insertOperations(documentRevisionId, graphRevisionsCreated, commit.forwardOperations, commit.inverseOperations);
    this.context.database
      .prepare(
        "INSERT INTO history_entries (history_order, document_revision_id, state, created_at) VALUES (?, ?, 'applied', ?)"
      )
      .run(this.nextHistoryOrder(), documentRevisionId, createdAt);
    this.setDocumentHead(documentRevisionId);
    return this.result(documentRevisionId, "edit", graphRevisionsCreated);
  }

  canUndo(): boolean {
    return this.history("applied", "DESC") !== undefined;
  }

  canRedo(): boolean {
    return this.history("undone", "ASC") !== undefined;
  }

  undo(): CommitResult {
    const entry = this.history("applied", "DESC");
    if (entry === undefined) {
      throw new DocumentRepositoryError("NOTHING_TO_UNDO", "There is no user revision to undo.");
    }
    const result = this.applyHistory(entry.document_revision_id, "undo");
    this.context.database
      .prepare("UPDATE history_entries SET state = 'undone' WHERE history_order = ?")
      .run(entry.history_order);
    return result;
  }

  redo(): CommitResult {
    const entry = this.history("undone", "ASC");
    if (entry === undefined) {
      throw new DocumentRepositoryError("NOTHING_TO_REDO", "There is no undone revision to redo.");
    }
    const result = this.applyHistory(entry.document_revision_id, "redo");
    this.context.database
      .prepare("UPDATE history_entries SET state = 'applied' WHERE history_order = ?")
      .run(entry.history_order);
    return result;
  }

  getDocumentRevision(id: string): {
    id: string;
    kind: DocumentRevisionKind;
    graphRevisions: Record<string, string>;
  } {
    const row = this.context.database
      .prepare("SELECT document_revision_id, kind FROM document_revisions WHERE document_revision_id = ?")
      .get(id) as { document_revision_id: string; kind: DocumentRevisionKind } | undefined;
    if (row === undefined) {
      throw new DocumentRepositoryError("REVISION_NOT_FOUND", `Document revision ${id} was not found.`);
    }
    return { id: row.document_revision_id, kind: row.kind, graphRevisions: this.members(id) };
  }

  getOperations(documentRevisionId: string): Array<{
    direction: "forward" | "inverse";
    globalOrder: number;
    operation: GraphOperation;
  }> {
    const rows = this.context.database
      .prepare(
        `SELECT global_order, operation_json, inverse_json
         FROM graph_operations WHERE document_revision_id = ? ORDER BY global_order`
      )
      .all(documentRevisionId) as unknown as Array<{
      global_order: number;
      inverse_json: string;
      operation_json: string;
    }>;
    return [
      ...rows.map((row) => ({
        direction: "forward" as const,
        globalOrder: row.global_order,
        operation: GraphOperationSchema.parse(JSON.parse(row.operation_json))
      })),
      ...rows.map((row) => ({
        direction: "inverse" as const,
        globalOrder: row.global_order,
        operation: GraphOperationSchema.parse(JSON.parse(row.inverse_json))
      }))
    ];
  }

  createMilestone(name: string, kind: "autosave" | "manual"): {
    id: string;
    members: Record<string, string>;
  } {
    const head = this.head();
    const id = this.context.createId("milestone");
    this.context.database
      .prepare(
        `INSERT INTO revision_milestones (
           milestone_id, document_revision_id, kind, name, created_at
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, head.documentRevisionId, kind, name, this.context.now());
    const statement = this.context.database.prepare(
      `INSERT INTO revision_milestone_members (
         milestone_id, graph_id, graph_revision_id
       ) VALUES (?, ?, ?)`
    );
    for (const [graphId, graphRevisionId] of Object.entries(head.graphRevisions)) {
      statement.run(id, graphId, graphRevisionId);
    }
    return { id, members: head.graphRevisions };
  }

  listMilestones(): Array<{
    id: string;
    kind: "autosave" | "manual";
    name: string;
    members: Record<string, string>;
  }> {
    const rows = this.context.database
      .prepare("SELECT milestone_id, kind, name FROM revision_milestones ORDER BY rowid")
      .all() as unknown as Array<{
      kind: "autosave" | "manual";
      milestone_id: string;
      name: string;
    }>;
    return rows.map((row) => {
      const members = this.context.database
        .prepare(
          `SELECT graph_id, graph_revision_id FROM revision_milestone_members
           WHERE milestone_id = ? ORDER BY graph_id`
        )
        .all(row.milestone_id) as unknown as MemberRow[];
      return { id: row.milestone_id, kind: row.kind, name: row.name, members: record(members) };
    });
  }

  private applyHistory(targetDocumentRevisionId: string, kind: "undo" | "redo"): CommitResult {
    const target = this.context.database
      .prepare(
        `SELECT document_revision_id, actor, title, created_at, kind
         FROM document_revisions WHERE document_revision_id = ?`
      )
      .get(targetDocumentRevisionId) as DocumentRevisionRow | undefined;
    if (target === undefined) {
      throw new DocumentRepositoryError("REVISION_NOT_FOUND", "History target revision is missing.");
    }
    const snapshots = this.context.database
      .prepare(
        `SELECT gr.graph_id, gr.snapshot_json, gr.previous_snapshot_json
         FROM document_revision_members drm
         JOIN graph_revisions gr ON gr.revision_id = drm.graph_revision_id
         WHERE drm.document_revision_id = ? ORDER BY gr.graph_id`
      )
      .all(targetDocumentRevisionId) as unknown as RevisionSnapshotRow[];
    const storedOperations = this.loadReplayOperations(
      targetDocumentRevisionId,
      snapshots.map((snapshot) => snapshot.graph_id)
    );
    const replayForward =
      kind === "undo" ? storedOperations.inverse.slice().reverse() : storedOperations.forward;
    const replayInverse =
      kind === "undo" ? storedOperations.forward.slice().reverse() : storedOperations.inverse;
    const currentGraphs = this.graphs.list();
    const existingSnapshots = new Map(currentGraphs.map((graph) => [graph.id, graph]));
    const affected = new Set(snapshots.map((row) => row.graph_id));
    let desired: Array<{ graphId: string; snapshot: EtherGraph | undefined }>;
    try {
      for (const row of snapshots) {
        const expectedCurrent = parseSnapshot(
          kind === "undo" ? row.snapshot_json : row.previous_snapshot_json
        );
        if (!sameSnapshot(existingSnapshots.get(row.graph_id), expectedCurrent)) {
          throw new Error(`Current graph ${row.graph_id} does not match the replay base snapshot.`);
        }
      }

      const replayed = new Map(
        replayGraphOperations(currentGraphs, replayForward).map((graph) => [graph.id, graph])
      );
      for (const graph of currentGraphs) {
        if (!affected.has(graph.id) && !sameSnapshot(replayed.get(graph.id), graph)) {
          throw new Error(`Replay mutated unaffected graph ${graph.id}.`);
        }
      }
      desired = snapshots.map((row) => {
        const expected = parseSnapshot(
          kind === "undo" ? row.previous_snapshot_json : row.snapshot_json
        );
        const actual = replayed.get(row.graph_id);
        const normalized =
          actual === undefined || expected === undefined
            ? actual
            : EtherGraphSchema.parse({
                ...actual,
                createdAt: expected.createdAt,
                updatedAt: expected.updatedAt
              });
        if (!sameSnapshot(normalized, expected)) {
          throw new Error(`Replayed graph ${row.graph_id} does not match its stored target snapshot.`);
        }
        return { graphId: row.graph_id, snapshot: normalized };
      });
    } catch (error) {
      throw new DocumentRepositoryError(
        "CORRUPT_REVISION_HISTORY",
        `Document revision ${targetDocumentRevisionId} cannot be replayed from its stored operations.`,
        { details: { documentRevisionId: targetDocumentRevisionId, cause: error } }
      );
    }
    this.graphs.persistMany(desired.flatMap(({ snapshot }) => (snapshot === undefined ? [] : [snapshot])));
    for (const item of desired) {
      if (item.snapshot === undefined) {
        this.graphs.markDeleted(item.graphId);
      }
    }
    const current = this.head();
    const createdAt = this.context.now();
    const documentRevisionId = this.context.createId("document-revision");
    this.context.database
      .prepare(
        `INSERT INTO document_revisions (
           document_revision_id, parent_document_revision_id, actor, title, created_at,
           metadata_json, kind, transaction_id, target_document_revision_id, revision_order
         ) VALUES (?, ?, 'system', ?, ?, '{}', ?, ?, ?, ?)`
      )
      .run(
        documentRevisionId,
        current.documentRevisionId,
        `${kind === "undo" ? "Undo" : "Redo"}: ${target.title}`,
        createdAt,
        kind,
        `${kind}:${targetDocumentRevisionId}`,
        targetDocumentRevisionId,
        this.nextRevisionOrder()
      );
    const created = desired.map(({ graphId, snapshot }) => {
      const revisionId = this.context.createId("graph-revision");
      this.context.database
        .prepare(
          `INSERT INTO graph_revisions (
             revision_id, graph_id, parent_revision_id, actor, title, created_at,
             operation_count, metadata_json, kind, transaction_id,
             snapshot_json, previous_snapshot_json
           ) VALUES (?, ?, ?, 'system', ?, ?, ?, '{}', ?, ?, ?, ?)`
        )
        .run(
          revisionId,
          graphId,
          current.graphRevisions[graphId] ?? null,
          kind === "undo" ? "Undo" : "Redo",
          createdAt,
          replayForward.filter((operation) => operation.graphId === graphId).length,
          kind,
          `${kind}:${targetDocumentRevisionId}`,
          snapshot === undefined ? null : JSON.stringify(snapshot),
          existingSnapshots.get(graphId) === undefined
            ? null
            : JSON.stringify(existingSnapshots.get(graphId))
        );
      this.insertMember(documentRevisionId, graphId, revisionId);
      this.context.database
        .prepare(
          `INSERT INTO graph_heads (graph_id, graph_revision_id) VALUES (?, ?)
           ON CONFLICT(graph_id) DO UPDATE SET graph_revision_id = excluded.graph_revision_id`
        )
        .run(graphId, revisionId);
      return { graphId, revisionId };
    });
    this.insertOperations(documentRevisionId, created, replayForward, replayInverse);
    this.setDocumentHead(documentRevisionId);
    return this.result(documentRevisionId, kind, created);
  }

  private loadReplayOperations(
    documentRevisionId: string,
    affectedGraphIds: string[]
  ): { forward: GraphOperation[]; inverse: GraphOperation[] } {
    try {
      const expected = this.context.database
        .prepare(
          `SELECT coalesce(sum(gr.operation_count), 0) AS operation_count
           FROM document_revision_members drm
           JOIN graph_revisions gr ON gr.revision_id = drm.graph_revision_id
           WHERE drm.document_revision_id = ?`
        )
        .get(documentRevisionId) as { operation_count: number };
      const rows = this.context.database
        .prepare(
          `SELECT global_order, operation_json, inverse_json
           FROM graph_operations WHERE document_revision_id = ? ORDER BY global_order`
        )
        .all(documentRevisionId) as unknown as StoredOperationRow[];
      if (rows.length === 0 || rows.length !== expected.operation_count) {
        throw new Error("Stored operation count does not match the affected graph revisions.");
      }

      const affected = new Set(affectedGraphIds);
      const represented = new Set<string>();
      const forward: GraphOperation[] = [];
      const inverse: GraphOperation[] = [];
      for (const [index, row] of rows.entries()) {
        if (row.global_order !== index) {
          throw new Error("Stored global operation order is not contiguous.");
        }
        const operation = GraphOperationSchema.parse(JSON.parse(row.operation_json));
        const inverseOperation = GraphOperationSchema.parse(JSON.parse(row.inverse_json));
        if (
          operation.graphId !== inverseOperation.graphId ||
          !affected.has(operation.graphId)
        ) {
          throw new Error("Stored operation pairs do not match the affected graph set.");
        }
        represented.add(operation.graphId);
        forward.push(operation);
        inverse.push(inverseOperation);
      }
      if (represented.size !== affected.size || [...affected].some((id) => !represented.has(id))) {
        throw new Error("Stored operations do not completely represent the affected graph set.");
      }
      return { forward, inverse };
    } catch (error) {
      throw new DocumentRepositoryError(
        "CORRUPT_REVISION_HISTORY",
        `Document revision ${documentRevisionId} has missing or invalid replay operations.`,
        { details: { documentRevisionId, cause: error } }
      );
    }
  }

  private history(state: "applied" | "undone", direction: "ASC" | "DESC"): HistoryRow | undefined {
    return this.context.database
      .prepare(
        `SELECT history_order, document_revision_id FROM history_entries
         WHERE state = ? ORDER BY history_order ${direction} LIMIT 1`
      )
      .get(state) as HistoryRow | undefined;
  }

  private insertOperations(
    documentRevisionId: string,
    revisions: Array<{ graphId: string; revisionId: string }>,
    forward: GraphOperation[],
    inverse: GraphOperation[]
  ): void {
    if (forward.length !== inverse.length) {
      throw new DocumentRepositoryError(
        "INVALID_PREPARED_COMMIT",
        "Forward and inverse operation arrays must preserve matching global order."
      );
    }
    const revisionByGraph = new Map(revisions.map((revision) => [revision.graphId, revision.revisionId]));
    const perRevisionIndex = new Map<string, number>();
    const statement = this.context.database.prepare(
      `INSERT INTO graph_operations (
         revision_id, operation_index, operation_json, inverse_json,
         document_revision_id, graph_id, global_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const [globalOrder, operation] of forward.entries()) {
      const revisionId = revisionByGraph.get(operation.graphId);
      if (revisionId === undefined) {
        throw new DocumentRepositoryError("INVALID_PREPARED_COMMIT", "Operation graph is not affected.");
      }
      const operationIndex = perRevisionIndex.get(revisionId) ?? 0;
      statement.run(
        revisionId,
        operationIndex,
        JSON.stringify(operation),
        JSON.stringify(inverse[globalOrder]),
        documentRevisionId,
        operation.graphId,
        globalOrder
      );
      perRevisionIndex.set(revisionId, operationIndex + 1);
    }
  }

  private insertMember(documentRevisionId: string, graphId: string, graphRevisionId: string): void {
    this.context.database
      .prepare(
        `INSERT INTO document_revision_members (
           document_revision_id, graph_id, graph_revision_id
         ) VALUES (?, ?, ?)`
      )
      .run(documentRevisionId, graphId, graphRevisionId);
  }

  private members(documentRevisionId: string): Record<string, string> {
    const rows = this.context.database
      .prepare(
        `SELECT graph_id, graph_revision_id FROM document_revision_members
         WHERE document_revision_id = ? ORDER BY graph_id`
      )
      .all(documentRevisionId) as unknown as MemberRow[];
    return record(rows);
  }

  private nextRevisionOrder(): number {
    const row = this.context.database
      .prepare("SELECT coalesce(max(revision_order), -1) + 1 AS next FROM document_revisions")
      .get() as { next: number };
    return row.next;
  }

  private nextHistoryOrder(): number {
    const row = this.context.database
      .prepare("SELECT coalesce(max(history_order), -1) + 1 AS next FROM history_entries")
      .get() as { next: number };
    return row.next;
  }

  private setDocumentHead(documentRevisionId: string): void {
    this.context.database
      .prepare(
        "UPDATE document_state SET current_document_revision_id = ?, dirty = 0 WHERE singleton = 1"
      )
      .run(documentRevisionId);
  }

  private result(
    documentRevisionId: string,
    kind: DocumentRevisionKind,
    graphRevisionsCreated: Array<{ graphId: string; revisionId: string }>
  ): CommitResult {
    return {
      documentRevisionId,
      graphRevisions: this.head().graphRevisions,
      documentRevision: { id: documentRevisionId, kind },
      graphRevisionsCreated
    };
  }
}

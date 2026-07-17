import {
  EtherGraphSchema,
  type EtherGraph
} from "@ether/schema";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface RepositoryTransactionContext {
  database: DatabaseSync;
  createId(prefix: string): string;
  now(): string;
}

export function createRepositoryContext(database: DatabaseSync): RepositoryTransactionContext {
  return {
    database,
    createId: (prefix) => `${prefix}-${randomUUID()}`,
    now: () => new Date().toISOString()
  };
}

interface GraphRow {
  created_at: string;
  graph_id: string;
  kind: "root" | "module";
  title: string;
  updated_at: string;
}

interface NodeRow {
  config_json: string;
  definition_id: EtherGraph["nodes"][number]["definitionId"];
  height: number;
  node_id: string;
  position_x: number;
  position_y: number;
  presentation_json: string;
  title: string;
  width: number;
}

interface EdgeRow {
  adapter_json: string;
  edge_id: string;
  enabled: number;
  lane_order: number;
  role: EtherGraph["edges"][number]["role"];
  selector_json: string;
  source_channel: EtherGraph["edges"][number]["from"]["channel"];
  source_node_id: string;
  target_channel: EtherGraph["edges"][number]["to"]["channel"];
  target_node_id: string;
}

interface GroupRow {
  color: string;
  group_id: string;
  height: number;
  node_ids_json: string;
  position_x: number;
  position_y: number;
  title: string;
  width: number;
}

interface ModuleRow {
  collapsed: number;
  height: number;
  interface_json: string;
  internal_graph_id: string;
  module_id: string;
  position_x: number;
  position_y: number;
  title: string;
  width: number;
}

interface ViewRow {
  inspector_json: string;
  selection_json: string;
  viewport_json: string;
}

type EntityKind = "edge" | "group" | "module" | "node";

interface EntityOwnerRow {
  entity_id: string;
  entity_kind: EntityKind;
  graph_id: string;
}

export class GraphRepositoryError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "GraphRepositoryError";
    this.code = code;
    this.details = details;
  }
}

function parseJson(serialized: string): unknown {
  return JSON.parse(serialized) as unknown;
}

export class GraphRepository {
  constructor(private readonly context: RepositoryTransactionContext) {}

  get(graphId: string): EtherGraph | undefined {
    const graph = this.context.database
      .prepare(
        `SELECT graph_id, title, kind, created_at, updated_at
         FROM graphs WHERE graph_id = ? AND deleted_at IS NULL`
      )
      .get(graphId) as GraphRow | undefined;
    if (graph === undefined) {
      return undefined;
    }
    const nodes = this.context.database
      .prepare(
        `SELECT node_id, definition_id, title, position_x, position_y, width, height,
                config_json, presentation_json
         FROM nodes WHERE graph_id = ? AND deleted_at IS NULL
         ORDER BY node_order, node_id`
      )
      .all(graphId) as unknown as NodeRow[];
    const edges = this.context.database
      .prepare(
        `SELECT edge_id, source_node_id, source_channel, target_node_id, target_channel,
                role, lane_order, selector_json, adapter_json, enabled
         FROM edges WHERE graph_id = ? AND deleted_at IS NULL
         ORDER BY edge_order, edge_id`
      )
      .all(graphId) as unknown as EdgeRow[];
    const groups = this.context.database
      .prepare(
        `SELECT group_id, title, node_ids_json, position_x, position_y, width, height, color
         FROM groups WHERE graph_id = ? AND deleted_at IS NULL
         ORDER BY group_order, group_id`
      )
      .all(graphId) as unknown as GroupRow[];
    const modules = this.context.database
      .prepare(
        `SELECT module_id, internal_graph_id, title, position_x, position_y, width, height,
                interface_json, collapsed
         FROM modules WHERE parent_graph_id = ? AND deleted_at IS NULL
         ORDER BY module_order, module_id`
      )
      .all(graphId) as unknown as ModuleRow[];
    const view = this.context.database
      .prepare(
        `SELECT viewport_json, selection_json, inspector_json
         FROM workspace_views WHERE graph_id = ? AND active = 1`
      )
      .get(graphId) as ViewRow | undefined;
    if (view === undefined) {
      throw new Error(`Graph ${graphId} is missing its active workspace view.`);
    }

    return EtherGraphSchema.parse({
      id: graph.graph_id,
      title: graph.title,
      kind: graph.kind,
      createdAt: graph.created_at,
      updatedAt: graph.updated_at,
      nodes: nodes.map((node) => ({
        id: node.node_id,
        definitionId: node.definition_id,
        title: node.title,
        position: { x: node.position_x, y: node.position_y },
        size: { width: node.width, height: node.height },
        config: parseJson(node.config_json),
        presentation: parseJson(node.presentation_json)
      })),
      edges: edges.map((edge) => ({
        id: edge.edge_id,
        from: { nodeId: edge.source_node_id, channel: edge.source_channel },
        to: { nodeId: edge.target_node_id, channel: edge.target_channel },
        role: edge.role,
        order: edge.lane_order,
        selector: parseJson(edge.selector_json),
        adapter: parseJson(edge.adapter_json),
        enabled: edge.enabled === 1
      })),
      groups: groups.map((group) => ({
        id: group.group_id,
        title: group.title,
        nodeIds: parseJson(group.node_ids_json),
        position: { x: group.position_x, y: group.position_y },
        size: { width: group.width, height: group.height },
        color: group.color
      })),
      modules: modules.map((module) => ({
        id: module.module_id,
        title: module.title,
        graphId: module.internal_graph_id,
        position: { x: module.position_x, y: module.position_y },
        size: { width: module.width, height: module.height },
        interface: parseJson(module.interface_json),
        collapsed: module.collapsed === 1
      })),
      viewState: {
        viewport: parseJson(view.viewport_json),
        ...(parseJson(view.selection_json) as object),
        inspectorTarget: parseJson(view.inspector_json)
      }
    });
  }

  list(): EtherGraph[] {
    const rows = this.context.database
      .prepare("SELECT graph_id FROM graphs WHERE deleted_at IS NULL ORDER BY graph_id")
      .all() as unknown as Array<{ graph_id: string }>;
    return rows.map(({ graph_id }) => this.get(graph_id)).filter((value): value is EtherGraph => value !== undefined);
  }

  persistMany(input: EtherGraph[]): EtherGraph[] {
    const graphs = input.map((value) => EtherGraphSchema.parse(value));
    this.validateEntityOwnership(graphs);
    const now = this.context.now();
    for (const graph of graphs) {
      this.context.database
        .prepare(
          `INSERT INTO graphs (graph_id, title, kind, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, NULL)
           ON CONFLICT(graph_id) DO UPDATE SET
             title = excluded.title, kind = excluded.kind, updated_at = excluded.updated_at,
             deleted_at = NULL`
        )
        .run(graph.id, graph.title, graph.kind, graph.createdAt, graph.updatedAt);
    }
    for (const graph of graphs) {
      for (const table of ["edges", "groups", "nodes"] as const) {
        this.context.database
          .prepare(`UPDATE ${table} SET deleted_at = ? WHERE graph_id = ? AND deleted_at IS NULL`)
          .run(now, graph.id);
      }
      this.context.database
        .prepare("UPDATE modules SET deleted_at = ? WHERE parent_graph_id = ? AND deleted_at IS NULL")
        .run(now, graph.id);
      this.persistGraphEntities(graph);
    }
    return graphs;
  }

  private validateEntityOwnership(graphs: EtherGraph[]): void {
    const proposed = new Map<string, { graphId: string; kind: EntityKind }>();
    const add = (entityId: string, graphId: string, kind: EntityKind): void => {
      const prior = proposed.get(entityId);
      if (prior !== undefined) {
        throw new GraphRepositoryError(
          "ENTITY_ID_CONFLICT",
          `Entity ID ${entityId} appears more than once in the prepared graph snapshots.`,
          { entityId, first: prior, second: { graphId, kind } }
        );
      }
      proposed.set(entityId, { graphId, kind });
    };

    for (const graph of graphs) {
      for (const node of graph.nodes) add(node.id, graph.id, "node");
      for (const edge of graph.edges) add(edge.id, graph.id, "edge");
      for (const group of graph.groups) add(group.id, graph.id, "group");
      for (const module of graph.modules) add(module.id, graph.id, "module");
    }

    const existing = this.context.database
      .prepare(
        `SELECT node_id AS entity_id, graph_id, 'node' AS entity_kind FROM nodes
         UNION ALL
         SELECT edge_id, graph_id, 'edge' FROM edges
         UNION ALL
         SELECT group_id, graph_id, 'group' FROM groups
         UNION ALL
         SELECT module_id, parent_graph_id, 'module' FROM modules`
      )
      .all() as unknown as EntityOwnerRow[];
    for (const owner of existing) {
      const candidate = proposed.get(owner.entity_id);
      if (
        candidate !== undefined &&
        (candidate.graphId !== owner.graph_id || candidate.kind !== owner.entity_kind)
      ) {
        throw new GraphRepositoryError(
          "ENTITY_ID_CONFLICT",
          `Entity ID ${owner.entity_id} cannot move between graphs or entity kinds.`,
          {
            entityId: owner.entity_id,
            existing: { graphId: owner.graph_id, kind: owner.entity_kind },
            proposed: candidate
          }
        );
      }
    }
  }

  markDeleted(graphId: string): void {
    const now = this.context.now();
    this.context.database.prepare("UPDATE graphs SET deleted_at = ? WHERE graph_id = ?").run(now, graphId);
    for (const table of ["edges", "groups", "nodes"] as const) {
      this.context.database.prepare(`UPDATE ${table} SET deleted_at = ? WHERE graph_id = ?`).run(now, graphId);
    }
    this.context.database.prepare("UPDATE modules SET deleted_at = ? WHERE parent_graph_id = ?").run(now, graphId);
  }

  private persistGraphEntities(graph: EtherGraph): void {
    for (const [index, node] of graph.nodes.entries()) {
      this.context.database
        .prepare(
          `INSERT INTO nodes (
             node_id, graph_id, definition_id, title, position_x, position_y, width, height,
             config_json, presentation_json, node_order, created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT(node_id) DO UPDATE SET
             graph_id = excluded.graph_id, definition_id = excluded.definition_id,
             title = excluded.title, position_x = excluded.position_x, position_y = excluded.position_y,
             width = excluded.width, height = excluded.height, config_json = excluded.config_json,
             presentation_json = excluded.presentation_json, node_order = excluded.node_order,
             updated_at = excluded.updated_at, deleted_at = NULL`
        )
        .run(
          node.id,
          graph.id,
          node.definitionId,
          node.title,
          node.position.x,
          node.position.y,
          node.size.width,
          node.size.height,
          JSON.stringify(node.config),
          JSON.stringify(node.presentation),
          index,
          graph.createdAt,
          graph.updatedAt
        );
    }
    for (const [index, edge] of graph.edges.entries()) {
      this.context.database
        .prepare(
          `INSERT INTO edges (
             edge_id, graph_id, source_node_id, source_channel, target_node_id, target_channel,
             role, lane_order, selector_json, adapter_json, enabled, edge_order, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT(edge_id) DO UPDATE SET
             graph_id = excluded.graph_id, source_node_id = excluded.source_node_id,
             source_channel = excluded.source_channel, target_node_id = excluded.target_node_id,
             target_channel = excluded.target_channel, role = excluded.role,
             lane_order = excluded.lane_order, selector_json = excluded.selector_json,
             adapter_json = excluded.adapter_json, enabled = excluded.enabled,
             edge_order = excluded.edge_order, deleted_at = NULL`
        )
        .run(
          edge.id,
          graph.id,
          edge.from.nodeId,
          edge.from.channel,
          edge.to.nodeId,
          edge.to.channel,
          edge.role,
          edge.order,
          JSON.stringify(edge.selector),
          JSON.stringify(edge.adapter),
          edge.enabled ? 1 : 0,
          index
        );
    }
    for (const [index, group] of graph.groups.entries()) {
      this.context.database
        .prepare(
          `INSERT INTO groups (
             group_id, graph_id, title, node_ids_json, position_x, position_y, width, height,
             color, group_order, created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT(group_id) DO UPDATE SET
             graph_id = excluded.graph_id, title = excluded.title, node_ids_json = excluded.node_ids_json,
             position_x = excluded.position_x, position_y = excluded.position_y,
             width = excluded.width, height = excluded.height, color = excluded.color,
             group_order = excluded.group_order, updated_at = excluded.updated_at, deleted_at = NULL`
        )
        .run(
          group.id,
          graph.id,
          group.title,
          JSON.stringify(group.nodeIds),
          group.position.x,
          group.position.y,
          group.size.width,
          group.size.height,
          group.color,
          index,
          graph.createdAt,
          graph.updatedAt
        );
    }
    for (const [index, module] of graph.modules.entries()) {
      this.context.database
        .prepare(
          `INSERT INTO modules (
             module_id, parent_graph_id, internal_graph_id, node_id, title, metadata_json,
             position_x, position_y, width, height, interface_json, collapsed, module_order,
             created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, NULL, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT(module_id) DO UPDATE SET
             parent_graph_id = excluded.parent_graph_id, internal_graph_id = excluded.internal_graph_id,
             node_id = NULL, title = excluded.title, position_x = excluded.position_x,
             position_y = excluded.position_y, width = excluded.width, height = excluded.height,
             interface_json = excluded.interface_json, collapsed = excluded.collapsed,
             module_order = excluded.module_order, updated_at = excluded.updated_at, deleted_at = NULL`
        )
        .run(
          module.id,
          graph.id,
          module.graphId,
          module.title,
          module.position.x,
          module.position.y,
          module.size.width,
          module.size.height,
          JSON.stringify(module.interface),
          module.collapsed ? 1 : 0,
          index,
          graph.createdAt,
          graph.updatedAt
        );
    }
    const selection = {
      selectedNodeIds: graph.viewState.selectedNodeIds,
      selectedEdgeIds: graph.viewState.selectedEdgeIds
    };
    this.context.database
      .prepare(
        `INSERT INTO workspace_views (
           workspace_view_id, graph_id, name, viewport_json, selection_json, inspector_json,
           active, created_at, updated_at
         ) VALUES (?, ?, 'Active', ?, ?, ?, 1, ?, ?)
         ON CONFLICT(graph_id) DO UPDATE SET
           viewport_json = excluded.viewport_json, selection_json = excluded.selection_json,
           inspector_json = excluded.inspector_json, updated_at = excluded.updated_at`
      )
      .run(
        `active:${graph.id}`,
        graph.id,
        JSON.stringify(graph.viewState.viewport),
        JSON.stringify(selection),
        JSON.stringify(graph.viewState.inspectorTarget),
        graph.createdAt,
        graph.updatedAt
      );
  }
}

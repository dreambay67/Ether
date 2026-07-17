import { z } from "zod";

import { RevisionActorSchema, TimestampSchema } from "./document.js";
import {
  EtherNodeSchema,
  InputConsequenceSchema,
  NodePositionSchema,
  NodeSizeSchema,
  PayloadChannelSchema,
  ConnectionRoleSchema
} from "./nodes.js";

export const OutputSelectorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("latest-approved") }).strict(),
  z.object({ kind: z.literal("latest") }).strict(),
  z.object({ kind: z.literal("all") }).strict(),
  z.object({ kind: z.literal("pinned"), outputVersionId: z.string().min(1) }).strict()
]);
export type OutputSelector = z.infer<typeof OutputSelectorSchema>;

export const EdgeEndpointSchema = z
  .object({ nodeId: z.string().min(1), channel: PayloadChannelSchema })
  .strict();
export type EdgeEndpoint = z.infer<typeof EdgeEndpointSchema>;

export const EdgeAdapterSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("auto") }).strict(),
  z.object({ kind: z.literal("explicit"), adapterId: z.string().min(1) }).strict()
]);
export type EdgeAdapter = z.infer<typeof EdgeAdapterSchema>;

export const EtherEdgeSchema = z
  .object({
    id: z.string().min(1),
    from: EdgeEndpointSchema,
    to: EdgeEndpointSchema,
    role: ConnectionRoleSchema,
    order: z.number().int().nonnegative(),
    selector: OutputSelectorSchema,
    adapter: EdgeAdapterSchema,
    enabled: z.boolean()
  })
  .strict();
export type EtherEdge = z.infer<typeof EtherEdgeSchema>;

export const ResolvedAdapterSchema = z
  .object({
    adapterId: z.string().min(1),
    fromChannel: PayloadChannelSchema,
    toChannel: PayloadChannelSchema,
    requiredCapability: z.string().min(1).nullable()
  })
  .strict();
export type ResolvedAdapter = z.infer<typeof ResolvedAdapterSchema>;

export const ConnectionErrorCodeSchema = z.enum([
  "UNKNOWN_NODE_DEFINITION",
  "UNKNOWN_CHANNEL",
  "SOURCE_CHANNEL_UNAVAILABLE",
  "TARGET_CHANNEL_UNAVAILABLE",
  "ADAPTER_UNAVAILABLE",
  "PROVIDER_CAPABILITY_UNAVAILABLE",
  "ROLE_UNSUPPORTED",
  "DUPLICATE_LANE",
  "CYCLE_NOT_ALLOWED"
]);
export type ConnectionErrorCode = z.infer<typeof ConnectionErrorCodeSchema>;

export const ConnectionRemedySchema = z
  .object({
    code: z.string().min(1),
    message: z.string(),
    adapterId: z.string().min(1).optional()
  })
  .strict();
export type ConnectionRemedy = z.infer<typeof ConnectionRemedySchema>;

export const ConnectionDecisionSchema = z.discriminatedUnion("allowed", [
  z
    .object({
      allowed: z.literal(true),
      adapter: ResolvedAdapterSchema.nullable(),
      consequences: z.array(InputConsequenceSchema)
    })
    .strict(),
  z
    .object({
      allowed: z.literal(false),
      code: ConnectionErrorCodeSchema,
      message: z.string(),
      remedies: z.array(ConnectionRemedySchema)
    })
    .strict()
]);
export type ConnectionDecision = z.infer<typeof ConnectionDecisionSchema>;

export const EtherGroupSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    nodeIds: z.array(z.string().min(1)),
    position: NodePositionSchema,
    size: NodeSizeSchema,
    color: z.string().min(1)
  })
  .strict();
export type EtherGroup = z.infer<typeof EtherGroupSchema>;

export const ModulePortSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    channel: PayloadChannelSchema,
    internalNodeId: z.string().min(1),
    internalChannel: PayloadChannelSchema,
    required: z.boolean()
  })
  .strict();
export type ModulePort = z.infer<typeof ModulePortSchema>;

export const ModuleParameterSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    nodeId: z.string().min(1),
    configPath: z.array(z.string().min(1)),
    required: z.boolean()
  })
  .strict();
export type ModuleParameter = z.infer<typeof ModuleParameterSchema>;

export const ModuleInterfaceSchema = z
  .object({
    inputs: z.array(ModulePortSchema),
    outputs: z.array(ModulePortSchema),
    parameters: z.array(ModuleParameterSchema)
  })
  .strict();
export type ModuleInterface = z.infer<typeof ModuleInterfaceSchema>;

export const EtherModuleSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    graphId: z.string().min(1),
    position: NodePositionSchema,
    size: NodeSizeSchema,
    interface: ModuleInterfaceSchema,
    collapsed: z.boolean()
  })
  .strict();
export type EtherModule = z.infer<typeof EtherModuleSchema>;

export const InspectorTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node"), id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("edge"), id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("group"), id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("module"), id: z.string().min(1) }).strict()
]);
export type InspectorTarget = z.infer<typeof InspectorTargetSchema>;

export const WorkspaceViewStateSchema = z
  .object({
    viewport: z
      .object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().positive() })
      .strict(),
    selectedNodeIds: z.array(z.string().min(1)),
    selectedEdgeIds: z.array(z.string().min(1)),
    inspectorTarget: InspectorTargetSchema.nullable()
  })
  .strict();
export type WorkspaceViewState = z.infer<typeof WorkspaceViewStateSchema>;

export const EtherGraphSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    kind: z.enum(["root", "module"]),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    nodes: z.array(EtherNodeSchema),
    edges: z.array(EtherEdgeSchema),
    groups: z.array(EtherGroupSchema),
    modules: z.array(EtherModuleSchema),
    viewState: WorkspaceViewStateSchema
  })
  .strict();
export type EtherGraph = z.infer<typeof EtherGraphSchema>;

const graphOperationBase = { graphId: z.string().min(1) };

export const AddNodeOperationSchema = z
  .object({ type: z.literal("addNode"), ...graphOperationBase, node: EtherNodeSchema })
  .strict();
export const UpdateNodeOperationSchema = z
  .object({
    type: z.literal("updateNode"),
    ...graphOperationBase,
    nodeId: z.string().min(1),
    node: EtherNodeSchema
  })
  .strict();
export const RemoveNodeOperationSchema = z
  .object({ type: z.literal("removeNode"), ...graphOperationBase, nodeId: z.string().min(1) })
  .strict();
export const AddEdgeOperationSchema = z
  .object({ type: z.literal("addEdge"), ...graphOperationBase, edge: EtherEdgeSchema })
  .strict();
export const UpdateEdgeOperationSchema = z
  .object({
    type: z.literal("updateEdge"),
    ...graphOperationBase,
    edgeId: z.string().min(1),
    edge: EtherEdgeSchema
  })
  .strict();
export const RemoveEdgeOperationSchema = z
  .object({ type: z.literal("removeEdge"), ...graphOperationBase, edgeId: z.string().min(1) })
  .strict();
export const MoveNodesOperationSchema = z
  .object({
    type: z.literal("moveNodes"),
    ...graphOperationBase,
    positions: z.array(
      z.object({ nodeId: z.string().min(1), position: NodePositionSchema }).strict()
    )
  })
  .strict();
export const ResizeNodesOperationSchema = z
  .object({
    type: z.literal("resizeNodes"),
    ...graphOperationBase,
    sizes: z.array(z.object({ nodeId: z.string().min(1), size: NodeSizeSchema }).strict())
  })
  .strict();
export const CreateGroupOperationSchema = z
  .object({ type: z.literal("createGroup"), ...graphOperationBase, group: EtherGroupSchema })
  .strict();
export const UpdateGroupOperationSchema = z
  .object({
    type: z.literal("updateGroup"),
    ...graphOperationBase,
    groupId: z.string().min(1),
    group: EtherGroupSchema
  })
  .strict();
export const RemoveGroupOperationSchema = z
  .object({ type: z.literal("removeGroup"), ...graphOperationBase, groupId: z.string().min(1) })
  .strict();
export const CreateModuleOperationSchema = z
  .object({
    type: z.literal("createModule"),
    ...graphOperationBase,
    module: EtherModuleSchema,
    internalGraph: EtherGraphSchema
  })
  .strict();
export const UpdateModuleOperationSchema = z
  .object({
    type: z.literal("updateModule"),
    ...graphOperationBase,
    moduleId: z.string().min(1),
    module: EtherModuleSchema
  })
  .strict();
export const RemoveModuleOperationSchema = z
  .object({ type: z.literal("removeModule"), ...graphOperationBase, moduleId: z.string().min(1) })
  .strict();
export const UpdateModuleInterfaceOperationSchema = z
  .object({
    type: z.literal("updateModuleInterface"),
    ...graphOperationBase,
    moduleId: z.string().min(1),
    interface: ModuleInterfaceSchema
  })
  .strict();
export const UpdateGraphPropertiesOperationSchema = z
  .object({
    type: z.literal("updateGraphProperties"),
    ...graphOperationBase,
    title: z.string().optional(),
    viewState: WorkspaceViewStateSchema.optional()
  })
  .strict();

const GraphOperationObjectSchema = z.discriminatedUnion("type", [
  AddNodeOperationSchema,
  UpdateNodeOperationSchema,
  RemoveNodeOperationSchema,
  AddEdgeOperationSchema,
  UpdateEdgeOperationSchema,
  RemoveEdgeOperationSchema,
  MoveNodesOperationSchema,
  ResizeNodesOperationSchema,
  CreateGroupOperationSchema,
  UpdateGroupOperationSchema,
  RemoveGroupOperationSchema,
  CreateModuleOperationSchema,
  UpdateModuleOperationSchema,
  RemoveModuleOperationSchema,
  UpdateModuleInterfaceOperationSchema,
  UpdateGraphPropertiesOperationSchema
]);
export const GraphOperationSchema = GraphOperationObjectSchema.superRefine((operation, context) => {
  const requireReplacementIdentity = (
    selectorId: string,
    replacementId: string,
    selectorPath: string,
    replacementPath: string
  ): void => {
    if (selectorId !== replacementId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [replacementPath, "id"],
        message: `${replacementPath} ID must match ${selectorPath}`
      });
    }
  };

  if (operation.type === "updateNode") {
    requireReplacementIdentity(operation.nodeId, operation.node.id, "nodeId", "node");
  } else if (operation.type === "updateEdge") {
    requireReplacementIdentity(operation.edgeId, operation.edge.id, "edgeId", "edge");
  } else if (operation.type === "updateGroup") {
    requireReplacementIdentity(operation.groupId, operation.group.id, "groupId", "group");
  } else if (operation.type === "updateModule") {
    requireReplacementIdentity(operation.moduleId, operation.module.id, "moduleId", "module");
  } else if (operation.type === "moveNodes") {
    const nodeIds = operation.positions.map((entry) => entry.nodeId);
    if (new Set(nodeIds).size !== nodeIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["positions"],
        message: "Move operations must contain each node ID exactly once"
      });
    }
  } else if (operation.type === "resizeNodes") {
    const nodeIds = operation.sizes.map((entry) => entry.nodeId);
    if (new Set(nodeIds).size !== nodeIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sizes"],
        message: "Resize operations must contain each node ID exactly once"
      });
    }
  } else if (operation.type === "createModule") {
    if (operation.module.graphId !== operation.internalGraph.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["module", "graphId"],
        message: "Module graphId must identify its internal graph"
      });
    }
    if (operation.internalGraph.kind !== "module") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["internalGraph", "kind"],
        message: "A module internal graph must have kind module"
      });
    }
    if (operation.internalGraph.id === operation.graphId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["internalGraph", "id"],
        message: "A module internal graph must be distinct from its parent graph"
      });
    }
  }
});
export type GraphOperation = z.infer<typeof GraphOperationSchema>;

export const GraphTransactionSchema = z
  .object({
    id: z.string().min(1),
    baseDocumentRevisionId: z.string().min(1),
    baseGraphRevisions: z.record(z.string().min(1), z.string().min(1)),
    title: z.string(),
    actor: RevisionActorSchema,
    operations: z.array(GraphOperationSchema).min(1),
    layoutPolicy: z.enum(["preserve", "tidy-affected", "layout-branch"])
  })
  .strict()
  .superRefine((transaction, context) => {
    const newInternalGraphIds = transaction.operations
      .filter((operation) => operation.type === "createModule")
      .map((operation) => operation.internalGraph.id);
    if (new Set(newInternalGraphIds).size !== newInternalGraphIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operations"],
        message: "Each newly created internal graph ID must be unique"
      });
    }

    const newInternalGraphs = new Set(newInternalGraphIds);
    for (const graphId of newInternalGraphs) {
      if (Object.hasOwn(transaction.baseGraphRevisions, graphId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["baseGraphRevisions", graphId],
          message: "A newly created internal graph cannot have a base revision"
        });
      }
    }

    for (const [index, operation] of transaction.operations.entries()) {
      if (
        !newInternalGraphs.has(operation.graphId) &&
        !Object.hasOwn(transaction.baseGraphRevisions, operation.graphId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["operations", index, "graphId"],
          message: "Every affected existing graph must declare its base revision"
        });
      }
    }
  });
export type GraphTransaction = z.infer<typeof GraphTransactionSchema>;

export const PreparedGraphCommitSchema = z
  .object({
    id: z.string().min(1),
    baseDocumentRevisionId: z.string().min(1),
    baseGraphRevisions: z.record(z.string().min(1), z.string().min(1)),
    title: z.string(),
    actor: RevisionActorSchema,
    graphSnapshots: z.array(EtherGraphSchema).min(1),
    forwardOperations: z.array(GraphOperationSchema).min(1),
    inverseOperations: z.array(GraphOperationSchema).min(1)
  })
  .strict()
  .superRefine((commit, context) => {
    const snapshotIds = commit.graphSnapshots.map((snapshot) => snapshot.id);
    const snapshotIdSet = new Set(snapshotIds);
    if (snapshotIdSet.size !== snapshotIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["graphSnapshots"],
        message: "Prepared commits must contain one resulting snapshot per affected graph"
      });
    }
    if (commit.forwardOperations.length !== commit.inverseOperations.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inverseOperations"],
        message: "Forward and inverse operation arrays must preserve matching global order"
      });
    }
    for (const graphId of Object.keys(commit.baseGraphRevisions)) {
      if (!snapshotIdSet.has(graphId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["baseGraphRevisions", graphId],
          message: "Base graph revisions may only name affected graph snapshots"
        });
      }
    }
    for (const [field, operations] of [
      ["forwardOperations", commit.forwardOperations],
      ["inverseOperations", commit.inverseOperations]
    ] as const) {
      for (const [index, operation] of operations.entries()) {
        if (!snapshotIdSet.has(operation.graphId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field, index, "graphId"],
            message: "Prepared operations must target an affected graph snapshot"
          });
        }
      }
    }
  });
export type PreparedGraphCommit = z.infer<typeof PreparedGraphCommitSchema>;

export function parseEtherGraph(input: unknown): EtherGraph {
  return EtherGraphSchema.parse(input);
}

export function parseGraphTransaction(input: unknown): GraphTransaction {
  return GraphTransactionSchema.parse(input);
}

export function parsePreparedGraphCommit(input: unknown): PreparedGraphCommit {
  return PreparedGraphCommitSchema.parse(input);
}

import { z } from "zod";

import { JsonValueSchema } from "./document.js";

export const payloadChannels = ["text", "image", "mask", "data", "video", "audio"] as const;
export const PayloadChannelSchema = z.enum(payloadChannels);
export type PayloadChannel = z.infer<typeof PayloadChannelSchema>;

export const connectionRoles = [
  "general",
  "negative",
  "subject",
  "product",
  "face",
  "clothing",
  "pose",
  "setting",
  "composition",
  "style",
  "lighting",
  "colourPalette",
  "typography",
  "motion",
  "timing"
] as const;
export const ConnectionRoleSchema = z.enum(connectionRoles);
export type ConnectionRole = z.infer<typeof ConnectionRoleSchema>;

export const canonicalNodeDefinitionIds = [
  "prompt.text",
  "prompt.worker",
  "reference.set",
  "generation.image",
  "edit.image",
  "edit.mask",
  "edit.transform",
  "review.compare",
  "review.evaluate",
  "review.filter",
  "flow.variables",
  "flow.batch",
  "flow.join",
  "output.collection",
  "output.export",
  "canvas.note",
  "canvas.drawing"
] as const;
export const NodeDefinitionIdSchema = z.enum(canonicalNodeDefinitionIds);
export type NodeDefinitionId = z.infer<typeof NodeDefinitionIdSchema>;

export const NodeFamilySchema = z.enum([
  "prompt",
  "reference",
  "generation",
  "edit",
  "review",
  "flow",
  "output",
  "canvas"
]);
export type NodeFamily = z.infer<typeof NodeFamilySchema>;

export const NodePositionSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
export type NodePosition = z.infer<typeof NodePositionSchema>;

export const NodeSizeSchema = z
  .object({ width: z.number().positive().finite(), height: z.number().positive().finite() })
  .strict();
export type NodeSize = z.infer<typeof NodeSizeSchema>;

export const NodePresentationSchema = z
  .object({
    collapsed: z.boolean(),
    accent: z.string().min(1),
    previewMode: z.enum(["summary", "content", "output"])
  })
  .strict();
export type NodePresentation = z.infer<typeof NodePresentationSchema>;

export const WorkerBehaviorSchema = z.enum([
  "brainstorm",
  "rewrite",
  "mutate",
  "expand",
  "reinforce",
  "extract",
  "critique",
  "custom"
]);
export type WorkerBehavior = z.infer<typeof WorkerBehaviorSchema>;

export const WorkerProfileSchema = z.enum(["fast", "balanced", "deep", "custom"]);
export type WorkerProfile = z.infer<typeof WorkerProfileSchema>;

export const ContextPolicySchema = z
  .object({
    includeUpstream: z.boolean(),
    includeDownstreamCapabilities: z.boolean(),
    maxTokens: z.number().int().positive()
  })
  .strict();
export type ContextPolicy = z.infer<typeof ContextPolicySchema>;

export const MemoryPolicySchema = z
  .object({ mode: z.enum(["stateless", "per-node", "per-branch"]) })
  .strict();
export type MemoryPolicy = z.infer<typeof MemoryPolicySchema>;

export const WorkerOutputContractSchema = z
  .object({
    channel: z.enum(["text", "data"]),
    schemaId: z.string().min(1).optional(),
    count: z.number().int().positive(),
    selectionPolicy: z.enum(["latest", "all", "best"])
  })
  .strict();
export type WorkerOutputContract = z.infer<typeof WorkerOutputContractSchema>;

export const PromptTextConfigSchema = z
  .object({
    kind: z.literal("prompt.text"),
    body: z.string(),
    assembly: z.enum(["append", "replace"])
  })
  .strict();
export type PromptTextConfig = z.infer<typeof PromptTextConfigSchema>;

export const PromptWorkerConfigSchema = z
  .object({
    kind: z.literal("prompt.worker"),
    behavior: WorkerBehaviorSchema,
    instruction: z.string(),
    profile: WorkerProfileSchema,
    model: z.string().min(1),
    reasoningEffort: z.string().min(1),
    variation: z.number().min(0).max(1),
    contextPolicy: ContextPolicySchema,
    memoryPolicy: MemoryPolicySchema,
    outputContract: WorkerOutputContractSchema
  })
  .strict();
export type PromptWorkerConfig = z.infer<typeof PromptWorkerConfigSchema>;

export const ReferenceSetConfigSchema = z
  .object({
    kind: z.literal("reference.set"),
    artifactIds: z.array(z.string().min(1)),
    enabledChannels: z.array(PayloadChannelSchema),
    ordering: z.enum(["manual", "created", "name"])
  })
  .strict();
export type ReferenceSetConfig = z.infer<typeof ReferenceSetConfigSchema>;

export const ResolutionSchema = z
  .object({ width: z.number().int().positive(), height: z.number().int().positive() })
  .strict();
export type Resolution = z.infer<typeof ResolutionSchema>;

export const GenerationImageConfigSchema = z
  .object({
    kind: z.literal("generation.image"),
    providerId: z.string().min(1),
    profileId: z.string().min(1),
    aspectRatio: z.string().min(1),
    resolution: ResolutionSchema,
    outputCount: z.number().int().positive(),
    seed: z.number().int().optional()
  })
  .strict();
export type GenerationImageConfig = z.infer<typeof GenerationImageConfigSchema>;

export const EditImageConfigSchema = z
  .object({
    kind: z.literal("edit.image"),
    providerId: z.string().min(1),
    profileId: z.string().min(1),
    strength: z.number().min(0).max(1),
    outputCount: z.number().int().positive()
  })
  .strict();
export type EditImageConfig = z.infer<typeof EditImageConfigSchema>;

export const EditMaskConfigSchema = z
  .object({
    kind: z.literal("edit.mask"),
    mode: z.enum(["local", "manual", "provider"]),
    feather: z.number().nonnegative()
  })
  .strict();
export type EditMaskConfig = z.infer<typeof EditMaskConfigSchema>;

export const EditTransformConfigSchema = z
  .object({
    kind: z.literal("edit.transform"),
    operation: z.enum(["resize", "crop", "rotate", "upscale"]),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    preserveAspectRatio: z.boolean()
  })
  .strict();
export type EditTransformConfig = z.infer<typeof EditTransformConfigSchema>;

export const ReviewCompareConfigSchema = z
  .object({
    kind: z.literal("review.compare"),
    selectionMode: z.enum(["one", "many"]),
    minimumSelections: z.number().int().nonnegative()
  })
  .strict();
export type ReviewCompareConfig = z.infer<typeof ReviewCompareConfigSchema>;

export const RubricCriterionSchema = z
  .object({ id: z.string().min(1), label: z.string().min(1), weight: z.number().positive() })
  .strict();
export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

export const ReviewEvaluateConfigSchema = z
  .object({
    kind: z.literal("review.evaluate"),
    instruction: z.string(),
    rubric: z.array(RubricCriterionSchema),
    profile: WorkerProfileSchema,
    model: z.string().min(1),
    reasoningEffort: z.string().min(1)
  })
  .strict();
export type ReviewEvaluateConfig = z.infer<typeof ReviewEvaluateConfigSchema>;

export const FilterRuleSchema = z
  .object({
    id: z.string().min(1),
    field: z.string().min(1),
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "exists"]),
    value: JsonValueSchema.optional()
  })
  .strict();
export type FilterRule = z.infer<typeof FilterRuleSchema>;

export const FilterRouteSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    outcome: z.enum(["matched", "unmatched"])
  })
  .strict();
export type FilterRoute = z.infer<typeof FilterRouteSchema>;

export const ReviewFilterConfigSchema = z
  .object({
    kind: z.literal("review.filter"),
    match: z.enum(["all", "any"]),
    rules: z.array(FilterRuleSchema),
    routes: z.array(FilterRouteSchema)
  })
  .strict();
export type ReviewFilterConfig = z.infer<typeof ReviewFilterConfigSchema>;

export const FlowVariableSchema = z
  .object({ name: z.string().min(1), value: JsonValueSchema })
  .strict();
export type FlowVariable = z.infer<typeof FlowVariableSchema>;

export const FlowVariablesConfigSchema = z
  .object({ kind: z.literal("flow.variables"), variables: z.array(FlowVariableSchema) })
  .strict();
export type FlowVariablesConfig = z.infer<typeof FlowVariablesConfigSchema>;

export const BatchDimensionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    values: z.array(JsonValueSchema).min(1)
  })
  .strict();
export type BatchDimension = z.infer<typeof BatchDimensionSchema>;

export const FlowBatchConfigSchema = z
  .object({
    kind: z.literal("flow.batch"),
    dimensions: z.array(BatchDimensionSchema),
    parallelism: z.number().int().positive()
  })
  .strict();
export type FlowBatchConfig = z.infer<typeof FlowBatchConfigSchema>;

export const FlowJoinConfigSchema = z
  .object({
    kind: z.literal("flow.join"),
    strategy: z.enum(["ordered", "zip", "merge"]),
    requireComplete: z.boolean()
  })
  .strict();
export type FlowJoinConfig = z.infer<typeof FlowJoinConfigSchema>;

export const OutputCollectionConfigSchema = z
  .object({
    kind: z.literal("output.collection"),
    collectionId: z.string().min(1),
    membershipMode: z.enum(["add", "replace"]),
    makePrimary: z.boolean()
  })
  .strict();
export type OutputCollectionConfig = z.infer<typeof OutputCollectionConfigSchema>;

export const OutputExportConfigSchema = z
  .object({
    kind: z.literal("output.export"),
    pathGrantId: z.string().min(1),
    namingTemplate: z.string().min(1),
    format: z.enum(["original", "png", "jpeg", "webp"]),
    collisionPolicy: z.enum(["rename", "skip", "error"]),
    includeMetadata: z.boolean()
  })
  .strict();
export type OutputExportConfig = z.infer<typeof OutputExportConfigSchema>;

export const CanvasNoteConfigSchema = z
  .object({ kind: z.literal("canvas.note"), body: z.string(), style: z.enum(["note", "cloud", "bubble"]) })
  .strict();
export type CanvasNoteConfig = z.infer<typeof CanvasNoteConfigSchema>;

export const DrawingPointSchema = z
  .object({ x: z.number().finite(), y: z.number().finite(), pressure: z.number().min(0).max(1) })
  .strict();
export type DrawingPoint = z.infer<typeof DrawingPointSchema>;

export const DrawingStrokeSchema = z
  .object({
    id: z.string().min(1),
    color: z.string().min(1),
    width: z.number().positive(),
    points: z.array(DrawingPointSchema)
  })
  .strict();
export type DrawingStroke = z.infer<typeof DrawingStrokeSchema>;

export const CanvasDrawingConfigSchema = z
  .object({
    kind: z.literal("canvas.drawing"),
    width: z.number().positive(),
    height: z.number().positive(),
    background: z.string().min(1),
    strokes: z.array(DrawingStrokeSchema)
  })
  .strict();
export type CanvasDrawingConfig = z.infer<typeof CanvasDrawingConfigSchema>;

export const NodeConfigSchemas = {
  "prompt.text": PromptTextConfigSchema,
  "prompt.worker": PromptWorkerConfigSchema,
  "reference.set": ReferenceSetConfigSchema,
  "generation.image": GenerationImageConfigSchema,
  "edit.image": EditImageConfigSchema,
  "edit.mask": EditMaskConfigSchema,
  "edit.transform": EditTransformConfigSchema,
  "review.compare": ReviewCompareConfigSchema,
  "review.evaluate": ReviewEvaluateConfigSchema,
  "review.filter": ReviewFilterConfigSchema,
  "flow.variables": FlowVariablesConfigSchema,
  "flow.batch": FlowBatchConfigSchema,
  "flow.join": FlowJoinConfigSchema,
  "output.collection": OutputCollectionConfigSchema,
  "output.export": OutputExportConfigSchema,
  "canvas.note": CanvasNoteConfigSchema,
  "canvas.drawing": CanvasDrawingConfigSchema
} as const;

export const NodeConfigSchema = z.discriminatedUnion("kind", [
  PromptTextConfigSchema,
  PromptWorkerConfigSchema,
  ReferenceSetConfigSchema,
  GenerationImageConfigSchema,
  EditImageConfigSchema,
  EditMaskConfigSchema,
  EditTransformConfigSchema,
  ReviewCompareConfigSchema,
  ReviewEvaluateConfigSchema,
  ReviewFilterConfigSchema,
  FlowVariablesConfigSchema,
  FlowBatchConfigSchema,
  FlowJoinConfigSchema,
  OutputCollectionConfigSchema,
  OutputExportConfigSchema,
  CanvasNoteConfigSchema,
  CanvasDrawingConfigSchema
]);
export type NodeConfig = z.infer<typeof NodeConfigSchema>;

export const NodeExecutorKindSchema = z.enum([
  "deterministic-assembly",
  "codex-llm",
  "asset-resolution",
  "image-provider",
  "edit-provider",
  "mask",
  "transform",
  "human-checkpoint",
  "codex-evaluation",
  "deterministic-filter",
  "deterministic",
  "batch",
  "join",
  "collection",
  "export",
  "non-runnable",
  "drawing"
]);
export type NodeExecutorKind = z.infer<typeof NodeExecutorKindSchema>;

type CanonicalNodeDefinitionContract = {
  family: NodeFamily;
  executor: NodeExecutorKind;
  inputs: readonly PayloadChannel[];
  outputs: readonly PayloadChannel[];
};

const allPayloadChannels = [...payloadChannels] as const;

export const canonicalNodeDefinitionContracts = {
  "prompt.text": {
    family: "prompt",
    executor: "deterministic-assembly",
    inputs: ["text", "data"],
    outputs: ["text", "data"]
  },
  "prompt.worker": {
    family: "prompt",
    executor: "codex-llm",
    inputs: allPayloadChannels,
    outputs: ["text", "data"]
  },
  "reference.set": {
    family: "reference",
    executor: "asset-resolution",
    inputs: allPayloadChannels,
    outputs: allPayloadChannels
  },
  "generation.image": {
    family: "generation",
    executor: "image-provider",
    inputs: ["text", "image", "data"],
    outputs: ["image", "text", "data"]
  },
  "edit.image": {
    family: "edit",
    executor: "edit-provider",
    inputs: ["text", "image", "mask", "data"],
    outputs: ["image", "mask", "data"]
  },
  "edit.mask": {
    family: "edit",
    executor: "mask",
    inputs: ["image", "text", "data", "mask"],
    outputs: ["mask", "image", "data"]
  },
  "edit.transform": {
    family: "edit",
    executor: "transform",
    inputs: ["image", "data"],
    outputs: ["image", "data"]
  },
  "review.compare": {
    family: "review",
    executor: "human-checkpoint",
    inputs: ["text", "image", "video", "audio", "data"],
    outputs: ["text", "image", "video", "audio", "data"]
  },
  "review.evaluate": {
    family: "review",
    executor: "codex-evaluation",
    inputs: allPayloadChannels,
    outputs: allPayloadChannels
  },
  "review.filter": {
    family: "review",
    executor: "deterministic-filter",
    inputs: allPayloadChannels,
    outputs: allPayloadChannels
  },
  "flow.variables": {
    family: "flow",
    executor: "deterministic",
    inputs: ["text", "data"],
    outputs: ["text", "data"]
  },
  "flow.batch": {
    family: "flow",
    executor: "batch",
    inputs: allPayloadChannels,
    outputs: allPayloadChannels
  },
  "flow.join": {
    family: "flow",
    executor: "join",
    inputs: allPayloadChannels,
    outputs: allPayloadChannels
  },
  "output.collection": {
    family: "output",
    executor: "collection",
    inputs: allPayloadChannels,
    outputs: allPayloadChannels
  },
  "output.export": {
    family: "output",
    executor: "export",
    inputs: allPayloadChannels,
    outputs: ["data"]
  },
  "canvas.note": {
    family: "canvas",
    executor: "non-runnable",
    inputs: [],
    outputs: ["text", "data"]
  },
  "canvas.drawing": {
    family: "canvas",
    executor: "drawing",
    inputs: ["image", "data"],
    outputs: ["image", "mask", "data"]
  }
} as const satisfies Record<NodeDefinitionId, CanonicalNodeDefinitionContract>;

export const NodePortSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    channel: PayloadChannelSchema,
    required: z.boolean(),
    multiple: z.boolean()
  })
  .strict();
export type NodePort = z.infer<typeof NodePortSchema>;

export const InputConsequenceSchema = z
  .object({
    executorInputField: z.string().min(1),
    assemblyStrategy: z.enum([
      "direct",
      "ordered-list",
      "role-section",
      "negative-constraint",
      "passthrough",
      "route"
    ]),
    preservationRule: z.enum([
      "preserve",
      "preserve-role",
      "preserve-lineage",
      "derive-lineage"
    ]),
    requiredAdapterCapability: z.string().min(1).nullable(),
    failureReason: z.string().nullable()
  })
  .strict();
export type InputConsequence = z.infer<typeof InputConsequenceSchema>;

export const ConsequenceTableSchema = z.record(
  PayloadChannelSchema,
  z.record(ConnectionRoleSchema, InputConsequenceSchema)
);
export type ConsequenceTable = z.infer<typeof ConsequenceTableSchema>;

export const NodeContractSchema = z
  .object({
    inputs: z.array(NodePortSchema),
    outputs: z.array(NodePortSchema),
    consequences: ConsequenceTableSchema
  })
  .strict();
export type NodeContract = z.infer<typeof NodeContractSchema>;

export const InspectorSectionSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    fields: z.array(z.string().min(1))
  })
  .strict();
export type InspectorSection = z.infer<typeof InspectorSectionSchema>;

export const InspectorDefinitionSchema = z
  .object({ sections: z.array(InspectorSectionSchema) })
  .strict();
export type InspectorDefinition = z.infer<typeof InspectorDefinitionSchema>;

export const NodePresentationDefaultsSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
    previewMode: z.enum(["summary", "content", "output"])
  })
  .strict();
export type NodePresentationDefaults = z.infer<typeof NodePresentationDefaultsSchema>;

const ConfigSchemaSchema = z.custom<z.ZodType<NodeConfig>>(
  (value) => value instanceof z.ZodType,
  "Expected a Zod node configuration schema"
);

const DefaultConfigSchema = z.custom<() => NodeConfig>(
  (value) => typeof value === "function",
  "Expected a default configuration factory"
);

export const NodeDefinitionSchema = z
  .object({
    id: NodeDefinitionIdSchema,
    family: NodeFamilySchema,
    title: z.string().min(1),
    description: z.string(),
    configSchema: ConfigSchemaSchema,
    defaultConfig: DefaultConfigSchema,
    contract: NodeContractSchema,
    inspector: InspectorDefinitionSchema,
    executor: NodeExecutorKindSchema,
    presentation: NodePresentationDefaultsSchema
  })
  .strict()
  .superRefine((definition, context) => {
    const canonical = canonicalNodeDefinitionContracts[definition.id];
    if (definition.configSchema !== NodeConfigSchemas[definition.id]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["configSchema"],
        message: `Config schema must be the canonical schema for ${definition.id}`
      });
    }
    if (definition.family !== canonical.family) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["family"],
        message: `Node family must be ${canonical.family} for ${definition.id}`
      });
    }
    if (definition.executor !== canonical.executor) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["executor"],
        message: `Node executor must be ${canonical.executor} for ${definition.id}`
      });
    }

    const validatePorts = (
      direction: "inputs" | "outputs",
      expectedChannels: readonly PayloadChannel[]
    ): void => {
      const ports = definition.contract[direction];
      const portIds = ports.map((port) => port.id);
      const channels = new Set(ports.map((port) => port.channel));
      if (new Set(portIds).size !== portIds.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contract", direction],
          message: `${direction} port IDs must be unique`
        });
      }
      if (
        channels.size !== expectedChannels.length ||
        expectedChannels.some((channel) => !channels.has(channel))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contract", direction],
          message: `${direction} channels must match the canonical ${definition.id} contract`
        });
      }
    };
    validatePorts("inputs", canonical.inputs);
    validatePorts("outputs", canonical.outputs);

    let defaultConfig: unknown;
    try {
      defaultConfig = definition.defaultConfig();
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultConfig"],
        message: `Default config factory threw: ${error instanceof Error ? error.message : "unknown error"}`
      });
      return;
    }
    const parsedDefaultConfig = NodeConfigSchema.safeParse(defaultConfig);
    if (!parsedDefaultConfig.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultConfig"],
        message: "Default config factory must return a canonical node configuration object"
      });
      return;
    }
    if (parsedDefaultConfig.data.kind !== definition.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultConfig"],
        message: `Default config kind ${parsedDefaultConfig.data.kind} does not match ${definition.id}`
      });
    }
    if (!definition.configSchema.safeParse(parsedDefaultConfig.data).success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["configSchema"],
        message: "Config schema does not accept its default configuration"
      });
    }
  });
export type ParsedNodeDefinition = z.infer<typeof NodeDefinitionSchema>;
export type NodeDefinition<TConfig extends NodeConfig = NodeConfig> = Omit<
  ParsedNodeDefinition,
  "id" | "configSchema" | "defaultConfig"
> & {
  id: TConfig["kind"];
  configSchema: z.ZodType<TConfig>;
  defaultConfig: () => TConfig;
};

const nodeShape = {
  id: z.string().min(1),
  title: z.string(),
  position: NodePositionSchema,
  size: NodeSizeSchema,
  presentation: NodePresentationSchema
};

export const EtherNodeSchema = z.discriminatedUnion("definitionId", [
  z.object({ ...nodeShape, definitionId: z.literal("prompt.text"), config: PromptTextConfigSchema }).strict(),
  z.object({ ...nodeShape, definitionId: z.literal("prompt.worker"), config: PromptWorkerConfigSchema }).strict(),
  z.object({ ...nodeShape, definitionId: z.literal("reference.set"), config: ReferenceSetConfigSchema }).strict(),
  z.object({ ...nodeShape, definitionId: z.literal("generation.image"), config: GenerationImageConfigSchema }).strict(),
  z.object({ ...nodeShape, definitionId: z.literal("edit.image"), config: EditImageConfigSchema }).strict(),
  z.object({ ...nodeShape, definitionId: z.literal("edit.mask"), config: EditMaskConfigSchema }).strict(),
  z.object({ ...nodeShape, definitionId: z.literal("edit.transform"), config: EditTransformConfigSchema }).strict(),
  z.object({ ...nodeShape, definitionId: z.literal("review.compare"), config: ReviewCompareConfigSchema }).strict(),
  z.object({ ...nodeShape, definitionId: z.literal("review.evaluate"), config: ReviewEvaluateConfigSchema }).strict(),
  z.object({ ...nodeShape, definitionId: z.literal("review.filter"), config: ReviewFilterConfigSchema }).strict(),
  z.object({ ...nodeShape, definitionId: z.literal("flow.variables"), config: FlowVariablesConfigSchema }).strict(),
  z.object({ ...nodeShape, definitionId: z.literal("flow.batch"), config: FlowBatchConfigSchema }).strict(),
  z.object({ ...nodeShape, definitionId: z.literal("flow.join"), config: FlowJoinConfigSchema }).strict(),
  z.object({ ...nodeShape, definitionId: z.literal("output.collection"), config: OutputCollectionConfigSchema }).strict(),
  z.object({ ...nodeShape, definitionId: z.literal("output.export"), config: OutputExportConfigSchema }).strict(),
  z.object({ ...nodeShape, definitionId: z.literal("canvas.note"), config: CanvasNoteConfigSchema }).strict(),
  z.object({ ...nodeShape, definitionId: z.literal("canvas.drawing"), config: CanvasDrawingConfigSchema }).strict()
]);
export type ParsedEtherNode = z.infer<typeof EtherNodeSchema>;
export type EtherNode<TConfig extends NodeConfig = NodeConfig> = Omit<
  ParsedEtherNode,
  "definitionId" | "config"
> & {
  definitionId: TConfig["kind"];
  config: TConfig;
};

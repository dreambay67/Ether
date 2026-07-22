import {
  NodeConfigSchemas,
  NodeDefinitionSchema,
  canonicalNodeDefinitionIds,
  connectionRoles,
  type ConnectionRole,
  type InputConsequence,
  type NodeConfig,
  type NodeDefinition,
  type NodeDefinitionId,
  type PayloadChannel
} from "@ether/schema";

export type KernelNodeDefinition = NodeDefinition & {
  library: {
    definitionId: NodeDefinitionId;
    inputChannels: PayloadChannel[];
    outputChannels: PayloadChannel[];
  };
  mcp: { definitionId: NodeDefinitionId; operation: "inspect" | "execute" };
  recipe: { definitionId: NodeDefinitionId; configurablePaths: string[] };
};

const allChannels: PayloadChannel[] = ["text", "image", "mask", "data", "video", "audio"];

const contracts: Record<NodeDefinitionId, {
  family: KernelNodeDefinition["family"];
  executor: KernelNodeDefinition["executor"];
  inputs: PayloadChannel[];
  outputs: PayloadChannel[];
  title: string;
}> = {
  "prompt.text": { family: "prompt", executor: "deterministic-assembly", inputs: ["text", "data"], outputs: ["text", "data"], title: "Prompt" },
  "prompt.worker": { family: "prompt", executor: "codex-llm", inputs: allChannels, outputs: ["text", "data"], title: "Worker" },
  "reference.set": { family: "reference", executor: "asset-resolution", inputs: allChannels, outputs: allChannels, title: "Reference Set" },
  "generation.image": { family: "generation", executor: "image-provider", inputs: ["text", "image", "data"], outputs: ["image", "text", "data"], title: "Image Generator" },
  "edit.image": { family: "edit", executor: "edit-provider", inputs: ["text", "image", "mask", "data"], outputs: ["image", "mask", "data"], title: "Image Edit" },
  "edit.mask": { family: "edit", executor: "mask", inputs: ["image", "text", "data", "mask"], outputs: ["mask", "image", "data"], title: "Mask" },
  "edit.transform": { family: "edit", executor: "transform", inputs: ["image", "data"], outputs: ["image", "data"], title: "Transform" },
  "review.compare": { family: "review", executor: "human-checkpoint", inputs: ["text", "image", "video", "audio", "data"], outputs: ["text", "image", "video", "audio", "data"], title: "Compare" },
  "review.evaluate": { family: "review", executor: "codex-evaluation", inputs: allChannels, outputs: allChannels, title: "Evaluate" },
  "review.filter": { family: "review", executor: "deterministic-filter", inputs: allChannels, outputs: allChannels, title: "Filter" },
  "flow.variables": { family: "flow", executor: "deterministic", inputs: ["text", "data"], outputs: ["text", "data"], title: "Variables" },
  "flow.batch": { family: "flow", executor: "batch", inputs: allChannels, outputs: allChannels, title: "Batch" },
  "flow.join": { family: "flow", executor: "join", inputs: allChannels, outputs: allChannels, title: "Join" },
  "output.collection": { family: "output", executor: "collection", inputs: allChannels, outputs: allChannels, title: "Collection" },
  "output.export": { family: "output", executor: "export", inputs: allChannels, outputs: ["data"], title: "Export" },
  "canvas.note": { family: "canvas", executor: "non-runnable", inputs: [], outputs: ["text", "data"], title: "Note" },
  "canvas.drawing": { family: "canvas", executor: "drawing", inputs: ["image", "data"], outputs: ["image", "mask", "data"], title: "Drawing" }
};

const defaults: Record<NodeDefinitionId, () => NodeConfig> = {
  "prompt.text": () => ({ kind: "prompt.text", body: "", assembly: "append" }),
  "prompt.worker": () => ({ kind: "prompt.worker", behavior: "rewrite", instruction: "", profile: "balanced", model: "gpt-5", reasoningEffort: "medium", variation: 0.2, contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 8_000 }, memoryPolicy: { mode: "stateless" }, outputContract: { channel: "text", count: 1, selectionPolicy: "latest" } }),
  "reference.set": () => ({ kind: "reference.set", artifactIds: [], enabledChannels: [], ordering: "manual" }),
  "generation.image": () => ({ kind: "generation.image", providerId: "codex", profileId: "image-default", aspectRatio: "1:1", resolution: { width: 1024, height: 1024 }, outputCount: 1 }),
  "edit.image": () => ({ kind: "edit.image", providerId: "codex", profileId: "image-edit", strength: 0.75, outputCount: 1 }),
  "edit.mask": () => ({ kind: "edit.mask", mode: "manual", feather: 0 }),
  "edit.transform": () => ({ kind: "edit.transform", operation: "resize", preserveAspectRatio: true }),
  "review.compare": () => ({ kind: "review.compare", selectionMode: "one", minimumSelections: 1 }),
  "review.evaluate": () => ({ kind: "review.evaluate", instruction: "", rubric: [], profile: "balanced", model: "gpt-5", reasoningEffort: "medium" }),
  "review.filter": () => ({ kind: "review.filter", match: "all", rules: [], routes: [] }),
  "flow.variables": () => ({ kind: "flow.variables", variables: [] }),
  "flow.batch": () => ({ kind: "flow.batch", dimensions: [{ id: "items", name: "Items", values: [""] }], parallelism: 1 }),
  "flow.join": () => ({ kind: "flow.join", strategy: "ordered", requireComplete: true }),
  "output.collection": () => ({ kind: "output.collection", collectionId: "default", membershipMode: "add", makePrimary: false }),
  "output.export": () => ({ kind: "output.export", pathGrantId: "unconfigured", namingTemplate: "{node}-{index}", format: "original", collisionPolicy: "rename", includeMetadata: true }),
  "canvas.note": () => ({ kind: "canvas.note", body: "", style: "note" }),
  "canvas.drawing": () => ({ kind: "canvas.drawing", width: 1024, height: 1024, background: "transparent", strokes: [] })
};

const inspectorFields: Record<NodeDefinitionId, string[]> = {
  "prompt.text": ["body", "assembly"], "prompt.worker": ["instruction", "behavior", "profile", "model"],
  "reference.set": ["artifactIds", "enabledChannels", "ordering"], "generation.image": ["providerId", "profileId", "aspectRatio", "resolution", "outputCount"],
  "edit.image": ["providerId", "profileId", "strength", "outputCount"], "edit.mask": ["mode", "feather"],
  "edit.transform": ["operation", "width", "height", "preserveAspectRatio"], "review.compare": ["selectionMode", "minimumSelections"],
  "review.evaluate": ["instruction", "rubric", "profile", "model"], "review.filter": ["match", "rules", "routes"],
  "flow.variables": ["variables"], "flow.batch": ["dimensions", "exclusions", "parallelism"], "flow.join": ["strategy", "requireComplete"],
  "output.collection": ["collectionId", "membershipMode", "makePrimary"], "output.export": ["pathGrantId", "namingTemplate", "format", "collisionPolicy", "includeMetadata"],
  "canvas.note": ["body", "style"], "canvas.drawing": ["width", "height", "background", "strokes"]
};

const inputFields: Record<NodeDefinitionId, Partial<Record<PayloadChannel, string>>> = {
  "prompt.text": { text: "positiveBody", data: "structuredContext" }, "prompt.worker": { text: "positiveBody", image: "mediaContext", mask: "mediaContext", data: "structuredContext", video: "mediaContext", audio: "mediaContext" },
  "reference.set": { text: "assets", image: "assets", mask: "assets", data: "assets", video: "assets", audio: "assets" }, "generation.image": { text: "positivePrompt", image: "references", data: "structuredInput" },
  "edit.image": { text: "instruction", image: "sources", mask: "masks", data: "structuredInput" }, "edit.mask": { image: "sourceImages", text: "instruction", data: "geometry", mask: "existingMasks" },
  "edit.transform": { image: "sourceImages", data: "transformData" }, "review.compare": { text: "candidates", image: "candidates", video: "candidates", audio: "candidates", data: "candidates" },
  "review.evaluate": { text: "evaluationContext", image: "evaluationContext", mask: "evaluationContext", data: "evaluationContext", video: "evaluationContext", audio: "evaluationContext" }, "review.filter": { text: "routeInputs", image: "routeInputs", mask: "routeInputs", data: "routeInputs", video: "routeInputs", audio: "routeInputs" },
  "flow.variables": { text: "templateInputs", data: "variables" }, "flow.batch": { text: "workItems", image: "workItems", mask: "workItems", data: "workItems", video: "workItems", audio: "workItems" },
  "flow.join": { text: "pools", image: "pools", mask: "pools", data: "pools", video: "pools", audio: "pools" }, "output.collection": { text: "members", image: "members", mask: "members", data: "members", video: "members", audio: "members" },
  "output.export": { text: "exportItems", image: "exportItems", mask: "exportItems", data: "exportItems", video: "exportItems", audio: "exportItems" }, "canvas.note": {}, "canvas.drawing": { image: "canvasImage", data: "drawingData" }
};

function consequence(definitionId: NodeDefinitionId, channel: PayloadChannel, role: ConnectionRole): InputConsequence {
  const executorInputField = role === "negative" && channel === "text" ? "negativeConstraints" : inputFields[definitionId][channel] ?? `${channel}Input`;
  const assemblyStrategy = definitionId === "review.filter" ? "route" : role === "negative" && channel === "text" ? "negative-constraint" : channel === "text" ? "role-section" : definitionId === "output.collection" ? "passthrough" : "ordered-list";
  const preservationRule = definitionId === "flow.join" ? "derive-lineage" : definitionId === "output.collection" || definitionId === "review.filter" ? "preserve-role" : "preserve-lineage";
  return { executorInputField, assemblyStrategy, preservationRule, requiredAdapterCapability: null, failureReason: null };
}

function ports(channels: PayloadChannel[], multiple = true) {
  return channels.map((channel) => ({ id: channel, name: channel[0]!.toUpperCase() + channel.slice(1), channel, required: false, multiple }));
}

function makeDefinition(id: NodeDefinitionId): KernelNodeDefinition {
  const metadata = contracts[id];
  const consequences = Object.fromEntries(metadata.inputs.map((channel) => [channel, Object.fromEntries(connectionRoles.map((role) => [role, consequence(id, channel, role)]))]));
  return {
    id,
    family: metadata.family,
    title: metadata.title,
    description: `${metadata.title} node.`,
    configSchema: NodeConfigSchemas[id],
    defaultConfig: defaults[id],
    contract: { inputs: ports(metadata.inputs), outputs: ports(metadata.outputs), consequences },
    inspector: { sections: [{ id: "main", title: metadata.title, fields: inspectorFields[id] }] },
    executor: metadata.executor,
    presentation: { width: 220, height: 140, previewMode: id === "prompt.text" ? "content" : "summary" },
    library: { definitionId: id, inputChannels: [...metadata.inputs], outputChannels: [...metadata.outputs] },
    mcp: { definitionId: id, operation: metadata.executor === "non-runnable" ? "inspect" : "execute" },
    recipe: { definitionId: id, configurablePaths: [...inspectorFields[id]] }
  } as KernelNodeDefinition;
}

type StructuralZodSchema = { _def?: { typeName?: string; innerType?: StructuralZodSchema; shape?: () => Record<string, StructuralZodSchema> } };

function schemaHasPath(schema: StructuralZodSchema, path: string): boolean {
  let current: StructuralZodSchema = schema;
  for (const segment of path.split(".")) {
    while (["ZodOptional", "ZodNullable"].includes(current._def?.typeName ?? "")) current = current._def!.innerType!;
    const shape = current._def?.shape?.();
    if (shape === undefined) return false;
    const next = shape[segment];
    if (next === undefined) return false;
    current = next;
  }
  return true;
}

export function createNodeRegistry(definitions: readonly KernelNodeDefinition[]): ReadonlyMap<NodeDefinitionId, KernelNodeDefinition> {
  const registry = new Map<NodeDefinitionId, KernelNodeDefinition>();
  for (const definition of definitions) {
    if (registry.has(definition.id)) throw new Error(`Duplicate node definition: ${definition.id}`);
    const { library: _library, mcp: _mcp, recipe: _recipe, ...structuralDefinition } = definition;
    NodeDefinitionSchema.parse(structuralDefinition);
    if (definition.configSchema !== NodeConfigSchemas[definition.id]) throw new Error(`Config schema contract mismatch for ${definition.id}`);
    if (definition.defaultConfig().kind !== definition.id || !definition.configSchema.safeParse(definition.defaultConfig()).success) throw new Error(`Invalid default or config contract for ${definition.id}`);
    for (const direction of ["inputs", "outputs"] as const) {
      const ids = definition.contract[direction].map((port) => port.id);
      if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${direction} port for ${definition.id}`);
      const contractChannels = definition.contract[direction].map((port) => port.channel);
      const libraryChannels = direction === "inputs" ? definition.library.inputChannels : definition.library.outputChannels;
      if (JSON.stringify(contractChannels) !== JSON.stringify(libraryChannels)) throw new Error(`Library projection does not match contract for ${definition.id}`);
    }
    if (definition.mcp.definitionId !== definition.id || definition.recipe.definitionId !== definition.id) throw new Error(`Catalog projection ID mismatch for ${definition.id}`);
    if (definition.inspector.sections.length === 0) throw new Error(`Inspector is empty for ${definition.id}`);
    for (const section of definition.inspector.sections) for (const path of section.fields) if (!schemaHasPath(definition.configSchema as StructuralZodSchema, path)) throw new Error(`Invalid inspector path ${path} for ${definition.id}`);
    const consequenceChannels = Object.keys(definition.contract.consequences);
    for (const input of definition.contract.inputs) {
      const roleTable = definition.contract.consequences[input.channel];
      if (roleTable === undefined || connectionRoles.some((role) => roleTable[role] === undefined || roleTable[role]!.executorInputField.length === 0)) throw new Error(`Empty consequences for ${definition.id}:${input.channel}`);
    }
    if (definition.executor !== "non-runnable" && (definition.contract.inputs.length === 0 || consequenceChannels.length === 0)) throw new Error(`Runnable node ${definition.id} has no meaningful consequence`);
    registry.set(definition.id, definition);
  }
  for (const id of canonicalNodeDefinitionIds) if (!registry.has(id)) throw new Error(`Missing node definition: ${id}`);
  if (registry.size !== canonicalNodeDefinitionIds.length) throw new Error("Registry contains non-canonical node definitions");
  return registry;
}

export const nodeDefinitions = canonicalNodeDefinitionIds.map(makeDefinition);
export const nodeRegistry = createNodeRegistry(nodeDefinitions);

export function getNodeDefinition(id: NodeDefinitionId): KernelNodeDefinition {
  const definition = nodeRegistry.get(id);
  if (definition === undefined) throw new Error(`Unknown node definition: ${id}`);
  return definition;
}

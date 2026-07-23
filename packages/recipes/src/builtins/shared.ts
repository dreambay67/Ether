import type {
  CapabilityRequirement,
  EtherEdge,
  GraphBlueprint,
  PayloadChannel,
  ProviderCapability,
  ProviderOperation,
  ProviderSubstitution,
  RecipeArtifactParameter,
  RecipeManifest,
  RecipeNodeBlueprint,
  RecipeParameter,
  RecipeStringParameter,
  ReviewCheckpoint
} from "@ether/schema";

const ACCENTS: Record<string, string> = {
  "prompt.text": "#37e6ea",
  "prompt.worker": "#a78bfa",
  "reference.set": "#3b82f6",
  "generation.image": "#f59e0b",
  "edit.image": "#fb7185",
  "edit.mask": "#fb7185",
  "edit.transform": "#fb7185",
  "review.compare": "#a78bfa",
  "review.evaluate": "#a78bfa",
  "review.filter": "#a78bfa",
  "flow.variables": "#14b8a6",
  "flow.batch": "#14b8a6",
  "flow.join": "#14b8a6",
  "output.collection": "#34d399",
  "output.export": "#34d399"
};

export function node(
  id: string,
  definitionId: RecipeNodeBlueprint["definitionId"],
  title: string,
  x: number,
  y: number,
  config: RecipeNodeBlueprint["config"]
): RecipeNodeBlueprint {
  return {
    id,
    definitionId,
    title,
    position: { x, y },
    size: { width: 220, height: 140 },
    config,
    presentation: {
      collapsed: false,
      accent: ACCENTS[definitionId] ?? "#37e6ea",
      previewMode: definitionId === "prompt.text" ? "content" : "summary"
    }
  };
}

export function edge(
  id: string,
  from: string,
  to: string,
  channel: PayloadChannel,
  role: EtherEdge["role"] = "general",
  order = 0
): EtherEdge {
  return {
    id,
    from: { kind: "node", nodeId: from, channel },
    to: { kind: "node", nodeId: to, channel },
    role,
    order,
    selector: { kind: "latest" },
    adapter: { kind: "auto" },
    enabled: true
  };
}

export function graph(
  graphRef: string,
  title: string,
  nodes: readonly RecipeNodeBlueprint[],
  edges: readonly EtherEdge[],
  focusNodeId = nodes[0]?.id ?? null
): GraphBlueprint {
  return {
    graphRef,
    title,
    kind: "root",
    nodes: [...nodes],
    edges: [...edges],
    groups: [{
      id: `${graphRef}-workflow`,
      title,
      nodeIds: nodes.map((item) => item.id),
      position: { x: 24, y: 36 },
      size: { width: Math.max(280, nodes.length * 278), height: 230 },
      color: "#37e6ea"
    }],
    modules: [],
    viewState: {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedNodeIds: focusNodeId === null ? [] : [focusNodeId],
      selectedEdgeIds: [],
      inspectorTarget: focusNodeId === null ? null : { kind: "node", id: focusNodeId }
    }
  };
}

export function briefParameter(defaultValue: string): RecipeStringParameter {
  return {
    id: "brief",
    title: "Creative brief",
    description: "The intent carried through the prompt and provider-ready graph.",
    type: "string",
    required: true,
    defaultValue,
    minLength: 3,
    maxLength: 1_200
  };
}

export function referenceParameter(title = "Reference images", maximumItems = 32): RecipeArtifactParameter {
  return {
    id: "references",
    title,
    description: "Add the source artifacts that should guide this recipe.",
    type: "artifact",
    required: true,
    channels: ["image"],
    minimumItems: 1,
    maximumItems
  };
}

export function requirement(
  id: string,
  operation: ProviderOperation,
  inputChannels: PayloadChannel[],
  outputChannels: PayloadChannel[],
  minimumReferences = 0,
  minimumOutputs = 1,
  supportsSeed = false
): CapabilityRequirement {
  return {
    id,
    operation,
    inputChannels,
    outputChannels,
    minimumReferences,
    minimumOutputs,
    supportsCancellation: true,
    supportsSeed
  };
}

function capabilityFor(requirement: CapabilityRequirement, providerId: string, profileId: string): ProviderCapability {
  return {
    providerId,
    profileId,
    operation: requirement.operation,
    inputChannels: requirement.inputChannels,
    outputChannels: requirement.outputChannels,
    aspectRatios: ["1:1", "4:5", "16:9"],
    resolutions: [{ id: "1024-square", width: 1024, height: 1024, label: "1024 × 1024" }],
    maxReferences: Math.max(8, requirement.minimumReferences),
    maxOutputsPerCall: Math.max(4, requirement.minimumOutputs),
    maxParallelism: 4,
    supportsCancellation: true,
    supportsSeed: requirement.supportsSeed,
    provenance: "static-constraint",
    limitations: []
  };
}

export function substitutionsFor(requirements: readonly CapabilityRequirement[]): ProviderSubstitution[] {
  return requirements.flatMap((item) => [
    {
      requirementId: item.id,
      providerId: "codex",
      profileId: item.operation === "edit-image" ? "image-edit" : item.operation === "llm" ? "balanced" : "image-default",
      priority: 0,
      capability: capabilityFor(item, "codex", item.operation === "edit-image" ? "image-edit" : item.operation === "llm" ? "balanced" : "image-default"),
      parameterBindings: []
    },
    {
      requirementId: item.id,
      providerId: "antigravity",
      profileId: item.operation === "edit-image" ? "nano-banana-2-edit" : item.operation === "llm" ? "reasoning" : "nano-banana-2",
      priority: 1,
      capability: capabilityFor(item, "antigravity", item.operation === "edit-image" ? "nano-banana-2-edit" : item.operation === "llm" ? "reasoning" : "nano-banana-2"),
      parameterBindings: []
    }
  ]);
}

export function checkpoint(graphRef: string, nodeRef: string, title: string): ReviewCheckpoint {
  return {
    id: `${nodeRef}-checkpoint`,
    graphRef,
    nodeRef,
    title,
    policy: "approve-one",
    required: true,
    minimumApprovals: 1
  };
}

export function manifest(input: {
  id: string;
  title: string;
  description: string;
  parameters: readonly RecipeParameter[];
  graph: GraphBlueprint;
  requirements: readonly CapabilityRequirement[];
  substitutions?: readonly ProviderSubstitution[];
  checkpoints?: readonly ReviewCheckpoint[];
  calls: number;
  workItems: number;
  scenario: RecipeManifest["acceptanceScenario"];
}): RecipeManifest {
  return {
    id: input.id,
    version: "4.0.0",
    title: input.title,
    description: input.description,
    parameters: [...input.parameters],
    graph: input.graph,
    moduleGraphs: [],
    capabilityRequirements: [...input.requirements],
    substitutions: [...(input.substitutions ?? substitutionsFor(input.requirements))],
    layout: { policy: "layout-branch", direction: "horizontal", spacing: { x: 58, y: 42 }, focusNodeRef: input.graph.viewState.inspectorTarget?.kind === "node" ? input.graph.viewState.inspectorTarget.id : null },
    checkpoints: [...(input.checkpoints ?? [])],
    expectedWork: {
      minimumCalls: input.calls,
      maximumCalls: input.calls,
      minimumWorkItems: input.workItems,
      maximumWorkItems: input.workItems
    },
    acceptanceScenario: input.scenario
  };
}

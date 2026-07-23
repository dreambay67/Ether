import { previewGraphTransaction } from "@ether/graph-kernel";
import type {
  CapabilityRequirement,
  EtherGraph,
  EtherModule,
  EtherNode,
  GraphBlueprint,
  GraphOperation,
  JsonValue,
  ProviderCapability,
  RecipeManifest,
  RecipeParameter,
  RecipeParameterValue
} from "@ether/schema";
import type {
  InstantiateRecipeInput,
  RecipeBlocker,
  RecipeInstantiation,
  RecipeProviderSetup,
  RecipeProviderResolution,
  ResolvedRecipeParameter
} from "./types.js";
import { validateRecipe } from "./validateRecipe.js";

function parameterDefault(parameter: RecipeParameter): JsonValue | undefined {
  switch (parameter.type) {
    case "string": return parameter.defaultValue;
    case "number": return parameter.defaultValue;
    case "boolean": return parameter.defaultValue;
    case "choice": return parameter.options.find((option) => option.id === parameter.defaultOptionId)?.value;
    case "artifact": return undefined;
  }
}

function parameterIssue(parameter: RecipeParameter, value: JsonValue): string | null {
  switch (parameter.type) {
    case "string":
      return typeof value !== "string" || value.length < parameter.minLength || value.length > parameter.maxLength
        ? `${parameter.title} must be ${parameter.minLength}-${parameter.maxLength} characters.`
        : null;
    case "number":
      return typeof value !== "number" || value < parameter.minimum || value > parameter.maximum || (value - parameter.minimum) % parameter.step !== 0
        ? `${parameter.title} must be a number from ${parameter.minimum} to ${parameter.maximum}.`
        : null;
    case "boolean": return typeof value === "boolean" ? null : `${parameter.title} must be true or false.`;
    case "choice": return parameter.options.some((option) => Object.is(option.value, value)) ? null : `${parameter.title} must use one of its offered choices.`;
    case "artifact": return !Array.isArray(value) || value.some((item) => typeof item !== "string") || value.length < parameter.minimumItems || value.length > parameter.maximumItems
      ? `${parameter.title} needs ${parameter.minimumItems}-${parameter.maximumItems} compatible artifact IDs.`
      : null;
  }
}

function resolveParameters(
  manifest: RecipeManifest,
  provided: readonly RecipeParameterValue[]
): { values: readonly ResolvedRecipeParameter[]; blockers: readonly RecipeBlocker[] } {
  const providedById = new Map(provided.map((item) => [item.parameterId, item.value]));
  const blockers: RecipeBlocker[] = [];
  const values: ResolvedRecipeParameter[] = [];
  for (const parameter of manifest.parameters) {
    const supplied = providedById.get(parameter.id);
    const defaultValue = parameterDefault(parameter);
    if (supplied === undefined && defaultValue === undefined) {
      if (parameter.required) blockers.push({ code: "PARAMETER_REQUIRED", message: `${parameter.title} is required before this recipe can be inserted.`, parameterId: parameter.id });
      continue;
    }
    const value = supplied ?? defaultValue!;
    const issue = parameterIssue(parameter, value);
    if (issue !== null) blockers.push({ code: "PARAMETER_INVALID", message: issue, parameterId: parameter.id });
    else values.push({ parameterId: parameter.id, value, source: supplied === undefined ? "default" : "provided" });
  }
  for (const value of provided) {
    if (!manifest.parameters.some((parameter) => parameter.id === value.parameterId)) {
      blockers.push({ code: "PARAMETER_INVALID", message: `Unknown recipe parameter ${value.parameterId}.`, parameterId: value.parameterId });
    }
  }
  return { values, blockers };
}

function capabilitySatisfies(requirement: CapabilityRequirement, capability: ProviderCapability): boolean {
  return capability.operation === requirement.operation
    && requirement.inputChannels.every((channel) => capability.inputChannels.includes(channel))
    && requirement.outputChannels.every((channel) => capability.outputChannels.includes(channel))
    && capability.maxReferences >= requirement.minimumReferences
    && capability.maxOutputsPerCall >= requirement.minimumOutputs
    && (!requirement.supportsCancellation || capability.supportsCancellation)
    && (!requirement.supportsSeed || capability.supportsSeed);
}

function providerResolutionFor(
  manifest: RecipeManifest,
  requirement: CapabilityRequirement,
  capabilities: readonly ProviderCapability[]
): { resolution: RecipeProviderResolution | null; options: RecipeProviderSetup["options"] } {
  const substitutions = manifest.substitutions
    .filter((item) => item.requirementId === requirement.id)
    .sort((left, right) => left.priority - right.priority || left.providerId.localeCompare(right.providerId));
  const options = substitutions.map((candidate) => ({
    providerId: candidate.providerId,
    profileId: candidate.profileId,
    priority: candidate.priority,
    available: capabilities.some((capability) =>
      capability.providerId === candidate.providerId
      && capability.profileId === candidate.profileId
      && capabilitySatisfies(requirement, capability))
  }));
  const substitution = substitutions.find((candidate) => capabilities.some((capability) =>
    capability.providerId === candidate.providerId
    && capability.profileId === candidate.profileId
    && capabilitySatisfies(requirement, capability)
  ));
  const capability = substitution === undefined
    ? capabilities.find((candidate) => capabilitySatisfies(requirement, candidate))
    : capabilities.find((candidate) => candidate.providerId === substitution.providerId && candidate.profileId === substitution.profileId && capabilitySatisfies(requirement, candidate));
  return {
    options,
    resolution: capability === undefined ? null : {
      requirementId: requirement.id,
      capability,
      mode: substitution === undefined ? "compatible" : substitution.priority === 0 ? "primary" : "substitution",
      substitutionProviderId: substitution?.providerId ?? null,
      substitutionProfileId: substitution?.profileId ?? null
    }
  };
}

export function inspectRecipeProviderSetup(
  manifest: RecipeManifest,
  capabilities: readonly ProviderCapability[]
): readonly RecipeProviderSetup[] {
  return manifest.capabilityRequirements.map((requirement) => {
    const { resolution, options } = providerResolutionFor(manifest, requirement, capabilities);
    return {
      requirementId: requirement.id,
      operation: requirement.operation,
      inputChannels: requirement.inputChannels,
      outputChannels: requirement.outputChannels,
      state: resolution?.mode ?? "missing",
      selectedProviderId: resolution?.capability.providerId ?? null,
      selectedProfileId: resolution?.capability.profileId ?? null,
      options
    };
  });
}

function resolveProviders(
  manifest: RecipeManifest,
  capabilities: readonly ProviderCapability[]
): { resolutions: readonly RecipeProviderResolution[]; blockers: readonly RecipeBlocker[] } {
  const resolutions: RecipeProviderResolution[] = [];
  const blockers: RecipeBlocker[] = [];
  for (const requirement of manifest.capabilityRequirements) {
    const { resolution, options } = providerResolutionFor(manifest, requirement, capabilities);
    if (resolution === null) {
      blockers.push({
        code: "CAPABILITY_MISSING",
        message: `No enabled provider can satisfy ${requirement.id} (${requirement.operation}).`,
        requirement,
        supportedSubstitutions: options.map((item) => ({ providerId: item.providerId, profileId: item.profileId }))
      });
      continue;
    }
    resolutions.push(resolution);
  }
  return { resolutions, blockers };
}

function replaceParameterTokens(value: JsonValue, parameters: ReadonlyMap<string, JsonValue>): JsonValue {
  if (typeof value === "string") {
    return value.replace(/{{([A-Za-z0-9_-]+)}}/g, (match, id: string) => {
      const replacement = parameters.get(id);
      return typeof replacement === "string" || typeof replacement === "number" || typeof replacement === "boolean" ? String(replacement) : match;
    });
  }
  if (Array.isArray(value)) return value.map((item) => replaceParameterTokens(item, parameters));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceParameterTokens(item, parameters)]));
  return value;
}

function configuredNodes(
  blueprint: GraphBlueprint,
  parameters: readonly ResolvedRecipeParameter[],
  providers: readonly RecipeProviderResolution[],
  prefix: string,
  offset = { x: 0, y: 0 }
): EtherNode[] {
  const values = new Map(parameters.map((item) => [item.parameterId, item.value]));
  const artifactValues = parameters.filter((item) => Array.isArray(item.value));
  return blueprint.nodes.map((nodeBlueprint) => {
    const config = replaceParameterTokens(nodeBlueprint.config, values) as Record<string, JsonValue>;
    if (nodeBlueprint.definitionId === "reference.set") {
      const artifacts = artifactValues.flatMap((item) => item.value as string[]);
      if (artifacts.length > 0) config.artifactIds = artifacts;
    }
    const provider = providers.find((item) => item.requirementId === nodeBlueprint.id);
    if ((nodeBlueprint.definitionId === "generation.image" || nodeBlueprint.definitionId === "edit.image") && provider !== undefined) {
      config.providerId = provider.capability.providerId;
      config.profileId = provider.capability.profileId;
    }
    return {
      ...nodeBlueprint,
      id: `${prefix}-${nodeBlueprint.id}`,
      position: { x: nodeBlueprint.position.x + offset.x, y: nodeBlueprint.position.y + offset.y },
      config
    } as EtherNode;
  });
}

function remapEndpoint(endpoint: GraphBlueprint["edges"][number]["from"], prefix: string) {
  return endpoint.kind === "node"
    ? { ...endpoint, nodeId: `${prefix}-${endpoint.nodeId}` }
    : { ...endpoint, moduleId: `${prefix}-${endpoint.moduleId}`, portId: `${prefix}-${endpoint.portId}` };
}

function remapModule(module: EtherModule, prefix: string, offset = { x: 0, y: 0 }): EtherModule {
  return {
    ...module,
    id: `${prefix}-${module.id}`,
    graphId: `${prefix}-${module.graphId}`,
    position: { x: module.position.x + offset.x, y: module.position.y + offset.y },
    interface: {
      inputs: module.interface.inputs.map((port) => ({ ...port, id: `${prefix}-${port.id}`, internalNodeId: `${prefix}-${port.internalNodeId}` })),
      outputs: module.interface.outputs.map((port) => ({ ...port, id: `${prefix}-${port.id}`, internalNodeId: `${prefix}-${port.internalNodeId}` })),
      parameters: module.interface.parameters.map((parameter) => ({ ...parameter, id: `${prefix}-${parameter.id}`, nodeId: `${prefix}-${parameter.nodeId}` }))
    }
  };
}

function remapGraph(
  blueprint: GraphBlueprint,
  parameters: readonly ResolvedRecipeParameter[],
  providers: readonly RecipeProviderResolution[],
  prefix: string
): EtherGraph {
  return {
    id: `${prefix}-${blueprint.graphRef}`,
    title: blueprint.title,
    kind: blueprint.kind,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    nodes: configuredNodes(blueprint, parameters, providers, prefix) as EtherGraph["nodes"],
    edges: blueprint.edges.map((edge) => ({ ...edge, id: `${prefix}-${edge.id}`, from: remapEndpoint(edge.from, prefix), to: remapEndpoint(edge.to, prefix) })),
    groups: blueprint.groups.map((group) => ({ ...group, id: `${prefix}-${group.id}`, nodeIds: group.nodeIds.map((id) => `${prefix}-${id}`) })),
    modules: blueprint.modules.map((module) => remapModule(module, prefix)),
    viewState: {
      ...blueprint.viewState,
      selectedNodeIds: blueprint.viewState.selectedNodeIds.map((id) => `${prefix}-${id}`),
      selectedEdgeIds: blueprint.viewState.selectedEdgeIds.map((id) => `${prefix}-${id}`),
      inspectorTarget: blueprint.viewState.inspectorTarget === null
        ? null
        : { ...blueprint.viewState.inspectorTarget, id: `${prefix}-${blueprint.viewState.inspectorTarget.id}` }
    }
  };
}

function insertionOffset(manifest: RecipeManifest, target: EtherGraph): { x: number; y: number } {
  const blueprintItems = [...manifest.graph.nodes, ...manifest.graph.modules];
  const existingItems = [...target.nodes, ...target.modules];
  const minimumX = blueprintItems.length === 0 ? 0 : Math.min(...blueprintItems.map((item) => item.position.x));
  const minimumY = blueprintItems.length === 0 ? 0 : Math.min(...blueprintItems.map((item) => item.position.y));
  if (existingItems.length === 0) return { x: 80 - minimumX, y: 80 - minimumY };
  if (manifest.layout.direction === "vertical") {
    const bottom = Math.max(...existingItems.map((item) => item.position.y + item.size.height));
    const left = Math.min(...existingItems.map((item) => item.position.x));
    return { x: left - minimumX, y: bottom + manifest.layout.spacing.y - minimumY };
  }
  const right = Math.max(...existingItems.map((item) => item.position.x + item.size.width));
  const top = Math.min(...existingItems.map((item) => item.position.y));
  return { x: right + manifest.layout.spacing.x - minimumX, y: top - minimumY };
}

function moduleSubtree(
  manifest: RecipeManifest,
  rootGraphRef: string,
  parameters: readonly ResolvedRecipeParameter[],
  providers: readonly RecipeProviderResolution[],
  prefix: string
) {
  const byRef = new Map(manifest.moduleGraphs.map((graph) => [graph.graphRef, graph]));
  const collected: EtherGraph[] = [];
  const seen = new Set<string>();
  const visit = (graphRef: string) => {
    if (seen.has(graphRef)) return;
    const graph = byRef.get(graphRef);
    if (graph === undefined) throw new Error(`Recipe module graph ${graphRef} is missing.`);
    seen.add(graphRef);
    collected.push(remapGraph(graph, parameters, providers, prefix));
    graph.modules.forEach((module) => visit(module.graphId));
  };
  visit(rootGraphRef);
  return { rootGraphId: `${prefix}-${rootGraphRef}`, graphs: collected };
}

function operationsFor(
  manifest: RecipeManifest,
  target: EtherGraph,
  parameters: readonly ResolvedRecipeParameter[],
  providers: readonly RecipeProviderResolution[],
  prefix: string
): GraphOperation[] {
  const offset = insertionOffset(manifest, target);
  const nodes = configuredNodes(manifest.graph, parameters, providers, prefix, offset);
  return [
    ...nodes.map((node) => ({ type: "addNode" as const, graphId: target.id, node }) as GraphOperation),
    ...manifest.graph.modules.map((module) => ({
      type: "createModule" as const,
      graphId: target.id,
      module: remapModule(module, prefix, offset),
      subtree: moduleSubtree(manifest, module.graphId, parameters, providers, prefix)
    }) as GraphOperation),
    ...manifest.graph.edges.map((recipeEdge) => ({
      type: "addEdge" as const,
      graphId: target.id,
      edge: {
        ...recipeEdge,
        id: `${prefix}-${recipeEdge.id}`,
        from: remapEndpoint(recipeEdge.from, prefix),
        to: remapEndpoint(recipeEdge.to, prefix)
      }
    }) as GraphOperation),
    ...manifest.graph.groups.map((group) => ({
      type: "createGroup" as const,
      graphId: target.id,
      group: {
        ...group,
        id: `${prefix}-${group.id}`,
        nodeIds: group.nodeIds.map((id) => `${prefix}-${id}`),
        position: { x: group.position.x + offset.x, y: group.position.y + offset.y }
      }
    }) as GraphOperation)
  ];
}

function uniquePrefix(graphs: readonly EtherGraph[], requested: string): string {
  const used = new Set(graphs.flatMap((graph) => [
    graph.id, ...graph.nodes.map((node) => node.id), ...graph.edges.map((edge) => edge.id), ...graph.groups.map((group) => group.id), ...graph.modules.map((module) => module.id)
  ]));
  if (![...used].some((id) => id === requested || id.startsWith(`${requested}-`))) return requested;
  let ordinal = 2;
  while ([...used].some((id) => id === `${requested}-${ordinal}` || id.startsWith(`${requested}-${ordinal}-`))) ordinal += 1;
  return `${requested}-${ordinal}`;
}

export function instantiateRecipe(input: InstantiateRecipeInput): RecipeInstantiation {
  const structural = validateRecipe(input.manifest);
  if (!structural.valid) return { kind: "blocked", manifest: input.manifest, blockers: structural.diagnostics.map((item) => ({ code: "RECIPE_MANIFEST_INVALID", message: item.message })) };
  const target = input.graphs.find((graph) => graph.id === input.targetGraphId);
  if (target === undefined) return { kind: "blocked", manifest: input.manifest, blockers: [{ code: "TARGET_GRAPH_MISSING", message: `Target graph ${input.targetGraphId} does not exist.` }] };
  const parameters = resolveParameters(input.manifest, input.parameters ?? []);
  const providers = resolveProviders(input.manifest, input.providerCapabilities);
  const blockers = [...parameters.blockers, ...providers.blockers];
  if (blockers.length > 0) return { kind: "blocked", manifest: input.manifest, blockers };
  const prefix = uniquePrefix(input.graphs, input.idPrefix ?? input.manifest.id);
  const transaction = {
    id: input.transactionId ?? `recipe-${prefix}`,
    baseDocumentRevisionId: input.baseDocumentRevisionId,
    baseGraphRevisions: input.baseGraphRevisions,
    title: `Insert recipe: ${input.manifest.title}`,
    actor: "recipe" as const,
    operations: operationsFor(input.manifest, target, parameters.values, providers.resolutions, prefix),
    layoutPolicy: "preserve" as const
  };
  try {
    previewGraphTransaction({ graphs: input.graphs, transaction, capabilities: input.graphCapabilities });
  } catch (error) {
    return { kind: "blocked", manifest: input.manifest, blockers: [{ code: "TRANSACTION_INVALID", message: error instanceof Error ? error.message : "Recipe transaction could not be applied." }] };
  }
  const focusNode = input.manifest.layout.focusNodeRef === null
    ? null
    : input.manifest.graph.nodes.some((node) => node.id === input.manifest.layout.focusNodeRef)
    ? `${prefix}-${input.manifest.layout.focusNodeRef}`
    : null;
  return { kind: "ready", manifest: input.manifest, resolvedParameters: parameters.values, providers: providers.resolutions, transaction, focus: focusNode === null ? null : { graphId: target.id, nodeId: focusNode } };
}

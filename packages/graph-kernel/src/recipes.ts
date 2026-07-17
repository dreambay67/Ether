import {
  EtherGraphSchema,
  RecipeManifestSchema,
  type EtherGraph,
  type EtherNode,
  type RecipeManifest
} from "@ether/schema";
import type { GraphDiagnostic } from "./modules.js";
import { nodeRegistry } from "./registry.js";
import { validateFullGraphState } from "./validation.js";

export type RecipeSemanticDiagnostic = GraphDiagnostic;

export type RecipeManifestValidation =
  | { valid: true; manifest: RecipeManifest; graphs: EtherGraph[]; diagnostics: [] }
  | { valid: false; diagnostics: RecipeSemanticDiagnostic[] };

type RecipeParameter = RecipeManifest["parameters"][number];

function replaceConfigValue(
  config: unknown,
  path: readonly string[],
  value: unknown
): { found: true; value: unknown } | { found: false } {
  if (path.length === 0) return { found: true, value };
  const [segment, ...rest] = path;
  if (Array.isArray(config)) {
    if (!/^\d+$/.test(segment)) return { found: false };
    const index = Number(segment);
    if (index >= config.length) return { found: false };
    const replacement = replaceConfigValue(config[index], rest, value);
    if (!replacement.found) return replacement;
    const next = [...config];
    next[index] = replacement.value;
    return { found: true, value: next };
  }
  if (typeof config !== "object" || config === null || !Object.hasOwn(config, segment)) {
    return { found: false };
  }
  const replacement = replaceConfigValue(Reflect.get(config, segment), rest, value);
  if (!replacement.found) return replacement;
  const next = { ...config };
  Reflect.set(next, segment, replacement.value);
  return { found: true, value: next };
}

function representativeParameterValues(parameter: RecipeParameter): unknown[] {
  switch (parameter.type) {
    case "string": {
      const alternate = parameter.defaultValue.length === 0
        ? "x"
        : `${parameter.defaultValue.slice(0, -1)}${parameter.defaultValue.endsWith("x") ? "y" : "x"}`;
      return [...new Set([
        parameter.defaultValue,
        "x".repeat(parameter.minLength),
        alternate
      ])];
    }
    case "number":
      return [...new Set([
        parameter.minimum,
        parameter.maximum,
        parameter.defaultValue,
        Math.min(parameter.maximum, parameter.minimum + parameter.step)
      ])];
    case "boolean":
      return [parameter.defaultValue, !parameter.defaultValue];
    case "choice":
      return parameter.options.map((option) => option.value);
    case "artifact":
      return [[], ["artifact:semantic-probe"]];
  }
}

function validateParameterBindings(
  manifest: RecipeManifest,
  diagnostics: RecipeSemanticDiagnostic[]
): void {
  const blueprints = new Map(
    [manifest.graph, ...manifest.moduleGraphs].map((blueprint) => [blueprint.graphRef, blueprint])
  );
  const parameters = new Map(manifest.parameters.map((parameter) => [parameter.id, parameter]));
  for (const substitution of manifest.substitutions) {
    for (const binding of substitution.parameterBindings) {
      const parameter = parameters.get(binding.parameterId);
      const blueprint = blueprints.get(binding.target.graphRef);
      const node = blueprint?.nodes.find((candidate) => candidate.id === binding.target.nodeRef);
      const definition = node === undefined
        ? undefined
        : nodeRegistry.get(node.definitionId as EtherNode["definitionId"]);
      if (parameter === undefined || node === undefined || definition === undefined) continue;
      const compatible = representativeParameterValues(parameter).every((value) => {
        const replacement = replaceConfigValue(node.config, binding.target.configPath, value);
        return replacement.found && definition.configSchema.safeParse(replacement.value).success;
      });
      if (!compatible) {
        diagnostics.push({
          code: "RECIPE_PARAMETER_BINDING_INVALID",
          message: `Recipe parameter ${parameter.id} is incompatible with ${node.id}.${binding.target.configPath.join(".")}.`,
          graphId: blueprint?.graphRef,
          entityId: node.id
        });
      }
    }
  }
}

function validateAcceptanceOutputs(
  manifest: RecipeManifest,
  diagnostics: RecipeSemanticDiagnostic[]
): void {
  const blueprints = new Map(
    [manifest.graph, ...manifest.moduleGraphs].map((blueprint) => [blueprint.graphRef, blueprint])
  );
  const requirements = new Map(
    manifest.capabilityRequirements.map((requirement) => [requirement.id, requirement])
  );
  for (const step of manifest.acceptanceScenario.steps) {
    if (step.kind !== "success") continue;
    const requirement = requirements.get(step.requirementId);
    for (const output of step.outputs) {
      if (requirement !== undefined && !requirement.outputChannels.includes(output.channel)) {
        diagnostics.push({
          code: "RECIPE_SCENARIO_OUTPUT_CHANNEL_REQUIREMENT_INVALID",
          message: `Acceptance output ${output.fixtureId} requests ${output.channel}, which is not declared by requirement ${requirement.id}.`,
          graphId: output.graphRef,
          entityId: output.nodeRef
        });
      }
      const blueprint = blueprints.get(output.graphRef);
      const node = blueprint?.nodes.find((candidate) => candidate.id === output.nodeRef);
      if (node === undefined) {
        diagnostics.push({
          code: "RECIPE_SCENARIO_OUTPUT_NODE_MISSING",
          message: `Acceptance output ${output.fixtureId} references missing node ${output.nodeRef}.`,
          graphId: output.graphRef,
          entityId: output.nodeRef
        });
        continue;
      }
      const definition = nodeRegistry.get(node.definitionId as EtherNode["definitionId"]);
      if (
        definition !== undefined
        && !definition.contract.outputs.some((port) => port.channel === output.channel)
      ) {
        diagnostics.push({
          code: "RECIPE_SCENARIO_OUTPUT_CHANNEL_INVALID",
          message: `Acceptance output ${output.fixtureId} requests ${output.channel}, which ${definition.id} does not produce.`,
          graphId: output.graphRef,
          entityId: output.nodeRef
        });
      }
    }
  }
}

export function validateRecipeManifest(input: unknown): RecipeManifestValidation {
  const structural = RecipeManifestSchema.safeParse(input);
  if (!structural.success) {
    return {
      valid: false,
      diagnostics: [{ code: "RECIPE_STRUCTURE_INVALID", message: structural.error.message }]
    };
  }
  const manifest = structural.data;
  const diagnostics: RecipeSemanticDiagnostic[] = [];
  validateParameterBindings(manifest, diagnostics);
  validateAcceptanceOutputs(manifest, diagnostics);
  const blueprints = [manifest.graph, ...manifest.moduleGraphs];
  const graphs: EtherGraph[] = [];
  for (const blueprint of blueprints) {
    const nodes: EtherNode[] = [];
    for (const node of blueprint.nodes) {
      const definition = nodeRegistry.get(node.definitionId as EtherNode["definitionId"]);
      if (definition === undefined) {
        diagnostics.push({ code: "UNKNOWN_NODE_DEFINITION", message: `Unknown recipe node definition ${node.definitionId}.`, graphId: blueprint.graphRef, entityId: node.id });
        continue;
      }
      const config = definition.configSchema.safeParse(node.config);
      if (!config.success) {
        diagnostics.push({ code: "NODE_CONFIG_INVALID", message: `Node ${node.id} has invalid ${definition.id} config.`, graphId: blueprint.graphRef, entityId: node.id });
        continue;
      }
      nodes.push({ ...node, definitionId: definition.id, config: config.data } as EtherNode);
    }
    graphs.push(EtherGraphSchema.parse({
      id: blueprint.graphRef,
      title: blueprint.title,
      kind: blueprint.kind,
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
      nodes,
      edges: blueprint.edges,
      groups: blueprint.groups,
      modules: blueprint.modules,
      viewState: blueprint.viewState
    }));
  }
  if (diagnostics.length > 0) return { valid: false, diagnostics };
  diagnostics.push(...validateFullGraphState(graphs));
  return diagnostics.length === 0
    ? { valid: true, manifest, graphs, diagnostics: [] }
    : { valid: false, diagnostics };
}

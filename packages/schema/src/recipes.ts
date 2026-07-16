import { z } from "zod";

import { JsonValueSchema, SemanticVersionSchema } from "./document.js";
import {
  EtherEdgeSchema,
  EtherGroupSchema,
  EtherModuleSchema,
  WorkspaceViewStateSchema
} from "./graph.js";
import {
  EtherNodeSchema,
  NodeConfigSchemas,
  PayloadChannelSchema,
  canonicalNodeDefinitionContracts
} from "./nodes.js";
import { ProviderCapabilitySchema, ProviderOperationSchema } from "./outputs.js";

const idSchema = z.string().min(1);

const recipeParameterShape = {
  id: idSchema,
  title: z.string().min(1),
  description: z.string(),
  required: z.boolean()
};

export const RecipeStringParameterSchema = z
  .object({
    ...recipeParameterShape,
    type: z.literal("string"),
    defaultValue: z.string(),
    minLength: z.number().int().nonnegative(),
    maxLength: z.number().int().positive()
  })
  .strict();
export type RecipeStringParameter = z.infer<typeof RecipeStringParameterSchema>;

export const RecipeNumberParameterSchema = z
  .object({
    ...recipeParameterShape,
    type: z.literal("number"),
    defaultValue: z.number().finite(),
    minimum: z.number().finite(),
    maximum: z.number().finite(),
    step: z.number().positive().finite()
  })
  .strict();
export type RecipeNumberParameter = z.infer<typeof RecipeNumberParameterSchema>;

export const RecipeBooleanParameterSchema = z
  .object({
    ...recipeParameterShape,
    type: z.literal("boolean"),
    defaultValue: z.boolean()
  })
  .strict();
export type RecipeBooleanParameter = z.infer<typeof RecipeBooleanParameterSchema>;

export const RecipeChoiceOptionSchema = z
  .object({ id: idSchema, label: z.string().min(1), value: JsonValueSchema })
  .strict();
export type RecipeChoiceOption = z.infer<typeof RecipeChoiceOptionSchema>;

export const RecipeChoiceParameterSchema = z
  .object({
    ...recipeParameterShape,
    type: z.literal("choice"),
    options: z.array(RecipeChoiceOptionSchema).min(1),
    defaultOptionId: idSchema
  })
  .strict();
export type RecipeChoiceParameter = z.infer<typeof RecipeChoiceParameterSchema>;

export const RecipeArtifactParameterSchema = z
  .object({
    ...recipeParameterShape,
    type: z.literal("artifact"),
    channels: z.array(PayloadChannelSchema).min(1),
    minimumItems: z.number().int().nonnegative(),
    maximumItems: z.number().int().positive()
  })
  .strict();
export type RecipeArtifactParameter = z.infer<typeof RecipeArtifactParameterSchema>;

export const RecipeParameterSchema = z.discriminatedUnion("type", [
  RecipeStringParameterSchema,
  RecipeNumberParameterSchema,
  RecipeBooleanParameterSchema,
  RecipeChoiceParameterSchema,
  RecipeArtifactParameterSchema
]);
export type RecipeParameter = z.infer<typeof RecipeParameterSchema>;

export const RecipeParameterValueSchema = z
  .object({ parameterId: idSchema, value: JsonValueSchema })
  .strict();
export type RecipeParameterValue = z.infer<typeof RecipeParameterValueSchema>;

const GraphBlueprintObjectSchema = z
  .object({
    graphRef: idSchema,
    title: z.string(),
    kind: z.enum(["root", "module"]),
    nodes: z.array(EtherNodeSchema),
    edges: z.array(EtherEdgeSchema),
    groups: z.array(EtherGroupSchema),
    modules: z.array(EtherModuleSchema),
    viewState: WorkspaceViewStateSchema
  })
  .strict();

type GraphBlueprintObject = z.infer<typeof GraphBlueprintObjectSchema>;

function validateGraphBlueprint(blueprint: GraphBlueprintObject, context: z.RefinementCtx): void {
  const nodeIds = new Set(blueprint.nodes.map((node) => node.id));
  const edgeIds = new Set(blueprint.edges.map((edge) => edge.id));
  const groupIds = new Set(blueprint.groups.map((group) => group.id));
  const moduleIds = new Set(blueprint.modules.map((module) => module.id));

  if (nodeIds.size !== blueprint.nodes.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["nodes"],
      message: "Blueprint node IDs must be unique"
    });
  }
  if (edgeIds.size !== blueprint.edges.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["edges"],
      message: "Blueprint edge IDs must be unique"
    });
  }
  if (groupIds.size !== blueprint.groups.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["groups"],
      message: "Blueprint group IDs must be unique"
    });
  }
  if (moduleIds.size !== blueprint.modules.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["modules"],
      message: "Blueprint module IDs must be unique"
    });
  }

  for (const [index, edge] of blueprint.edges.entries()) {
    if (!nodeIds.has(edge.from.nodeId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["edges", index, "from", "nodeId"],
        message: "Blueprint edge source references an unknown node"
      });
    }
    if (!nodeIds.has(edge.to.nodeId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["edges", index, "to", "nodeId"],
        message: "Blueprint edge target references an unknown node"
      });
    }
  }

  for (const [groupIndex, group] of blueprint.groups.entries()) {
    if (new Set(group.nodeIds).size !== group.nodeIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groups", groupIndex, "nodeIds"],
        message: "Blueprint group node IDs must be unique"
      });
    }
    for (const [nodeIndex, nodeId] of group.nodeIds.entries()) {
      if (!nodeIds.has(nodeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groups", groupIndex, "nodeIds", nodeIndex],
          message: "Blueprint group references an unknown node"
        });
      }
    }
  }

  for (const [moduleIndex, module] of blueprint.modules.entries()) {
    if (module.graphId === blueprint.graphRef) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modules", moduleIndex, "graphId"],
        message: "A parent blueprint module must reference a distinct internal graph"
      });
    }

    const ports = [...module.interface.inputs, ...module.interface.outputs];
    const portIds = new Set(ports.map((port) => port.id));
    if (portIds.size !== ports.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modules", moduleIndex, "interface"],
        message: "Module interface port IDs must be unique"
      });
    }
    const parameterIds = new Set(module.interface.parameters.map((parameter) => parameter.id));
    if (parameterIds.size !== module.interface.parameters.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modules", moduleIndex, "interface", "parameters"],
        message: "Module interface parameter IDs must be unique"
      });
    }
  }

  for (const [index, nodeId] of blueprint.viewState.selectedNodeIds.entries()) {
    if (!nodeIds.has(nodeId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["viewState", "selectedNodeIds", index],
        message: "View state references an unknown blueprint node"
      });
    }
  }
  for (const [index, edgeId] of blueprint.viewState.selectedEdgeIds.entries()) {
    if (!edgeIds.has(edgeId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["viewState", "selectedEdgeIds", index],
        message: "View state references an unknown blueprint edge"
      });
    }
  }

  const inspectorTarget = blueprint.viewState.inspectorTarget;
  const inspectorTargetExists =
    inspectorTarget === null ||
    (inspectorTarget.kind === "node" && nodeIds.has(inspectorTarget.id)) ||
    (inspectorTarget.kind === "edge" && edgeIds.has(inspectorTarget.id)) ||
    (inspectorTarget.kind === "group" && groupIds.has(inspectorTarget.id)) ||
    (inspectorTarget.kind === "module" && moduleIds.has(inspectorTarget.id));
  if (!inspectorTargetExists) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["viewState", "inspectorTarget"],
      message: "Inspector target does not exist in the blueprint"
    });
  }
}

export const GraphBlueprintSchema = GraphBlueprintObjectSchema.superRefine(
  validateGraphBlueprint
);
export type GraphBlueprint = z.infer<typeof GraphBlueprintSchema>;

export const CapabilityRequirementSchema = z
  .object({
    id: idSchema,
    operation: ProviderOperationSchema,
    inputChannels: z.array(PayloadChannelSchema),
    outputChannels: z.array(PayloadChannelSchema),
    minimumReferences: z.number().int().nonnegative(),
    minimumOutputs: z.number().int().positive(),
    supportsCancellation: z.boolean(),
    supportsSeed: z.boolean()
  })
  .strict();
export type CapabilityRequirement = z.infer<typeof CapabilityRequirementSchema>;

export const RecipeParameterBindingSchema = z
  .object({
    parameterId: idSchema,
    target: z
      .object({
        graphRef: idSchema,
        nodeRef: idSchema,
        configPath: z.array(idSchema).min(1)
      })
      .strict()
  })
  .strict();
export type RecipeParameterBinding = z.infer<typeof RecipeParameterBindingSchema>;

export const ProviderSubstitutionSchema = z
  .object({
    requirementId: idSchema,
    providerId: idSchema,
    profileId: idSchema,
    priority: z.number().int().nonnegative(),
    capability: ProviderCapabilitySchema,
    parameterBindings: z.array(RecipeParameterBindingSchema)
  })
  .strict();
export type ProviderSubstitution = z.infer<typeof ProviderSubstitutionSchema>;

export const RecipeLayoutPolicySchema = z
  .object({
    policy: z.enum(["preserve", "tidy-affected", "layout-branch"]),
    direction: z.enum(["horizontal", "vertical"]),
    spacing: z
      .object({ x: z.number().nonnegative().finite(), y: z.number().nonnegative().finite() })
      .strict(),
    focusNodeRef: idSchema.nullable()
  })
  .strict();
export type RecipeLayoutPolicy = z.infer<typeof RecipeLayoutPolicySchema>;

export const ReviewCheckpointSchema = z
  .object({
    id: idSchema,
    graphRef: idSchema,
    nodeRef: idSchema,
    title: z.string().min(1),
    policy: z.enum(["approve-one", "approve-any", "manual"]),
    required: z.boolean(),
    minimumApprovals: z.number().int().nonnegative()
  })
  .strict();
export type ReviewCheckpoint = z.infer<typeof ReviewCheckpointSchema>;

export const ExpectedWorkRangeSchema = z
  .object({
    minimumCalls: z.number().int().nonnegative(),
    maximumCalls: z.number().int().nonnegative(),
    minimumWorkItems: z.number().int().nonnegative(),
    maximumWorkItems: z.number().int().nonnegative()
  })
  .strict()
  .superRefine((range, context) => {
    if (range.minimumCalls > range.maximumCalls) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maximumCalls"],
        message: "Maximum calls must be at least minimum calls"
      });
    }
    if (range.minimumWorkItems > range.maximumWorkItems) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maximumWorkItems"],
        message: "Maximum work items must be at least minimum work items"
      });
    }
  });
export type ExpectedWorkRange = z.infer<typeof ExpectedWorkRangeSchema>;

export const FakeScenarioOutputSchema = z
  .object({
    graphRef: idSchema,
    nodeRef: idSchema,
    channel: PayloadChannelSchema,
    fixtureId: idSchema,
    mediaType: z.string().min(1)
  })
  .strict();
export type FakeScenarioOutput = z.infer<typeof FakeScenarioOutputSchema>;

export const FakeProviderScenarioStepSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("success"),
      requirementId: idSchema,
      latencyMs: z.number().int().nonnegative(),
      outputs: z.array(FakeScenarioOutputSchema)
    })
    .strict(),
  z
    .object({
      kind: z.literal("failure"),
      requirementId: idSchema,
      latencyMs: z.number().int().nonnegative(),
      error: z
        .object({ code: idSchema, message: z.string(), retryable: z.boolean() })
        .strict()
    })
    .strict()
]);
export type FakeProviderScenarioStep = z.infer<typeof FakeProviderScenarioStepSchema>;

export const FakeProviderScenarioSchema = z
  .object({ id: idSchema, steps: z.array(FakeProviderScenarioStepSchema).min(1) })
  .strict();
export type FakeProviderScenario = z.infer<typeof FakeProviderScenarioSchema>;

type ConfigPathResolution =
  | { found: true; value: unknown }
  | { found: false };

function resolveConfigPath(config: unknown, path: readonly string[]): ConfigPathResolution {
  let current = config;
  for (const segment of path) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) {
        return { found: false };
      }
      const index = Number(segment);
      if (index >= current.length) {
        return { found: false };
      }
      current = current[index];
      continue;
    }
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, segment)) {
      return { found: false };
    }
    current = Reflect.get(current, segment);
  }
  return { found: true, value: current };
}

function replaceConfigPathValue(
  config: unknown,
  path: readonly string[],
  value: unknown
): ConfigPathResolution {
  if (path.length === 0) {
    return { found: true, value };
  }
  const [segment, ...rest] = path;
  if (Array.isArray(config)) {
    if (!/^\d+$/.test(segment)) {
      return { found: false };
    }
    const index = Number(segment);
    if (index >= config.length) {
      return { found: false };
    }
    const replacement = replaceConfigPathValue(config[index], rest, value);
    if (!replacement.found) {
      return replacement;
    }
    const next = [...config];
    next[index] = replacement.value;
    return { found: true, value: next };
  }
  if (typeof config !== "object" || config === null || !Object.hasOwn(config, segment)) {
    return { found: false };
  }
  const replacement = replaceConfigPathValue(Reflect.get(config, segment), rest, value);
  if (!replacement.found) {
    return replacement;
  }
  const next = { ...config };
  Reflect.set(next, segment, replacement.value);
  return { found: true, value: next };
}

function parameterFitsTarget(
  parameter: z.infer<typeof RecipeParameterSchema>,
  node: z.infer<typeof EtherNodeSchema>,
  configPath: readonly string[]
): boolean {
  const values =
    parameter.type === "choice"
      ? parameter.options.map((option) => option.value)
      : parameter.type === "artifact"
        ? [[]]
        : [parameter.defaultValue];
  return values.every((value) => {
    const replacement = replaceConfigPathValue(node.config, configPath, value);
    return (
      replacement.found &&
      NodeConfigSchemas[node.definitionId].safeParse(replacement.value).success
    );
  });
}

function validateRecipeManifest(
  manifest: z.infer<typeof RecipeManifestObjectSchema>,
  context: z.RefinementCtx
): void {
  const parameterIds = new Set(manifest.parameters.map((parameter) => parameter.id));
  const requirementIds = new Set(
    manifest.capabilityRequirements.map((requirement) => requirement.id)
  );
  const blueprints = [manifest.graph, ...manifest.moduleGraphs];
  const blueprintByRef = new Map(blueprints.map((blueprint) => [blueprint.graphRef, blueprint]));
  const rootNodeIds = new Set(manifest.graph.nodes.map((node) => node.id));

  if (manifest.graph.kind !== "root") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["graph", "kind"],
      message: "A recipe root graph must have kind root"
    });
  }
  for (const [index, blueprint] of manifest.moduleGraphs.entries()) {
    if (blueprint.kind !== "module") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["moduleGraphs", index, "kind"],
        message: "Recipe module blueprints must have kind module"
      });
    }
  }
  if (blueprintByRef.size !== blueprints.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["moduleGraphs"],
      message: "Recipe graph references must be unique"
    });
  }
  if (parameterIds.size !== manifest.parameters.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["parameters"],
      message: "Recipe parameter IDs must be unique"
    });
  }
  if (requirementIds.size !== manifest.capabilityRequirements.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["capabilityRequirements"],
      message: "Capability requirement IDs must be unique"
    });
  }
  if (manifest.layout.focusNodeRef && !rootNodeIds.has(manifest.layout.focusNodeRef)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["layout", "focusNodeRef"],
      message: "Layout focus references an unknown root blueprint node"
    });
  }

  for (const [index, parameter] of manifest.parameters.entries()) {
    if (
      parameter.type === "string" &&
      (parameter.minLength > parameter.maxLength ||
        parameter.defaultValue.length < parameter.minLength ||
        parameter.defaultValue.length > parameter.maxLength)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parameters", index, "defaultValue"],
        message: "String default must satisfy its declared length range"
      });
    }
    if (
      parameter.type === "number" &&
      (parameter.minimum > parameter.maximum ||
        parameter.defaultValue < parameter.minimum ||
        parameter.defaultValue > parameter.maximum)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parameters", index, "defaultValue"],
        message: "Number default must satisfy its declared range"
      });
    }
    if (parameter.type === "choice") {
      const optionIds = new Set(parameter.options.map((option) => option.id));
      if (optionIds.size !== parameter.options.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parameters", index, "options"],
          message: "Choice option IDs must be unique"
        });
      }
      if (!optionIds.has(parameter.defaultOptionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parameters", index, "defaultOptionId"],
          message: "Choice default must reference a declared option"
        });
      }
    }
    if (parameter.type === "artifact" && parameter.minimumItems > parameter.maximumItems) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parameters", index, "maximumItems"],
        message: "Maximum artifact count must be at least the minimum"
      });
    }
  }

  for (const [blueprintIndex, blueprint] of blueprints.entries()) {
    for (const [moduleIndex, module] of blueprint.modules.entries()) {
      const internalGraph = blueprintByRef.get(module.graphId);
      const modulePath = [
        blueprintIndex === 0 ? "graph" : "moduleGraphs",
        ...(blueprintIndex === 0 ? [] : [blueprintIndex - 1]),
        "modules",
        moduleIndex
      ];
      if (!internalGraph || internalGraph.kind !== "module") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...modulePath, "graphId"],
          message: "Module graphId must resolve to a module-kind blueprint"
        });
        continue;
      }
      const internalNodes = new Map(internalGraph.nodes.map((node) => [node.id, node]));
      for (const [direction, ports] of [
        ["inputs", module.interface.inputs],
        ["outputs", module.interface.outputs]
      ] as const) {
        for (const [portIndex, port] of ports.entries()) {
          const node = internalNodes.get(port.internalNodeId);
          if (!node) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...modulePath, "interface", direction, portIndex, "internalNodeId"],
              message: "Module interface port references an unknown internal node"
            });
            continue;
          }
          const channels: readonly z.infer<typeof PayloadChannelSchema>[] =
            canonicalNodeDefinitionContracts[node.definitionId][direction];
          if (!channels.includes(port.internalChannel)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [...modulePath, "interface", direction, portIndex, "internalChannel"],
              message: `Internal node does not expose ${port.internalChannel} on ${direction}`
            });
          }
        }
      }
      for (const [parameterIndex, parameter] of module.interface.parameters.entries()) {
        const node = internalNodes.get(parameter.nodeId);
        if (!node) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...modulePath, "interface", "parameters", parameterIndex, "nodeId"],
            message: "Module parameter references an unknown internal node"
          });
        } else if (!resolveConfigPath(node.config, parameter.configPath).found) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...modulePath, "interface", "parameters", parameterIndex, "configPath"],
            message: "Module parameter config path does not exist"
          });
        }
      }
    }
  }

  for (const [index, substitution] of manifest.substitutions.entries()) {
    const requirement = manifest.capabilityRequirements.find(
      (candidate) => candidate.id === substitution.requirementId
    );
    if (!requirement) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["substitutions", index, "requirementId"],
        message: "Substitution references an unknown capability requirement"
      });
    } else {
      const capability = substitution.capability;
      const incompatible =
        capability.providerId !== substitution.providerId ||
        capability.profileId !== substitution.profileId ||
        capability.operation !== requirement.operation ||
        requirement.inputChannels.some((channel) => !capability.inputChannels.includes(channel)) ||
        requirement.outputChannels.some((channel) => !capability.outputChannels.includes(channel)) ||
        capability.maxReferences < requirement.minimumReferences ||
        capability.maxOutputsPerCall < requirement.minimumOutputs ||
        (requirement.supportsCancellation && !capability.supportsCancellation) ||
        (requirement.supportsSeed && !capability.supportsSeed);
      if (incompatible) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["substitutions", index, "capability"],
          message: "Provider capability does not satisfy its recipe requirement"
        });
      }
    }

    const targetKeys = new Set<string>();
    for (const [bindingIndex, binding] of substitution.parameterBindings.entries()) {
      if (!parameterIds.has(binding.parameterId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["substitutions", index, "parameterBindings", bindingIndex, "parameterId"],
          message: "Binding references an unknown recipe parameter"
        });
      }
      const blueprint = blueprintByRef.get(binding.target.graphRef);
      const node = blueprint?.nodes.find((candidate) => candidate.id === binding.target.nodeRef);
      if (!node) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["substitutions", index, "parameterBindings", bindingIndex, "target"],
          message: "Binding target must resolve to a blueprint node"
        });
      } else {
        const resolution = resolveConfigPath(node.config, binding.target.configPath);
        if (!resolution.found) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["substitutions", index, "parameterBindings", bindingIndex, "target", "configPath"],
            message: "Binding target config path does not exist"
          });
        } else {
          const parameter = manifest.parameters.find(
            (candidate) => candidate.id === binding.parameterId
          );
          if (parameter && !parameterFitsTarget(parameter, node, binding.target.configPath)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["substitutions", index, "parameterBindings", bindingIndex, "target"],
              message: "Recipe parameter values are incompatible with the target config field"
            });
          }
        }
      }
      const targetKey = `${binding.target.graphRef}:${binding.target.nodeRef}:${binding.target.configPath.join(".")}`;
      if (targetKeys.has(targetKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["substitutions", index, "parameterBindings", bindingIndex, "target"],
          message: "Each substitution target may be bound only once"
        });
      }
      targetKeys.add(targetKey);
    }
  }

  const checkpointIds = new Set(manifest.checkpoints.map((checkpoint) => checkpoint.id));
  if (checkpointIds.size !== manifest.checkpoints.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["checkpoints"],
      message: "Review checkpoint IDs must be unique"
    });
  }
  for (const [index, checkpoint] of manifest.checkpoints.entries()) {
    const blueprint = blueprintByRef.get(checkpoint.graphRef);
    if (!blueprint?.nodes.some((node) => node.id === checkpoint.nodeRef)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkpoints", index, "nodeRef"],
        message: "Checkpoint must resolve to a blueprint node"
      });
    }
  }

  for (const [index, step] of manifest.acceptanceScenario.steps.entries()) {
    const requirement = manifest.capabilityRequirements.find(
      (candidate) => candidate.id === step.requirementId
    );
    if (!requirement) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptanceScenario", "steps", index, "requirementId"],
        message: "Scenario step references an unknown capability requirement"
      });
      continue;
    }
    if (step.kind === "success") {
      if (step.outputs.length < requirement.minimumOutputs) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["acceptanceScenario", "steps", index, "outputs"],
          message: "Scenario success outputs must satisfy the capability minimum"
        });
      }
      for (const [outputIndex, output] of step.outputs.entries()) {
        const blueprint = blueprintByRef.get(output.graphRef);
        const node = blueprint?.nodes.find((candidate) => candidate.id === output.nodeRef);
        if (!node) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["acceptanceScenario", "steps", index, "outputs", outputIndex, "nodeRef"],
            message: "Scenario output must resolve to a blueprint node"
          });
          continue;
        }
        if (
          !requirement.outputChannels.includes(output.channel) ||
          !(canonicalNodeDefinitionContracts[node.definitionId].outputs as readonly z.infer<
            typeof PayloadChannelSchema
          >[]).includes(output.channel)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["acceptanceScenario", "steps", index, "outputs", outputIndex, "channel"],
            message: "Scenario output channel must be produced by both requirement and node"
          });
        }
      }
    }
  }
}

const RecipeManifestObjectSchema = z
  .object({
    id: idSchema,
    version: SemanticVersionSchema,
    title: z.string().min(1),
    description: z.string(),
    parameters: z.array(RecipeParameterSchema),
    graph: GraphBlueprintSchema,
    moduleGraphs: z.array(GraphBlueprintSchema),
    capabilityRequirements: z.array(CapabilityRequirementSchema),
    substitutions: z.array(ProviderSubstitutionSchema),
    layout: RecipeLayoutPolicySchema,
    checkpoints: z.array(ReviewCheckpointSchema),
    expectedWork: ExpectedWorkRangeSchema,
    acceptanceScenario: FakeProviderScenarioSchema
  })
  .strict();

export const RecipeManifestSchema = RecipeManifestObjectSchema.superRefine(validateRecipeManifest);
export type RecipeManifest = z.infer<typeof RecipeManifestSchema>;

export function parseRecipeManifest(input: unknown): RecipeManifest {
  return RecipeManifestSchema.parse(input);
}

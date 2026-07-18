import { getNodeDefinition, planTraversal, validateConnection } from "@ether/graph-kernel";
import {
  ExecutionPlanSchema,
  type EtherGraph,
  type ExecutionPlan,
  type ExecutionScope,
  type JsonObject,
  type ProviderCapability
} from "@ether/schema";

import { hashPlan } from "./hashPlan.js";

export interface CompilePlanInput {
  id: string;
  documentId: string;
  documentRevisionId: string;
  graph: EtherGraph;
  graphRevisionId: string;
  scope: ExecutionScope;
  capability: ProviderCapability;
  createdAt: string;
}

export function compilePlan(input: CompilePlanInput): ExecutionPlan {
  const traversal = planTraversal([input.graph], input.graph.id);
  const scopedIds = resolveScope(input.scope, traversal.nodeIds);
  const targets = input.graph.nodes.filter(
    (node) => scopedIds.has(node.id) && getNodeDefinition(node.definitionId).executor === "image-provider"
  );
  const steps = targets.map((target) => {
    if (target.config.kind !== "generation.image") throw new Error("Unsupported image provider node.");
    const incoming = input.graph.edges
      .filter((edge) => {
        if (!edge.enabled || edge.to.kind !== "node" || edge.from.kind !== "node") return false;
        return edge.to.nodeId === target.id;
      })
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    const promptSections = incoming.map((edge) => {
      if (edge.from.kind !== "node" || edge.to.kind !== "node") throw new Error("Invalid direct lane.");
      const sourceNodeId = edge.from.nodeId;
      const source = input.graph.nodes.find((node) => node.id === sourceNodeId);
      if (source?.config.kind !== "prompt.text") throw new Error("Task 8 requires Prompt text inputs.");
      const decision = validateConnection({
        sourceDefinitionId: source.definitionId,
        sourceChannel: edge.from.channel,
        targetDefinitionId: target.definitionId,
        targetChannel: edge.to.channel,
        role: edge.role,
        adapter: edge.adapter,
        capabilities: []
      });
      if (!decision.allowed) throw new Error(`${decision.code}: ${decision.message}`);
      return `${titleCase(edge.role)}: ${source.config.body}`;
    });
    const stepId = `step-${target.id}`;
    const workItemId = `${stepId}:work-0`;
    return {
      id: stepId,
      nodeId: target.id,
      executor: "image-provider" as const,
      dependencyStepIds: [],
      inputPayloadIds: [],
      workItemIds: [workItemId],
      compiledPrompt: promptSections.join("\n\n"),
      compiledContext: {
        promptSections,
        sourceEdgeIds: incoming.map((edge) => edge.id)
      },
      parameters: {
        aspectRatio: target.config.aspectRatio,
        resolution: target.config.resolution,
        outputCount: target.config.outputCount
      } as JsonObject,
      selectors: incoming.map((edge) => edge.selector as JsonObject),
      provider: {
        providerId: target.config.providerId,
        profileId: target.config.profileId,
        modelId: "deterministic-png-v1",
        settings: target.config as JsonObject,
        capabilitySnapshot: input.capability
      }
    };
  });
  const workItems = steps.flatMap((step) =>
    step.workItemIds.map((id, ordinal) => ({
      id,
      stepId: step.id,
      ordinal,
      inputs: [],
      parameters: Object.entries(step.parameters).map(([name, value]) => ({ name, value }))
    }))
  );
  const withoutHash: Omit<ExecutionPlan, "contentHash"> = {
    id: input.id,
    capsuleVersion: 1,
    hashVersion: "sha256-v1",
    documentId: input.documentId,
    documentRevisionId: input.documentRevisionId,
    graphId: input.graph.id,
    graphRevisionId: input.graphRevisionId,
    scope: input.scope,
    steps,
    workItems,
    providerCapabilitySnapshots: [input.capability],
    estimatedCalls: workItems.length,
    warnings: [],
    createdAt: input.createdAt
  };
  return ExecutionPlanSchema.parse({ ...withoutHash, contentHash: hashPlan(withoutHash) });
}

function resolveScope(scope: ExecutionScope, traversal: readonly string[]): Set<string> {
  if (scope.kind === "graph") return new Set(traversal);
  if (scope.kind === "node") return new Set([scope.nodeId]);
  if (scope.kind === "selected") return new Set(scope.nodeIds);
  if (scope.kind === "branch") {
    const index = traversal.indexOf(scope.rootNodeId);
    return new Set(index < 0 ? [] : traversal.slice(index));
  }
  return new Set(traversal);
}

function titleCase(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

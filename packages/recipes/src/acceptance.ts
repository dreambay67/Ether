import type { FakeScenarioOutput, PayloadChannel, RecipeManifest } from "@ether/schema";
import { validateRecipe } from "./validateRecipe.js";

export type RecipeAcceptanceArtifact = FakeScenarioOutput & {
  id: string;
  reviewed: boolean;
  checkpointIds: readonly string[];
  collectionIds: readonly string[];
  exportNodeIds: readonly string[];
};

export type RecipeAcceptanceScenarioOptions = {
  /** True explicitly approves every declared checkpoint; an ID list approves only those checkpoints. */
  approveCheckpoints?: boolean | readonly string[];
  /** Lets tests model a broken route without making the manifest structurally invalid. */
  disabledEdgeIds?: readonly string[];
  /** Selects the deterministic outcome for each review.filter node; matched is the default. */
  filterOutcomes?: Readonly<Record<string, "matched" | "unmatched">>;
};

export type RecipeAcceptanceScenarioResult = {
  recipeId: string;
  passed: boolean;
  artifacts: readonly RecipeAcceptanceArtifact[];
  checkpointsReached: readonly string[];
  collectionIds: readonly string[];
  exportNodeIds: readonly string[];
  completedNodeIds: readonly string[];
  skippedNodeIds: readonly string[];
  blockedNodeIds: readonly string[];
  failedRequirementIds: readonly string[];
};

type MutableArtifact = FakeScenarioOutput & {
  id: string;
  reviewed: boolean;
  checkpointIds: Set<string>;
  collectionIds: Set<string>;
  exportNodeIds: Set<string>;
};

const SOURCE_DEFINITIONS = new Set(["prompt.text", "reference.set", "flow.variables", "flow.batch"]);

/**
 * Executes the declared fake scenario as a deterministic graph walk. Providers
 * are the only artificial stop points; after their declared outputs resume the
 * route, local nodes and explicitly-approved review gates run normally.
 */
export function runFakeRecipeAcceptanceScenario(
  manifest: RecipeManifest,
  options: RecipeAcceptanceScenarioOptions = { approveCheckpoints: true }
): RecipeAcceptanceScenarioResult {
  const validation = validateRecipe(manifest);
  if (!validation.valid) throw new Error(`Cannot run an invalid recipe: ${validation.diagnostics.map((item) => item.message).join(" ")}`);

  const disabled = new Set(options.disabledEdgeIds ?? []);
  const edges = manifest.graph.edges.filter((edge) => edge.enabled && !disabled.has(edge.id) && edge.from.kind === "node" && edge.to.kind === "node");
  const incoming = new Map<string, typeof edges>();
  const outgoing = new Map<string, typeof edges>();
  for (const edge of edges) {
    incoming.set(edge.to.kind === "node" ? edge.to.nodeId : "", [...(incoming.get(edge.to.kind === "node" ? edge.to.nodeId : "") ?? []), edge]);
    outgoing.set(edge.from.kind === "node" ? edge.from.nodeId : "", [...(outgoing.get(edge.from.kind === "node" ? edge.from.nodeId : "") ?? []), edge]);
  }

  const providers = new Map(manifest.capabilityRequirements.map((requirement) => [requirement.id, requirement]));
  const nodes = new Map(manifest.graph.nodes.map((node) => [node.id, node]));
  const steps = new Map<string, typeof manifest.acceptanceScenario.steps>();
  for (const step of manifest.acceptanceScenario.steps) steps.set(step.requirementId, [...(steps.get(step.requirementId) ?? []), step]);
  const checkpoints = new Map(manifest.checkpoints.map((checkpoint) => [checkpoint.nodeRef, checkpoint]));
  const checkpointApproval = options.approveCheckpoints ?? true;
  const approvals = checkpointApproval === true
    ? new Set(manifest.checkpoints.map((checkpoint) => checkpoint.id))
    : new Set(checkpointApproval === false ? [] : checkpointApproval);

  const completed = new Set<string>();
  const skipped = new Set<string>();
  const routedEdgeIds = new Set<string>();
  const producedChannels = new Map<string, Set<PayloadChannel>>();
  const artifactIndexes = new Map<string, Set<number>>();
  const artifacts: MutableArtifact[] = [];
  const checkpointsReached = new Set<string>();
  const collectionIds = new Set<string>();
  const exportNodeIds = new Set<string>();
  const failedRequirementIds = new Set<string>();

  const complete = (nodeId: string, channels: Iterable<PayloadChannel>, indexes: Iterable<number>) => {
    completed.add(nodeId);
    producedChannels.set(nodeId, new Set(channels));
    artifactIndexes.set(nodeId, new Set(indexes));
  };
  const skipBranch = (nodeId: string) => {
    if (completed.has(nodeId) || skipped.has(nodeId)) return;
    skipped.add(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (edge.to.kind !== "node") continue;
      const targetInputs = incoming.get(edge.to.nodeId) ?? [];
      if (targetInputs.every((input) => input.from.kind === "node" && skipped.has(input.from.nodeId))) {
        skipBranch(edge.to.nodeId);
      }
    }
  };

  for (const node of manifest.graph.nodes) {
    if (!SOURCE_DEFINITIONS.has(node.definitionId) || (incoming.get(node.id)?.length ?? 0) > 0) continue;
    complete(node.id, (outgoing.get(node.id) ?? []).map((edge) => edge.from.channel), []);
  }

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const node of manifest.graph.nodes) {
      if (completed.has(node.id) || skipped.has(node.id)) continue;
      const inputs = incoming.get(node.id) ?? [];
      if (inputs.length === 0) continue;
      const ready = inputs.every((edge) => edge.from.kind === "node"
        && completed.has(edge.from.nodeId)
        && producedChannels.get(edge.from.nodeId)?.has(edge.from.channel)
        && (nodes.get(edge.from.nodeId)?.definitionId !== "review.filter" || routedEdgeIds.has(edge.id)));
      if (!ready) continue;

      const upstreamArtifacts = new Set(inputs.flatMap((edge) => edge.from.kind === "node" ? [...(artifactIndexes.get(edge.from.nodeId) ?? [])] : []));
      const requirement = providers.get(node.id);
      if (requirement !== undefined) {
        const declaredSteps = steps.get(requirement.id) ?? [];
        if (declaredSteps.length === 0 || declaredSteps.some((step) => step.kind === "failure")) {
          failedRequirementIds.add(requirement.id);
          continue;
        }
        const indexes = new Set(upstreamArtifacts);
        const channels = new Set<PayloadChannel>();
        for (const step of declaredSteps) {
          if (step.kind !== "success") continue;
          for (const output of step.outputs) {
            const index = artifacts.length;
            artifacts.push({ ...output, id: `${manifest.id}:${output.fixtureId}:${index + 1}`, reviewed: false, checkpointIds: new Set(), collectionIds: new Set(), exportNodeIds: new Set() });
            indexes.add(index);
            channels.add(output.channel);
          }
        }
        complete(node.id, channels, indexes);
        progressed = true;
        continue;
      }

      const checkpoint = checkpoints.get(node.id);
      if (checkpoint !== undefined) {
        if (checkpoint.required && !approvals.has(checkpoint.id)) continue;
        checkpointsReached.add(checkpoint.id);
        upstreamArtifacts.forEach((index) => {
          artifacts[index]!.reviewed = true;
          artifacts[index]!.checkpointIds.add(checkpoint.id);
        });
      }

      if (node.definitionId === "output.collection" && typeof node.config.collectionId === "string") {
        collectionIds.add(node.config.collectionId);
        upstreamArtifacts.forEach((index) => artifacts[index]!.collectionIds.add(node.config.collectionId as string));
      }
      if (node.definitionId === "output.export") {
        exportNodeIds.add(node.id);
        upstreamArtifacts.forEach((index) => artifacts[index]!.exportNodeIds.add(node.id));
      }
      if (node.definitionId === "review.filter") {
        const outcome = options.filterOutcomes?.[node.id] ?? "matched";
        for (const edge of outgoing.get(node.id) ?? []) {
          const edgeOutcome = edge.role === "negative" ? "unmatched" : "matched";
          if (edgeOutcome === outcome) routedEdgeIds.add(edge.id);
          else if (edge.to.kind === "node") skipBranch(edge.to.nodeId);
        }
      }
      complete(node.id, (outgoing.get(node.id) ?? []).map((edge) => edge.from.channel), upstreamArtifacts);
      progressed = true;
    }
  }

  const blockedNodeIds = manifest.graph.nodes.map((node) => node.id).filter((id) => !completed.has(id) && !skipped.has(id)).sort();
  const requiredCheckpointIds = manifest.checkpoints.filter((checkpoint) => checkpoint.required).map((checkpoint) => checkpoint.id);
  const passed = blockedNodeIds.length === 0
    && failedRequirementIds.size === 0
    && requiredCheckpointIds.every((id) => checkpointsReached.has(id));

  return {
    recipeId: manifest.id,
    passed,
    artifacts: artifacts.map((artifact) => ({
      ...artifact,
      checkpointIds: [...artifact.checkpointIds].sort(),
      collectionIds: [...artifact.collectionIds].sort(),
      exportNodeIds: [...artifact.exportNodeIds].sort()
    })),
    checkpointsReached: [...checkpointsReached].sort(),
    collectionIds: [...collectionIds].sort(),
    exportNodeIds: [...exportNodeIds].sort(),
    completedNodeIds: [...completed].sort(),
    skippedNodeIds: [...skipped].sort(),
    blockedNodeIds,
    failedRequirementIds: [...failedRequirementIds].sort()
  };
}

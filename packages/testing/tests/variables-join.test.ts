import { describe, expect, it } from "vitest";
import {
  interpolateVariables,
  renderVariableValue,
  variableMap,
  variableValueType
} from "../../graph-kernel/src/variables.js";
import { JoinExecutor } from "../../execution/src/executors/join.js";
import { ReviewExecutor } from "../../execution/src/executors/review.js";
import { compilePlan } from "../../execution/src/plan/compilePlan.js";
import { documentStorePersistence, type DocumentStoreLike } from "../../execution/src/scheduler/persistence.js";
import type {
  EtherGraph,
  PayloadEnvelope,
  ProviderCapability,
  PlanStep
} from "@ether/schema";

describe("typed variables", () => {
  it("renders JSON values deterministically and interpolates explicit tokens", () => {
    const variables = [
      { name: "name", value: "Ether" as const },
      { name: "count", value: 3 },
      { name: "enabled", value: true },
      { name: "settings", value: { z: 1, a: "first" } }
    ];
    expect(variableValueType(variables[3]!.value)).toBe("object");
    expect(renderVariableValue(variables[3]!.value)).toBe('{"a":"first","z":1}');
    expect(interpolateVariables("${name} ${count} ${enabled} ${settings}", variables)).toBe('Ether 3 true {"a":"first","z":1}');
    expect(interpolateVariables("$${name}", variables)).toBe("${name}");
  });

  it("rejects invalid and duplicate referenceable names and missing tokens", () => {
    expect(() => variableMap([{ name: "not valid", value: "x" }])).toThrow(/start with a letter/);
    expect(() => variableMap([{ name: "same", value: 1 }, { name: "same", value: 2 }])).toThrow(/more than once/);
    expect(() => interpolateVariables("${missing}", [{ name: "known", value: "x" }])).toThrow(/not defined/);
    expect(() => interpolateVariables("${broken", [{ name: "known", value: "x" }])).toThrow(/closing brace/);
  });
});

function payload(id: string, sourceNodeId: string, lineageKey: string, edgeId?: string): PayloadEnvelope {
  return {
    id,
    channel: "text",
    role: "general",
    content: { kind: "text", value: id },
    source: { nodeId: sourceNodeId, outputVersionId: `version-${id}`, lineageKey, ...(edgeId === undefined ? {} : { edgeId }) },
    metadata: {}
  };
}

function joinContext(
  strategy: "ordered" | "zip" | "merge",
  requireComplete: boolean,
  inputs: PayloadEnvelope[],
  expectedSourceEdgeIds: string[],
  dependencyStepIds: string[] = [],
  dependencyWorkItemIds?: string[]
): Parameters<JoinExecutor["execute"]>[0] {
  const step = {
    id: "step-join",
    nodeId: "join",
    subject: { kind: "node", nodeId: "join" },
    executor: "join",
    dependencyStepIds,
    inputPayloadIds: inputs.map((input) => input.id),
    workItemIds: ["work-join"],
    compiledPrompt: "",
    compiledContext: { inputBindings: [], join: { strategy, requireComplete, expectedSourceEdgeIds } },
    parameters: { kind: "flow.join", strategy, requireComplete },
    selectors: [],
    executorConfig: { kind: "flow.join", strategy, requireComplete, join: { strategy, requireComplete, expectedSourceEdgeIds } },
    provider: { providerId: "local", profileId: "local", modelId: "local", settings: {}, capabilitySnapshot: capability() },
    providerBinding: null
  } satisfies PlanStep;
  return {
    claim: {} as never,
    step,
    plannedWorkItem: {
      id: "work-join",
      stepId: step.id,
      ordinal: 0,
      inputs: [],
      parameters: [],
      ...(dependencyWorkItemIds === undefined ? {} : { dependencyWorkItemIds })
    },
    inputs,
    providerInputs: [],
    signal: new AbortController().signal,
    stagingDirectory: "C:/tmp",
    providers: {}
  };
}

function reviewContext(inputs: PayloadEnvelope[]): Parameters<ReviewExecutor["execute"]>[0] {
  const step = {
    id: "step-review",
    nodeId: "review",
    subject: { kind: "node", nodeId: "review" },
    executor: "human-checkpoint",
    dependencyStepIds: ["step-join"],
    inputPayloadIds: inputs.map((input) => input.id),
    workItemIds: ["work-review"],
    compiledPrompt: "",
    compiledContext: { inputBindings: [] },
    parameters: { kind: "flow.compare", selectionMode: "one", minimumSelections: 1 },
    selectors: [],
    executorConfig: { kind: "flow.compare", selectionMode: "one", minimumSelections: 1 },
    provider: { providerId: "local", profileId: "local", modelId: "local", settings: {}, capabilitySnapshot: capability() },
    providerBinding: null
  } satisfies PlanStep;
  return {
    claim: {} as never,
    step,
    plannedWorkItem: { id: "work-review", stepId: step.id, ordinal: 0, inputs: [], parameters: [] },
    inputs,
    providerInputs: [],
    signal: new AbortController().signal,
    stagingDirectory: "C:/tmp",
    providers: {}
  };
}

function joinDraftPayloads(outputs: Extract<Awaited<ReturnType<JoinExecutor["execute"]>>, { kind: "complete" }>["outputs"]): PayloadEnvelope[] {
  return outputs.map((output, index) => ({
    id: `joined-payload-${index}`,
    channel: output.channel,
    role: output.role,
    content: output.content,
    source: { nodeId: "join", outputVersionId: `joined-version-${index}`, lineageKey: `joined-${index}` },
    metadata: output.metadata ?? {}
  }));
}

function capability(): ProviderCapability {
  return {
    providerId: "local",
    profileId: "local",
    modelId: "local",
    operation: "generate-image",
    inputChannels: ["text", "image", "data"],
    outputChannels: ["image"],
    aspectRatios: [],
    resolutions: [],
    maxReferences: 32,
    maxOutputsPerCall: 4,
    maxParallelism: 4,
    supportsCancellation: true,
    supportsSeed: false,
    provenance: "static-constraint",
    limitations: []
  };
}

describe("deterministic join", () => {
  it("keeps ordered and merge strategies observably distinct", async () => {
    const inputs = [payload("b", "b", "z", "edge-b"), payload("a", "a", "a", "edge-a")];
    const executor = new JoinExecutor();
    const ordered = await executor.execute(joinContext("ordered", true, inputs, ["edge-b", "edge-a"]));
    const merged = await executor.execute(joinContext("merge", true, inputs, ["edge-b", "edge-a"]));
    expect(ordered.kind).toBe("complete");
    expect(merged.kind).toBe("complete");
    if (ordered.kind !== "complete" || merged.kind !== "complete") return;
    expect(ordered.outputs.map((output) => output.content)).toEqual([{ kind: "text", value: "b" }, { kind: "text", value: "a" }]);
    expect(merged.outputs.map((output) => output.content)).toEqual([{ kind: "text", value: "a" }, { kind: "text", value: "b" }]);
    expect(ordered.outputs[0]!.metadata).toMatchObject({ joinComplete: true, joinInputLineageKey: "z" });
  });

  it("zips available pools when completeness is optional and fails closed when required", async () => {
    const inputs = [payload("a1", "a", "a1", "edge-a"), payload("b1", "b", "b1", "edge-b"), payload("a2", "a", "a2", "edge-a")];
    const executor = new JoinExecutor();
    const optional = await executor.execute(joinContext("zip", false, inputs, ["edge-a", "edge-b"]));
    expect(optional.kind).toBe("complete");
    if (optional.kind !== "complete") return;
    expect(optional.outputs.map((output) => output.content)).toEqual([
      { kind: "text", value: "a1" }, { kind: "text", value: "b1" }, { kind: "text", value: "a2" }
    ]);
    expect(optional.outputs.every((output) => output.metadata?.joinComplete === false)).toBe(true);
    await expect(executor.execute(joinContext("zip", true, inputs, ["edge-a", "edge-b"]))).rejects.toThrow(/equal payload counts/);
    await expect(executor.execute(joinContext("ordered", true, [inputs[0]!], ["edge-a", "edge-b"]))).rejects.toThrow(/missing edge-b/);
  });

  it("keeps global latest selection for an expanded legacy Join work item", async () => {
    const sourcePayloads = [
      payload("older", "source", "source-older", "source-join"),
      payload("newer", "source", "source-newer", "source-join")
    ];
    const sourceVersions = sourcePayloads.map((sourcePayload, index) => ({
      id: sourcePayload.source.outputVersionId,
      nodeId: "source",
      graphId: "graph",
      graphRevisionId: "graph-r1",
      inputPayloadIds: [],
      selectedOutputVersionIds: [],
      compiledContextHash: "sha256:v1:test",
      producer: { kind: "local", executor: "deterministic" },
      outputPayloadIds: [sourcePayload.id],
      parentOutputVersionId: null,
      approval: { state: "unreviewed" },
      runId: "job",
      stepId: "step-source",
      workItemId: "work-source",
      attemptId: "attempt-source",
      timing: { startedAt: "2026-08-09T00:00:00.000Z", completedAt: `2026-08-09T00:00:0${index + 1}.000Z` },
      failure: null,
      createdAt: `2026-08-09T00:00:0${index + 1}.000Z`
    }));
    const store = {
      documentId: "doc",
      path: "C:/tmp/legacy-join.ether",
      read: async <T>(operation: Parameters<DocumentStoreLike["read"]>[0]): Promise<T> => operation({
        artifacts: {},
        execution: {},
        outputs: {
          getPayload: (id: string) => sourcePayloads.find((sourcePayload) => sourcePayload.id === id),
          listByNode: (nodeId: string) => nodeId === "source" ? sourceVersions : []
        }
      }) as T,
      transaction: async <T>(operation: Parameters<DocumentStoreLike["transaction"]>[0]): Promise<T> => operation({ execution: {}, outputs: {} }) as T
    } satisfies DocumentStoreLike;
    const legacyJoin = joinContext("ordered", true, [], ["source-join"], ["step-source"], ["planned-source"]);
    const joinStep = {
      ...legacyJoin.step,
      inputPayloadIds: ["logical-source-join"],
      compiledContext: {
        ...legacyJoin.step.compiledContext,
        inputBindings: [{
          edgeId: "source-join",
          role: "general",
          selector: { kind: "latest" },
          sourceChannel: "text",
          sourceNodeId: "source",
          sourceStepId: "step-source"
        }]
      }
    } satisfies PlanStep;
    const resolved = await documentStorePersistence(store).resolvePlanInputs!({
      claim: {
        job: { id: "job" },
        plan: {
          steps: [{ id: "step-source", executor: "deterministic" }, joinStep],
          workItems: [
            { id: "planned-source", stepId: "step-source", ordinal: 0, inputs: [], parameters: [] },
            legacyJoin.plannedWorkItem
          ]
        }
      } as never,
      step: joinStep,
      plannedWorkItem: legacyJoin.plannedWorkItem,
      stagingDirectory: "C:/tmp/legacy-join"
    });

    expect(resolved.map((sourcePayload) => sourcePayload.id)).toEqual(["newer"]);
  });

  it("marks new batched Join boundaries so Compare keeps original artifact-producing candidates", async () => {
    const inputs = [0, 1, 2, 3].map((ordinal) =>
      payload(`candidate-${ordinal}`, "generate", `lineage-${ordinal}`, `edge-${ordinal}`)
    );
    const join = new JoinExecutor();
    const review = new ReviewExecutor();
    const boundary = await join.execute(
      joinContext(
        "ordered",
        true,
        inputs,
        inputs.map((_, ordinal) => `edge-${ordinal}`),
        ["step-generate"],
        inputs.map((_, ordinal) => `work-generate-${ordinal}`)
      )
    );
    expect(boundary.kind).toBe("complete");
    if (boundary.kind !== "complete") return;
    expect(boundary.outputs.map((output) => output.metadata)).toEqual(inputs.map((input) => expect.objectContaining({
      joinBatchBoundary: true,
      joinInputOutputVersionId: input.source.outputVersionId
    })));

    const reviewedBoundary = await review.execute(reviewContext(joinDraftPayloads(boundary.outputs)));
    expect(reviewedBoundary).toMatchObject({
      kind: "waiting-review",
      checkpoint: { candidateOutputVersionIds: inputs.map((input) => input.source.outputVersionId) }
    });

    const ordinary = await join.execute(
      joinContext("ordered", true, inputs.slice(0, 2), ["edge-0", "edge-1"], ["step-left", "step-right"], ["work-left", "work-right"])
    );
    expect(ordinary.kind).toBe("complete");
    if (ordinary.kind !== "complete") return;
    expect(ordinary.outputs.every((output) => output.metadata?.joinBatchBoundary === undefined)).toBe(true);
    const reviewedOrdinary = await review.execute(reviewContext(joinDraftPayloads(ordinary.outputs)));
    expect(reviewedOrdinary).toMatchObject({
      kind: "waiting-review",
      checkpoint: { candidateOutputVersionIds: ["joined-version-0", "joined-version-1"] }
    });
  });

  it("unwraps only newly marked embedded-artifact Reference Set inputs for Compare", async () => {
    const review = new ReviewExecutor();
    const legacyEmbeddedArtifact = {
      ...payload("legacy-reference", "references", "legacy-reference"),
      metadata: { referenceMemberKind: "embedded-artifact" }
    };
    const sealedEmbeddedArtifact = {
      ...payload("sealed-reference", "references", "sealed-reference"),
      metadata: {
        referenceMemberKind: "embedded-artifact",
        referenceArtifactSourceOutputVersionId: "original-artifact-output"
      }
    };
    const linkedReference = {
      ...payload("linked-reference", "references", "linked-reference"),
      metadata: { referenceArtifactSourceOutputVersionId: "not-an-embedded-artifact-output" }
    };

    const result = await review.execute(reviewContext([
      legacyEmbeddedArtifact,
      sealedEmbeddedArtifact,
      linkedReference
    ]));

    expect(result).toMatchObject({
      kind: "waiting-review",
      checkpoint: {
        candidateOutputVersionIds: [
          legacyEmbeddedArtifact.source.outputVersionId,
          "original-artifact-output",
          linkedReference.source.outputVersionId
        ]
      }
    });
  });
});

function graph(nodes: EtherGraph["nodes"], edges: EtherGraph["edges"]): EtherGraph {
  return {
    id: "root",
    title: "Variable join test",
    kind: "root",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    nodes,
    edges,
    groups: [],
    modules: [],
    viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
  };
}

describe("variable scope in plan preview", () => {
  it("interpolates only variables reachable upstream of the target", () => {
    const base = { position: { x: 0, y: 0 }, size: { width: 220, height: 140 }, presentation: { collapsed: false, accent: "#37e6ea", previewMode: "content" as const } };
    const graphValue = graph([
      { ...base, id: "variables-a", definitionId: "flow.variables", title: "A", config: { kind: "flow.variables", variables: [{ name: "subject", value: "lamp" }] } },
      { ...base, id: "prompt-a", definitionId: "prompt.text", title: "A prompt", config: { kind: "prompt.text", body: "${subject}", assembly: "replace" } },
      { ...base, id: "variables-b", definitionId: "flow.variables", title: "B", config: { kind: "flow.variables", variables: [{ name: "subject", value: "chair" }] } },
      { ...base, id: "prompt-b", definitionId: "prompt.text", title: "B prompt", position: { x: 300, y: 0 }, config: { kind: "prompt.text", body: "${missing}", assembly: "replace" } },
      { ...base, id: "image", definitionId: "generation.image", title: "Image", position: { x: 560, y: 0 }, config: { kind: "generation.image", providerId: "local", profileId: "local", aspectRatio: "1:1", resolution: { width: 64, height: 64 }, outputCount: 1 } }
    ] as EtherGraph["nodes"], [
      { id: "a", from: { kind: "node", nodeId: "variables-a", channel: "text" }, to: { kind: "node", nodeId: "prompt-a", channel: "text" }, role: "general", order: 0, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true },
      { id: "b", from: { kind: "node", nodeId: "variables-b", channel: "text" }, to: { kind: "node", nodeId: "prompt-b", channel: "text" }, role: "general", order: 0, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true },
      { id: "c", from: { kind: "node", nodeId: "prompt-a", channel: "text" }, to: { kind: "node", nodeId: "image", channel: "text" }, role: "general", order: 0, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true }
    ]);
    const plan = compilePlan({ id: "plan-scope", documentId: "doc", documentRevisionId: "doc-r1", graph: graphValue, graphRevisionId: "graph-r1", scope: { kind: "graph" }, capability: capability(), createdAt: "2026-08-03T00:00:00.000Z" });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.compiledPrompt).toContain("lamp");
  });
});

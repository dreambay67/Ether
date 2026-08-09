import { ExecutorRegistry, type ExecutorContext } from "@ether/execution";
import type { PayloadEnvelope } from "@ether/schema";
import { describe, expect, it } from "vitest";

const claim = {
  plan: {} as ExecutorContext["claim"]["plan"],
  job: { id: "review-job", status: "running" },
  workItem: { id: "review-work", plannedWorkItemId: "review-work", status: "running" },
  attempt: { id: "review-attempt", ordinal: 1, status: "running", startedAt: "2026-08-03T08:00:00.000Z", createdAt: "2026-08-03T08:00:00.000Z" },
  providerAttemptId: "review-provider-attempt"
} satisfies ExecutorContext["claim"];

const source: PayloadEnvelope = {
  id: "source-image-payload",
  channel: "image",
  role: "subject",
  content: { kind: "artifact", artifactId: "source-artifact" },
  source: { nodeId: "source", outputVersionId: "source-output", lineageKey: "source" },
  metadata: { assetPath: "C:/staged/source.png" }
};

describe("review execution runtime", () => {
  it("feeds evaluator Data and its scored media passthrough into deterministic Filter", async () => {
    const registry = new ExecutorRegistry();
    const evaluation = await registry.execute({
      claim,
      step: {
        id: "evaluate-step", nodeId: "evaluate", executor: "codex-evaluation", dependencyStepIds: [], inputPayloadIds: [source.id], workItemIds: ["review-work"],
        compiledPrompt: "Score composition.", compiledContext: {}, selectors: [], parameters: { rubric: [], model: "fake-evaluation-v1", reasoningEffort: "medium" }, provider: null,
        providerBinding: null
      } as unknown as ExecutorContext["step"],
      plannedWorkItem: { id: "review-work", stepId: "evaluate-step", ordinal: 0, inputs: [], parameters: [] },
      inputs: [source], providerInputs: [], signal: new AbortController().signal, stagingDirectory: "C:/staged",
      providers: {
        evaluation: {
          evaluate: async (input) => ({
            providerId: "fake-evaluator", providerName: "Fake evaluator", capabilities: ["evaluation.vision"], summary: "Ready.",
            items: input.images.map((image) => ({ id: image.id, assetId: image.assetId, assetPath: image.assetPath, score: 4, tags: ["ready"], decision: "pass" as const, confidence: 0.9, explanation: "Balanced.", detectedIssues: [] }))
          })
        }
      }
    });
    if (evaluation.kind !== "complete") throw new Error("Expected Evaluate to complete.");
    const evaluatorPayloads: PayloadEnvelope[] = evaluation.outputs.map((output, index) => ({
      id: `evaluate-payload-${index + 1}`,
      channel: output.channel,
      role: output.role,
      content: output.content,
      source: { nodeId: "evaluate", outputVersionId: "evaluate-output", lineageKey: `evaluate-${index + 1}` },
      metadata: output.metadata ?? {}
    }));
    const filtered = await registry.execute({
      claim,
      step: {
        id: "filter-step", nodeId: "filter", executor: "deterministic-filter", dependencyStepIds: [], inputPayloadIds: evaluatorPayloads.map((payload) => payload.id), workItemIds: ["review-work"],
        compiledPrompt: "", compiledContext: {}, selectors: [], provider: null, providerBinding: null,
        parameters: { match: "all", rules: [{ id: "quality", field: "score", operator: "gte", value: 4 }], routes: [{ id: "accepted", outcome: "matched" }] }
      } as unknown as ExecutorContext["step"],
      plannedWorkItem: { id: "review-work", stepId: "filter-step", ordinal: 1, inputs: [], parameters: [] },
      inputs: evaluatorPayloads.filter((payload) => payload.channel === "data" || payload.channel === "image"), providerInputs: [], signal: new AbortController().signal, stagingDirectory: "C:/staged", providers: {}
    });
    if (filtered.kind !== "complete") throw new Error("Expected Filter to complete.");
    expect(filtered.outputs.find((output) => output.content.kind === "object" && output.content.schemaId === "ether.filter-result.v1")).toMatchObject({
      content: { value: { items: expect.arrayContaining([expect.objectContaining({ matched: true, routeIds: ["accepted"], rules: [expect.objectContaining({ matched: true })] })]) } }
    });
    expect(filtered.outputs.find((output) => output.content.kind === "object" && output.content.schemaId === "ether.evaluation.item.v1")).toMatchObject({
      content: { value: expect.objectContaining({ score: 4 }) }, metadata: expect.objectContaining({ filterMatched: true, filterRouteIds: ["accepted"] })
    });
    expect(filtered.outputs.find((output) => output.channel === "image")).toMatchObject({
      content: { kind: "artifact", artifactId: "source-artifact" }, metadata: expect.objectContaining({ evaluationItem: expect.objectContaining({ score: 4 }), filterMatched: true, filterRouteIds: ["accepted"] })
    });
  });
});

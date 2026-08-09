import { documentStorePersistence, type DocumentStoreLike } from "../../execution/src/scheduler/persistence.js";
import type { NodeOutputVersion, PayloadEnvelope, PlanStep } from "@ether/schema";
import { describe, expect, it } from "vitest";

const currentJobId = "job-current";

function payload(id: string, outputVersionId: string, filterMatched?: boolean): PayloadEnvelope {
  return {
    id,
    channel: "data",
    role: "general",
    content: { kind: "object", value: { id } },
    source: { nodeId: "filter", outputVersionId, lineageKey: `filter:${id}` },
    metadata: filterMatched === undefined ? { aggregateSummary: true } : { filterMatched }
  };
}

function version(id: string, payloadId: string, runId: string, ordinal: number): NodeOutputVersion {
  const timestamp = `2026-08-09T00:00:0${ordinal}.000Z`;
  return {
    id,
    nodeId: "filter",
    graphId: "graph",
    graphRevisionId: "graph-r1",
    inputPayloadIds: [],
    selectedOutputVersionIds: [],
    compiledContextHash: "sha256:v1:test",
    producer: { kind: "local", executor: "deterministic-filter" },
    outputPayloadIds: [payloadId],
    parentOutputVersionId: null,
    approval: { state: "approved", actor: "system", at: timestamp },
    runId,
    stepId: "step-filter",
    workItemId: `work-filter-${ordinal}`,
    attemptId: `attempt-filter-${ordinal}`,
    timing: { startedAt: timestamp, completedAt: timestamp },
    failure: null,
    createdAt: timestamp
  };
}

const matched = payload("payload-matched", "version-matched", true);
const unmatched = payload("payload-unmatched", "version-unmatched", false);
const summary = payload("payload-summary", "version-summary");
const historical = payload("payload-historical", "version-historical", true);
const payloads = [matched, unmatched, summary, historical];
const versions = [
  version("version-matched", matched.id, currentJobId, 1),
  version("version-unmatched", unmatched.id, currentJobId, 2),
  version("version-summary", summary.id, currentJobId, 3),
  version("version-historical", historical.id, "job-prior", 4)
];

const store = {
  documentId: "document",
  path: "C:/tmp/filter-route.ether",
  read: async <T>(operation: Parameters<DocumentStoreLike["read"]>[0]): Promise<T> => operation({
    artifacts: {},
    execution: {},
    outputs: {
      getPayload: (id: string) => payloads.find((candidate) => candidate.id === id),
      listByNode: (nodeId: string) => nodeId === "filter" ? versions : []
    }
  }) as T,
  transaction: async <T>(operation: Parameters<DocumentStoreLike["transaction"]>[0]): Promise<T> => operation({ execution: {}, outputs: {} }) as T
} satisfies DocumentStoreLike;

function filterStep(executor: PlanStep["executor"] = "deterministic-filter"): PlanStep {
  return {
    id: "step-filter",
    nodeId: "filter",
    subject: { kind: "node", nodeId: "filter" },
    executor,
    dependencyStepIds: [],
    inputPayloadIds: [],
    workItemIds: ["work-filter"],
    compiledPrompt: "",
    compiledContext: {},
    parameters: {},
    selectors: [],
    executorConfig: {},
    provider: null,
    providerBinding: null
  } as unknown as PlanStep;
}

function targetStep(binding: Record<string, unknown>): PlanStep {
  return {
    id: "step-target",
    nodeId: "target",
    subject: { kind: "node", nodeId: "target" },
    executor: "collection",
    dependencyStepIds: ["step-filter"],
    inputPayloadIds: [],
    workItemIds: ["work-target"],
    compiledPrompt: "",
    compiledContext: { inputBindings: [binding] },
    parameters: {},
    selectors: [],
    executorConfig: {},
    provider: null,
    providerBinding: null
  } as unknown as PlanStep;
}

async function resolveFilterInput(
  extra: Record<string, unknown> = {},
  sourceExecutor: PlanStep["executor"] = "deterministic-filter"
): Promise<PayloadEnvelope[]> {
  const source = filterStep(sourceExecutor);
  const target = targetStep({
    edgeId: "filter-target",
    role: "general",
    selector: { kind: "all" },
    sourceChannel: "data",
    sourceNodeId: "filter",
    sourceStepId: source.id,
    ...extra
  });
  return documentStorePersistence(store).resolvePlanInputs!({
    claim: {
      job: { id: currentJobId },
      plan: { steps: [source, target], workItems: [] }
    } as never,
    step: target,
    plannedWorkItem: { id: "work-target", stepId: target.id, ordinal: 0, inputs: [], parameters: [] },
    stagingDirectory: "C:/tmp/filter-route"
  });
}

describe("Filter route persistence", () => {
  it("keeps only current-job matched payloads and excludes an untagged aggregate summary", async () => {
    const resolved = await resolveFilterInput({ filterRoute: "matched" });
    expect(resolved.map((candidate) => candidate.id)).toEqual([matched.id]);
  });

  it("keeps only current-job unmatched payloads", async () => {
    const resolved = await resolveFilterInput({ filterRoute: "unmatched" });
    expect(resolved.map((candidate) => candidate.id)).toEqual([unmatched.id]);
  });

  it("retains selector-only legacy behavior for an unmarked route", async () => {
    const resolved = await resolveFilterInput();
    expect(resolved.map((candidate) => candidate.id)).toEqual([matched.id, unmatched.id, summary.id]);
  });

  it("fails closed for malformed markers and non-Filter sources", async () => {
    await expect(resolveFilterInput({ filterRoute: "invalid" })).rejects.toMatchObject({
      code: "FILTER_ROUTE_PLAN_CONTRACT_INVALID"
    });
    await expect(resolveFilterInput({ filterRoute: "matched" }, "deterministic")).rejects.toMatchObject({
      code: "FILTER_ROUTE_PLAN_CONTRACT_INVALID"
    });
  });
});

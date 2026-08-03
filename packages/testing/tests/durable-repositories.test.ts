import { canonicalPlanJson, type EtherGraph, type ExecutionPlan, type NodeOutputVersion, type PayloadEnvelope } from "@ether/schema";
import { DocumentStore, importBlob } from "@ether/document";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const createdAt = "2026-07-22T08:00:00.000Z";

function promptNode(id: string) {
  return {
    id,
    definitionId: "prompt.text" as const,
    title: id,
    position: { x: 0, y: 0 },
    size: { width: 220, height: 140 },
    config: { kind: "prompt.text" as const, body: id, assembly: "append" as const },
    presentation: { collapsed: false, accent: "default", previewMode: "summary" as const }
  };
}

function compareNode(id: string) {
  return {
    id,
    definitionId: "review.compare" as const,
    title: id,
    position: { x: 260, y: 0 },
    size: { width: 220, height: 140 },
    config: { kind: "review.compare" as const, selectionMode: "one" as const, minimumSelections: 1 },
    presentation: { collapsed: false, accent: "default", previewMode: "summary" as const }
  };
}

function graph(): EtherGraph {
  return {
    id: "graph-durable",
    title: "Durable",
    kind: "root",
    createdAt,
    updatedAt: createdAt,
    nodes: [promptNode("source"), promptNode("target"), compareNode("compare")],
    edges: [{
      id: "edge-source-target",
      from: { kind: "node", nodeId: "source", channel: "text" },
      to: { kind: "node", nodeId: "target", channel: "text" },
      role: "general",
      order: 0,
      selector: { kind: "latest" },
      adapter: { kind: "auto" },
      enabled: true
    }],
    groups: [],
    modules: [],
    viewState: {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedNodeIds: [],
      selectedEdgeIds: [],
      inspectorTarget: null
    }
  };
}

const capability = {
  providerId: "fixture-provider",
  profileId: "fixture-profile",
  operation: "llm" as const,
  inputChannels: ["text" as const],
  outputChannels: ["text" as const],
  aspectRatios: [],
  resolutions: [],
  maxReferences: 0,
  maxOutputsPerCall: 1,
  supportsCancellation: true,
  supportsSeed: false,
  provenance: "static-constraint" as const,
  limitations: []
};

function plan(head: { documentRevisionId: string; graphRevisions: Record<string, string> }): ExecutionPlan {
  const steps = [
    ["step-source", "source", "deterministic"],
    ["step-target", "target", "deterministic"],
    ["step-compare", "compare", "human-checkpoint"],
    ["step-compare-many", "compare", "human-checkpoint"]
  ].map(([id, nodeId, executor], index) => ({
    id,
    nodeId,
    executor: executor as "deterministic" | "human-checkpoint",
    dependencyStepIds: index === 0 ? [] : [index === 1 ? "step-source" : "step-target"],
    inputPayloadIds: [],
    workItemIds: [`work-${index + 1}`],
    compiledPrompt: "",
    compiledContext: {},
    parameters: {},
    selectors: [],
    provider: {
      providerId: capability.providerId,
      profileId: capability.profileId,
      modelId: "fixture-model",
      settings: {},
      capabilitySnapshot: capability
    }
  }));
  const capsule: Omit<ExecutionPlan, "contentHash"> = {
    id: "plan-durable",
    capsuleVersion: 1,
    hashVersion: "sha256-v1",
    documentId: "document-durable",
    documentRevisionId: head.documentRevisionId,
    graphId: "graph-durable",
    graphRevisionId: head.graphRevisions["graph-durable"]!,
    scope: { kind: "graph" },
    steps,
    workItems: [
      { id: "work-1", stepId: "step-source", ordinal: 0, inputs: [], parameters: [] },
      { id: "work-2", stepId: "step-target", ordinal: 1, inputs: [], parameters: [], dependencyWorkItemIds: ["work-1"] },
      { id: "work-3", stepId: "step-compare", ordinal: 2, inputs: [], parameters: [], dependencyWorkItemIds: ["work-2"] },
      { id: "work-4", stepId: "step-compare-many", ordinal: 3, inputs: [], parameters: [], dependencyWorkItemIds: ["work-2"] }
    ],
    providerCapabilitySnapshots: [capability],
    estimatedCalls: 0,
    warnings: [],
    createdAt
  };
  return {
    ...capsule,
    contentHash: `sha256:v1:${createHash("sha256").update(canonicalPlanJson(capsule)).digest("hex")}`
  };
}

function textOutput(input: {
  claim: { attempt: { id: string; startedAt: string | null }; job: { id: string }; workItem: { id: string } };
  graphRevisionId: string;
  id: string;
  nodeId: string;
  payloadId: string;
  text: string;
}): { payloads: PayloadEnvelope[]; version: NodeOutputVersion } {
  const completedAt = new Date().toISOString();
  return {
    version: {
      id: input.id,
      nodeId: input.nodeId,
      graphId: "graph-durable",
      graphRevisionId: input.graphRevisionId,
      inputPayloadIds: [],
      selectedOutputVersionIds: [],
      compiledContextHash: "local-completion",
      producer: { kind: "local", executor: "deterministic" },
      outputPayloadIds: [input.payloadId],
      parentOutputVersionId: null,
      approval: { state: "unreviewed" },
      runId: input.claim.job.id,
      stepId: input.nodeId === "source" ? "step-source" : "step-target",
      workItemId: input.claim.workItem.id,
      attemptId: input.claim.attempt.id,
      timing: { startedAt: input.claim.attempt.startedAt!, completedAt },
      failure: null,
      createdAt: completedAt
    },
    payloads: [{
      id: input.payloadId,
      channel: "text",
      role: "general",
      content: { kind: "text", value: input.text },
      source: { nodeId: input.nodeId, outputVersionId: input.id, lineageKey: input.id },
      metadata: {}
    }]
  };
}

describe("durable document repositories", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("persists dependencies, local completion, immutable output workflows, collections, checkpoints, and dedupe", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ether-durable-repositories-"));
    roots.push(root);
    const store = await DocumentStore.create(path.join(root, "Durable.ether"), {
      appVersion: "4.0.0",
      documentId: "document-durable",
      initialGraph: graph(),
      title: "Durable"
    });
    try {
      const executionPlan = plan(await store.read(({ revisions }) => revisions.head()));
      const job = await store.transaction(({ execution }) => {
        execution.savePlan(executionPlan);
        const permit = execution.grantRunPermit(executionPlan.id, executionPlan.contentHash, "permit-durable");
        return execution.startJob({
          commandId: "start-durable",
          planId: executionPlan.id,
          contentHash: executionPlan.contentHash,
          runPermitId: permit.id
        });
      });

      const claimOne = await store.transaction(({ execution }) => execution.claimNext(job.id, "worker-one"));
      expect(claimOne?.workItem.plannedWorkItemId).toBe("work-1");
      const outputOne = textOutput({
        claim: claimOne!,
        graphRevisionId: executionPlan.graphRevisionId,
        id: "output-source",
        payloadId: "payload-source",
        nodeId: "source",
        text: "durable text"
      });
      const first = await store.transaction(({ execution }) => execution.acceptCompletion({
        claim: claimOne!,
        outputs: [outputOne]
      }));
      const duplicate = await store.transaction(({ execution }) => execution.acceptCompletion({
        claim: claimOne!,
        outputs: [outputOne]
      }));
      expect(duplicate.outputVersions).toEqual(first.outputVersions);

      const claimTwo = await store.transaction(({ execution }) => execution.claimNext(job.id, "worker-two"));
      expect(claimTwo?.workItem.plannedWorkItemId).toBe("work-2");
      const outputTwo = textOutput({
        claim: claimTwo!,
        graphRevisionId: executionPlan.graphRevisionId,
        id: "output-target",
        payloadId: "payload-target",
        nodeId: "target",
        text: "dependent text"
      });
      await store.transaction(({ execution }) => execution.acceptCompletion({ claim: claimTwo!, outputs: [outputTwo] }));

      const compareClaim = await store.transaction(({ execution }) => execution.claimNext(job.id, "worker-compare"));
      expect(compareClaim?.workItem.plannedWorkItemId).toBe("work-3");
      await expect(store.transaction(({ execution }) => execution.createCompareCheckpoint({
        planId: executionPlan.id,
        stepId: "step-compare",
        workItemId: compareClaim!.workItem.id,
        candidateOutputVersionIds: [outputTwo.version.id],
        selectedOutputVersionIds: [outputTwo.version.id, outputTwo.version.id],
        selectionMode: "one",
        minimumSelections: 1
      }))).rejects.toMatchObject({ code: "DUPLICATE_REVIEW_SELECTION" });
      await expect(store.transaction(({ execution }) => execution.createCompareCheckpoint({
        planId: executionPlan.id,
        stepId: "step-compare",
        workItemId: compareClaim!.workItem.id,
        candidateOutputVersionIds: [outputTwo.version.id],
        selectedOutputVersionIds: [outputOne.version.id],
        selectionMode: "one",
        minimumSelections: 1
      }))).rejects.toMatchObject({ code: "REVIEW_SELECTION_NOT_CANDIDATE" });
      const checkpoint = await store.transaction(({ execution }) => execution.createCompareCheckpoint({
        planId: executionPlan.id,
        stepId: "step-compare",
        workItemId: compareClaim!.workItem.id,
        candidateOutputVersionIds: [outputTwo.version.id],
        selectedOutputVersionIds: [outputTwo.version.id],
        selectionMode: "one",
        minimumSelections: 1
      }));
      expect(checkpoint).toMatchObject({
        state: "waiting-review",
        candidateOutputVersionIds: [outputTwo.version.id],
        selectionMode: "one",
        minimumSelections: 1,
        completion: {
          version: 1,
          policy: { candidateOutputVersionIds: [outputTwo.version.id], selectionMode: "one", minimumSelections: 1 },
          decision: null
        }
      });
      await expect(store.transaction(({ execution }) => execution.completeCompareCheckpoint({
        checkpointId: checkpoint.id,
        selectedOutputVersionIds: [outputTwo.version.id, outputTwo.version.id]
      }))).rejects.toMatchObject({ code: "DUPLICATE_REVIEW_SELECTION" });
      await expect(store.transaction(({ execution }) => execution.completeCompareCheckpoint({
        checkpointId: checkpoint.id,
        selectedOutputVersionIds: [outputOne.version.id]
      }))).rejects.toMatchObject({ code: "REVIEW_SELECTION_NOT_CANDIDATE" });
      await expect(store.transaction(({ execution }) => execution.completeCompareCheckpoint({
        checkpointId: checkpoint.id,
        selectedOutputVersionIds: []
      }))).rejects.toMatchObject({ code: "REVIEW_SELECTION_COUNT_INVALID" });
      const completed = await store.transaction(({ execution }) => execution.completeCompareCheckpoint({
        checkpointId: checkpoint.id,
        selectedOutputVersionIds: [outputTwo.version.id],
        completion: { note: "best candidate" }
      }));
      expect(completed).toMatchObject({
        state: "completed",
        candidateOutputVersionIds: [outputTwo.version.id],
        completion: {
          version: 1,
          policy: { candidateOutputVersionIds: [outputTwo.version.id], selectionMode: "one", minimumSelections: 1 },
          decision: { note: "best candidate" }
        }
      });
      await expect(store.transaction(({ execution }) => execution.completeCompareCheckpoint({
        checkpointId: checkpoint.id,
        selectedOutputVersionIds: [outputTwo.version.id]
      }))).resolves.toMatchObject({ completion: completed.completion });

      const manyClaim = await store.transaction(({ execution }) => execution.claimNext(job.id, "worker-compare-many"));
      expect(manyClaim?.workItem.plannedWorkItemId).toBe("work-4");
      const manyCheckpoint = await store.transaction(({ execution }) => execution.createCompareCheckpoint({
        planId: executionPlan.id,
        stepId: "step-compare-many",
        workItemId: manyClaim!.workItem.id,
        candidateOutputVersionIds: [outputOne.version.id, outputTwo.version.id],
        selectedOutputVersionIds: [outputOne.version.id],
        selectionMode: "many",
        minimumSelections: 2
      }));
      const database = (store as unknown as { database: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).database;
      database.prepare("UPDATE review_checkpoints SET completion_json = ? WHERE checkpoint_id = ?")
        .run(JSON.stringify({ version: 1, policy: { candidateOutputVersionIds: [] } }), manyCheckpoint.id);
      await expect(store.read(({ execution }) => execution.searchReviewCheckpoints({ state: "waiting-review" })))
        .rejects.toMatchObject({ code: "REVIEW_POLICY_CORRUPT" });
      database.prepare("UPDATE review_checkpoints SET completion_json = ? WHERE checkpoint_id = ?")
        .run(JSON.stringify(manyCheckpoint.completion), manyCheckpoint.id);
      await expect(store.transaction(({ execution }) => execution.completeCompareCheckpoint({
        checkpointId: manyCheckpoint.id,
        selectedOutputVersionIds: [outputOne.version.id]
      }))).rejects.toMatchObject({ code: "REVIEW_SELECTION_COUNT_INVALID" });
      await expect(store.transaction(({ execution }) => execution.completeCompareCheckpoint({
        checkpointId: manyCheckpoint.id,
        selectedOutputVersionIds: [outputOne.version.id, outputTwo.version.id]
      }))).resolves.toMatchObject({ state: "completed", minimumSelections: 2, selectionMode: "many" });

      const manualAt = new Date().toISOString();
      const manual = (id: string, parentOutputVersionId: string, payloadId: string, text: string, relation: "manual-edit" | "restored") => ({
        version: {
          ...outputOne.version,
          id,
          outputPayloadIds: [payloadId],
          parentOutputVersionId,
          lineage: { parentOutputVersionId, rootOutputVersionId: outputOne.version.id, relation },
          producer: { kind: "manual" as const, actor: "user" as const },
          runId: null,
          stepId: null,
          workItemId: null,
          attemptId: null,
          timing: { startedAt: manualAt, completedAt: manualAt },
          createdAt: manualAt
        },
        payloads: [{
          ...outputOne.payloads[0]!,
          id: payloadId,
          content: { kind: "text" as const, value: text },
          source: { nodeId: "source", outputVersionId: id, lineageKey: id }
        }]
      });
      const edited = manual("output-edit", outputOne.version.id, "payload-edit", "edited", "manual-edit");
      const restored = manual("output-restore", edited.version.id, "payload-restore", "restored", "restored");
      await store.transaction(({ outputs }) => {
        outputs.createManualEdit(edited.version, edited.payloads);
        outputs.restore(restored.version, restored.payloads);
        outputs.appendReview({ outputVersionId: outputOne.version.id, state: "approved", actor: "user", at: manualAt });
        outputs.pinEdgeSelector("edge-source-target", outputOne.version.id);
      });
      await expect(store.read(({ outputs, graphs }) => ({
        approval: outputs.currentApproval(outputOne.version.id),
        restored: outputs.getVersion(restored.version.id),
        selector: graphs.get("graph-durable")!.edges[0]!.selector
      }))).resolves.toMatchObject({
        approval: { state: "approved" },
        restored: { parentOutputVersionId: edited.version.id },
        selector: { kind: "pinned", outputVersionId: outputOne.version.id }
      });

      const blobPath = path.join(root, "artifact.bin");
      writeFileSync(blobPath, Buffer.from("artifact bytes"));
      const imported = await importBlob(store, {
        sourcePath: blobPath,
        mediaType: "application/octet-stream",
        artifact: {
          id: "artifact-durable",
          channel: "text",
          mediaType: "application/octet-stream",
          source: { outputVersionId: outputOne.version.id, payloadId: outputOne.payloads[0]!.id },
          createdAt: manualAt,
          metadata: { title: "Durable artifact" }
        }
      }, { appDataRoot: root });
      expect(imported.contentKey).toHaveLength(64);
      await importBlob(store, {
        sourcePath: blobPath,
        mediaType: "application/octet-stream",
        artifact: {
          id: "artifact-child",
          channel: "text",
          mediaType: "application/octet-stream",
          source: { outputVersionId: outputTwo.version.id, payloadId: outputTwo.payloads[0]!.id },
          createdAt: manualAt,
          metadata: { title: "Child artifact" }
        }
      }, { appDataRoot: root });
      const evaluationVersion = (id: string, payloadId: string): NodeOutputVersion => ({
        ...outputOne.version,
        id,
        nodeId: "source",
        stepId: "step-source",
        outputPayloadIds: [payloadId],
        createdAt: manualAt
      });
      await store.transaction(({ outputs }) => {
        outputs.insert(evaluationVersion("evaluation-data-output", "evaluation-data-payload"), [{
          id: "evaluation-data-payload",
          channel: "data",
          role: "general",
          content: { kind: "object", schemaId: "ether.evaluation.v1", value: { summary: "Durable evaluation.", items: [{ id: "artifact-durable", score: 4 }] } },
          source: { nodeId: "source", outputVersionId: "evaluation-data-output", lineageKey: "evaluation-data" },
          metadata: { evaluationProviderId: "fake-evaluator", evaluationModelId: "fake-evaluation-v1", evaluationInstruction: "Score durability.", evaluationRubric: [] }
        }]);
        outputs.insert(evaluationVersion("evaluation-media-output", "evaluation-media-payload"), [{
          id: "evaluation-media-payload",
          channel: "text",
          role: "general",
          content: { kind: "artifact", artifactId: "artifact-durable" },
          source: { nodeId: "source", outputVersionId: "evaluation-media-output", lineageKey: "evaluation-media" },
          metadata: { evaluationPassthrough: true }
        }]);
      });
      await expect(store.read(({ artifacts }) => artifacts.detail("artifact-durable")!.evaluation)).resolves.toMatchObject({
        providerId: "fake-evaluator",
        modelId: "fake-evaluation-v1",
        summary: "Durable evaluation.",
        items: [expect.objectContaining({ score: 4 })]
      });
      await store.transaction(({ artifacts }) => artifacts.addLineage({
        artifactId: "artifact-child",
        parentArtifactId: "artifact-durable",
        relation: "derived-from",
        sourceOutputVersionId: outputTwo.version.id,
        metadata: { id: "lineage-parent-child", createdAt: manualAt, role: "general" }
      }));
      const lineageViews = await store.read(({ artifacts }) => ({
        child: artifacts.detail("artifact-child")!.lineage,
        parent: artifacts.detail("artifact-durable")!.lineage
      }));
      expect(lineageViews.child).toContainEqual(expect.objectContaining({
        id: "lineage-parent-child", parentArtifactId: "artifact-durable", childArtifactId: "artifact-child"
      }));
      expect(lineageViews.parent).toContainEqual(expect.objectContaining({
        id: "lineage-parent-child", parentArtifactId: "artifact-durable", childArtifactId: "artifact-child"
      }));
      await store.transaction(({ collections }) => {
        collections.create({ id: "collection-a", title: "A", description: "first", primary: true });
        collections.create({ id: "collection-b", title: "B", description: "second", primary: false });
        collections.addMembers("collection-a", [{ artifactId: "artifact-durable", role: "general" }]);
        collections.setPrimary("collection-b");
        collections.removeMembers("collection-a", ["artifact-durable"]);
      });
      const persisted = await store.read(({ collections, execution }) => ({
        collections: collections.list(),
        members: collections.memberships("collection-a"),
        snapshot: execution.snapshot(job.id)
      }));
      expect(persisted.collections.find((collection) => collection.id === "collection-b")?.primary).toBe(true);
      expect(persisted.members).toEqual([]);
      expect(persisted.snapshot.job.status).toBe("completed");
      expect(persisted.snapshot.workItems.every((item) => item.status === "accepted")).toBe(true);
    } finally {
      await store.close();
    }
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addJobDependencies,
  addJobItems,
  appendJobEvent,
  cancelJobItem,
  cancelRunJob,
  __setProjectStoreTestHooks,
  createProject,
  enqueueJob,
  enqueueRun,
  executeQueuedRun,
  executePlannedJobItem,
  getJobById,
  getGraphRevision,
  getLatestGraphRevision,
  listJobDependencies,
  listJobEvents,
  listJobItems,
  listJobs,
  listReadyJobItems,
  previewRun,
  openProject,
  recordJobItemFailure,
  retryRunItem,
  retryJobItem,
  saveGraph,
  saveGraphRevision,
  transitionJobItemStatus,
  transitionJobStatus,
  type CanvasNodeData,
  type EtherGraph,
  type ExecutionNodeResult,
  type ExecutionQueueItem,
  type ExecutionRequest,
  type ExecutionWorkerState
} from "@ether/engine";
import { FAKE_PROVIDER_ID } from "@ether/providers";

const tempRoots: string[] = [];

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-job-store-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  __setProjectStoreTestHooks({});
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createJobWithItems(projectPath: string, kind: string, nodeIds: string[]) {
  const job = await enqueueJob(projectPath, { kind });
  const items = await addJobItems(projectPath, {
    jobId: job.id,
    items: nodeIds.map((nodeId) => ({ nodeId }))
  });

  return { job, items };
}

function node(
  id: string,
  data: Partial<CanvasNodeData> &
    Pick<CanvasNodeData, "definitionId" | "kind" | "subtype"> &
    Record<string, unknown>
) {
  const title = data.title ?? `${data.subtype} ${data.kind}`;

  return {
    id,
    type: "etherNode",
    position: { x: 0, y: 0 },
    data: {
      title,
      label: data.label ?? title,
      instruction: data.instruction ?? "",
      notes: data.notes ?? "",
      status: data.status ?? "idle",
      ...data
    }
  };
}

function edge(id: string, source: string, target: string, label = "prompt") {
  return { id, source, target, label, data: { label } };
}

function unavailableAdapterEdge(
  id: string,
  source: string,
  target: string,
  data: Record<string, unknown> = {}
) {
  return {
    id,
    source,
    target,
    label: "reference",
    data: {
      label: "reference",
      graphVersion: "2.5",
      sourceChannel: "image",
      targetChannel: "text",
      role: "reference",
      adapter: {
        operation: "caption",
        providerId: "visual-description",
        status: "unavailable",
        reason: "Adapter reason from provider setup."
      },
      ...data
    }
  };
}

function graph(nodes: EtherGraph["nodes"], edges: EtherGraph["edges"]): EtherGraph {
  return {
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedSnapshotId: null,
    updatedAt: "2026-06-28T00:00:00.000Z"
  };
}

function coordinatorGraph() {
  return graph(
    [
      node("prompt", {
        definitionId: "prompt-general",
        kind: "Prompt",
        subtype: "General",
        instruction: "silver product on acrylic"
      }),
      node("generation-a", {
        definitionId: "generation-image",
        kind: "Generation",
        subtype: "Image"
      }),
      node("generation-b", {
        definitionId: "generation-image",
        kind: "Generation",
        subtype: "Image"
      })
    ],
    [
      edge("edge-prompt-generation-a", "prompt", "generation-a"),
      edge("edge-prompt-generation-b", "prompt", "generation-b")
    ]
  );
}

function completeResult(
  item: ExecutionQueueItem,
  action: string,
  now = "2026-06-28T10:00:00.000Z"
): ExecutionNodeResult {
  return {
    nodeId: item.nodeId,
    iteration: item.iteration,
    status: "complete",
    action,
    startedAt: now,
    finishedAt: now
  };
}

function setTestNodeData(state: ExecutionWorkerState, nodeId: string, data: Record<string, unknown>) {
  state.graph = {
    ...state.graph,
    nodes: state.graph.nodes.map((candidate) =>
      candidate.id === nodeId
        ? {
            ...candidate,
            data: {
              ...candidate.data,
              ...data
            }
          }
        : candidate
    )
  };
}

describe("job store", () => {
  it("persists jobs, items, dependencies, events, retries, cancellation, and ready-item queries", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Durable Jobs" });

    const job = await enqueueJob(project.path, {
      kind: "graph-run",
      graphRevisionId: null,
      rootNodeId: "root-node",
      metadata: { source: "test" },
      now: new Date("2026-06-28T10:00:00.000Z")
    });
    const items = await addJobItems(project.path, {
      jobId: job.id,
      items: [
        { nodeId: "prompt", input: { text: "a cinematic skyline" } },
        { nodeId: "image", input: { model: "draft" } },
        { nodeId: "rating", input: { rubric: "editorial" } },
        { nodeId: "canceled", input: { reason: "not needed" } }
      ],
      now: new Date("2026-06-28T10:01:00.000Z")
    });
    const [promptItem, imageItem, ratingItem, canceledItem] = items;

    await addJobDependencies(project.path, {
      jobId: job.id,
      dependencies: [
        { parentJobItemId: promptItem.id, childJobItemId: imageItem.id },
        { parentJobItemId: imageItem.id, childJobItemId: ratingItem.id }
      ],
      now: new Date("2026-06-28T10:02:00.000Z")
    });

    await transitionJobStatus(project.path, {
      jobId: job.id,
      from: "queued",
      to: "running",
      now: new Date("2026-06-28T10:03:00.000Z")
    });
    await transitionJobItemStatus(project.path, {
      jobItemId: promptItem.id,
      from: "queued",
      to: "running",
      now: new Date("2026-06-28T10:04:00.000Z")
    });
    await transitionJobItemStatus(project.path, {
      jobItemId: promptItem.id,
      from: "running",
      to: "completed",
      output: { prompt: "a cinematic skyline at blue hour" },
      now: new Date("2026-06-28T10:05:00.000Z")
    });

    await expect(listReadyJobItems(project.path, job.id)).resolves.toEqual([
      expect.objectContaining({ id: imageItem.id, nodeId: "image", status: "queued" }),
      expect.objectContaining({ id: canceledItem.id, nodeId: "canceled", status: "queued" })
    ]);

    await recordJobItemFailure(project.path, {
      jobItemId: imageItem.id,
      error: { code: "provider_unavailable", message: "Provider timed out" },
      metadata: { provider: "fake-image" },
      now: new Date("2026-06-28T10:06:00.000Z")
    });
    const retried = await retryJobItem(project.path, {
      jobItemId: imageItem.id,
      error: { code: "retry_requested" },
      now: new Date("2026-06-28T10:07:00.000Z")
    });
    await cancelJobItem(project.path, {
      jobItemId: canceledItem.id,
      now: new Date("2026-06-28T10:08:00.000Z")
    });
    await appendJobEvent(project.path, {
      jobId: job.id,
      eventType: "job.started",
      payload: { status: "running" },
      now: new Date("2026-06-28T10:09:00.000Z")
    });
    await appendJobEvent(project.path, {
      jobId: job.id,
      jobItemId: imageItem.id,
      eventType: "item.retry",
      payload: { retryCount: retried.retryCount },
      now: new Date("2026-06-28T10:09:00.000Z")
    });

    await transitionJobItemStatus(project.path, {
      jobItemId: imageItem.id,
      from: "queued",
      to: "running",
      now: new Date("2026-06-28T10:10:00.000Z")
    });
    await transitionJobItemStatus(project.path, {
      jobItemId: imageItem.id,
      from: "running",
      to: "completed",
      output: { assetId: "asset-1" },
      now: new Date("2026-06-28T10:11:00.000Z")
    });
    await transitionJobItemStatus(project.path, {
      jobItemId: ratingItem.id,
      from: "queued",
      to: "running",
      now: new Date("2026-06-28T10:12:00.000Z")
    });
    await transitionJobItemStatus(project.path, {
      jobItemId: ratingItem.id,
      from: "running",
      to: "completed",
      output: { score: 4 },
      now: new Date("2026-06-28T10:13:00.000Z")
    });
    await transitionJobStatus(project.path, {
      jobId: job.id,
      from: "running",
      to: "completed",
      now: new Date("2026-06-28T10:14:00.000Z")
    });

    await expect(getJobById(project.path, job.id)).resolves.toMatchObject({
      id: job.id,
      kind: "graph-run",
      status: "completed",
      metadata: { source: "test" },
      startedAt: "2026-06-28T10:03:00.000Z",
      finishedAt: "2026-06-28T10:14:00.000Z"
    });
    await expect(listJobs(project.path)).resolves.toEqual([expect.objectContaining({ id: job.id })]);
    await expect(listJobItems(project.path, job.id)).resolves.toEqual([
      expect.objectContaining({ id: promptItem.id, status: "completed", output: { prompt: expect.any(String) } }),
      expect.objectContaining({
        id: imageItem.id,
        status: "completed",
        retryCount: 1,
        retryMetadata: expect.objectContaining({ lastRetryAt: "2026-06-28T10:07:00.000Z" }),
        error: { code: "retry_requested" },
        output: { assetId: "asset-1" }
      }),
      expect.objectContaining({ id: ratingItem.id, status: "completed" }),
      expect.objectContaining({ id: canceledItem.id, status: "canceled", finishedAt: "2026-06-28T10:08:00.000Z" })
    ]);
    await expect(listJobDependencies(project.path, job.id)).resolves.toEqual([
      expect.objectContaining({ parentJobItemId: promptItem.id, childJobItemId: imageItem.id }),
      expect.objectContaining({ parentJobItemId: imageItem.id, childJobItemId: ratingItem.id })
    ]);
    await expect(listJobEvents(project.path, job.id)).resolves.toEqual([
      expect.objectContaining({ eventType: "job.started", payload: { status: "running" } }),
      expect.objectContaining({ eventType: "item.retry", payload: { retryCount: 1 } })
    ]);

    const queuedRecoveryJob = await enqueueJob(project.path, {
      kind: "queued-recovery-check",
      now: new Date("2026-06-28T11:00:00.000Z")
    });
    const runningRecoveryJob = await enqueueJob(project.path, {
      kind: "running-recovery-check",
      now: new Date("2026-06-28T11:01:00.000Z")
    });
    await transitionJobStatus(project.path, {
      jobId: runningRecoveryJob.id,
      from: "queued",
      to: "running",
      now: new Date("2026-06-28T11:02:00.000Z")
    });

    await openProject(project.path);

    await expect(listJobs(project.path, { statuses: ["queued", "running"] })).resolves.toEqual([
      expect.objectContaining({ id: queuedRecoveryJob.id, status: "queued", kind: "queued-recovery-check" }),
      expect.objectContaining({ id: runningRecoveryJob.id, status: "running", kind: "running-recovery-check" })
    ]);
  });

  it("rejects dependencies whose parent or child item belongs to another job", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Cross Job Dependency" });
    const first = await createJobWithItems(project.path, "first-job", ["first-node"]);
    const second = await createJobWithItems(project.path, "second-job", ["second-node"]);

    await expect(
      addJobDependencies(project.path, {
        jobId: first.job.id,
        dependencies: [
          {
            parentJobItemId: first.items[0].id,
            childJobItemId: second.items[0].id
          }
        ]
      })
    ).rejects.toThrow(/belongs to a different job/i);
    await expect(listJobDependencies(project.path, first.job.id)).resolves.toEqual([]);
  });

  it("rejects events whose item belongs to another job", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Cross Job Event" });
    const first = await createJobWithItems(project.path, "event-source-job", ["source-node"]);
    const second = await enqueueJob(project.path, { kind: "event-target-job" });

    await expect(
      appendJobEvent(project.path, {
        jobId: second.id,
        jobItemId: first.items[0].id,
        eventType: "item.cross_job",
        payload: { invalid: true }
      })
    ).rejects.toThrow(/belongs to a different job/i);
    await expect(listJobEvents(project.path, second.id)).resolves.toEqual([]);
  });

  it("does not record failures on completed job items", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Terminal Failure Guard" });
    const { job, items } = await createJobWithItems(project.path, "terminal-guard", ["terminal-node"]);
    const [item] = items;

    await transitionJobItemStatus(project.path, {
      jobItemId: item.id,
      from: "queued",
      to: "running"
    });
    await transitionJobItemStatus(project.path, {
      jobItemId: item.id,
      from: "running",
      to: "completed",
      output: { assetId: "asset-terminal" }
    });

    await expect(
      recordJobItemFailure(project.path, {
        jobItemId: item.id,
        error: { code: "late_failure" }
      })
    ).rejects.toThrow(/not queued or running/i);
    await expect(listJobItems(project.path, job.id)).resolves.toEqual([
      expect.objectContaining({
        id: item.id,
        status: "completed",
        error: null,
        output: { assetId: "asset-terminal" }
      })
    ]);
  });

  it("rejects reserved item metadata keys in user payloads without mutating output", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Reserved Metadata Key" });
    const reservedPayload = { __etherJobItemMetadata: { retryCount: 99 } };

    const job = await enqueueJob(project.path, { kind: "reserved-key-job" });
    await expect(
      addJobItems(project.path, {
        jobId: job.id,
        items: [{ nodeId: "bad-input", input: reservedPayload }]
      })
    ).rejects.toThrow(/reserved/i);

    const [item] = await addJobItems(project.path, {
      jobId: job.id,
      items: [{ nodeId: "reserved-node" }]
    });
    await transitionJobItemStatus(project.path, {
      jobItemId: item.id,
      from: "queued",
      to: "running"
    });

    await expect(
      transitionJobItemStatus(project.path, {
        jobItemId: item.id,
        from: "running",
        to: "completed",
        output: { ...reservedPayload, assetId: "should-not-write" }
      })
    ).rejects.toThrow(/reserved/i);
    await expect(listJobItems(project.path, job.id)).resolves.toEqual([
      expect.objectContaining({ id: item.id, status: "running", output: {} })
    ]);

    await expect(
      recordJobItemFailure(project.path, {
        jobItemId: item.id,
        error: { code: "blocked" },
        metadata: reservedPayload
      })
    ).rejects.toThrow(/reserved/i);
    await expect(listJobItems(project.path, job.id)).resolves.toEqual([
      expect.objectContaining({ id: item.id, status: "running", output: {}, retryCount: 0 })
    ]);

    await recordJobItemFailure(project.path, {
      jobItemId: item.id,
      error: { code: "safe_failure" },
      metadata: { provider: "safe" }
    });
    await expect(
      retryJobItem(project.path, {
        jobItemId: item.id,
        metadata: reservedPayload
      })
    ).rejects.toThrow(/reserved/i);
    await expect(listJobItems(project.path, job.id)).resolves.toEqual([
      expect.objectContaining({
        id: item.id,
        status: "failed",
        output: {},
        retryCount: 0,
        metadata: expect.objectContaining({ provider: "safe" })
      })
    ]);
  });
});

describe("run coordinator", () => {
  it("previews a run plan without executing provider or asset work", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Preview" });
    const canvas = coordinatorGraph();

    const preview = await previewRun(project.path, canvas, {
      policy: "branch",
      targetNodeIds: ["prompt"],
      runCountCap: 2
    });

    expect(preview.plan.items.map((item) => `${item.nodeId}:${item.iteration}`)).toEqual([
      "prompt:1",
      "generation-a:1",
      "generation-b:1"
    ]);
    expect(preview.dirtyNodeIds).toEqual([]);
    expect(preview.providerCallCandidates).toEqual(["generation-a", "generation-b"]);
    expect(preview.expectedOutputCount).toBe(2);
    expect(preview.blockedReasons).toEqual([]);
    await expect(listJobs(project.path)).resolves.toEqual([]);

    const staleCanvas = {
      ...canvas,
      nodes: canvas.nodes.map((candidate) =>
        candidate.id === "generation-a"
          ? {
              ...candidate,
              data: {
                ...candidate.data,
                rerunState: "stale",
                staleSince: "2026-06-28T09:55:00.000Z"
              }
            }
          : candidate
      )
    };
    const stalePreview = await previewRun(project.path, staleCanvas, {
      policy: "branch",
      targetNodeIds: ["prompt"],
      runCountCap: 2
    });

    expect(stalePreview.dirtyNodeIds).toEqual(["generation-a"]);
  });

  it("previews concrete provider operations for selected and downstream provider nodes", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Provider Operation Preview" });
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        }),
        node("edit", {
          definitionId: "edit-image",
          kind: "Edit",
          subtype: "Image"
        }),
        node("assistant", {
          definitionId: "assistant-general",
          kind: "Assistant",
          subtype: "General"
        }),
        node("evaluation", {
          definitionId: "store-evaluate",
          kind: "Store",
          subtype: "Evaluate"
        })
      ],
      [
        edge("edge-prompt-generation", "prompt", "generation"),
        edge("edge-generation-edit", "generation", "edit"),
        edge("edge-edit-assistant", "edit", "assistant"),
        edge("edge-assistant-evaluation", "assistant", "evaluation")
      ]
    );

    const preview = await previewRun(project.path, canvas, {
      policy: "branch",
      targetNodeIds: ["prompt"]
    });

    expect((preview as any).operations).toEqual([
      {
        type: "provider",
        nodeId: "generation",
        iteration: 1,
        kind: "Generation",
        operation: "image.generate",
        status: "ready"
      },
      {
        type: "provider",
        nodeId: "edit",
        iteration: 1,
        kind: "Edit",
        operation: "image.edit",
        status: "ready"
      },
      {
        type: "provider",
        nodeId: "assistant",
        iteration: 1,
        kind: "Assistant",
        operation: "assistant.text",
        status: "ready"
      },
      {
        type: "provider",
        nodeId: "evaluation",
        iteration: 1,
        kind: "Store",
        operation: "evaluation.vision",
        status: "ready"
      }
    ]);
  });

  it("previews required adapter operations for in-scope channel-changing edges", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Adapter Operation Preview" });
    const canvas = graph(
      [
        node("image-reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image"
        }),
        node("audio-reference", {
          definitionId: "reference-audio",
          kind: "Reference",
          subtype: "Audio"
        }),
        node("video-reference", {
          definitionId: "reference-video",
          kind: "Reference",
          subtype: "Video"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        unavailableAdapterEdge("edge-image-generation", "image-reference", "generation"),
        unavailableAdapterEdge("edge-audio-generation", "audio-reference", "generation", {
          sourceChannel: "audio",
          targetChannel: "text",
          adapter: {
            operation: "transcribe",
            providerId: "audio-transcription",
            status: "unavailable",
            reason: "Audio transcription adapter is not configured."
          }
        }),
        unavailableAdapterEdge("edge-video-generation", "video-reference", "generation", {
          sourceChannel: "video",
          targetChannel: "text",
          adapter: {
            operation: "caption",
            providerId: "video-caption",
            status: "unavailable",
            reason: "Video caption adapter is not configured."
          }
        })
      ]
    );

    const preview = await previewRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["generation"]
    });

    expect((preview as any).operations).toEqual([
      {
        type: "adapter",
        edgeId: "edge-image-generation",
        sourceNodeId: "image-reference",
        targetNodeId: "generation",
        operation: "adapter.caption",
        sourceChannel: "image",
        targetChannel: "text",
        status: "unavailable",
        required: true,
        reason: "Adapter reason from provider setup."
      },
      {
        type: "adapter",
        edgeId: "edge-audio-generation",
        sourceNodeId: "audio-reference",
        targetNodeId: "generation",
        operation: "adapter.transcribe",
        sourceChannel: "audio",
        targetChannel: "text",
        status: "unavailable",
        required: true,
        reason: "Audio transcription adapter is not configured."
      },
      {
        type: "adapter",
        edgeId: "edge-video-generation",
        sourceNodeId: "video-reference",
        targetNodeId: "generation",
        operation: "adapter.caption",
        sourceChannel: "video",
        targetChannel: "text",
        status: "unavailable",
        required: true,
        reason: "Video caption adapter is not configured."
      },
      {
        type: "provider",
        nodeId: "generation",
        iteration: 1,
        kind: "Generation",
        operation: "image.generate",
        status: "blocked",
        reason: "Adapter reason from provider setup."
      }
    ]);
  });

  it("blocks preview provider candidates behind unavailable adapter edges", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Adapter Blocked Preview" });
    const reason = "Image reference needs a caption adapter before this node can run.";
    const canvas = graph(
      [
        node("reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        unavailableAdapterEdge("edge-reference-generation", "reference", "generation", {
          disabledReason: reason,
          adapter: {
            operation: "caption",
            providerId: "visual-description",
            status: "unavailable",
            reason: "Lower priority adapter reason."
          }
        })
      ]
    );

    const preview = await previewRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["generation"],
      runCountCap: 1
    });

    expect(preview.items).toEqual([
      expect.objectContaining({
        nodeId: "generation",
        willCallProvider: true,
        blockedReason: reason
      })
    ]);
    expect(preview.providerCallCandidates).toEqual([]);
    expect(preview.expectedOutputCount).toBe(0);
    expect(preview.blockedReasons).toEqual([reason]);
  });

  it("blocks preview execution for evaluation nodes behind unavailable adapter edges", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Adapter Blocked Evaluation Preview" });
    const reason = "Adapter reason from provider setup.";
    const canvas = graph(
      [
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        }),
        node("evaluation", {
          definitionId: "store-evaluate",
          kind: "Store",
          subtype: "Evaluate"
        })
      ],
      [unavailableAdapterEdge("edge-generation-evaluation", "generation", "evaluation")]
    );

    const preview = await previewRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["evaluation"]
    });

    expect(preview.items).toEqual([
      expect.objectContaining({
        nodeId: "evaluation",
        blockedReason: reason
      })
    ]);
    expect(preview.blockedReasons).toEqual([reason]);
  });

  it("keeps locked preview precedence over disabled incoming adapter edges", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Locked Adapter Preview" });
    const canvas = graph(
      [
        node("reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image",
          locked: true
        })
      ],
      [
        unavailableAdapterEdge("edge-reference-generation", "reference", "generation", {
          disabledReason: "Adapter should not hide the locked state."
        })
      ]
    );

    const preview = await previewRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["generation"],
      runCountCap: 1
    });

    expect(preview.items).toEqual([
      expect.objectContaining({
        nodeId: "generation",
        blockedReason: "Node is locked"
      })
    ]);
    expect(preview.providerCallCandidates).toEqual([]);
    expect(preview.expectedOutputCount).toBe(0);
    expect(preview.blockedReasons).toEqual(["Node is locked"]);
  });

  it("uses adapter reason for blocked adapter status when disabledReason is absent", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Blocked Adapter Reason Preview" });
    const reason = "Audio rendering is intentionally disabled for this route.";
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        unavailableAdapterEdge("edge-prompt-generation", "prompt", "generation", {
          sourceChannel: "text",
          targetChannel: "audio",
          adapter: {
            operation: "transform",
            providerId: "text-to-audio",
            status: "blocked",
            reason
          }
        })
      ]
    );

    const preview = await previewRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["generation"],
      runCountCap: 1
    });

    expect(preview.items).toEqual([
      expect.objectContaining({
        nodeId: "generation",
        blockedReason: reason
      })
    ]);
    expect(preview.blockedReasons).toEqual([reason]);
  });

  it("uses a channel-labeled generic reason when adapter block has no explicit reason", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Generic Adapter Reason Preview" });
    const canvas = graph(
      [
        node("reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        unavailableAdapterEdge("edge-reference-generation", "reference", "generation", {
          adapter: {
            operation: "caption",
            providerId: "visual-description",
            status: "unavailable"
          }
        })
      ]
    );

    const preview = await previewRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["generation"],
      runCountCap: 1
    });

    expect(preview.items).toEqual([
      expect.objectContaining({
        nodeId: "generation",
        blockedReason: "Image to Text connections require an adapter that is not available."
      })
    ]);
    expect(preview.blockedReasons).toEqual([
      "Image to Text connections require an adapter that is not available."
    ]);
  });

  it("enqueues a selected node run with durable items, dependencies, and events", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Enqueue" });

    const queued = await enqueueRun(project.path, coordinatorGraph(), {
      policy: "selected",
      targetNodeIds: ["prompt", "generation-a"],
      runCountCap: 1,
      providerId: FAKE_PROVIDER_ID,
      now: () => new Date("2026-06-28T10:00:00.000Z")
    });

    expect(queued.job).toMatchObject({
      kind: "graph-run",
      status: "queued",
      rootNodeId: "generation-a",
      metadata: expect.objectContaining({
        request: expect.objectContaining({ policy: "selected", targetNodeIds: ["prompt", "generation-a"] }),
        plan: expect.objectContaining({ nodeIds: ["prompt", "generation-a"] })
      })
    });
    expect(queued.items.map((item) => item.nodeId)).toEqual(["prompt", "generation-a"]);
    expect(queued.items[0]?.input).toMatchObject({ nodeId: "prompt", iteration: 1 });
    expect(queued.dependencies).toEqual([
      expect.objectContaining({
        parentJobItemId: queued.items[0]?.id,
        childJobItemId: queued.items[1]?.id
      })
    ]);
    await expect(listReadyJobItems(project.path, queued.job.id)).resolves.toEqual([
      expect.objectContaining({ nodeId: "prompt", status: "queued" })
    ]);
    await expect(listJobEvents(project.path, queued.job.id)).resolves.toEqual([
      expect.objectContaining({ eventType: "run.previewed" }),
      expect.objectContaining({ eventType: "run.enqueued" })
    ]);
  });

  it("rejects stale graph enqueue without making the stale graph latest", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Enqueue Stale" });
    const staleCanvas = coordinatorGraph();
    const savedCanvas = {
      ...staleCanvas,
      nodes: staleCanvas.nodes.map((candidate) =>
        candidate.id === "prompt"
          ? {
              ...candidate,
              data: {
                ...candidate.data,
                instruction: "fresh saved edit"
              }
            }
          : candidate
      )
    };

    await saveGraph(project.path, savedCanvas);
    const latestBefore = await getLatestGraphRevision(project.path);

    await expect(
      enqueueRun(project.path, staleCanvas, {
        policy: "selected",
        targetNodeIds: ["prompt"]
      })
    ).rejects.toThrow(/changed since this run was prepared/i);

    const latestAfter = await getLatestGraphRevision(project.path);

    expect(latestAfter?.id).toBe(latestBefore?.id);
    expect(latestAfter?.graph.nodes.find((candidate) => candidate.id === "prompt")?.data).toMatchObject({
      instruction: "fresh saved edit"
    });
    await expect(listJobs(project.path)).resolves.toEqual([]);
  });

  it("attaches an enqueued job to the exact revision saved for that run", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Enqueue Revision Race" });
    const canvas = {
      ...coordinatorGraph(),
      updatedAt: new Date().toISOString()
    };
    const competingGraph = {
      ...canvas,
      nodes: canvas.nodes.map((candidate) =>
        candidate.id === "prompt"
          ? {
              ...candidate,
              data: {
                ...candidate.data,
                instruction: "competing edit"
              }
            }
          : candidate
      ),
      updatedAt: new Date(Date.now() + 1000).toISOString()
    };
    let injectedCompetingRevision = false;

    __setProjectStoreTestHooks({
      writeJson: async (filePath, value, writeDefault) => {
        await writeDefault(filePath, value);

        if (injectedCompetingRevision || !filePath.endsWith("graph.json")) {
          return;
        }

        injectedCompetingRevision = true;
        const latest = await getLatestGraphRevision(project.path);
        await saveGraphRevision(project.path, {
          graph: competingGraph,
          baseRevisionId: latest?.id ?? null,
          reason: "competing-save",
          actor: "test"
        });
      }
    });

    const queued = await enqueueRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["prompt"]
    });
    const jobRevision = await getGraphRevision(project.path, queued.job.graphRevisionId!);
    const latest = await getLatestGraphRevision(project.path);

    expect(jobRevision).toMatchObject({
      id: queued.job.graphRevisionId,
      reason: "run-enqueued",
      metadata: expect.objectContaining({
        policy: "selected"
      })
    });
    expect(jobRevision?.graph.nodes.find((candidate) => candidate.id === "prompt")?.data).toMatchObject({
      instruction: "silver product on acrylic"
    });
    expect(latest).toMatchObject({
      reason: "competing-save"
    });
  });

  it("executes queued sequential dependencies and persists an output graph revision", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Execute" });
    const queued = await enqueueRun(project.path, coordinatorGraph(), {
      policy: "selected",
      targetNodeIds: ["prompt", "generation-a"],
      runCountCap: 1,
      providerId: FAKE_PROVIDER_ID,
      now: () => new Date("2026-06-28T10:00:00.000Z")
    });

    const result = await executeQueuedRun(project.path, queued.job.id);
    const items = await listJobItems(project.path, queued.job.id);
    const latest = await getLatestGraphRevision(project.path);

    expect(result.execution.results.map((entry) => entry.nodeId)).toEqual(["prompt", "generation-a"]);
    expect(items.map((item) => item.status)).toEqual(["completed", "completed"]);
    expect(items[0]?.output).toMatchObject({
      action: "assemble-prompt",
      status: "complete",
      graphPatch: expect.objectContaining({ changedNodeIds: ["prompt"] })
    });
    expect(items[1]?.output).toMatchObject({
      action: "generate",
      status: "complete",
      graphPatch: expect.objectContaining({ changedNodeIds: ["generation-a"] })
    });
    expect(result.revision?.id).toBe(latest?.id);
    expect(latest?.metadata).toMatchObject({
      jobId: queued.job.id,
      graphPatch: expect.objectContaining({
        changedNodeIds: expect.arrayContaining(["prompt", "generation-a"])
      })
    });
    await expect(listJobEvents(project.path, queued.job.id)).resolves.toContainEqual(
      expect.objectContaining({
        eventType: "run.item.completed",
        payload: expect.objectContaining({
          nodeId: "generation-a",
          graphPatch: expect.objectContaining({ changedNodeIds: ["generation-a"] })
        })
      })
    );
    await expect(getJobById(project.path, queued.job.id)).resolves.toMatchObject({ status: "completed" });
  });

  it("executes coordinator-level parallel ready siblings when enabled", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Parallel" });
    const queued = await enqueueRun(project.path, coordinatorGraph(), {
      policy: "branch",
      targetNodeIds: ["prompt"],
      runCountCap: 2,
      parallel: true
    });

    const starts: string[] = [];
    let releaseGeneration = () => undefined;
    const generationGate = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    let resolveBothStarted = () => undefined;
    const bothStarted = new Promise<void>((resolve) => {
      resolveBothStarted = resolve;
    });
    const resultPromise = executeQueuedRun(project.path, queued.job.id, {
      runner: async (_projectPath, state, _request, item) => {
        starts.push(`${item.nodeId}:${item.iteration}`);

        if (item.nodeId.startsWith("generation")) {
          if (starts.filter((entry) => entry.startsWith("generation")).length === 2) {
            resolveBothStarted();
          }
          await generationGate;
        }

        setTestNodeData(state, item.nodeId, { status: "complete", testRun: item.iteration });
        return completeResult(item, item.nodeId === "prompt" ? "assemble-prompt" : "generate");
      }
    });

    await bothStarted;
    await expect(listJobItems(project.path, queued.job.id)).resolves.toEqual([
      expect.objectContaining({ nodeId: "prompt", status: "completed" }),
      expect.objectContaining({ nodeId: "generation-a", status: "running" }),
      expect.objectContaining({ nodeId: "generation-b", status: "running" })
    ]);
    releaseGeneration();
    const result = await resultPromise;
    const events = await listJobEvents(project.path, queued.job.id);

    expect(starts).toEqual(["prompt:1", "generation-a:1", "generation-b:1"]);
    expect(result.execution.results.map((entry) => entry.nodeId)).toEqual([
      "prompt",
      "generation-a",
      "generation-b"
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        eventType: "run.execution.parallel",
        payload: expect.objectContaining({ readyItemCount: 2 })
      })
    );
  });

  it("blocks parallel downstream work until all parent node iterations complete", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Parallel Iterations" });
    const canvas = graph(
      [
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        }),
        node("collection", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection",
          title: "Finals",
          label: "Finals"
        })
      ],
      [edge("edge-generation-collection", "generation", "collection", "result")]
    );
    const queued = await enqueueRun(project.path, canvas, {
      policy: "branch",
      targetNodeIds: ["generation"],
      runCountCap: 3,
      parallel: true
    });
    const items = await listJobItems(project.path, queued.job.id);
    const generationItems = items.filter((item) => item.nodeId === "generation");
    const collectionItem = items.find((item) => item.nodeId === "collection");

    expect(generationItems).toHaveLength(3);
    expect(collectionItem).toBeDefined();
    await expect(listReadyJobItems(project.path, queued.job.id)).resolves.toEqual([
      expect.objectContaining({ id: generationItems[0]?.id, nodeId: "generation" })
    ]);

    await transitionJobItemStatus(project.path, {
      jobItemId: generationItems[0]!.id,
      from: "queued",
      to: "running"
    });
    await transitionJobItemStatus(project.path, {
      jobItemId: generationItems[0]!.id,
      from: "running",
      to: "completed"
    });
    await expect(listReadyJobItems(project.path, queued.job.id)).resolves.toEqual([
      expect.objectContaining({ id: generationItems[1]?.id, nodeId: "generation" })
    ]);

    await transitionJobItemStatus(project.path, {
      jobItemId: generationItems[1]!.id,
      from: "queued",
      to: "running"
    });
    await transitionJobItemStatus(project.path, {
      jobItemId: generationItems[1]!.id,
      from: "running",
      to: "completed"
    });
    await expect(listReadyJobItems(project.path, queued.job.id)).resolves.toEqual([
      expect.objectContaining({ id: generationItems[2]?.id, nodeId: "generation" })
    ]);

    await transitionJobItemStatus(project.path, {
      jobItemId: generationItems[2]!.id,
      from: "queued",
      to: "running"
    });
    await transitionJobItemStatus(project.path, {
      jobItemId: generationItems[2]!.id,
      from: "running",
      to: "completed"
    });
    await expect(listReadyJobItems(project.path, queued.job.id)).resolves.toEqual([
      expect.objectContaining({ id: collectionItem?.id, nodeId: "collection" })
    ]);
  });

  it("cancels before provider work starts", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Cancel" });
    const queued = await enqueueRun(project.path, coordinatorGraph(), {
      policy: "selected",
      targetNodeIds: ["generation-a"]
    });
    let providerCalls = 0;

    await cancelRunJob(project.path, queued.job.id);
    await executeQueuedRun(project.path, queued.job.id, {
      runner: async () => {
        providerCalls += 1;
        throw new Error("runner should not be called");
      }
    });

    expect(providerCalls).toBe(0);
    await expect(getJobById(project.path, queued.job.id)).resolves.toMatchObject({ status: "canceled" });
    await expect(listJobItems(project.path, queued.job.id)).resolves.toEqual([
      expect.objectContaining({ status: "canceled" })
    ]);
  });

  it("retries a failed item and completes on the next coordinator call", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Retry" });
    const queued = await enqueueRun(project.path, coordinatorGraph(), {
      policy: "selected",
      targetNodeIds: ["prompt"]
    });

    await executeQueuedRun(project.path, queued.job.id, {
      runner: async () => {
        throw new Error("temporary failure");
      }
    });
    await expect(getJobById(project.path, queued.job.id)).resolves.toMatchObject({ status: "failed" });
    const [failedItem] = await listJobItems(project.path, queued.job.id);

    await retryRunItem(project.path, failedItem!.id);
    await executeQueuedRun(project.path, queued.job.id);

    await expect(getJobById(project.path, queued.job.id)).resolves.toMatchObject({ status: "completed" });
    await expect(listJobItems(project.path, queued.job.id)).resolves.toEqual([
      expect.objectContaining({ nodeId: "prompt", status: "completed", retryCount: 1, error: null })
    ]);
  });

  it("recovers a queued run after reopening the project", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Recovery" });
    const queued = await enqueueRun(project.path, coordinatorGraph(), {
      policy: "selected",
      targetNodeIds: ["prompt"]
    });

    await openProject(project.path);
    const result = await executeQueuedRun(project.path, queued.job.id);

    expect(result.execution.results).toEqual([
      expect.objectContaining({ nodeId: "prompt", status: "complete" })
    ]);
    await expect(getJobById(project.path, queued.job.id)).resolves.toMatchObject({ status: "completed" });
  });

  it("exports a single planned item worker boundary", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Item Worker" });
    const state: ExecutionWorkerState = {
      graph: graph(
        [
          node("prompt", {
            definitionId: "prompt-general",
            kind: "Prompt",
            subtype: "General",
            instruction: "single worker prompt"
          })
        ],
        []
      )
    };
    const request: ExecutionRequest = {
      policy: "selected",
      targetNodeIds: ["prompt"]
    };

    const result = await executePlannedJobItem(project.path, state, request, {
      nodeId: "prompt",
      iteration: 1
    });

    expect(result).toMatchObject({ nodeId: "prompt", status: "complete", action: "assemble-prompt" });
    expect(state.graph.nodes[0]?.data).toMatchObject({
      status: "complete",
      rerunState: "complete",
      assembledPrompt: "General: single worker prompt"
    });
  });

  it("rebases run output onto non-overlapping graph edits made after enqueue", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Rebase" });
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "queued prompt"
        }),
        node("notes", {
          definitionId: "note-text",
          kind: "Note",
          subtype: "Text",
          notes: "original user note"
        } as any)
      ],
      []
    );
    const queued = await enqueueRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["prompt"]
    });
    await saveGraph(project.path, {
      ...canvas,
      nodes: canvas.nodes.map((candidate) =>
        candidate.id === "notes"
          ? {
              ...candidate,
              data: {
                ...candidate.data,
                notes: "edited after enqueue"
              }
            }
          : candidate
      )
    });

    await executeQueuedRun(project.path, queued.job.id, {
      runner: async (_projectPath, state, _request, item) => {
        setTestNodeData(state, item.nodeId, { status: "complete", assembledPrompt: "run output" });
        return completeResult(item, "assemble-prompt");
      }
    });
    const latest = await getLatestGraphRevision(project.path);

    expect(latest?.graph.nodes.find((candidate) => candidate.id === "prompt")?.data).toMatchObject({
      assembledPrompt: "run output"
    });
    expect(latest?.graph.nodes.find((candidate) => candidate.id === "notes")?.data).toMatchObject({
      notes: "edited after enqueue"
    });
    await expect(getJobById(project.path, queued.job.id)).resolves.toMatchObject({ status: "completed" });

    const completedAgain = await executeQueuedRun(project.path, queued.job.id);
    expect(completedAgain.execution.graph.nodes.find((candidate) => candidate.id === "prompt")?.data).toMatchObject({
      assembledPrompt: "run output"
    });
    expect(completedAgain.execution.graph.nodes.find((candidate) => candidate.id === "notes")?.data).toMatchObject({
      notes: "edited after enqueue"
    });
  });

  it("fails with a conflict instead of overwriting overlapping graph edits made after enqueue", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Conflict" });
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "queued prompt"
        })
      ],
      []
    );
    const queued = await enqueueRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["prompt"]
    });
    await saveGraph(project.path, {
      ...canvas,
      nodes: canvas.nodes.map((candidate) =>
        candidate.id === "prompt"
          ? {
              ...candidate,
              data: {
                ...candidate.data,
                instruction: "edited after enqueue"
              }
            }
          : candidate
      )
    });

    await executeQueuedRun(project.path, queued.job.id, {
      runner: async (_projectPath, state, _request, item) => {
        setTestNodeData(state, item.nodeId, { assembledPrompt: "run output" });
        return completeResult(item, "assemble-prompt");
      }
    });
    const latest = await getLatestGraphRevision(project.path);

    await expect(getJobById(project.path, queued.job.id)).resolves.toMatchObject({ status: "failed" });
    expect(latest?.graph.nodes.find((candidate) => candidate.id === "prompt")?.data).toMatchObject({
      instruction: "edited after enqueue"
    });
    await expect(listJobEvents(project.path, queued.job.id)).resolves.toContainEqual(
      expect.objectContaining({
        eventType: "run.conflict",
        payload: expect.objectContaining({ conflictedNodeIds: ["prompt"] })
      })
    );
  });

  it("does not fail a job another executor completed before finalization conflict handling", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Finalize Race" });
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "queued prompt"
        })
      ],
      []
    );
    const queued = await enqueueRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["prompt"]
    });
    await saveGraph(project.path, {
      ...canvas,
      nodes: canvas.nodes.map((candidate) =>
        candidate.id === "prompt"
          ? {
              ...candidate,
              data: {
                ...candidate.data,
                instruction: "edited after enqueue"
              }
            }
          : candidate
      )
    });

    const result = await executeQueuedRun(project.path, queued.job.id, {
      runner: async (_projectPath, state, _request, item) => {
        setTestNodeData(state, item.nodeId, { status: "complete", assembledPrompt: "run output" });
        await transitionJobStatus(project.path, {
          jobId: queued.job.id,
          from: "running",
          to: "completed"
        });
        const latest = await getLatestGraphRevision(project.path);
        await appendJobEvent(project.path, {
          jobId: queued.job.id,
          eventType: "run.completed",
          payload: { graphRevisionId: latest?.id ?? null, resultCount: 1 }
        });
        return completeResult(item, "assemble-prompt");
      }
    });

    expect(result.job.status).toBe("completed");
    await expect(getJobById(project.path, queued.job.id)).resolves.toMatchObject({ status: "completed" });
    await expect(listJobEvents(project.path, queued.job.id)).resolves.not.toContainEqual(
      expect.objectContaining({ eventType: "run.conflict" })
    );
  });

  it("treats skipped dependency parents as satisfied so jobs do not stay running", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Skipped Dependency" });
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          locked: true
        }),
        node("collection", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection",
          title: "Skipped Parent OK"
        })
      ],
      [edge("edge-prompt-collection", "prompt", "collection")]
    );
    const queued = await enqueueRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["prompt", "collection"]
    });

    const result = await executeQueuedRun(project.path, queued.job.id);

    expect(result.execution.results.map((entry) => [entry.nodeId, entry.status])).toEqual([
      ["prompt", "skipped"],
      ["collection", "complete"]
    ]);
    await expect(getJobById(project.path, queued.job.id)).resolves.toMatchObject({ status: "completed" });
    await expect(listJobItems(project.path, queued.job.id)).resolves.toEqual([
      expect.objectContaining({ nodeId: "prompt", status: "skipped" }),
      expect.objectContaining({ nodeId: "collection", status: "completed" })
    ]);
  });

  it("does not fail a job when another executor has already claimed the ready item", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Claim Race" });
    const queued = await enqueueRun(project.path, coordinatorGraph(), {
      policy: "selected",
      targetNodeIds: ["prompt"]
    });
    const [item] = await listReadyJobItems(project.path, queued.job.id);

    const firstRun = executeQueuedRun(project.path, queued.job.id, {
      runner: async (_projectPath, state, _request, queueItem) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        setTestNodeData(state, queueItem.nodeId, { status: "complete" });
        return completeResult(queueItem, "assemble-prompt");
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const secondRun = await executeQueuedRun(project.path, queued.job.id);
    await firstRun;

    expect(item).toBeDefined();
    expect(secondRun.job.status).toBe("running");
    await expect(getJobById(project.path, queued.job.id)).resolves.toMatchObject({ status: "completed" });
  });

  it("recovers abandoned running items when recovery is requested", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Running Recovery" });
    const queued = await enqueueRun(project.path, coordinatorGraph(), {
      policy: "selected",
      targetNodeIds: ["prompt"]
    });
    const [item] = await listReadyJobItems(project.path, queued.job.id);
    await transitionJobStatus(project.path, { jobId: queued.job.id, from: "queued", to: "running" });
    await transitionJobItemStatus(project.path, { jobItemId: item!.id, from: "queued", to: "running" });

    const withoutRecovery = await executeQueuedRun(project.path, queued.job.id);
    expect(withoutRecovery.job.status).toBe("running");

    const recovered = await executeQueuedRun(project.path, queued.job.id, {
      recoverRunningItems: true,
      abandonedAfterMs: 0
    });

    expect(recovered.execution.results).toEqual([
      expect.objectContaining({ nodeId: "prompt", status: "complete" })
    ]);
    await expect(getJobById(project.path, queued.job.id)).resolves.toMatchObject({ status: "completed" });
  });

  it("returns all completed and skipped item results after retry/resume", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Resume Results" });
    const queued = await enqueueRun(project.path, coordinatorGraph(), {
      policy: "selected",
      targetNodeIds: ["prompt", "generation-a"]
    });
    await executeQueuedRun(project.path, queued.job.id, {
      runner: async (_projectPath, state, _request, item) => {
        if (item.nodeId === "generation-a") {
          throw new Error("generation interrupted");
        }
        setTestNodeData(state, item.nodeId, { status: "complete" });
        return completeResult(item, "assemble-prompt");
      }
    });
    const failedGeneration = (await listJobItems(project.path, queued.job.id)).find(
      (item) => item.nodeId === "generation-a"
    );
    await retryRunItem(project.path, failedGeneration!.id);

    const resumed = await executeQueuedRun(project.path, queued.job.id, {
      runner: async (_projectPath, state, _request, item) => {
        setTestNodeData(state, item.nodeId, { status: "complete" });
        return completeResult(item, "generate");
      }
    });

    expect(resumed.execution.results.map((entry) => [entry.nodeId, entry.action])).toEqual([
      ["prompt", "assemble-prompt"],
      ["generation-a", "generate"]
    ]);
    await expect(listJobEvents(project.path, queued.job.id)).resolves.toContainEqual(
      expect.objectContaining({
        eventType: "run.completed",
        payload: expect.objectContaining({ resultCount: 2 })
      })
    );
  });

  it("replays lossless completed item patches on resume without persisting sanitized placeholders", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Lossless Replay" });
    const longValue = "long-value-".repeat(180);
    const queued = await enqueueRun(project.path, coordinatorGraph(), {
      policy: "selected",
      targetNodeIds: ["prompt", "generation-a"]
    });

    await executeQueuedRun(project.path, queued.job.id, {
      runner: async (_projectPath, state, _request, item) => {
        if (item.nodeId === "generation-a") {
          throw new Error("generation interrupted");
        }

        setTestNodeData(state, item.nodeId, { textOutput: longValue });
        return completeResult(item, "assemble-prompt");
      }
    });
    const failedGeneration = (await listJobItems(project.path, queued.job.id)).find(
      (item) => item.nodeId === "generation-a"
    );
    await retryRunItem(project.path, failedGeneration!.id);

    const resumed = await executeQueuedRun(project.path, queued.job.id, {
      runner: async (_projectPath, state, _request, item) => {
        const promptNode = state.graph.nodes.find((candidate) => candidate.id === "prompt");
        setTestNodeData(state, item.nodeId, {
          observedPromptText: promptNode?.data?.textOutput
        });
        return completeResult(item, "generate");
      }
    });

    const promptNode = resumed.execution.graph.nodes.find((candidate) => candidate.id === "prompt");
    const generationNode = resumed.execution.graph.nodes.find((candidate) => candidate.id === "generation-a");
    const [promptItem] = (await listJobItems(project.path, queued.job.id)).filter(
      (item) => item.nodeId === "prompt"
    );

    expect(promptNode?.data?.textOutput).toBe(longValue);
    expect(generationNode?.data?.observedPromptText).toBe(longValue);
    expect(JSON.stringify(promptItem?.output)).not.toContain("[omitted:");
    expect(JSON.stringify(resumed.execution.graph)).not.toContain("[omitted:");
  });

  it("returns the hydrated final graph when executing an already completed job", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Completed Rehydrate" });
    const outputText = "completed-output-".repeat(140);
    const queued = await enqueueRun(project.path, coordinatorGraph(), {
      policy: "selected",
      targetNodeIds: ["prompt"]
    });

    await executeQueuedRun(project.path, queued.job.id, {
      runner: async (_projectPath, state, _request, item) => {
        setTestNodeData(state, item.nodeId, { textOutput: outputText });
        return completeResult(item, "assemble-prompt");
      }
    });

    const completedAgain = await executeQueuedRun(project.path, queued.job.id);
    const promptNode = completedAgain.execution.graph.nodes.find((candidate) => candidate.id === "prompt");

    expect(completedAgain.job.status).toBe("completed");
    expect(promptNode?.data?.textOutput).toBe(outputText);
    expect(JSON.stringify(completedAgain.execution.graph)).not.toContain("[omitted:");
  });

  it("does not hydrate a completed job from another job's latest completed revision", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Completed Ownership" });
    const firstGraph = graph(
      [
        node("prompt-a", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "first job"
        })
      ],
      []
    );
    const secondGraph = graph(
      [
        node("prompt-b", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "second job"
        })
      ],
      []
    );
    const first = await enqueueRun(project.path, firstGraph, {
      policy: "selected",
      targetNodeIds: ["prompt-a"]
    });
    await transitionJobStatus(project.path, { jobId: first.job.id, from: "queued", to: "running" });
    await transitionJobStatus(project.path, { jobId: first.job.id, from: "running", to: "completed" });
    await appendJobEvent(project.path, {
      jobId: first.job.id,
      eventType: "run.completed",
      payload: { graphRevisionId: "missing-revision" }
    });
    const second = await enqueueRun(project.path, {
      ...secondGraph,
      updatedAt: new Date().toISOString()
    }, {
      policy: "selected",
      targetNodeIds: ["prompt-b"]
    });
    await executeQueuedRun(project.path, second.job.id, {
      runner: async (_projectPath, state, _request, item) => {
        setTestNodeData(state, item.nodeId, { textOutput: "second output" });
        return completeResult(item, "assemble-prompt");
      }
    });

    const firstAgain = await executeQueuedRun(project.path, first.job.id);

    expect(firstAgain.execution.graph.nodes.some((candidate) => candidate.id === "prompt-a")).toBe(true);
    expect(firstAgain.execution.graph.nodes.some((candidate) => candidate.id === "prompt-b")).toBe(false);
  });

  it("fails a parallel batch when sibling graph patches touch the same node", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Parallel Conflict" });
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General"
        }),
        node("generation-a", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        }),
        node("generation-b", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        }),
        node("shared", {
          definitionId: "note-text",
          kind: "Note",
          subtype: "Text",
          notes: "shared"
        } as any)
      ],
      [
        edge("edge-prompt-a", "prompt", "generation-a"),
        edge("edge-prompt-b", "prompt", "generation-b")
      ]
    );
    const queued = await enqueueRun(project.path, canvas, {
      policy: "branch",
      targetNodeIds: ["prompt"],
      runCountCap: 2,
      parallel: true
    });

    await executeQueuedRun(project.path, queued.job.id, {
      runner: async (_projectPath, state, _request, item) => {
        if (item.nodeId.startsWith("generation")) {
          setTestNodeData(state, "shared", { notes: item.nodeId });
          return completeResult(item, "generate");
        }
        setTestNodeData(state, item.nodeId, { status: "complete" });
        return completeResult(item, "assemble-prompt");
      }
    });

    await expect(getJobById(project.path, queued.job.id)).resolves.toMatchObject({ status: "failed" });
    await expect(listJobEvents(project.path, queued.job.id)).resolves.toContainEqual(
      expect.objectContaining({
        eventType: "run.conflict",
        payload: expect.objectContaining({ conflictedNodeIds: ["shared"] })
      })
    );
  });

  it("keeps item graph patch output bounded when a node has large metadata", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Bounded Patch" });
    const queued = await enqueueRun(project.path, coordinatorGraph(), {
      policy: "selected",
      targetNodeIds: ["prompt"]
    });
    const largeText = "x".repeat(20000);

    await executeQueuedRun(project.path, queued.job.id, {
      runner: async (_projectPath, state, _request, item) => {
        setTestNodeData(state, item.nodeId, { textOutput: largeText });
        return {
          ...completeResult(item, "assemble-prompt"),
          metadata: { largeText }
        };
      }
    });
    const [item] = await listJobItems(project.path, queued.job.id);

    expect(JSON.stringify(item?.output).length).toBeLessThan(10000);
    expect(JSON.stringify(item?.output)).not.toContain(largeText);
  });

  it("keeps medium-field graph patch item output bounded without storing the full node payload", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Oversized Medium Patch" });
    const queued = await enqueueRun(project.path, coordinatorGraph(), {
      policy: "selected",
      targetNodeIds: ["prompt"]
    });
    const mediumFields = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`mediumField${index}`, "m".repeat(999)])
    );

    await executeQueuedRun(project.path, queued.job.id, {
      runner: async (_projectPath, state, _request, item) => {
        setTestNodeData(state, item.nodeId, mediumFields);
        return completeResult(item, "assemble-prompt");
      }
    });
    const [item] = await listJobItems(project.path, queued.job.id);

    await expect(getJobById(project.path, queued.job.id)).resolves.toMatchObject({ status: "completed" });
    expect(item).toMatchObject({ status: "completed" });
    expect(JSON.stringify(item?.output).length).toBeLessThan(1000);
    expect(JSON.stringify(item?.output)).not.toContain("m".repeat(999));
  });

  it("returns failed jobs without trying to fail them again", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Run Failed Noop" });
    const queued = await enqueueRun(project.path, coordinatorGraph(), {
      policy: "selected",
      targetNodeIds: ["prompt"]
    });

    await executeQueuedRun(project.path, queued.job.id, {
      runner: async () => {
        throw new Error("first failure");
      }
    });
    const second = await executeQueuedRun(project.path, queued.job.id);

    expect(second.job.status).toBe("failed");
    await expect(getJobById(project.path, queued.job.id)).resolves.toMatchObject({ status: "failed" });
  });
});

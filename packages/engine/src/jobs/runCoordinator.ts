import {
  executePlannedJobItem,
  executionDependenciesForPlan,
  planExecution,
  type ExecutionNodeResult,
  type ExecutionPlan,
  type ExecutionQueueItem,
  type ExecutionRequest,
  type ExecutionRunResult,
  type ExecutionWorkerState
} from "../run/execution.js";
import { saveGraph, saveGraphWithRevision } from "../project/projectStore.js";
import { LATEST_GRAPH_VERSION, type EtherGraph } from "../project/schema.js";
import { blockedIncomingAdapterReason } from "../graph/adapterBlocks.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  addJobDependencies,
  addJobItems,
  appendJobEvent,
  cancelJobItem,
  enqueueJob,
  getJobById,
  getJobItemById,
  listJobEvents,
  listJobDependencies,
  listJobItems,
  listReadyJobItems,
  recordJobItemFailure,
  retryJobItem,
  transitionJobItemStatus,
  transitionJobStatus
} from "./jobStore.js";
import type {
  EtherJob,
  EtherJobDependency,
  EtherJobEvent,
  EtherJobItem,
  JsonRecord
} from "./types.js";
import { getGraphRevision, getLatestGraphRevision } from "../revisions/revisionStore.js";
import { GraphRevisionConflict, type GraphRevision } from "../revisions/types.js";

export type RunPreviewOperation =
  | {
      type: "provider";
      nodeId: string;
      iteration: number;
      kind: string;
      operation: string;
      status: "ready" | "blocked";
      reason?: string;
    }
  | {
      type: "adapter";
      edgeId: string;
      sourceNodeId: string;
      targetNodeId: string;
      operation: string;
      sourceChannel?: string;
      targetChannel?: string;
      status: string;
      required: true;
      reason?: string;
    };

export type RunPreviewItem = {
  nodeId: string;
  iteration: number;
  kind: string;
  willCallProvider: boolean;
  blockedReason?: string;
};

export type RunPreview = {
  plan: ExecutionPlan;
  dirtyNodeIds: string[];
  providerCallCandidates: string[];
  expectedOutputCount: number;
  blockedReasons: string[];
  items: RunPreviewItem[];
  operations: RunPreviewOperation[];
};

export type EnqueuedRun = {
  job: EtherJob;
  items: EtherJobItem[];
  dependencies: EtherJobDependency[];
  events: EtherJobEvent[];
  preview: RunPreview;
};

export type RunCoordinatorRunner = (
  projectPath: string,
  state: ExecutionWorkerState,
  request: ExecutionRequest,
  item: ExecutionQueueItem
) => Promise<ExecutionNodeResult>;

export type ExecuteQueuedRunOptions = {
  runner?: RunCoordinatorRunner;
  recoverRunningItems?: boolean;
  abandonedAfterMs?: number;
};

export type ExecutedQueuedRun = {
  job: EtherJob;
  items: EtherJobItem[];
  execution: ExecutionRunResult;
  revision: GraphRevision | null;
};

export type GraphPatch = {
  changedNodeIds: string[];
  addedNodeIds: string[];
  removedNodeIds: string[];
  changedEdgeIds: string[];
  addedEdgeIds: string[];
  removedEdgeIds: string[];
  artifactNodeIds: string[];
  nodes: EtherGraph["nodes"];
  edges: EtherGraph["edges"];
};

const RUN_JOB_KIND = "graph-run";
const MAX_ITEM_OUTPUT_JSON_BYTES = 10_000;
const MAX_REPLAY_PATCH_JSON_BYTES = 250_000;
const MAX_REPLAY_PATCH_NODES = 32;
const MAX_REPLAY_PATCH_EDGES = 64;

export async function previewRun(
  _projectPath: string,
  graph: EtherGraph,
  request: ExecutionRequest
): Promise<RunPreview> {
  return previewRunPlan(graph, request);
}

export function previewRunPlan(graph: EtherGraph, request: ExecutionRequest): RunPreview {
  const plan = planExecution(graph, request);
  const items = plan.items.map((item) => {
    const node = findNode(graph, item.nodeId);
    const data = readRecord(node.data);
    const kind = String(data.kind ?? "Unknown");
    const willCallProvider = kind === "Generation" || kind === "Edit" || kind === "Assistant";
    const blockedReason =
      data.locked === true
        ? "Node is locked"
        : blockedIncomingAdapterReason(graph, item.nodeId) ??
          (willCallProvider || isLocallyExecutableKind(kind, data.subtype)
            ? undefined
            : `${kind} nodes do not have local execution yet`);

    return {
      nodeId: item.nodeId,
      iteration: item.iteration,
      kind,
      willCallProvider,
      ...(blockedReason ? { blockedReason } : {})
    };
  });
  const providerCallCandidates = uniqueInOrder(
    items.filter((item) => item.willCallProvider && !item.blockedReason).map((item) => item.nodeId)
  );
  const itemByNodeId = new Map(items.map((item) => [item.nodeId, item]));
  const operations = plan.items.flatMap((plannedItem): RunPreviewOperation[] => {
    const item = itemByNodeId.get(plannedItem.nodeId);

    if (!item) {
      return [];
    }

    const data = readRecord(findNode(graph, plannedItem.nodeId).data);

    return [
      ...adapterOperationsForTarget(graph, plannedItem.nodeId),
      ...providerOperationForItem(item, data.subtype)
    ];
  });

  return {
    plan,
    dirtyNodeIds: uniqueInOrder(
      plan.items
        .filter((item) => isDirtyPlannedNode(findNode(graph, item.nodeId)))
        .map((item) => item.nodeId)
    ),
    providerCallCandidates,
    expectedOutputCount: items.filter((item) => item.willCallProvider && !item.blockedReason).length,
    blockedReasons: uniqueInOrder(items.map((item) => item.blockedReason).filter(isString)),
    items,
    operations
  };
}

export async function enqueueRun(
  projectPath: string,
  graph: EtherGraph,
  request: ExecutionRequest
): Promise<EnqueuedRun> {
  const preview = await previewRun(projectPath, graph, request);
  const baseRevision = await latestRevision(projectPath);

  assertRunGraphCanEnqueue(graph, baseRevision);
  const saved = await saveGraphWithRevision(projectPath, graph, {
    baseRevisionId: baseRevision?.id ?? null,
    reason: "run-enqueued",
    actor: "run-coordinator",
    metadata: {
      policy: request.policy,
      targetNodeIds: request.targetNodeIds,
      baseGraphRevisionId: baseRevision?.id ?? null
    }
  });
  const job = await enqueueJob(projectPath, {
    kind: RUN_JOB_KIND,
    graphRevisionId: saved.revision.id,
    rootNodeId: preview.plan.targetNodeIds.at(-1) ?? null,
    metadata: {
      request: serializeExecutionRequest(request),
      plan: preview.plan,
      preview: {
        dirtyNodeIds: preview.dirtyNodeIds,
        providerCallCandidates: preview.providerCallCandidates,
        expectedOutputCount: preview.expectedOutputCount,
        blockedReasons: preview.blockedReasons
      }
    },
    now: request.now?.()
  });
  const items = await addJobItems(projectPath, {
    jobId: job.id,
    items: preview.plan.items.map((item, index) => ({
      nodeId: item.nodeId,
      input: {
        nodeId: item.nodeId,
        iteration: item.iteration,
        order: index,
        request: serializeExecutionRequest(request)
      },
      metadata: {
        order: index,
        iteration: item.iteration
      }
    })),
    now: request.now?.()
  });
  const dependencies = await addJobDependencies(projectPath, {
    jobId: job.id,
    dependencies: dependencyPairsForRun(graph, preview.plan, items),
    now: request.now?.()
  });
  const previewEvent = await appendJobEvent(projectPath, {
    jobId: job.id,
    eventType: "run.previewed",
    payload: previewEventPayload(preview),
    now: request.now?.()
  });
  const enqueueEvent = await appendJobEvent(projectPath, {
    jobId: job.id,
    eventType: "run.enqueued",
    payload: {
      graphRevisionId: job.graphRevisionId,
      itemCount: items.length,
      dependencyCount: dependencies.length
    },
    now: request.now?.()
  });

  return {
    job,
    items,
    dependencies,
    events: [previewEvent, enqueueEvent],
    preview
  };
}

export async function executeQueuedRun(
  projectPath: string,
  jobId: string,
  options: ExecuteQueuedRunOptions = {}
): Promise<ExecutedQueuedRun> {
  const job = await requireRunJob(projectPath, jobId);

  if (job.status === "canceled") {
    await cancelQueuedItems(projectPath, jobId);
    return emptyExecutionResult(projectPath, job, await listJobItems(projectPath, jobId));
  }

  if (job.status === "completed") {
    return emptyExecutionResult(projectPath, job, await listJobItems(projectPath, jobId));
  }

  if (job.status === "failed") {
    return emptyExecutionResult(projectPath, job, await listJobItems(projectPath, jobId));
  }

  const initialGraph = await graphForJob(projectPath, job);
  const request = requestFromJob(job);
  if (options.recoverRunningItems) {
    await recoverRunningJobItems(projectPath, job.id, options.abandonedAfterMs ?? 0);
  }
  const state: ExecutionWorkerState = {
    graph: await applyCompletedItemPatches(projectPath, initialGraph, await listJobItems(projectPath, job.id))
  };
  const plan = readPlan(job);
  const runner = options.runner ?? executePlannedJobItem;
  const executionResults: ExecutionNodeResult[] = resultsFromJobItems(await listJobItems(projectPath, job.id));
  let currentJob = job;

  if (currentJob.status === "queued") {
    try {
      currentJob = await transitionJobStatus(projectPath, {
        jobId: job.id,
        from: "queued",
        to: "running",
        now: request.now?.()
      });
    } catch (error) {
      if (!isJobTransitionRace(error, job.id, "queued")) {
        throw error;
      }

      const reloaded = await requireRunJob(projectPath, job.id);
      if (reloaded.status !== "running") {
        return emptyExecutionResult(projectPath, reloaded, await listJobItems(projectPath, job.id));
      }
      currentJob = reloaded;
    }
  }

  try {
    while (true) {
      const readyItems = await listReadyJobItems(projectPath, job.id);

      if (readyItems.length === 0) {
        break;
      }

      const batch = request.parallel ? readyItems : readyItems.slice(0, 1);
      await appendJobEvent(projectPath, {
        jobId: job.id,
        eventType: request.parallel ? "run.execution.parallel" : "run.execution.sequential",
        payload: { readyItemCount: batch.length },
        now: request.now?.()
      });

      const batchResults = request.parallel
        ? await Promise.all(
            batch.map((item) =>
              executeReadyJobItem(projectPath, job.id, state.graph, request, item, runner)
            )
          )
        : [
            await executeReadyJobItem(projectPath, job.id, state.graph, request, batch[0], runner)
          ];

      const batchConflict = findPatchConflict(batchResults.map((result) => result.patch).filter(isGraphPatch));
      if (batchConflict) {
        const failedJob = await failRunWithConflict(projectPath, currentJob, batchConflict, request);
        return {
          job: failedJob,
          items: await listJobItems(projectPath, job.id),
          execution: {
            graph: state.graph,
            plan,
            results: resultsFromJobItems(await listJobItems(projectPath, job.id))
          },
          revision: null
        };
      }

      for (const batchResult of batchResults) {
        if (batchResult.result) {
          executionResults.push(batchResult.result);
        }

        if (batchResult.patch) {
          state.graph = applyGraphPatch(state.graph, batchResult.patch);
        }
      }

      if (batchResults.some((result) => result.failed)) {
        const failedJob = await transitionJobStatus(projectPath, {
          jobId: currentJob.id,
          from: currentJob.status,
          to: "failed",
          now: request.now?.()
        });
        await appendJobEvent(projectPath, {
          jobId: job.id,
          eventType: "run.failed",
          payload: { failedItemCount: batchResults.filter((result) => result.failed).length },
          now: request.now?.()
        });

        return {
          job: failedJob,
          items: await listJobItems(projectPath, job.id),
          execution: {
            graph: state.graph,
            plan,
            results: executionResults
          },
          revision: null
        };
      }

      if (!request.parallel) {
        continue;
      }
    }

    const finalItems = await listJobItems(projectPath, job.id);
    const failedItems = finalItems.filter((item) => item.status === "failed");
    if (failedItems.length > 0) {
      const failedJob = await transitionJobStatus(projectPath, {
        jobId: currentJob.id,
        from: currentJob.status,
        to: "failed",
        now: request.now?.()
      });
      await appendJobEvent(projectPath, {
        jobId: job.id,
        eventType: "run.failed",
        payload: { failedItemCount: failedItems.length },
        now: request.now?.()
      });
      return {
        job: failedJob,
        items: finalItems,
        execution: {
          graph: state.graph,
          plan,
          results: executionResults
        },
        revision: null
      };
    }

    if (finalItems.some((item) => item.status === "queued" || item.status === "running")) {
      return {
        job: currentJob,
        items: finalItems,
        execution: {
          graph: state.graph,
          plan,
          results: executionResults
        },
        revision: null
      };
    }

    const runPatch = createGraphPatch(initialGraph, state.graph);
    const rebase = await rebaseRunPatchOntoLatest(projectPath, job, initialGraph, runPatch);
    if (rebase.conflict) {
      const finalizedResult = await completedRunResultIfFinalized(projectPath, job.id);
      if (finalizedResult) {
        return finalizedResult;
      }

      const failedJob = await failRunWithConflict(projectPath, currentJob, rebase.conflict, request);
      return {
        job: failedJob,
        items: await listJobItems(projectPath, job.id),
        execution: {
          graph: state.graph,
          plan,
          results: resultsFromJobItems(await listJobItems(projectPath, job.id))
        },
        revision: null
      };
    }

    const outputGraph = rebase.graph;
    const revision = rebase.revision;
    const completedJob = await transitionJobStatus(projectPath, {
      jobId: currentJob.id,
      from: currentJob.status,
      to: "completed",
      now: request.now?.()
    });
    await appendJobEvent(projectPath, {
      jobId: job.id,
      eventType: "run.completed",
      payload: {
        graphRevisionId: revision?.id ?? null,
        resultCount: resultsFromJobItems(await listJobItems(projectPath, job.id)).length,
        graphPatch: graphPatchSummary(runPatch),
        updatedAt: outputGraph.updatedAt
      },
      now: request.now?.()
    });

    return {
      job: completedJob,
      items: await listJobItems(projectPath, job.id),
      execution: {
        graph: outputGraph,
        plan,
        results: resultsFromJobItems(await listJobItems(projectPath, job.id))
      },
      revision
    };
  } catch (error) {
    const finalizedResult = await completedRunResultIfFinalized(projectPath, job.id);
    if (finalizedResult) {
      return finalizedResult;
    }

    for (const item of await listJobItems(projectPath, job.id)) {
      if (item.status === "running") {
        await recordJobItemFailure(projectPath, {
          jobItemId: item.id,
          error: {
            code: "execution_exception",
            message: error instanceof Error ? error.message : "Execution failed"
          },
          now: request.now?.()
        });
      }
    }

    const failedJob = await transitionJobStatus(projectPath, {
      jobId: currentJob.id,
      from: currentJob.status,
      to: "failed",
      now: request.now?.()
    });
    await appendJobEvent(projectPath, {
      jobId: job.id,
      eventType: "run.failed",
      payload: { message: error instanceof Error ? error.message : "Execution failed" },
      now: request.now?.()
    });

    return {
      job: failedJob,
      items: await listJobItems(projectPath, job.id),
      execution: {
        graph: state.graph,
        plan,
        results: executionResults
      },
      revision: null
    };
  }
}

export async function cancelRunJob(projectPath: string, jobId: string): Promise<EtherJob> {
  const job = await requireRunJob(projectPath, jobId);

  if (job.status === "canceled") {
    return job;
  }

  if (job.status !== "queued" && job.status !== "running") {
    throw new Error(`Run job "${jobId}" is not queued or running.`);
  }

  await cancelQueuedItems(projectPath, jobId);
  const canceled = await transitionJobStatus(projectPath, {
    jobId,
    from: job.status,
    to: "canceled"
  });
  await appendJobEvent(projectPath, {
    jobId,
    eventType: "run.canceled",
    payload: { status: "canceled" }
  });

  return canceled;
}

export async function retryRunItem(projectPath: string, jobItemId: string): Promise<EtherJobItem> {
  const item = await getJobItemById(projectPath, jobItemId);

  if (!item) {
    throw new Error(`Job item "${jobItemId}" was not found.`);
  }

  const retried = await retryJobItem(projectPath, {
    jobItemId,
    error: { code: "retry_requested" }
  });
  const job = await getJobById(projectPath, item.jobId);
  if (job?.status === "failed") {
    await transitionJobStatus(projectPath, {
      jobId: item.jobId,
      from: "failed",
      to: "queued"
    });
  }
  await appendJobEvent(projectPath, {
    jobId: item.jobId,
    jobItemId,
    eventType: "item.retry",
    payload: { retryCount: retried.retryCount }
  });

  return retried;
}

type ReadyJobItemResult = {
  item: EtherJobItem;
  result: ExecutionNodeResult | null;
  patch: GraphPatch | null;
  failed: boolean;
};

async function executeReadyJobItem(
  projectPath: string,
  jobId: string,
  graph: EtherGraph,
  request: ExecutionRequest,
  item: EtherJobItem,
  runner: RunCoordinatorRunner
): Promise<ReadyJobItemResult> {
  try {
    await transitionJobItemStatus(projectPath, {
      jobItemId: item.id,
      from: "queued",
      to: "running",
      now: request.now?.()
    });
  } catch (error) {
    if (isTransitionRace(error, item.id, "queued")) {
      return { item, result: null, patch: null, failed: false };
    }

    throw error;
  }

  const workerState: ExecutionWorkerState = { graph };
  const queueItem = queueItemFromJobItem(item);

  try {
    const result = await runner(projectPath, workerState, request, queueItem);

    if (result.status === "error") {
      await recordJobItemFailure(projectPath, {
        jobItemId: item.id,
        error: {
          code: "execution_error",
          message: result.reason ?? "Execution failed"
        },
        now: request.now?.()
      });
      return { item, result, patch: null, failed: true };
    }

    const patch = createGraphPatch(graph, workerState.graph);
    const replayLimitError = replayPatchLimitError(patch);

    if (replayLimitError) {
      await recordJobItemFailure(projectPath, {
        jobItemId: item.id,
        error: replayLimitError,
        now: request.now?.()
      });
      await appendJobEvent(projectPath, {
        jobId,
        jobItemId: item.id,
        eventType: "run.failed",
        payload: {
          code: replayLimitError.code,
          message: replayLimitError.message,
          nodeId: item.nodeId,
          iteration: queueItem.iteration
        },
        now: request.now?.()
      });

      return { item, result: null, patch: null, failed: true };
    }

    const replayPatchPath = await writeReplayPatch(projectPath, jobId, item.id, patch);
    const output = jsonRecord({
      status: result.status,
      action: result.action,
      reason: result.reason,
      assetId: result.assetId,
      assetPath: result.assetPath,
      metadata: boundedResultMetadata(result.metadata),
      graphPatch: graphPatchForStorage(patch),
      replayPatchPath
    });
    const outputLimitError = itemOutputLimitError(output);

    if (outputLimitError) {
      await recordJobItemFailure(projectPath, {
        jobItemId: item.id,
        error: outputLimitError,
        now: request.now?.()
      });
      await appendJobEvent(projectPath, {
        jobId,
        jobItemId: item.id,
        eventType: "run.failed",
        payload: {
          code: outputLimitError.code,
          message: outputLimitError.message,
          nodeId: item.nodeId,
          iteration: queueItem.iteration
        },
        now: request.now?.()
      });

      return { item, result: null, patch: null, failed: true };
    }

    await transitionJobItemStatus(projectPath, {
      jobItemId: item.id,
      from: "running",
      to: result.status === "skipped" ? "skipped" : "completed",
      error: null,
      output,
      now: request.now?.()
    });
    await appendJobEvent(projectPath, {
      jobId,
      jobItemId: item.id,
      eventType: result.status === "skipped" ? "run.item.skipped" : "run.item.completed",
      payload: {
        nodeId: item.nodeId,
        iteration: queueItem.iteration,
        status: result.status,
        action: result.action,
        graphPatch: graphPatchSummary(patch)
      },
      now: request.now?.()
    });

    return { item, result, patch, failed: false };
  } catch (error) {
    await recordJobItemFailure(projectPath, {
      jobItemId: item.id,
      error: {
        code: "execution_exception",
        message: error instanceof Error ? error.message : "Execution failed"
      },
      now: request.now?.()
    });

    return { item, result: null, patch: null, failed: true };
  }
}

function queueItemFromJobItem(item: EtherJobItem): ExecutionQueueItem {
  return {
    nodeId: item.nodeId,
    iteration: typeof item.input.iteration === "number" ? item.input.iteration : 1
  };
}

function dependencyPairsForRun(
  graph: EtherGraph,
  plan: ExecutionPlan,
  items: EtherJobItem[]
): Array<{ parentJobItemId: string; childJobItemId: string }> {
  const itemByNodeIteration = new Map(
    items.map((item) => [
      itemKey(item.nodeId, typeof item.input.iteration === "number" ? item.input.iteration : 1),
      item.id
    ])
  );
  const itemIdsByNode = new Map<string, string[]>();
  for (const item of items) {
    itemIdsByNode.set(item.nodeId, [...(itemIdsByNode.get(item.nodeId) ?? []), item.id]);
  }
  const pairs: Array<{ parentJobItemId: string; childJobItemId: string }> = [];

  if (!plan.parallel) {
    for (let index = 1; index < items.length; index += 1) {
      pairs.push({
        parentJobItemId: items[index - 1].id,
        childJobItemId: items[index].id
      });
    }
    return pairs;
  }

  const dependencies = executionDependenciesForPlan(graph, plan.items);
  for (const item of plan.items) {
    const childId = itemByNodeIteration.get(itemKey(item.nodeId, item.iteration));
    if (!childId) {
      continue;
    }

    if (item.iteration > 1) {
      const previousIterationId = itemByNodeIteration.get(itemKey(item.nodeId, item.iteration - 1));
      if (previousIterationId) {
        pairs.push({ parentJobItemId: previousIterationId, childJobItemId: childId });
      }
    }

    for (const parentNodeId of dependencies.get(item.nodeId) ?? []) {
      for (const parentId of itemIdsByNode.get(parentNodeId) ?? []) {
        pairs.push({ parentJobItemId: parentId, childJobItemId: childId });
      }
    }
  }

  return uniqueDependencyPairs(pairs);
}

async function requireRunJob(projectPath: string, jobId: string) {
  const job = await getJobById(projectPath, jobId);

  if (!job) {
    throw new Error(`Run job "${jobId}" was not found.`);
  }

  if (job.kind !== RUN_JOB_KIND) {
    throw new Error(`Job "${jobId}" is not a graph run job.`);
  }

  return job;
}

async function graphForJob(projectPath: string, job: EtherJob): Promise<EtherGraph> {
  if (!job.graphRevisionId) {
    throw new Error(`Run job "${job.id}" does not have a graph revision.`);
  }

  const revision = await getGraphRevision(projectPath, job.graphRevisionId);
  if (!revision) {
    throw new Error(`Graph revision "${job.graphRevisionId}" was not found.`);
  }

  return revision.graph;
}

function requestFromJob(job: EtherJob): ExecutionRequest {
  const request = readRecord(job.metadata.request);

  return {
    policy: request.policy as ExecutionRequest["policy"],
    targetNodeIds: readStringArray(request.targetNodeIds),
    ...(typeof request.runCountCap === "number" ? { runCountCap: request.runCountCap } : {}),
    ...(request.parallel === true ? { parallel: true } : {}),
    ...(typeof request.providerId === "string" ? { providerId: request.providerId } : {}),
    ...(typeof request.assistantCodexCliPath === "string"
      ? { assistantCodexCliPath: request.assistantCodexCliPath }
      : {})
  };
}

function serializeExecutionRequest(request: ExecutionRequest): JsonRecord {
  return jsonRecord({
    policy: request.policy,
    targetNodeIds: request.targetNodeIds,
    runCountCap: request.runCountCap,
    parallel: request.parallel,
    providerId: request.providerId,
    assistantCodexCliPath: request.assistantCodexCliPath
  });
}

async function cancelQueuedItems(projectPath: string, jobId: string) {
  for (const item of await listJobItems(projectPath, jobId)) {
    if (item.status === "queued" || item.status === "running") {
      await cancelJobItem(projectPath, { jobItemId: item.id });
    }
  }
}

async function emptyExecutionResult(
  projectPath: string,
  job: EtherJob,
  items: EtherJobItem[]
): Promise<ExecutedQueuedRun> {
  const completedRevision = job.status === "completed" ? await completedGraphRevision(projectPath, job) : null;
  const graph = completedRevision?.graph ?? (job.graphRevisionId ? (await getGraphRevision(projectPath, job.graphRevisionId))?.graph : null);
  const hydratedGraph =
    job.status === "completed" && completedRevision
      ? completedRevision.graph
      : graph
        ? await applyCompletedItemPatches(projectPath, graph, items)
        : null;
  const request = requestFromJob(job);

  return {
    job,
    items,
    execution: {
      graph:
        hydratedGraph ?? {
          graphVersion: LATEST_GRAPH_VERSION,
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          selectedSnapshotId: null,
          updatedAt: new Date().toISOString()
        },
      plan: graph ? planExecution(graph, request) : readPlan(job),
      results: resultsFromJobItems(items)
    },
    revision: null
  };
}

async function completedRunResultIfFinalized(
  projectPath: string,
  jobId: string
): Promise<ExecutedQueuedRun | null> {
  const job = await requireRunJob(projectPath, jobId);

  if (job.status !== "completed") {
    return null;
  }

  return emptyExecutionResult(projectPath, job, await listJobItems(projectPath, jobId));
}

async function completedGraphRevision(projectPath: string, job: EtherJob): Promise<GraphRevision | null> {
  const completedEvents = (await listJobEvents(projectPath, job.id)).filter(
    (event) => event.eventType === "run.completed"
  );

  for (const event of completedEvents.reverse()) {
    if (typeof event.payload.graphRevisionId === "string" && event.payload.graphRevisionId.length > 0) {
      const revision = await getGraphRevision(projectPath, event.payload.graphRevisionId);
      if (revision && revision.metadata.jobId === job.id) {
        return revision;
      }
    }
  }

  const latest = await latestRevision(projectPath);
  return latest?.metadata.jobId === job.id ? latest : null;
}

function previewEventPayload(preview: RunPreview): JsonRecord {
  return {
    itemCount: preview.plan.items.length,
    dirtyNodeIds: preview.dirtyNodeIds,
    providerCallCandidates: preview.providerCallCandidates,
    expectedOutputCount: preview.expectedOutputCount,
    blockedReasons: preview.blockedReasons
  };
}

function readPlan(job: EtherJob): ExecutionPlan {
  return readRecord(job.metadata.plan) as unknown as ExecutionPlan;
}

async function latestRevision(projectPath: string) {
  return getLatestGraphRevision(projectPath);
}

function assertRunGraphCanEnqueue(graph: EtherGraph, latest: GraphRevision | null) {
  if (!latest) {
    return;
  }

  const submittedAt = Date.parse(graph.updatedAt);
  const latestAt = Date.parse(latest.graph.updatedAt);

  if (!Number.isFinite(submittedAt) || !Number.isFinite(latestAt)) {
    if (!hasSameDurableGraphContent(graph, latest.graph)) {
      throw new Error("The graph changed since this run was prepared. Save or reload the canvas and try again.");
    }
    return;
  }

  if (submittedAt < latestAt && !hasSameDurableGraphContent(graph, latest.graph)) {
    throw new Error("The graph changed since this run was prepared. Save or reload the canvas and try again.");
  }
}

function hasSameDurableGraphContent(left: EtherGraph, right: EtherGraph) {
  return (
    stableJson({
      nodes: left.nodes,
      edges: left.edges,
      viewport: left.viewport,
      selectedSnapshotId: left.selectedSnapshotId ?? null
    }) ===
    stableJson({
      nodes: right.nodes,
      edges: right.edges,
      viewport: right.viewport,
      selectedSnapshotId: right.selectedSnapshotId ?? null
    })
  );
}

async function recoverRunningJobItems(projectPath: string, jobId: string, abandonedAfterMs: number) {
  const nowMs = Date.now();

  for (const item of await listJobItems(projectPath, jobId)) {
    if (item.status !== "running") {
      continue;
    }

    const startedAtMs = item.startedAt ? Date.parse(item.startedAt) : 0;
    const ageMs = Number.isFinite(startedAtMs) ? nowMs - startedAtMs : Number.MAX_SAFE_INTEGER;

    if (!item.startedAt || ageMs >= abandonedAfterMs) {
      await transitionJobItemStatus(projectPath, {
        jobItemId: item.id,
        from: "running",
        to: "queued"
      });
    }
  }
}

function resultsFromJobItems(items: EtherJobItem[]): ExecutionNodeResult[] {
  return [...items]
    .sort((left, right) => readItemOrder(left) - readItemOrder(right))
    .filter((item) => item.status === "completed" || item.status === "skipped")
    .map((item) => {
      const iteration = typeof item.input.iteration === "number" ? item.input.iteration : 1;
      const status = item.output.status === "skipped" ? "skipped" : "complete";
      const action = typeof item.output.action === "string" ? item.output.action : "execute";

      return {
        nodeId: item.nodeId,
        iteration,
        status,
        action,
        ...(typeof item.output.reason === "string" ? { reason: item.output.reason } : {}),
        ...(typeof item.output.assetId === "string" ? { assetId: item.output.assetId } : {}),
        ...(typeof item.output.assetPath === "string" ? { assetPath: item.output.assetPath } : {}),
        metadata: readRecord(item.output.metadata),
        startedAt: item.startedAt ?? item.createdAt,
        finishedAt: item.finishedAt ?? item.updatedAt
      };
    });
}

function readItemOrder(item: EtherJobItem) {
  return typeof item.input.order === "number" ? item.input.order : Number.MAX_SAFE_INTEGER;
}

async function rebaseRunPatchOntoLatest(
  projectPath: string,
  job: EtherJob,
  baseGraph: EtherGraph,
  runPatch: GraphPatch
): Promise<
  | { graph: EtherGraph; revision: GraphRevision | null; conflict: null }
  | { graph: EtherGraph; revision: null; conflict: GraphPatchConflict }
> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const latest = await latestRevision(projectPath);
    const latestGraph = latest?.graph ?? baseGraph;

    if (latest?.id && latest.id !== job.graphRevisionId) {
      const userPatch = createGraphPatch(baseGraph, latestGraph);
      const conflict = graphPatchConflict(runPatch, userPatch);

      if (conflict) {
        return { graph: latestGraph, revision: null, conflict };
      }
    }

    const graph = applyGraphPatch(latestGraph, runPatch);

    try {
      const savedGraph = await saveGraph(projectPath, graph, {
        baseRevisionId: latest?.id ?? null,
        reason: "run-completed",
        actor: "run-coordinator",
        metadata: {
          jobId: job.id,
          graphPatch: graphPatchSummary(runPatch)
        }
      });

      return { graph: savedGraph, revision: await latestRevision(projectPath), conflict: null };
    } catch (error) {
      if (!(error instanceof GraphRevisionConflict)) {
        throw error;
      }

      if (attempt === 0) {
        continue;
      }

      const refreshed = await latestRevision(projectPath);
      const refreshedGraph = refreshed?.graph ?? latestGraph;
      const refreshedConflict = graphPatchConflict(runPatch, createGraphPatch(baseGraph, refreshedGraph));
      return {
        graph: refreshedGraph,
        revision: null,
        conflict: refreshedConflict ?? {
          conflictedNodeIds: touchedNodeIds(runPatch),
          conflictedEdgeIds: touchedEdgeIds(runPatch)
        }
      };
    }
  }

  return {
    graph: baseGraph,
    revision: null,
    conflict: {
      conflictedNodeIds: touchedNodeIds(runPatch),
      conflictedEdgeIds: touchedEdgeIds(runPatch)
    }
  };
}

type GraphPatchConflict = {
  conflictedNodeIds: string[];
  conflictedEdgeIds: string[];
};

async function failRunWithConflict(
  projectPath: string,
  job: EtherJob,
  conflict: GraphPatchConflict,
  request: ExecutionRequest
): Promise<EtherJob> {
  const latestJob = await requireRunJob(projectPath, job.id);

  if (latestJob.status === "completed" || latestJob.status === "failed") {
    return latestJob;
  }

  await appendJobEvent(projectPath, {
    jobId: job.id,
    eventType: "run.conflict",
    payload: {
      conflictedNodeIds: conflict.conflictedNodeIds,
      conflictedEdgeIds: conflict.conflictedEdgeIds
    },
    now: request.now?.()
  });

  return transitionJobStatus(projectPath, {
    jobId: job.id,
    from: latestJob.status,
    to: "failed",
    now: request.now?.()
  });
}

function createGraphPatch(before: EtherGraph, after: EtherGraph): GraphPatch {
  const beforeNodes = new Map(before.nodes.map((node) => [String(node.id), node]));
  const afterNodes = new Map(after.nodes.map((node) => [String(node.id), node]));
  const beforeEdges = new Map(before.edges.map((edge) => [String(edge.id), edge]));
  const afterEdges = new Map(after.edges.map((edge) => [String(edge.id), edge]));
  const addedNodeIds = after.nodes.filter((node) => !beforeNodes.has(String(node.id))).map((node) => String(node.id));
  const removedNodeIds = before.nodes.filter((node) => !afterNodes.has(String(node.id))).map((node) => String(node.id));
  const changedNodeIds = after.nodes
    .filter((node) => beforeNodes.has(String(node.id)) && stableJson(beforeNodes.get(String(node.id))) !== stableJson(node))
    .map((node) => String(node.id));
  const addedEdgeIds = after.edges.filter((edge) => !beforeEdges.has(String(edge.id))).map((edge) => String(edge.id));
  const removedEdgeIds = before.edges.filter((edge) => !afterEdges.has(String(edge.id))).map((edge) => String(edge.id));
  const changedEdgeIds = after.edges
    .filter((edge) => beforeEdges.has(String(edge.id)) && stableJson(beforeEdges.get(String(edge.id))) !== stableJson(edge))
    .map((edge) => String(edge.id));
  const nodeIdsForStorage = new Set([...addedNodeIds, ...changedNodeIds]);
  const edgeIdsForStorage = new Set([...addedEdgeIds, ...changedEdgeIds]);

  return {
    changedNodeIds,
    addedNodeIds,
    removedNodeIds,
    changedEdgeIds,
    addedEdgeIds,
    removedEdgeIds,
    artifactNodeIds: after.nodes
      .filter((node) => nodeIdsForStorage.has(String(node.id)) && hasArtifactOutputChange(node))
      .map((node) => String(node.id)),
    nodes: after.nodes.filter((node) => nodeIdsForStorage.has(String(node.id))),
    edges: after.edges.filter((edge) => edgeIdsForStorage.has(String(edge.id)))
  };
}

async function applyCompletedItemPatches(
  projectPath: string,
  graph: EtherGraph,
  items: EtherJobItem[]
): Promise<EtherGraph> {
  let currentGraph = graph;

  for (const item of items
    .filter((entry) => entry.status === "completed" || entry.status === "skipped")
    .sort((left, right) => readItemOrder(left) - readItemOrder(right))) {
    currentGraph = applyGraphPatch(currentGraph, await readReplayPatch(projectPath, item));
  }

  return currentGraph;
}

function applyGraphPatch(graph: EtherGraph, patch: GraphPatch | null): EtherGraph {
  if (!patch) {
    return graph;
  }

  const removedNodeIds = new Set(patch.removedNodeIds);
  const replacementNodes = new Map(patch.nodes.map((node) => [String(node.id), node]));
  const existingNodeIds = new Set(graph.nodes.map((node) => String(node.id)));
  const nodes = [
    ...graph.nodes
      .filter((node) => !removedNodeIds.has(String(node.id)))
      .map((node) => replacementNodes.get(String(node.id)) ?? node),
    ...patch.nodes.filter((node) => !existingNodeIds.has(String(node.id)) && !removedNodeIds.has(String(node.id)))
  ];
  const removedEdgeIds = new Set(patch.removedEdgeIds);
  const replacementEdges = new Map(patch.edges.map((edge) => [String(edge.id), edge]));
  const existingEdgeIds = new Set(graph.edges.map((edge) => String(edge.id)));
  const edges = [
    ...graph.edges
      .filter((edge) => !removedEdgeIds.has(String(edge.id)))
      .map((edge) => replacementEdges.get(String(edge.id)) ?? edge),
    ...patch.edges.filter((edge) => !existingEdgeIds.has(String(edge.id)) && !removedEdgeIds.has(String(edge.id)))
  ];

  return {
    ...graph,
    nodes,
    edges
  };
}

function graphPatchForStorage(patch: GraphPatch): JsonRecord {
  return {
    ...graphPatchSummary(patch),
    nodeCount: patch.nodes.length,
    edgeCount: patch.edges.length
  };
}

async function writeReplayPatch(
  projectPath: string,
  jobId: string,
  jobItemId: string,
  patch: GraphPatch
): Promise<string> {
  const relativePath = path.join("runs", "jobs", jobId, `${jobItemId}.graph-patch.json`);
  const absolutePath = path.join(projectPath, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(patch), "utf8");
  return relativePath.replace(/\\/g, "/");
}

async function readReplayPatch(projectPath: string, item: EtherJobItem): Promise<GraphPatch | null> {
  const replayPatchPath =
    typeof item.output.replayPatchPath === "string" ? item.output.replayPatchPath : "";

  if (!replayPatchPath) {
    return null;
  }

  const projectRoot = path.resolve(projectPath);
  const absolutePath = path.resolve(projectRoot, replayPatchPath);
  const projectPrefix = projectRoot.endsWith(path.sep) ? projectRoot : `${projectRoot}${path.sep}`;

  if (
    absolutePath !== projectRoot &&
    !absolutePath.toLocaleLowerCase().startsWith(projectPrefix.toLocaleLowerCase())
  ) {
    return null;
  }

  return readGraphPatch(JSON.parse(await readFile(absolutePath, "utf8")));
}

function graphPatchSummary(patch: GraphPatch): JsonRecord {
  return {
    changedNodeIds: patch.changedNodeIds,
    addedNodeIds: patch.addedNodeIds,
    removedNodeIds: patch.removedNodeIds,
    changedEdgeIds: patch.changedEdgeIds,
    addedEdgeIds: patch.addedEdgeIds,
    removedEdgeIds: patch.removedEdgeIds,
    artifactNodeIds: patch.artifactNodeIds
  };
}

function readGraphPatch(value: unknown): GraphPatch | null {
  const record = readRecord(value);
  const patch: GraphPatch = {
    changedNodeIds: readStringArray(record.changedNodeIds),
    addedNodeIds: readStringArray(record.addedNodeIds),
    removedNodeIds: readStringArray(record.removedNodeIds),
    changedEdgeIds: readStringArray(record.changedEdgeIds),
    addedEdgeIds: readStringArray(record.addedEdgeIds),
    removedEdgeIds: readStringArray(record.removedEdgeIds),
    artifactNodeIds: readStringArray(record.artifactNodeIds),
    nodes: Array.isArray(record.nodes) ? (record.nodes as EtherGraph["nodes"]) : [],
    edges: Array.isArray(record.edges) ? (record.edges as EtherGraph["edges"]) : []
  };

  return hasGraphPatchContent(patch) ? patch : null;
}

function findPatchConflict(patches: GraphPatch[]): GraphPatchConflict | null {
  const seenNodeIds = new Set<string>();
  const seenEdgeIds = new Set<string>();
  const conflictedNodeIds = new Set<string>();
  const conflictedEdgeIds = new Set<string>();

  for (const patch of patches) {
    for (const nodeId of touchedNodeIds(patch)) {
      if (seenNodeIds.has(nodeId)) {
        conflictedNodeIds.add(nodeId);
      }
      seenNodeIds.add(nodeId);
    }

    for (const edgeId of touchedEdgeIds(patch)) {
      if (seenEdgeIds.has(edgeId)) {
        conflictedEdgeIds.add(edgeId);
      }
      seenEdgeIds.add(edgeId);
    }
  }

  return conflictedNodeIds.size > 0 || conflictedEdgeIds.size > 0
    ? {
        conflictedNodeIds: [...conflictedNodeIds],
        conflictedEdgeIds: [...conflictedEdgeIds]
      }
    : null;
}

function graphPatchConflict(left: GraphPatch, right: GraphPatch): GraphPatchConflict | null {
  const rightNodeIds = new Set(touchedNodeIds(right));
  const rightEdgeIds = new Set(touchedEdgeIds(right));
  const conflictedNodeIds = touchedNodeIds(left).filter((nodeId) => rightNodeIds.has(nodeId));
  const conflictedEdgeIds = touchedEdgeIds(left).filter((edgeId) => rightEdgeIds.has(edgeId));

  return conflictedNodeIds.length > 0 || conflictedEdgeIds.length > 0
    ? { conflictedNodeIds, conflictedEdgeIds }
    : null;
}

function touchedNodeIds(patch: GraphPatch) {
  return uniqueInOrder([...patch.changedNodeIds, ...patch.addedNodeIds, ...patch.removedNodeIds]);
}

function touchedEdgeIds(patch: GraphPatch) {
  return uniqueInOrder([...patch.changedEdgeIds, ...patch.addedEdgeIds, ...patch.removedEdgeIds]);
}

function isGraphPatch(value: GraphPatch | null): value is GraphPatch {
  return value !== null;
}

function hasGraphPatchContent(patch: GraphPatch) {
  return (
    patch.changedNodeIds.length > 0 ||
    patch.addedNodeIds.length > 0 ||
    patch.removedNodeIds.length > 0 ||
    patch.changedEdgeIds.length > 0 ||
    patch.addedEdgeIds.length > 0 ||
    patch.removedEdgeIds.length > 0
  );
}

function findNode(graph: EtherGraph, nodeId: string) {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new Error(`Unknown graph node: ${nodeId}`);
  }

  return node;
}

function isDirtyPlannedNode(node: EtherGraph["nodes"][number]) {
  const data = readRecord(node.data);
  return (
    data.dirty === true ||
    typeof data.staleSince === "string" ||
    data.rerunState === "stale" ||
    data.rerunState === "error"
  );
}

function isLocallyExecutableKind(kind: string, subtype: unknown) {
  return (
    kind === "Prompt" ||
    kind === "Generation" ||
    kind === "Edit" ||
    kind === "Assistant" ||
    (kind === "Store" && ["Collection", "Directory", "Compare", "Evaluate", "Filter"].includes(String(subtype ?? "")))
  );
}

function providerOperationForItem(item: RunPreviewItem, subtype: unknown): RunPreviewOperation[] {
  const operation = providerOperationName(item.kind, subtype);

  if (!operation) {
    return [];
  }

  return [
    {
      type: "provider",
      nodeId: item.nodeId,
      iteration: item.iteration,
      kind: item.kind,
      operation,
      status: item.blockedReason ? "blocked" : "ready",
      ...(item.blockedReason ? { reason: item.blockedReason } : {})
    }
  ];
}

function providerOperationName(kind: string, subtype: unknown): string | null {
  if (kind === "Generation") {
    return "image.generate";
  }

  if (kind === "Edit") {
    return "image.edit";
  }

  if (kind === "Assistant") {
    return "assistant.text";
  }

  if (kind === "Store" && String(subtype ?? "") === "Evaluate") {
    return "evaluation.vision";
  }

  return null;
}

function adapterOperationsForTarget(graph: EtherGraph, targetNodeId: string): RunPreviewOperation[] {
  return graph.edges.flatMap((edge): RunPreviewOperation[] => {
    if (edge.target !== targetNodeId) {
      return [];
    }

    const data = readRecord(edge.data);
    const adapter = readRecord(data.adapter);
    const operation = adapterOperationName(adapter.operation);

    if (!operation) {
      return [];
    }

    const status = typeof adapter.status === "string" && adapter.status.length > 0 ? adapter.status : "required";
    const reason = adapterOperationReason(data, adapter);

    return [
      {
        type: "adapter",
        edgeId: String(edge.id),
        sourceNodeId: String(edge.source),
        targetNodeId: String(edge.target),
        operation,
        ...(typeof data.sourceChannel === "string" ? { sourceChannel: data.sourceChannel } : {}),
        ...(typeof data.targetChannel === "string" ? { targetChannel: data.targetChannel } : {}),
        status,
        required: true,
        ...(reason ? { reason } : {})
      }
    ];
  });
}

function adapterOperationName(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const operation = value.trim();
  return operation.startsWith("adapter.") ? operation : `adapter.${operation}`;
}

function adapterOperationReason(data: JsonRecord, adapter: JsonRecord) {
  const disabledReason = cleanText(data.disabledReason);

  if (disabledReason) {
    return disabledReason;
  }

  const adapterReason = cleanText(adapter.reason);

  return adapterReason || undefined;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function itemKey(nodeId: string, iteration: number) {
  return `${nodeId}:${iteration}`;
}

function hasArtifactOutputChange(node: EtherGraph["nodes"][number]) {
  const data = readRecord(node.data);
  return (
    typeof data.assetId === "string" ||
    typeof data.assetPath === "string" ||
    typeof data.textOutput === "string" ||
    Boolean(data.mutationArtifact) ||
    Boolean(data.compareArtifact) ||
    Boolean(data.evaluationArtifact) ||
    Boolean(data.filterResult)
  );
}

function sanitizeRecordForPatchStorage(record: JsonRecord): JsonRecord {
  const sanitized: JsonRecord = {};

  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && value.length > 1000) {
      sanitized[key] = `[omitted:${value.length}]`;
      continue;
    }

    if (JSON.stringify(value).length > 4000) {
      sanitized[key] = "[omitted:large]";
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

function boundedResultMetadata(metadata: Record<string, unknown> | undefined): JsonRecord | undefined {
  if (!metadata) {
    return undefined;
  }

  const sanitized = sanitizeRecordForPatchStorage(metadata);
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function replayPatchLimitError(patch: GraphPatch): JsonRecord | null {
  if (patch.nodes.length > MAX_REPLAY_PATCH_NODES || patch.edges.length > MAX_REPLAY_PATCH_EDGES) {
    return {
      code: "graph_patch_too_large",
      message: "Graph replay patch exceeded storage limits.",
      nodeCount: patch.nodes.length,
      edgeCount: patch.edges.length,
      maxNodeCount: MAX_REPLAY_PATCH_NODES,
      maxEdgeCount: MAX_REPLAY_PATCH_EDGES
    };
  }

  const byteLength = Buffer.byteLength(JSON.stringify(patch), "utf8");

  if (byteLength > MAX_REPLAY_PATCH_JSON_BYTES) {
    return {
      code: "graph_patch_too_large",
      message: "Graph replay patch exceeded storage limits.",
      byteLength,
      maxByteLength: MAX_REPLAY_PATCH_JSON_BYTES
    };
  }

  return null;
}

function itemOutputLimitError(output: JsonRecord): JsonRecord | null {
  const byteLength = Buffer.byteLength(JSON.stringify(output), "utf8");

  if (byteLength > MAX_ITEM_OUTPUT_JSON_BYTES) {
    return {
      code: "item_output_too_large",
      message: "Job item output exceeded storage limits.",
      byteLength,
      maxByteLength: MAX_ITEM_OUTPUT_JSON_BYTES
    };
  }

  return null;
}

function isTransitionRace(error: unknown, itemId: string, from: string) {
  return error instanceof Error && error.message.includes(`Job item "${itemId}" is not in status "${from}"`);
}

function isJobTransitionRace(error: unknown, jobId: string, from: string) {
  return error instanceof Error && error.message.includes(`Job "${jobId}" is not in status "${from}"`);
}

function jsonRecord(record: Record<string, unknown>): JsonRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as JsonRecord;
}

function readRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function uniqueInOrder(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function uniqueDependencyPairs(pairs: Array<{ parentJobItemId: string; childJobItemId: string }>) {
  const seen = new Set<string>();
  const result: Array<{ parentJobItemId: string; childJobItemId: string }> = [];

  for (const pair of pairs) {
    const key = `${pair.parentJobItemId}->${pair.childJobItemId}`;
    if (seen.has(key) || pair.parentJobItemId === pair.childJobItemId) {
      continue;
    }

    seen.add(key);
    result.push(pair);
  }

  return result;
}

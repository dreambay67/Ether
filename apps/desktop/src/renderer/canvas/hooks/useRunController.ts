import { useCallback, useEffect, useRef, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { EtherGraph, ExecutionPolicy, ExecutionRequest, RunPreview } from "@ether/engine";
import type { CanvasNodeData } from "@ether/engine/graph/nodeCatalog";
import { freezePromptNode } from "@ether/engine/graph/promptAssembly";
import {
  normalizeEdges,
  normalizeNodes
} from "./useCanvasGraph";
import type { MaskWorkspaceSavePayload } from "../inspector/types";

type UseRunControllerArgs = {
  graph: EtherGraph | null;
  projectId: string | null;
  localRunStatus: string | null;
  setLocalRunStatus(message: string | null): void;
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
  assemblyGraph: EtherGraph;
  selectedNode: Node<CanvasNodeData> | null;
  selectedNodeIds: string[];
  commitSnapshot(nextNodes: Node<CanvasNodeData>[], nextEdges: Edge[], traceMessage?: string): void;
  commitDurableSnapshot(nextNodes: Node<CanvasNodeData>[], nextEdges: Edge[], traceMessage?: string): void;
  commitDurableGraphIfCurrent(
    expectedFingerprint: string,
    nextGraph: EtherGraph,
    traceMessage?: string,
    staleMessage?: string
  ): boolean;
  graphContentFingerprint(graph: Pick<EtherGraph, "nodes" | "edges">): string;
  isCurrentGraphContent(graphOrFingerprint: Pick<EtherGraph, "nodes" | "edges"> | string): boolean;
  serializeCurrentGraph(): EtherGraph;
  onStatus(message: string): void;
  onTrace(message: string): void;
};

export type RunProviderMode = "codex" | "simulation";
export type NodeRunVisualStatus = "running" | "done" | "error";

export type RunPlanPreviewState = {
  graph: EtherGraph;
  preview: RunPreview;
  request: Omit<ExecutionRequest, "now">;
  fingerprint: string;
};

export function useRunController({
  graph,
  projectId,
  localRunStatus,
  setLocalRunStatus,
  nodes,
  edges,
  assemblyGraph,
  selectedNode,
  selectedNodeIds,
  commitSnapshot,
  commitDurableSnapshot,
  commitDurableGraphIfCurrent,
  graphContentFingerprint,
  isCurrentGraphContent,
  serializeCurrentGraph,
  onStatus,
  onTrace
}: UseRunControllerArgs) {
  const [pendingGeneratedAssetId, setPendingGeneratedAssetId] = useState<string | null>(null);
  const [executionPolicy, setExecutionPolicy] = useState<ExecutionPolicy>("cached-inputs");
  const [runCountCap, setRunCountCap] = useState(1);
  const [parallelExecution, setParallelExecution] = useState(false);
  const [runProviderMode, setRunProviderMode] = useState<RunProviderMode>("codex");
  const [runPreview, setRunPreview] = useState<RunPlanPreviewState | null>(null);
  const [isStartingPreviewRun, setIsStartingPreviewRun] = useState(false);
  const previewRequestSequenceRef = useRef(0);
  const previewStartInFlightRef = useRef(false);
  const [nodeRunVisualStatus, setNodeRunVisualStatus] = useState<Record<string, NodeRunVisualStatus>>({});
  const nodeRunVisualTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    if (graph) {
      setPendingGeneratedAssetId(null);
    }
  }, [graph]);

  useEffect(
    () => () => {
      for (const timer of nodeRunVisualTimersRef.current.values()) {
        clearTimeout(timer);
      }
      nodeRunVisualTimersRef.current.clear();
    },
    []
  );

  useEffect(() => {
    if (projectId) {
      setLocalRunStatus(null);
    }
  }, [projectId]);

  const setSafeRunCountCap = useCallback((cap: number) => {
    setRunCountCap(Number.isFinite(cap) ? Math.max(0, Math.min(100, Math.floor(cap))) : 0);
  }, []);

  const setRunVisualStatus = useCallback((nodeIds: string[], status: NodeRunVisualStatus, timeoutMs?: number) => {
    const uniqueNodeIds = [...new Set(nodeIds)].filter(Boolean);

    if (uniqueNodeIds.length === 0) {
      return;
    }

    for (const nodeId of uniqueNodeIds) {
      const existingTimer = nodeRunVisualTimersRef.current.get(nodeId);

      if (existingTimer) {
        clearTimeout(existingTimer);
        nodeRunVisualTimersRef.current.delete(nodeId);
      }
    }

    setNodeRunVisualStatus((current) => ({
      ...current,
      ...Object.fromEntries(uniqueNodeIds.map((nodeId) => [nodeId, status]))
    }));

    if (timeoutMs && timeoutMs > 0) {
      for (const nodeId of uniqueNodeIds) {
        const timer = setTimeout(() => {
          nodeRunVisualTimersRef.current.delete(nodeId);
          setNodeRunVisualStatus((current) => {
            if (current[nodeId] !== status) {
              return current;
            }

            const next = { ...current };
            delete next[nodeId];
            return next;
          });
        }, timeoutMs);

        nodeRunVisualTimersRef.current.set(nodeId, timer);
      }
    }
  }, []);

  const runNode = useCallback(
    (id: string) => {
      const target = nodes.find((node) => node.id === id);

      if (!target || target.data.kind !== "Prompt") {
        onStatus("Only prompt nodes can be assembled locally in this phase.");
        return;
      }

      if (target.data.locked) {
        const message = "Node is locked";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const nextGraph = freezePromptNode(assemblyGraph, id);
      const nextNodes = normalizeNodes(nextGraph.nodes).map((node) => ({
        ...node,
        data:
          node.id === id
            ? { ...node.data, rerunState: "complete" as const, staleSince: undefined }
            : node.data,
        selected: node.id === id
      }));
      const nextEdges = normalizeEdges(nextGraph.edges);
      const nextTarget = nextNodes.find((node) => node.id === id);
      const mutationArtifact =
        nextTarget?.data.mutationArtifact && typeof nextTarget.data.mutationArtifact === "object"
          ? (nextTarget.data.mutationArtifact as Record<string, unknown>)
          : null;
      const message = mutationArtifact
        ? `Mutation ${target.data.title} (${String(mutationArtifact.seed ?? "seeded")})`
        : `Assembled ${target.data.title}`;

      commitSnapshot(nextNodes, nextEdges, message);
      setLocalRunStatus(message);
      onStatus(message);
    },
    [assemblyGraph, commitSnapshot, nodes, onStatus]
  );

  const ensureStoreFolderForNode = useCallback(
    async (id: string, updates?: Partial<CanvasNodeData>) => {
      const target = nodes.find((node) => node.id === id);

      if (!target || target.data.kind !== "Store") {
        onStatus("Select a Collection or Directory node first.");
        return;
      }

      if (target.data.subtype !== "Collection" && target.data.subtype !== "Directory") {
        onStatus("Only Collection and Directory nodes mirror folders in this phase.");
        return;
      }

      if (target.data.locked) {
        const message = "Node is locked";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      if (!projectId) {
        const message = "Open a project to mirror folders";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const expectedFingerprint = graphContentFingerprint(serializeCurrentGraph());
      const targetData = { ...target.data, ...(updates ?? {}) };

      try {
        const customPath = typeof targetData.storePath === "string" && targetData.storePath.trim()
          ? targetData.storePath.trim()
          : undefined;
        const name =
          targetData.storeFolderName?.trim() ||
          targetData.label.trim() ||
          targetData.title;
        const asset =
          targetData.subtype === "Collection"
            ? await window.ether.asset.ensureCollection(projectId, { name, nodeId: target.id, path: customPath })
            : await window.ether.asset.ensureDirectory(projectId, { name, nodeId: target.id, path: customPath });
        if (!isCurrentGraphContent(expectedFingerprint)) {
          const message = "Folder mirror skipped; canvas changed while preparing the folder";
          setLocalRunStatus(message);
          onStatus(message);
          onTrace(message);
          return;
        }

        const currentGraph = serializeCurrentGraph();
        const currentNodes = normalizeNodes(currentGraph.nodes);
        const currentEdges = normalizeEdges(currentGraph.edges);
        const nextNodes = currentNodes.map((node) =>
          node.id === target.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...(updates ?? {}),
                  status: "complete" as const,
                  rerunState: "complete" as const,
                  staleSince: undefined,
                  storeAssetId: asset.id,
                  storePath: asset.path,
                  storeMetadata: asset.metadata
                }
              }
            : { ...node, selected: false }
        );
        const message = `${targetData.subtype} folder ready`;

        commitDurableSnapshot(nextNodes, currentEdges, message);
        onStatus(message);
      } catch (error) {
        onStatus(error instanceof Error ? error.message : "Folder mirror failed");
      }
    },
    [
      commitDurableSnapshot,
      graphContentFingerprint,
      isCurrentGraphContent,
      nodes,
      onStatus,
      onTrace,
      projectId,
      serializeCurrentGraph
    ]
  );

  const saveFakeGeneratedAssetForNode = useCallback(
    async (id: string) => {
      const target = nodes.find((node) => node.id === id);

      if (!target || target.data.kind !== "Generation") {
        onStatus("Select a Generation node first.");
        return;
      }

      if (target.data.locked) {
        const message = "Node is locked";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      if (!projectId) {
        const message = "Open a project to save fake generated output";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const expectedFingerprint = graphContentFingerprint(serializeCurrentGraph());

      try {
        const asset = await window.ether.asset.saveFakeGenerated(projectId, {
          generationNodeId: target.id,
          fileName: `fake-output-${target.id}-${Date.now()}.png`,
          content: `fake generated output for ${target.data.title}\n`,
          mimeType: "image/png"
        });
        if (!isCurrentGraphContent(expectedFingerprint)) {
          const message = "Generated output save skipped; canvas changed while saving";
          setPendingGeneratedAssetId(asset.id);
          setLocalRunStatus(message);
          onStatus(message);
          onTrace(message);
          return;
        }

        const currentGraph = serializeCurrentGraph();
        const currentNodes = normalizeNodes(currentGraph.nodes);
        const currentEdges = normalizeEdges(currentGraph.edges);
        const nextNodes = currentNodes.map((node) =>
          node.id === target.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  status: "complete" as const,
                  rerunState: "complete" as const,
                  staleSince: undefined,
                  assetId: asset.id,
                  assetKind: asset.kind,
                  assetPath: asset.path,
                  assetMetadata: asset.metadata
                }
              }
            : { ...node, selected: false }
        );
        const message = "Saved fake generated output";

        setPendingGeneratedAssetId(asset.id);
        commitDurableSnapshot(nextNodes, currentEdges, message);
        onStatus(message);
      } catch (error) {
        onStatus(error instanceof Error ? error.message : "Fake generated output save failed");
      }
    },
    [
      commitDurableSnapshot,
      graphContentFingerprint,
      isCurrentGraphContent,
      nodes,
      onStatus,
      onTrace,
      projectId,
      serializeCurrentGraph
    ]
  );

  const createMaskAssetForNode = useCallback(
    async (id: string, payload?: MaskWorkspaceSavePayload) => {
      const target = nodes.find((node) => node.id === id);

      if (!target || target.data.kind !== "Edit") {
        onStatus("Select an Edit node first.");
        return;
      }

      if (target.data.locked) {
        const message = "Node is locked";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      if (!projectId) {
        const message = "Open a project to save mask overlays";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const sourceAssetPath = target.data.sourceAssetPath ?? target.data.assetPath;

      if (!sourceAssetPath) {
        const message = "Add a source image before creating a mask.";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const expectedFingerprint = graphContentFingerprint(serializeCurrentGraph());

      try {
        const asset = await window.ether.asset.saveMask(projectId, {
          editNodeId: target.id,
          sourceAssetId: target.data.sourceAssetId ?? target.data.assetId,
          sourceAssetPath,
          fileName: payload?.fileName ?? `mask-${target.id}-${Date.now()}.svg`,
          content: payload?.content,
          mimeType: payload?.mimeType ?? "image/svg+xml",
          instruction: target.data.instruction,
          notes: target.data.notes,
          metadata: {
            sourceAssetKind: target.data.sourceAssetKind ?? target.data.assetKind,
            sourceAssetMetadata: target.data.sourceAssetMetadata ?? target.data.assetMetadata ?? {},
            ...(payload?.recipe ? { recipe: payload.recipe } : {}),
            ...(payload?.frame ? { frame: payload.frame } : {}),
            ...(payload?.metadata ?? {})
          }
        });
        const now = new Date().toISOString();
        const currentGraph = serializeCurrentGraph();
        const currentNodes = normalizeNodes(currentGraph.nodes);
        const currentEdges = normalizeEdges(currentGraph.edges);
        const currentTarget = currentNodes.find((node) => node.id === target.id);
        const currentSourceAssetPath =
          currentTarget?.data.kind === "Edit"
            ? currentTarget.data.sourceAssetPath ?? currentTarget.data.assetPath
            : null;

        if (!isCurrentGraphContent(expectedFingerprint) && currentSourceAssetPath !== sourceAssetPath) {
          const message = "Mask overlay skipped; source image changed while saving";
          setLocalRunStatus(message);
          onStatus(message);
          onTrace(message);
          return;
        }

        const nextNodes = currentNodes.map((node) =>
          node.id === target.id
            ? {
                ...node,
                selected: true,
                data: {
                  ...node.data,
                  maskAssetId: asset.id,
                  maskAssetPath: asset.path,
                  maskMetadata: asset.metadata,
                  editRecipe: payload?.recipe?.id ?? node.data.editRecipe,
                  editFrame: payload?.frame ?? node.data.editFrame,
                  rerunState: node.data.assetId ? ("stale" as const) : (node.data.rerunState ?? "ready"),
                  staleSince: node.data.assetId ? now : node.data.staleSince
                }
              }
            : { ...node, selected: false }
        );
        const message = "Mask overlay saved";

        commitDurableSnapshot(nextNodes, currentEdges, message);
        setLocalRunStatus(message);
        onStatus(message);
      } catch (error) {
        onStatus(error instanceof Error ? error.message : "Mask overlay save failed");
      }
    },
    [
      commitDurableSnapshot,
      graphContentFingerprint,
      isCurrentGraphContent,
      nodes,
      onStatus,
      onTrace,
      projectId,
      serializeCurrentGraph
    ]
  );

  const moveLatestGeneratedAssetToCollection = useCallback(
    async (collectionNodeId: string) => {
      const collectionNode = nodes.find((node) => node.id === collectionNodeId);

      if (
        !collectionNode ||
        collectionNode.data.kind !== "Store" ||
        collectionNode.data.subtype !== "Collection"
      ) {
        onStatus("Select a Collection node first.");
        return;
      }

      if (collectionNode.data.locked) {
        const message = "Node is locked";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      if (!projectId) {
        const message = "Open a project to move generated assets";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      if (!pendingGeneratedAssetId) {
        const message = "No pending generated output to move.";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const sourceNode = nodes.find(
        (node) =>
          node.data.kind === "Generation" &&
          node.data.assetKind === "generated" &&
          node.data.assetId === pendingGeneratedAssetId
      );

      if (!sourceNode?.data.assetId) {
        const message = "No pending generated output to move.";
        setPendingGeneratedAssetId(null);
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      if (sourceNode.data.locked) {
        const message = "Unlock the generated output before moving it.";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const expectedFingerprint = graphContentFingerprint(serializeCurrentGraph());

      try {
        const collectionName = collectionNode.data.label.trim() || collectionNode.data.title;
        const collectionAsset =
          collectionNode.data.storeAssetId && collectionNode.data.storePath
            ? {
                id: collectionNode.data.storeAssetId,
                path: collectionNode.data.storePath,
                metadata: collectionNode.data.storeMetadata ?? {}
              }
            : await window.ether.asset.ensureCollection(projectId, {
                name: collectionName,
                nodeId: collectionNode.id
              });
        const movedAsset = await window.ether.asset.moveToCollection(projectId, {
          assetId: sourceNode.data.assetId,
          collectionId: collectionAsset.id,
          reason: "manual-inspector-validation"
        });
        if (!isCurrentGraphContent(expectedFingerprint)) {
          const message = "Generated asset move skipped; canvas changed while moving";
          setLocalRunStatus(message);
          onStatus(message);
          onTrace(message);
          return;
        }

        const currentGraph = serializeCurrentGraph();
        const currentNodes = normalizeNodes(currentGraph.nodes);
        const currentEdges = normalizeEdges(currentGraph.edges);
        const nextNodes = currentNodes.map((node) => {
          if (node.id === sourceNode.id) {
            return {
              ...node,
              selected: false,
              data: {
                ...node.data,
                assetPath: movedAsset.path,
                assetMetadata: movedAsset.metadata
              }
            };
          }

          if (node.id === collectionNode.id) {
            return {
              ...node,
              selected: true,
              data: {
                ...node.data,
                status: "complete" as const,
                rerunState: "complete" as const,
                staleSince: undefined,
                storeAssetId: collectionAsset.id,
                storePath: collectionAsset.path,
                storeMetadata: collectionAsset.metadata,
                lastMovedAssetId: movedAsset.id,
                lastMovedAssetPath: movedAsset.path,
                lastMovedAt: movedAsset.updatedAt
              }
            };
          }

          return { ...node, selected: false };
        });
        const message = "Moved pending generated output to Collection";

        setPendingGeneratedAssetId(null);
        commitDurableSnapshot(nextNodes, currentEdges, message);
        onStatus(message);
      } catch (error) {
        onStatus(error instanceof Error ? error.message : "Generated asset move failed");
      }
    },
    [
      commitDurableSnapshot,
      graphContentFingerprint,
      isCurrentGraphContent,
      nodes,
      onStatus,
      onTrace,
      pendingGeneratedAssetId,
      projectId,
      serializeCurrentGraph
    ]
  );

  const createExecutionRequest = useCallback(
    (policy: ExecutionPolicy): Omit<ExecutionRequest, "now"> | null => {
      const targetNodeIds =
        policy === "selected" ? selectedNodeIds : selectedNode ? [selectedNode.id] : selectedNodeIds;

      if (targetNodeIds.length === 0) {
        onStatus("Select a node before running.");
        return null;
      }

      const cappedRunCount = Math.max(0, Math.min(100, Math.floor(runCountCap)));

      return {
        policy,
        targetNodeIds,
        runCountCap: cappedRunCount,
        parallel: parallelExecution,
        ...(runProviderMode === "simulation" ? { providerId: "ether-fake-local" } : {})
      };
    },
    [parallelExecution, runCountCap, runProviderMode, selectedNode, selectedNodeIds, onStatus]
  );

  const executeRun = useCallback(
    async (policyOrRequest: ExecutionPolicy | Omit<ExecutionRequest, "now">) => {
      const request =
        typeof policyOrRequest === "string" ? createExecutionRequest(policyOrRequest) : policyOrRequest;

      if (!request) {
        return;
      }

      if (!projectId) {
        const message = "Open a project to run the execution engine";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const submittedGraph = serializeCurrentGraph();
      const submittedFingerprint = graphContentFingerprint(submittedGraph);
      const queueMessage = `Queued ${request.policy} run for ${request.targetNodeIds.length} node${
        request.targetNodeIds.length === 1 ? "" : "s"
      }`;

      setLocalRunStatus(queueMessage);
      onTrace(queueMessage);
      setRunVisualStatus(request.targetNodeIds, "running");

      try {
        const durableJobs = window.ether.execution.jobs;
        const requestPayload = {
          policy: request.policy,
          targetNodeIds: request.targetNodeIds,
          runCountCap: request.runCountCap,
          parallel: request.parallel,
          providerId: request.providerId
        };
        const result = durableJobs
          ? await durableJobs.execute(
              projectId,
              (await durableJobs.enqueue(projectId, submittedGraph, requestPayload)).job.id
            ).then((queuedResult) => ({
              graph: queuedResult.execution.graph,
              plan: queuedResult.execution.plan,
              results: queuedResult.execution.results,
              job: queuedResult.job,
              items: queuedResult.items
            }))
          : await window.ether.execution.run(projectId, submittedGraph, requestPayload);
        const completed = result.results.filter((entry) => entry.status === "complete").length;
        const skipped = result.results.filter((entry) => entry.status === "skipped").length;
        const failed = "items" in result
          ? result.items.filter((item) => item.status === "failed").length
          : result.results.filter((entry) => entry.status === "error").length;
        const lastGeneratedAsset = [...result.results]
          .reverse()
          .find((entry) => entry.action === "generate");
        const summary = failed > 0
          ? `Run finished with ${failed} error${failed === 1 ? "" : "s"}`
          : "job" in result && result.job.status === "canceled"
            ? "Run canceled"
            : `Run complete: ${completed} complete, ${skipped} skipped`;

        if (!isCurrentGraphContent(submittedFingerprint)) {
          const message = "Run result skipped; canvas changed during execution";
          setLocalRunStatus(message);
          onStatus(message);
          onTrace(message);
          setRunVisualStatus(request.targetNodeIds, "done", 10000);
          for (const entry of result.results) {
            onTrace(`${entry.status} ${entry.nodeId} (${entry.action})`);
          }
          return;
        }

        if (lastGeneratedAsset?.assetId) {
          setPendingGeneratedAssetId(lastGeneratedAsset.assetId);
        }

        const applied = commitDurableGraphIfCurrent(submittedFingerprint, result.graph, summary, "Run result skipped; canvas changed during execution");
        if (!applied) {
          const message = "Run result skipped; canvas changed during execution";
          setLocalRunStatus(message);
          onStatus(message);
          setRunVisualStatus(request.targetNodeIds, "done", 10000);
          return;
        }

        for (const entry of result.results) {
          onTrace(`${entry.status} ${entry.nodeId} (${entry.action})`);
        }
        if ("items" in result) {
          for (const item of result.items) {
            if (item.status === "completed" || item.status === "skipped") {
              continue;
            }

            onTrace(`${item.status} ${item.nodeId} (job item)`);
          }
        }
        onStatus(summary);
        setRunVisualStatus(request.targetNodeIds, failed > 0 ? "error" : "done", 10000);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Execution run failed";
        setLocalRunStatus(message);
        onStatus(message);
        setRunVisualStatus(request.targetNodeIds, "error", 10000);
      }
    },
    [
      assemblyGraph,
      commitDurableGraphIfCurrent,
      commitDurableSnapshot,
      createExecutionRequest,
      graphContentFingerprint,
      isCurrentGraphContent,
      projectId,
      setRunVisualStatus,
      serializeCurrentGraph,
      onStatus,
      onTrace
    ]
  );

  const previewRun = useCallback(
    async (policy: ExecutionPolicy) => {
      const request = createExecutionRequest(policy);

      if (!request) {
        return;
      }

      if (!projectId) {
        const message = "Open a project to preview the execution engine";
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      const submittedGraph = serializeCurrentGraph();
      const submittedFingerprint = graphContentFingerprint(submittedGraph);
      const previewRequestId = previewRequestSequenceRef.current + 1;
      const message = `Previewing ${request.policy} run`;

      previewRequestSequenceRef.current = previewRequestId;
      setRunPreview(null);
      setLocalRunStatus(message);
      onTrace(message);

      try {
        const preview = await window.ether.execution.preview(projectId, submittedGraph, request);

        if (previewRequestId !== previewRequestSequenceRef.current) {
          return;
        }

        if (!isCurrentGraphContent(submittedFingerprint)) {
          const staleMessage = "Run preview skipped; canvas changed during planning";
          setLocalRunStatus(staleMessage);
          onStatus(staleMessage);
          onTrace(staleMessage);
          return;
        }

        setRunPreview({
          graph: submittedGraph,
          preview,
          request,
          fingerprint: submittedFingerprint
        });
        setLocalRunStatus("Run preview ready");
        onStatus("Run preview ready");
      } catch (error) {
        if (previewRequestId !== previewRequestSequenceRef.current) {
          return;
        }

        const errorMessage = error instanceof Error ? error.message : "Run preview failed";
        setLocalRunStatus(errorMessage);
        onStatus(errorMessage);
      }
    },
    [
      createExecutionRequest,
      graphContentFingerprint,
      isCurrentGraphContent,
      projectId,
      serializeCurrentGraph,
      onStatus,
      onTrace
    ]
  );

  const closeRunPreview = useCallback(() => {
    setRunPreview(null);
  }, []);

  const startPreviewRun = useCallback(() => {
    if (previewStartInFlightRef.current) {
      return;
    }

    const previewState = runPreview;

    if (!previewState) {
      return;
    }

    previewStartInFlightRef.current = true;
    setIsStartingPreviewRun(true);
    setRunPreview(null);
    if (!isCurrentGraphContent(previewState.fingerprint)) {
      const message = "Run start skipped; canvas changed after preview";
      setLocalRunStatus(message);
      onStatus(message);
      onTrace(message);
      previewStartInFlightRef.current = false;
      setIsStartingPreviewRun(false);
      return;
    }

    void executeRun(previewState.request).finally(() => {
      previewStartInFlightRef.current = false;
      setIsStartingPreviewRun(false);
    });
  }, [executeRun, isCurrentGraphContent, onStatus, onTrace, runPreview]);

  const cancelRun = useCallback(() => {
    const message = "Run cancellation placeholder; execution jobs are currently immediate.";
    setLocalRunStatus(message);
    onStatus(message);
  }, [onStatus]);

  const refreshTimeline = useCallback(() => {
    const message = "Timeline refreshed";
    setLocalRunStatus(message);
    onTrace(message);
  }, [onTrace]);

  return {
    localRunStatus,
    setLocalRunStatus,
    executionPolicy,
    setExecutionPolicy,
    runCountCap,
    setRunCountCap: setSafeRunCountCap,
    parallelExecution,
    setParallelExecution,
    runProviderMode,
    setRunProviderMode,
    runNode,
    runPreview,
    nodeRunVisualStatus,
    isStartingPreviewRun,
    previewRun,
    closeRunPreview,
    startPreviewRun,
    ensureStoreFolderForNode,
    saveFakeGeneratedAssetForNode,
    createMaskAssetForNode,
    moveLatestGeneratedAssetToCollection,
    cancelRun,
    refreshTimeline
  };
}

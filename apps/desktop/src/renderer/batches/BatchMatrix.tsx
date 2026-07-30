import { useEffect, useMemo, useState } from "react";
import { Gauge, Image, Rows3, Sparkles, Trash2 } from "lucide-react";
import {
  SAFE_ANTIGRAVITY_PROVIDER_PARALLELISM,
  SAFE_CODEX_PROVIDER_PARALLELISM,
  SAFE_GEMINI_API_PROVIDER_PARALLELISM,
  type BatchProviderAllocation,
  type EtherGraph,
  type ProviderCapability
} from "@ether/schema";
import {
  stableKey,
  useBatchPreview,
  type BatchConfigChange,
  type BatchNode
} from "./useBatchPreview";

type AllocationTarget = EtherGraph["nodes"][number] & {
  config:
    | Extract<EtherGraph["nodes"][number]["config"], { kind: "generation.image" }>
    | Extract<EtherGraph["nodes"][number]["config"], { kind: "prompt.worker" }>;
};

export function BatchMatrix({
  documentId,
  graph,
  onUpdated,
  onStatus
}: {
  documentId: string;
  graph: EtherGraph;
  onUpdated(): Promise<void>;
  onStatus(message: string): void;
}) {
  const batchNodes = useMemo(
    () => graph.nodes.filter((node): node is BatchNode => node.config.kind === "flow.batch"),
    [graph.nodes]
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(batchNodes[0]?.id ?? null);
  const node = batchNodes.find((candidate) => candidate.id === selectedNodeId) ?? batchNodes[0];
  useEffect(() => {
    if (node !== undefined && selectedNodeId !== node.id) setSelectedNodeId(node.id);
  }, [node, selectedNodeId]);
  const {
    capabilities,
    config,
    cells,
    totalCount,
    plan,
    message,
    isUpdating,
    update
  } = useBatchPreview({ documentId, graph, node, onUpdated });
  const targets = useMemo(
    () => node === undefined ? [] : allocationTargets(graph, node.id),
    [graph, node]
  );

  if (!node || !config) {
    return <section className="batch-matrix"><header><div><span className="eyebrow">Planning</span><h2>Batch Matrix</h2></div></header><p className="batch-empty">Add a Batch node to preview dimensions and work.</p></section>;
  }

  const visibleIncluded = cells.filter((cell) => !cell.excluded).length;
  const included = plan?.batchSummary?.workItemCount;
  const executableCount = included ?? Math.max(totalCount - (config.exclusions?.length ?? 0), 0);
  const cappedWarning = plan?.warnings.find((warning) => warning.code === "BATCH_EXPANSION_CAPPED");
  const save = async (change: BatchConfigChange, title: string, success: string) => {
    try {
      await update(change, title);
      onStatus(success);
    } catch (cause) {
      onStatus(cause instanceof Error ? cause.message : "The batch could not be updated.");
    }
  };
  const toggleCell = async (key: string) => {
    await save(
      (currentConfig) => {
        const current = new Map((currentConfig.exclusions ?? []).map((entry) => [stableKey(entry.values), entry]));
        if (current.has(key)) current.delete(key);
        else {
          const cell = cells.find((candidate) => candidate.key === key);
          if (cell) current.set(key, { values: cell.values });
        }
        return { ...currentConfig, exclusions: [...current.values()] };
      },
      "Update batch exclusions",
      "Batch exclusion saved."
    );
  };
  const updateParallelism = async (parallelism: number) => {
    await save(
      (currentConfig) => ({ ...currentConfig, parallelism }),
      "Update batch concurrency",
      parallelism === 1
        ? "Sequential execution saved."
        : `Concurrent execution requested at ${parallelism}.`
    );
  };
  const allocations = config.allocations ?? [];
  const saveAllocations = (
    change: (current: readonly BatchProviderAllocation[]) => BatchProviderAllocation[],
    messageText: string
  ) => save(
    (currentConfig) => ({
      ...currentConfig,
      allocations: change(currentConfig.allocations ?? [])
    }),
    "Update batch provider allocation",
    messageText
  );
  const addAllocation = async (target: AllocationTarget) => {
    const available = capabilitiesForTarget(capabilities, target);
    const selected = preferredCapability(available, target);
    if (selected === undefined) {
      onStatus(`No verified ${targetKind(target)} provider is available for ${target.title}.`);
      return;
    }
    await saveAllocations((currentAllocations) => {
      const assigned = currentAllocations
        .filter((allocation) => allocation.targetNodeId === target.id)
        .reduce((total, allocation) => total + allocation.count, 0);
      const next: BatchProviderAllocation = {
        id: crypto.randomUUID(),
        targetNodeId: target.id,
        count: Math.max(Math.min(executableCount - assigned, executableCount), 1),
        providerId: selected.providerId,
        profileId: selected.profileId,
        modelId: modelFor(selected, target)
      };
      return [...currentAllocations, next];
    }, `Added a ${targetKind(target)} allocation lane.`);
  };
  const patchAllocation = async (
    allocationId: string,
    patch: Partial<BatchProviderAllocation>
  ) => {
    await saveAllocations(
      (allocations) => allocations.map((allocation) =>
        allocation.id === allocationId ? { ...allocation, ...patch } : allocation
      ),
      "Batch allocation saved."
    );
  };

  return (
    <section className="batch-matrix" aria-label="Batch Matrix">
      <header>
        <div><span className="eyebrow">Planning</span><h2>Batch Matrix</h2></div>
        {isUpdating ? <span className="batch-saving" role="status">Saving batch changes…</span> : null}
        {batchNodes.length > 1 ? (
          <label className="batch-node-picker">Batch
            <select
              aria-label="Active Batch node"
              value={node.id}
              disabled={isUpdating}
              onChange={(event) => setSelectedNodeId(event.target.value)}
            >
              {batchNodes.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
            </select>
          </label>
        ) : <strong>{node.title}</strong>}
      </header>

      <section className="batch-control-section" aria-labelledby="full-batch-heading">
        <div className="batch-section-heading">
          <div><span className="eyebrow">Contents</span><h3 id="full-batch-heading">Full batch</h3></div>
          <p>Dimensions create the complete work list. Excluding a cell removes only that item.</p>
        </div>
        <div className="batch-summary">
          <div><Rows3 size={16} aria-hidden="true" /><span>{config.dimensions.length} dimensions</span><strong>{included === undefined ? "Calculating…" : `${included} work items`}</strong></div>
          <div><Gauge size={16} aria-hidden="true" /><span>Provider calls</span><strong>{plan?.estimatedCalls ?? "—"}</strong></div>
          <div><span>Excluded</span><strong>{config.exclusions?.length ?? 0}</strong></div>
        </div>
        {cappedWarning ? <p className="batch-warning" role="alert">{cappedWarning.message}</p> : null}
        <div className="batch-cells" data-testid="batch-cells">
          {cells.slice(0, 500).map((cell, index) => (
            <button
              key={cell.key}
              type="button"
              className={cell.excluded ? "is-excluded" : ""}
              aria-pressed={cell.excluded}
              disabled={isUpdating}
              onClick={() => void toggleCell(cell.key)}
            >
              <span>#{index + 1}</span>
              <strong>{Object.values(cell.values).map(String).join(" · ")}</strong>
              <small>{cell.excluded ? "Excluded" : "Included"}</small>
            </button>
          ))}
        </div>
        {totalCount > cells.length ? <small>Showing the first {cells.length} of {totalCount.toLocaleString()} combinations. The plan count above is the exact executable total.</small> : visibleIncluded !== included && included !== undefined ? <small>The plan count reflects executable work after all planner limits.</small> : null}
      </section>

      <section className="batch-control-section" aria-labelledby="allocation-heading">
        <div className="batch-section-heading">
          <div><span className="eyebrow">Routing</span><h3 id="allocation-heading">Provider and model allocation</h3></div>
          <p>Assign stable work items to a compatible, verified provider and model route. Its profile and model identity come from current capability evidence; unassigned items keep the node default.</p>
        </div>
        {targets.length === 0 ? <p className="batch-empty">Connect this Batch to a Worker or Image Generator to allocate provider work.</p> : (
          <div className="batch-targets">
            {targets.map((target) => {
              const targetAllocations = allocations.filter((allocation) => allocation.targetNodeId === target.id);
              const assigned = targetAllocations.reduce((total, allocation) => total + allocation.count, 0);
              const available = capabilitiesForTarget(capabilities, target);
              return (
                <article className="batch-target" key={target.id}>
                  <header>
                    <span className="batch-target-icon">{target.config.kind === "prompt.worker" ? <Sparkles size={15} aria-hidden="true" /> : <Image size={15} aria-hidden="true" />}</span>
                    <div><strong>{target.title}</strong><small>{targetKind(target)} · {assigned} allocated · {Math.max(executableCount - assigned, 0)} default</small></div>
                    <button type="button" onClick={() => void addAllocation(target)} disabled={isUpdating || available.length === 0 || assigned >= executableCount}>Add lane</button>
                  </header>
                  {targetAllocations.length === 0 ? <p>All work uses the node’s current provider route.</p> : (
                    <div className="batch-allocation-list">
                       {targetAllocations.map((allocation) => {
                         const selectedKey = capabilityKey(allocation);
                        const selectedCapability = available.find((candidate) => capabilityKey(candidate) === selectedKey);
                         const maximumForLane = Math.max(
                           executableCount - (assigned - allocation.count),
                           1
                         );
                         return (
                           <div className="batch-allocation-row" key={allocation.id}>
                            <label>{selectedCapability === undefined ? "Provider and model route needs attention" : "Compatible verified provider and model route"}
                              <select
                                aria-label={`${target.title} provider and model route`}
                                value={selectedKey}
                                disabled={isUpdating}
                                onChange={(event) => {
                                  const capability = available.find((candidate) => capabilityKey(candidate) === event.target.value);
                                  if (capability) void patchAllocation(allocation.id, {
                                    providerId: capability.providerId,
                                    profileId: capability.profileId,
                                    modelId: modelFor(capability, target)
                                  });
                                }}
                              >
                                {selectedCapability === undefined ? <option value={selectedKey} disabled>{providerLabel(allocation.providerId)} · {allocation.modelId} — unavailable or incompatible</option> : null}
                                {available.map((capability) => <option key={capabilityKey(capability)} value={capabilityKey(capability)}>{providerLabel(capability.providerId)} · {modelFor(capability, target)}</option>)}
                              </select>
                            </label>
                            <label>Items
                              <input
                                aria-label={`${target.title} allocated items`}
                                key={`${allocation.id}:${allocation.count}`}
                                type="number"
                                min={1}
                                max={maximumForLane}
                                defaultValue={allocation.count}
                                disabled={isUpdating}
                                onBlur={(event) => void patchAllocation(allocation.id, {
                                  count: Math.max(Math.min(Number(event.target.value) || 1, maximumForLane), 1)
                                })}
                              />
                            </label>
                            <button
                              type="button"
                              className="icon-command"
                              aria-label={`Remove ${target.title} allocation`}
                              title="Remove allocation"
                              disabled={isUpdating}
                              onClick={() => void saveAllocations(
                                (allocations) => allocations.filter((candidate) => candidate.id !== allocation.id),
                                "Batch allocation removed."
                              )}
                            ><Trash2 size={14} aria-hidden="true" /></button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="batch-control-section batch-concurrency" aria-labelledby="concurrency-heading">
        <div className="batch-section-heading">
          <div><span className="eyebrow">Throughput</span><h3 id="concurrency-heading">Concurrent run</h3></div>
          <p>Total concurrency is separate from batch size. Ether permits 8 calls globally, shares 4 across Codex, shares 4 across Gemini API, keeps Antigravity as an explicit fallback family, and fails closed at 1 for an unknown provider.</p>
        </div>
        <label className="batch-policy">Total simultaneous work
          <select aria-label="Batch execution policy" value={String(config.parallelism)} disabled={isUpdating} onChange={(event) => void updateParallelism(Number(event.target.value))}>
            {config.parallelism > 8 ? <option value={String(config.parallelism)}>{config.parallelism} requested · reduced to the safe limit</option> : null}
            <option value="1">Sequential · 1</option>
            <option value="2">Concurrent · 2</option>
            <option value="3">Concurrent · 3</option>
            <option value="4">Concurrent · 4</option>
            <option value="5">Concurrent · 5</option>
            <option value="6">Concurrent · 6</option>
            <option value="7">Concurrent · 7</option>
            <option value="8">Concurrent · 8 maximum</option>
          </select>
        </label>
        {plan ? <p className="batch-cap">Requested {plan.requestedParallelism ?? config.parallelism}; effective {plan.effectiveParallelism ?? 1} after the global and provider limits.</p> : message ? <p className="batch-warning">{message}</p> : null}
        <div className="batch-provider-caps" aria-label="Provider concurrency limits">
          {providerCaps(capabilities, targets, allocations, executableCount).map((cap) => (
            <span key={cap.id}><strong>{cap.label}</strong> up to {cap.maximum} at once</span>
          ))}
        </div>
      </section>
    </section>
  );
}

function allocationTargets(graph: EtherGraph, batchNodeId: string): AllocationTarget[] {
  const reachable = new Set<string>();
  const visit = (nodeId: string) => {
    for (const edge of graph.edges) {
      if (!edge.enabled || edge.from.kind !== "node" || edge.to.kind !== "node" || edge.from.nodeId !== nodeId) continue;
      if (reachable.has(edge.to.nodeId)) continue;
      reachable.add(edge.to.nodeId);
      visit(edge.to.nodeId);
    }
  };
  visit(batchNodeId);
  return graph.nodes.filter((candidate): candidate is AllocationTarget =>
    reachable.has(candidate.id) &&
    (candidate.config.kind === "prompt.worker" || candidate.config.kind === "generation.image")
  );
}

function capabilitiesForTarget(
  capabilities: readonly ProviderCapability[],
  target: AllocationTarget
) {
  const operation = target.config.kind === "prompt.worker" ? "llm" : "generate-image";
  return capabilities.filter((capability) => {
    if (capability.operation !== operation) return false;
    if (target.config.kind !== "generation.image") return true;
    const { aspectRatio, resolution: targetResolution } = target.config;
    const supportsAspectRatio = capability.aspectRatios.length === 0 ||
      capability.aspectRatios.includes(aspectRatio);
    const supportsResolution = capability.resolutions.length === 0 || capability.resolutions.some(
      (resolution) =>
        resolution.width === targetResolution.width &&
        resolution.height === targetResolution.height
    );
    const outputFormat = target.config.outputFormat ?? "image/png";
    const supportsOutputFormat = capability.outputFormats === undefined ||
      capability.outputFormats.includes(outputFormat);
    const supportsOutputCount = capability.maxOutputsPerCall >= target.config.outputCount;
    return supportsAspectRatio && supportsResolution && supportsOutputFormat && supportsOutputCount;
  });
}

function preferredCapability(
  capabilities: readonly ProviderCapability[],
  target: AllocationTarget
) {
  if (target.config.kind === "generation.image") {
    return capabilities.find((capability) =>
      capability.providerId === target.config.providerId &&
      capability.profileId === target.config.profileId
    ) ?? capabilities[0];
  }
  const providerId = target.config.providerId;
  const profileId = target.config.profileId;
  const model = target.config.model;
  return capabilities.find((capability) =>
    capability.providerId === providerId &&
    capability.profileId === profileId
  ) ?? capabilities.find((capability) => capability.profileId.endsWith(`:${model}`)) ?? capabilities[0];
}

function modelFor(capability: ProviderCapability, target: AllocationTarget) {
  if (capability.modelId !== undefined) return capability.modelId;
  if (target.config.kind === "prompt.worker") {
    return capability.profileId.includes(":")
      ? capability.profileId.slice(capability.profileId.indexOf(":") + 1)
      : target.config.model;
  }
  return capability.profileId;
}

function capabilityKey(input: Pick<ProviderCapability, "profileId" | "providerId"> | Pick<BatchProviderAllocation, "profileId" | "providerId">) {
  return `${input.providerId}\u0000${input.profileId}`;
}

function targetKind(target: AllocationTarget) {
  return target.config.kind === "prompt.worker" ? "Prompt Worker" : "Image generation";
}

function providerLabel(providerId: string) {
  if (providerId.startsWith("codex-")) return "Codex";
  if (providerId.startsWith("google-gemini-api-")) return "Gemini API";
  if (providerId.startsWith("google-nano-banana-")) return "Antigravity fallback";
  return providerId;
}

function providerCaps(
  capabilities: readonly ProviderCapability[],
  targets: readonly AllocationTarget[],
  allocations: readonly BatchProviderAllocation[],
  executableCount: number
) {
  const selected = new Map<string, { id: string; label: string; maximum: number }>();
  for (const target of targets) {
    const targetAllocations = allocations.filter((allocation) => allocation.targetNodeId === target.id);
    const assigned = targetAllocations.reduce((total, allocation) => total + allocation.count, 0);
    const defaultCapability = preferredCapability(capabilitiesForTarget(capabilities, target), target);
    const defaultIdentity = target.config.kind === "generation.image"
      ? { providerId: target.config.providerId, profileId: target.config.profileId }
      : target.config.providerId && target.config.profileId
        ? { providerId: target.config.providerId, profileId: target.config.profileId }
        : defaultCapability === undefined
          ? null
          : { providerId: defaultCapability.providerId, profileId: defaultCapability.profileId };
    const identities = [
      ...targetAllocations,
      ...(assigned < executableCount && defaultIdentity !== null ? [defaultIdentity] : [])
    ];
    for (const identity of identities) {
      const capability = capabilities.find((candidate) =>
        candidate.providerId === identity.providerId &&
        candidate.profileId === identity.profileId
      );
      if (capability === undefined) continue;
      const family = capability.providerId.startsWith("codex-")
        ? "codex"
        : capability.providerId.startsWith("google-gemini-api-")
          ? "gemini-api"
        : capability.providerId.startsWith("google-nano-banana-")
          ? "antigravity"
          : capability.providerId;
      const maximum = family === "codex"
        ? SAFE_CODEX_PROVIDER_PARALLELISM
        : family === "gemini-api"
          ? SAFE_GEMINI_API_PROVIDER_PARALLELISM
        : family === "antigravity"
          ? SAFE_ANTIGRAVITY_PROVIDER_PARALLELISM
          : 1;
      const existing = selected.get(family);
      selected.set(family, {
        id: family,
        label: family === "codex" ? "Codex" : family === "gemini-api" ? "Gemini API" : family === "antigravity" ? "Antigravity fallback" : capability.providerId,
        maximum: Math.min(existing?.maximum ?? maximum, maximum)
      });
    }
  }
  return [...selected.values()];
}

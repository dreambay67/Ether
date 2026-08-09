import { useCallback, useEffect, useMemo, useState, type DragEvent as ReactDragEvent } from "react";
import { getNodeDefinition } from "@ether/graph-kernel";
import type { Artifact, CanvasDrawingConfig, EditImageConfig, EditMaskGeometry, EditWorkspaceState, EtherEdge, EtherNode, GenerationImageConfig, GraphOperation, NodeOutputVersion, PromptTextConfig, PromptWorkerConfig, ProviderCapability } from "@ether/schema";
import { embeddedArtifactSource } from "../../artifacts/embeddedArtifactSource";
import { StrokeCanvas, buildDrawingMaskSvg, buildDrawingSvg, drawingToMaskGeometry } from "../drawing/StrokeCanvas";
import { channelLabel } from "../ports/channelRegistry";
import { EditWorkspace, type ImageEditCapability, type ImageEditCommit, type ImageEditSource } from "../edit/EditWorkspace";
import { MaskWorkspace } from "../edit/MaskWorkspace";
import type { MaskCommitResult, MaskGeometry } from "../edit/MaskCanvas";
import { documentCommand, documentQuery, globalQuery } from "./applicationRequests";
import { DraftConflict } from "./DraftConflict";
import { Help, InspectorSection, NodeSetup } from "./NodeSetup";
import { controlHelp, outgoingRoles, roleLabels } from "./inspectorConfig";
import { RegistryConfigFields } from "./RegistryConfigFields";
import { RunControls } from "./RunControls";
import { runPlanContextFingerprint } from "./runPlanPresentation";
import type { InspectorNodeContext } from "./types";
import { useInspectorDraft } from "./useInspectorDraft";

type AppBridge = { command(command: unknown): Promise<{ payload?: unknown }>; query(query: unknown): Promise<{ payload?: Record<string, unknown> }> };
const app = () => (window.ether as unknown as { application?: AppBridge }).application;

// Keep the renderer's capability matching browser-safe. The concrete provider
// package is Node-oriented; only the documented logical Codex route needs a
// literal mapping here.
function resolveRendererImageProviderAlias(providerId: string): string {
  return providerId === "codex" ? "codex-chatgpt-image-2" : providerId;
}

function OutputVersions({ context }: { context: InspectorNodeContext }) {
  const { node, graph, document, report } = context;
  const [outputs, setOutputs] = useState<NodeOutputVersion[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [editDrafts, setEditDrafts] = useState<Record<string, string>>({});
  const [pinEdges, setPinEdges] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => { try { const response = await app()?.query(documentQuery("node.outputs", document.documentId, { nodeId: node.id })); setOutputs((response?.payload?.outputs as NodeOutputVersion[] | undefined) ?? []); } catch (error) { report(error instanceof Error ? error.message : "Output versions could not be loaded."); } }, [document.documentId, node.id, report]);
  useEffect(() => { void refresh(); }, [refresh]);
  const command = async (name: string, payload: Record<string, unknown>) => { try { await app()?.command(documentCommand(name, document.documentId, payload)); await refresh(); report(`${name.replace(".", " ")} saved.`); return true; } catch (error) { report(error instanceof Error ? error.message : "That output action needs attention."); return false; } };
  if (!outputs.length) return <section className="inspector-output-empty" data-testid="output-versions"><strong>Output versions</strong><span>Immutable versions appear here after execution completes.</span></section>;
  const outgoing = graph.edges.filter((edge) => edge.from.kind === "node" && edge.from.nodeId === node.id);
  const pin = async (outputVersionId: string) => {
    const edgeId = pinEdges[outputVersionId] ?? outgoing[0]?.id;
    if (!edgeId) return false;
    try {
      const snapshot = await app()?.query(documentQuery("graph.snapshot", document.documentId, { graphId: graph.id }));
      const baseDocumentRevisionId = snapshot?.payload?.documentRevisionId;
      if (typeof baseDocumentRevisionId !== "string") throw new Error("The current document revision is unavailable.");
      return command("output.pin", { edgeId, outputVersionId, baseDocumentRevisionId });
    } catch (error) { report(error instanceof Error ? error.message : "The current lane revision could not be loaded."); return false; }
  };
  return <InspectorSection title="Output versions" help="Every executable run creates an immutable version. Review and manual changes preserve earlier versions."><div className="inspector-output-versions" data-testid="output-versions">{outputs.map((output) => {
    const selected = compare.includes(output.id);
    const approval = output.approval.state === "approved" ? "Approved" : output.approval.state === "rejected" ? "Rejected" : "Unreviewed";
    const editDraft = editDrafts[output.id] ?? "";
    const producer = output.producer?.kind === "provider"
      ? `${output.producer.providerId} · ${output.producer.modelId}`
      : output.producer?.kind === "local"
        ? `Local · ${output.producer.executor}`
        : output.producer?.kind === "manual"
          ? `Manual · ${output.producer.actor}`
          : "Producer unavailable";
    return <article key={output.id} className="inspector-output-version">
      <header><strong>{approval}</strong><span>{output.outputPayloadIds.length} payload{output.outputPayloadIds.length === 1 ? "" : "s"}</span></header>
      <small>{new Date(output.createdAt).toLocaleString()} · {output.id.slice(0, 12)}</small>
      <details><summary>Version provenance</summary><div className="inspector-output-provenance"><span>{producer}</span><span>{output.runId ? `Run · ${output.runId}` : "No provider run"}</span><span>{output.inputPayloadIds?.length ?? 0} inputs · {output.selectedOutputVersionIds?.length ?? 0} selected versions</span><span>Lineage · {output.lineage?.relation ?? (output.parentOutputVersionId ? "descendant" : "generated")}</span>{output.selectedBy ? <span>Selected by {output.selectedBy.selector} on {output.selectedBy.edgeId}</span> : null}{output.failure ? <em>{output.failure.code} · {output.failure.message}</em> : null}</div></details>
      <label>Manual descendant<input aria-label={`Manual output text ${output.id}`} value={editDraft} placeholder="Optional edited text" onChange={(event) => setEditDrafts((current) => ({ ...current, [output.id]: event.target.value }))} /></label>
      {outgoing.length > 1 ? <label>Pin lane<select aria-label={`Pin lane ${output.id}`} value={pinEdges[output.id] ?? outgoing[0]!.id} onChange={(event) => setPinEdges((current) => ({ ...current, [output.id]: event.target.value }))}>{outgoing.map((edge) => <option key={edge.id} value={edge.id}>{edge.role} to {edge.to.kind === "node" ? (() => { const targetId = edge.to.kind === "node" ? edge.to.nodeId : ""; return graph.nodes.find((target) => target.id === targetId)?.title ?? targetId; })() : edge.to.portId}</option>)}</select></label> : null}
      <div className="inspector-actions"><button type="button" title="Approve this version for latest-approved selectors." onClick={() => void command("review.approve", { outputVersionId: output.id, approved: true })}>Approve</button><button type="button" title="Reject this version without deleting it." onClick={() => void command("review.reject", { outputVersionId: output.id })}>Reject</button><button type="button" disabled={!editDraft.trim()} title="Create a manual descendant; the original remains immutable." onClick={() => void (async () => { if (await command("output.edit", { outputVersionId: output.id, payload: { text: editDraft }, note: "Edited in Inspector" })) setEditDrafts((current) => ({ ...current, [output.id]: "" })); })()}>Edit</button><button type="button" aria-pressed={selected} title="Pick two versions for a side-by-side provenance comparison." onClick={() => setCompare((current) => current.includes(output.id) ? current.filter((id) => id !== output.id) : [...current.slice(-1), output.id])}>Compare</button>{outgoing.length ? <button type="button" title="Pin this version to the selected outgoing lane." onClick={() => void pin(output.id)}>Pin</button> : null}<button type="button" title="Restore this as a new immutable descendant." onClick={() => void command("output.restore", { outputVersionId: output.id, note: "Restored in Inspector" })}>Restore</button></div>
    </article>;
  })}</div>{compare.length === 2 ? <div className="inspector-compare-strip" data-testid="output-compare"><strong>Compare</strong><span>{compare.map((id) => id.slice(0, 8)).join(" vs ")}</span><button type="button" onClick={() => setCompare([])}>Clear</button></div> : null}</InspectorSection>;
}

function PromptFields({ context }: { context: InspectorNodeContext }) {
  const { node, apply, graph, document, report } = context;
  const source = node.config.kind === "prompt.text" ? node.config : { kind: "prompt.text" as const, body: "", assembly: "append" as const };
  const draft = useInspectorDraft<PromptTextConfig>(`${node.id}:prompt`, source);
  const [preview, setPreview] = useState<{ instruction: string; contextHash: string } | null>(null);
  useEffect(() => {
    if (node.config.kind !== "prompt.text") return;
    let current = true;
    void app()?.query(documentQuery("node.compiledInputPreview", document.documentId, { nodeId: node.id })).then((response) => {
      if (!current) return;
      const instruction = response.payload?.instruction; const contextHash = response.payload?.contextHash;
      setPreview(typeof instruction === "string" && typeof contextHash === "string" ? { instruction, contextHash } : null);
    }).catch((error: unknown) => { if (current) report(error instanceof Error ? error.message : "Assembled input preview is unavailable."); });
    return () => { current = false; };
  }, [document.documentId, node.config, node.id, report]);
  if (node.config.kind !== "prompt.text") return null;
  const commit = async () => {
    if (!draft.dirty) return;
    if (draft.conflict) { report("Resolve the changed-base warning before saving this prompt."); return; }
    const saved = await apply([{ type: "updateNode", graphId: graph.id, nodeId: node.id, node: { ...node, config: draft.draft } as EtherNode }] as GraphOperation[], "Update prompt");
    if (saved) draft.markCommitted();
  };
  const useManualOverride = () => draft.update({ kind: "prompt.text", body: preview?.instruction ?? draft.draft.body, assembly: "replace" });
  return <><InspectorSection title="Prompt" help="Prompt is authored text and deterministic assembly. It never shows a misleading provider Run control.">{draft.conflict ? <DraftConflict onLatest={draft.useLatest} onRebase={draft.rebaseDraft} /> : null}<label>{draft.draft.assembly === "replace" ? "Manual override text" : "Authored text"} <Help label="Authored text" text={controlHelp.body} /><textarea aria-label={draft.draft.assembly === "replace" ? "Manual override text" : "Authored text"} value={draft.draft.body} onChange={(event) => draft.update((current) => ({ ...current, body: event.target.value }))} onBlur={() => void commit()} /></label><label>Assembly <Help label="Assembly" text={controlHelp.assembly} /><select aria-label="Prompt assembly" value={draft.draft.assembly} onChange={(event) => draft.update((current) => ({ ...current, assembly: event.target.value as PromptTextConfig["assembly"] }))}><option value="append">Append incoming context</option><option value="replace">Manual override</option></select></label><div className="inspector-actions"><button type="button" disabled={!preview || draft.conflict} onClick={useManualOverride}>Use assembled text as manual override</button><button type="button" disabled={!draft.dirty || draft.conflict} onClick={() => void commit()}>Save prompt</button></div></InspectorSection><InspectorSection title="Assembled text" help="This canonical compiled input can be promoted into an explicit, persisted manual override."><textarea aria-label="Assembled text" value={preview?.instruction ?? "Preview unavailable"} readOnly /><small>{draft.draft.assembly === "replace" ? "Provenance: authored manual override." : preview ? `Derived preview - context ${preview.contextHash.slice(0, 12)}` : "No compiled preview is available yet."}</small></InspectorSection></>;
}

function WorkerFields({ context }: { context: InspectorNodeContext }) {
  const { node, apply, graph, report } = context;
  const [capabilities, setCapabilities] = useState<ProviderCapability[]>([]);
  type WorkerConfigWithReview = PromptWorkerConfig & { reviewPolicy: "inspect-first" | "auto-apply" };
  const savedReviewPolicy = node.config.kind === "prompt.worker"
    ? (node.config as PromptWorkerConfig & { reviewPolicy?: WorkerConfigWithReview["reviewPolicy"] }).reviewPolicy
    : undefined;
  const source = (node.config.kind === "prompt.worker" ? { ...node.config, reviewPolicy: savedReviewPolicy ?? "inspect-first" } : { kind: "prompt.worker" as const, behavior: "rewrite" as const, instruction: "", profile: "balanced" as const, model: "gpt-5", reasoningEffort: "medium", variation: 0.2, contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 8_000 }, memoryPolicy: { mode: "stateless" as const }, outputContract: { channel: "text" as const, count: 1, selectionPolicy: "latest" as const }, reviewPolicy: "inspect-first" as const }) as WorkerConfigWithReview;
  const draft = useInspectorDraft<WorkerConfigWithReview>(`${node.id}:worker`, source);
  useEffect(() => {
    const refresh = () => {
      void app()?.query(globalQuery("provider.capabilities", {}))
        .then((response) => setCapabilities(
          ((response.payload?.capabilities as ProviderCapability[] | undefined) ?? [])
            .filter((capability) => capability.operation === "llm" && capability.profileId.startsWith("worker:"))
        ))
        .catch((error: unknown) => report(
          error instanceof Error ? error.message : "Worker provider capabilities are unavailable."
        ));
    };
    refresh();
    window.addEventListener("ether:provider-policy-changed", refresh);
    return () => window.removeEventListener("ether:provider-policy-changed", refresh);
  }, [report]);
  if (node.config.kind !== "prompt.worker") return null;
  const selectedCapability = capabilities.find((capability) =>
    capability.providerId === draft.draft.providerId &&
    capability.profileId === draft.draft.profileId
  ) ?? capabilities.find((capability) => capability.profileId.endsWith(`:${draft.draft.model}`)) ?? capabilities[0];
  const save = async () => { if (!draft.dirty) return; if (draft.conflict) { report("Resolve the changed-base warning before saving this worker."); return; } const saved = await apply([{ type: "updateNode", graphId: graph.id, nodeId: node.id, node: { ...node, config: draft.draft } as EtherNode }] as GraphOperation[], "Update worker"); if (saved) draft.markCommitted(); };
  const resolvedRoute = selectedCapability
    ? `${selectedCapability.providerId} · ${selectedCapability.modelId ?? draft.draft.model} · ${draft.draft.reasoningEffort}`
    : `${draft.draft.model} · ${draft.draft.reasoningEffort} · unavailable until runtime discovery`;
  return <>
    <InspectorSection title="Worker" help="Worker transforms connected material into immutable output versions. It never overwrites another node's instruction or configuration.">
      {draft.conflict ? <DraftConflict onLatest={draft.useLatest} onRebase={draft.rebaseDraft} /> : null}
      <label>Instruction<textarea aria-label="Worker instruction" value={draft.draft.instruction} onChange={(event) => draft.update((current) => ({ ...current, instruction: event.target.value }))} /></label>
      <label>Behavior <Help label="Behavior" text={controlHelp.behavior} /><select aria-label="Worker behavior" value={draft.draft.behavior} onChange={(event) => draft.update((current) => ({ ...current, behavior: event.target.value as PromptWorkerConfig["behavior"] }))}>{["brainstorm", "rewrite", "mutate", "expand", "reinforce", "extract", "critique", "custom"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>AI profile <Help label="AI profile" text={controlHelp.profile} /><select aria-label="AI profile" value={draft.draft.profile} onChange={(event) => draft.update((current) => ({ ...current, profile: event.target.value as PromptWorkerConfig["profile"] }))}>{["fast", "balanced", "deep", "custom"].map((value) => <option key={value} value={value}>{value}</option>)}</select><small>Resolved at preview from active runtime: {resolvedRoute}</small></label>
      <label>Result handling<select aria-label="Worker result handling" value={draft.draft.reviewPolicy} onChange={(event) => draft.update((current) => ({ ...current, reviewPolicy: event.target.value as WorkerConfigWithReview["reviewPolicy"] }))}><option value="inspect-first">Inspect first · leave unreviewed</option><option value="auto-apply">Auto-apply · approve valid results</option></select><small>Auto-apply accepts validated output versions only. It never edits downstream node settings.</small></label>
      <div className="inspector-actions"><button type="button" disabled={!draft.dirty || draft.conflict} onClick={() => void save()}>Save worker</button></div>
    </InspectorSection>
    <InspectorSection title="Context and output" help="Ordinary policy controls define what the Worker may read, remember, and publish.">
      <label className="inspector-checkbox"><input aria-label="Include upstream context" type="checkbox" checked={draft.draft.contextPolicy.includeUpstream} onChange={(event) => draft.update((current) => ({ ...current, contextPolicy: { ...current.contextPolicy, includeUpstream: event.target.checked } }))} />Include connected upstream context</label>
      <label className="inspector-checkbox"><input aria-label="Include downstream capabilities" type="checkbox" checked={draft.draft.contextPolicy.includeDownstreamCapabilities} onChange={(event) => draft.update((current) => ({ ...current, contextPolicy: { ...current.contextPolicy, includeDownstreamCapabilities: event.target.checked } }))} />Inform the Worker about downstream capabilities</label>
      <label>Context budget<input aria-label="Worker context token budget" type="number" min="256" step="256" value={draft.draft.contextPolicy.maxTokens} onChange={(event) => draft.update((current) => ({ ...current, contextPolicy: { ...current.contextPolicy, maxTokens: Math.max(256, Number(event.target.value) || 256) } }))} /></label>
      <label>Memory<select aria-label="Worker memory" value={draft.draft.memoryPolicy.mode} onChange={(event) => draft.update((current) => ({ ...current, memoryPolicy: { mode: event.target.value as PromptWorkerConfig["memoryPolicy"]["mode"] } }))}><option value="stateless">Stateless</option><option value="per-node">Remember per node</option><option value="per-branch">Remember per branch</option></select></label>
      <label>Output channel<select aria-label="Worker output channel" value={draft.draft.outputContract.channel} onChange={(event) => draft.update((current) => ({ ...current, outputContract: { ...current.outputContract, channel: event.target.value as PromptWorkerConfig["outputContract"]["channel"], ...(event.target.value === "text" ? { schemaId: undefined } : {}) } }))}><option value="text">Text</option><option value="data">Structured data</option></select></label>
      {draft.draft.outputContract.channel === "data" ? <label>Schema ID<input aria-label="Worker output schema ID" value={draft.draft.outputContract.schemaId ?? ""} placeholder="Optional registered schema" onChange={(event) => draft.update((current) => ({ ...current, outputContract: { ...current.outputContract, schemaId: event.target.value.trim() || undefined } }))} /></label> : null}
      <label>Result count<input aria-label="Worker result count" type="number" min="1" max={selectedCapability?.maxOutputsPerCall ?? 16} value={draft.draft.outputContract.count} onChange={(event) => draft.update((current) => ({ ...current, outputContract: { ...current.outputContract, count: Math.max(1, Math.min(selectedCapability?.maxOutputsPerCall ?? 16, Number(event.target.value) || 1)) } }))} /></label>
      <label>Selection policy<select aria-label="Worker output selection policy" value={draft.draft.outputContract.selectionPolicy} onChange={(event) => draft.update((current) => ({ ...current, outputContract: { ...current.outputContract, selectionPolicy: event.target.value as PromptWorkerConfig["outputContract"]["selectionPolicy"] } }))}><option value="latest">Latest</option><option value="all">All results</option><option value="best">Best result</option></select></label>
      <div className="inspector-actions"><button type="button" disabled={!draft.dirty || draft.conflict} onClick={() => void save()}>Save worker policy</button></div>
    </InspectorSection>
    <InspectorSection advanced title="Advanced worker settings" help={controlHelp.advanced}>
      {selectedCapability ? <label>Provider and model<select aria-label="Worker provider and model" value={`${selectedCapability.providerId}\u0000${selectedCapability.profileId}`} onChange={(event) => { const capability = capabilities.find((candidate) => `${candidate.providerId}\u0000${candidate.profileId}` === event.target.value); if (!capability) return; const model = capability.modelId ?? capability.profileId.slice(capability.profileId.indexOf(":") + 1); draft.update((current) => ({ ...current, profile: "custom", providerId: capability.providerId, profileId: capability.profileId, model })); }}>{capabilities.map((capability) => <option key={`${capability.providerId}:${capability.profileId}`} value={`${capability.providerId}\u0000${capability.profileId}`}>{capability.providerId} · {capability.modelId ?? capability.profileId}</option>)}</select></label> : <p className="inspector-unavailable">No runtime-discovered Worker provider/model is available.</p>}
      <label>Model<input aria-label="Worker model" value={draft.draft.model} onChange={(event) => draft.update((current) => ({ ...current, profile: "custom", model: event.target.value }))} /></label>
      <label>Reasoning effort<input aria-label="Reasoning effort" value={draft.draft.reasoningEffort} onChange={(event) => draft.update((current) => ({ ...current, profile: "custom", reasoningEffort: event.target.value }))} /></label>
      <label>Variation<input aria-label="Variation" type="range" min="0" max="1" step="0.05" value={draft.draft.variation} onChange={(event) => draft.update((current) => ({ ...current, variation: Number(event.target.value) }))} /></label>
      <div className="inspector-actions"><button type="button" disabled={!draft.dirty || draft.conflict} onClick={() => void save()}>Save advanced settings</button></div>
    </InspectorSection>
  </>;
}

function resolutionsForAspect(capability: ProviderCapability, aspectRatio: string) {
  const exact = capability.resolutions.filter((resolution) =>
    resolution.aspectRatio === undefined || resolution.aspectRatio === aspectRatio
  );
  return exact.length > 0 ? exact : capability.resolutions;
}

function replacementResolution(
  capability: ProviderCapability,
  aspectRatio: string,
  current: { width: number; height: number }
) {
  const currentOption = capability.resolutions.find((resolution) =>
    resolution.width === current.width && resolution.height === current.height
  );
  const options = resolutionsForAspect(capability, aspectRatio);
  return options.find((resolution) =>
    currentOption?.tier !== undefined && resolution.tier === currentOption.tier
  ) ?? options[0];
}

function ProviderFields({ context }: { context: InspectorNodeContext }) {
  const { node, apply, graph, report } = context; const [capabilities, setCapabilities] = useState<ProviderCapability[]>([]);
  const source = node.config.kind === "generation.image" || node.config.kind === "edit.image" ? node.config : { kind: "generation.image" as const, providerId: "unavailable", profileId: "unavailable", aspectRatio: "1:1", resolution: { width: 1024, height: 1024 }, outputFormat: "image/png" as const, outputCount: 1 };
  const draft = useInspectorDraft<GenerationImageConfig | EditImageConfig>(`${node.id}:provider`, source);
  const [resetNotice, setResetNotice] = useState("");
  useEffect(() => {
    const refresh = () => {
      void app()?.query(globalQuery("provider.capabilities", {}))
        .then((response) => setCapabilities((response.payload?.capabilities as ProviderCapability[] | undefined) ?? []))
        .catch((error: unknown) => report(error instanceof Error ? error.message : "Provider capabilities are unavailable."));
    };
    refresh();
    window.addEventListener("ether:provider-policy-changed", refresh);
    return () => window.removeEventListener("ether:provider-policy-changed", refresh);
  }, [report]);
  if (node.config.kind !== "generation.image" && node.config.kind !== "edit.image") return null;
  const operation = draft.draft.kind === "generation.image" ? "generate-image" : "edit-image"; const supported = capabilities.filter((capability) => capability.operation === operation); const selectedProviderId = resolveRendererImageProviderAlias(draft.draft.providerId); const selected = supported.find((capability) => capability.providerId === selectedProviderId && capability.profileId === draft.draft.profileId);
  const selectedAspectRatio = draft.draft.kind === "generation.image" ? draft.draft.aspectRatio : "";
  const reset = (capability: ProviderCapability) => { draft.update((current) => { const aspectRatio = capability.aspectRatios[0] ?? (current.kind === "generation.image" ? current.aspectRatio : ""); const resolution = current.kind === "generation.image" ? replacementResolution(capability, aspectRatio, current.resolution) : undefined; const outputFormats = capability.outputFormats?.length ? capability.outputFormats : ["image/png", "image/jpeg"] as const; const outputFormat = current.kind === "generation.image" && outputFormats.includes(current.outputFormat ?? "image/png") ? current.outputFormat ?? "image/png" : outputFormats[0]; return { ...current, providerId: capability.providerId, profileId: capability.profileId, outputCount: 1, ...(current.kind === "generation.image" ? { aspectRatio, resolution: resolution ? { width: resolution.width, height: resolution.height } : current.resolution, outputFormat } : {}) }; }); setResetNotice(`Defaults reset for ${capability.providerId} / ${capability.profileId}: output count 1${capability.aspectRatios[0] ? `, ${capability.aspectRatios[0]}` : ""}.`); };
  const save = async () => { if (!draft.dirty) return; if (draft.conflict) { report("Resolve the changed-base warning before saving provider settings."); return; } const saved = await apply([{ type: "updateNode", graphId: graph.id, nodeId: node.id, node: { ...node, config: draft.draft } as EtherNode }] as GraphOperation[], "Update provider settings"); if (saved) draft.markCommitted(); };
  if (!selected) return <InspectorSection title="Provider" help="Provider-specific controls appear only after a verified profile is discovered."><p className="inspector-unavailable">{supported.length === 0 ? `No verified ${operation} capability is available. Ether will not guess settings.` : `The saved ${draft.draft.providerId} / ${draft.draft.profileId} binding is unavailable. Choose a verified profile before running.`}</p>{supported.length > 0 ? <label>Model profile <Help label="Provider profile" text={controlHelp.provider} /><select aria-label="Provider profile" value="" onChange={(event) => { const capability = supported.find((item) => `${item.providerId}:${item.profileId}` === event.target.value); if (capability) reset(capability); }}><option value="" disabled>Choose a verified profile</option>{supported.map((capability) => <option key={`${capability.providerId}:${capability.profileId}`} value={`${capability.providerId}:${capability.profileId}`}>{providerProfileLabel(capability)}</option>)}</select></label> : null}</InspectorSection>;
  return <><InspectorSection title="Provider" help="Model profile, aspect ratio, resolution, and limits are supplied by the selected verified capability.">
    {draft.conflict ? <DraftConflict onLatest={draft.useLatest} onRebase={draft.rebaseDraft} /> : null}
    <label>Model profile <Help label="Provider profile" text={controlHelp.provider} /><select aria-label="Provider profile" value={`${selected.providerId}:${selected.profileId}`} onChange={(event) => { const capability = supported.find((item) => `${item.providerId}:${item.profileId}` === event.target.value); if (capability) reset(capability); }}>{supported.map((capability) => <option key={`${capability.providerId}:${capability.profileId}`} value={`${capability.providerId}:${capability.profileId}`}>{providerProfileLabel(capability)}</option>)}</select></label>
    {draft.draft.kind === "generation.image" ? <><label>Aspect ratio <Help label="Aspect ratio" text={controlHelp.aspect} /><select aria-label="Aspect ratio" value={selectedAspectRatio} onChange={(event) => { const aspectRatio = event.target.value; draft.update((current) => { if (current.kind !== "generation.image") return current; const resolution = replacementResolution(selected, aspectRatio, current.resolution); return { ...current, aspectRatio, resolution: resolution ? { width: resolution.width, height: resolution.height } : current.resolution }; }); }}>{(selected.aspectRatios.length > 0 ? selected.aspectRatios : [selectedAspectRatio]).map((value) => <option key={value}>{value}</option>)}</select>{selected.aspectRatios.length === 0 ? <small>This verified profile uses its current provider-determined ratio.</small> : null}</label><label>Resolution <Help label="Resolution" text={controlHelp.resolution} /><select aria-label="Resolution" value={`${draft.draft.resolution.width}x${draft.draft.resolution.height}`} onChange={(event) => { const resolution = resolutionsForAspect(selected, selectedAspectRatio).find((item) => `${item.width}x${item.height}` === event.target.value); if (resolution) draft.update((current) => current.kind === "generation.image" ? { ...current, resolution: { width: resolution.width, height: resolution.height } } : current); }}>{(selected.resolutions.length > 0 ? resolutionsForAspect(selected, selectedAspectRatio) : [{ id: "provider-determined", width: draft.draft.resolution.width, height: draft.draft.resolution.height, label: "Provider-determined (current request)" }]).map((resolution) => <option key={resolution.id} value={`${resolution.width}x${resolution.height}`}>{resolution.label}</option>)}</select>{selected.resolutions.length === 0 ? <small>Exact output dimensions are provider-determined and validated after generation.</small> : null}</label><label>Output format <select aria-label="Output format" value={(selected.outputFormats?.includes(draft.draft.outputFormat ?? "image/png") ? draft.draft.outputFormat : selected.outputFormats?.[0]) ?? draft.draft.outputFormat ?? "image/png"} onChange={(event) => draft.update((current) => current.kind === "generation.image" ? { ...current, outputFormat: event.target.value === "image/jpeg" ? "image/jpeg" : "image/png" } : current)}>{(selected.outputFormats?.length ? selected.outputFormats : ["image/png", "image/jpeg"]).map((format) => <option key={format} value={format}>{format === "image/jpeg" ? "JPEG" : "PNG"}</option>)}</select>{selected.outputFormats?.length === 1 ? <small>This live provider route currently supports {selected.outputFormats[0] === "image/jpeg" ? "JPEG" : "PNG"} output only.</small> : null}</label></> : null}
    {draft.draft.kind === "generation.image" && geminiCostGuidance(selected, draft.draft) ? <p className="inspector-unavailable">{geminiCostGuidance(selected, draft.draft)}</p> : null}
    <label>Output count <Help label="Output count" text={controlHelp.output} /><input aria-label="Output count" type="number" min="1" max={selected.maxOutputsPerCall} value={draft.draft.outputCount} onChange={(event) => draft.update((current) => ({ ...current, outputCount: Math.max(1, Math.min(selected.maxOutputsPerCall, Number(event.target.value) || 1)) }))} /></label>
    {resetNotice ? <small role="status">{resetNotice}</small> : null}<div className="inspector-actions"><button type="button" onClick={() => reset(selected)}>Reset to profile defaults</button><button type="button" disabled={!draft.dirty || draft.conflict} onClick={() => void save()}>Save provider settings</button></div>
  </InspectorSection><InspectorSection advanced title="Provider capability" help="Verified provenance and limitations are available when troubleshooting provider behavior."><p>Provenance: {selected.provenance}</p><p>{selected.limitations.length ? selected.limitations.join(" ") : "No reported limitations."}</p></InspectorSection></>;
}

function providerProfileLabel(capability: ProviderCapability) {
  const profile = capability.profileId === "nano-banana-2"
    ? "Nano Banana 2"
    : capability.profileId === "nano-banana-pro"
      ? "Nano Banana Pro"
      : capability.profileId === "nano-banana-2-lite"
        ? "Nano Banana 2 Lite"
        : capability.profileId;
  if (capability.providerId.startsWith("google-gemini-api-")) return `Gemini API · ${profile}`;
  if (capability.providerId.startsWith("google-nano-banana-")) return `Antigravity fallback · ${profile}`;
  return `${capability.providerId} · ${profile}`;
}

function geminiCostGuidance(capability: ProviderCapability, config: GenerationImageConfig) {
  if (!capability.providerId.startsWith("google-gemini-api-")) return null;
  const tier = capability.resolutions.find((resolution) =>
    resolution.width === config.resolution.width && resolution.height === config.resolution.height
  )?.tier;
  const estimates: Record<string, string> = capability.profileId === "nano-banana-2"
    ? { "0.5K": "$0.045", "1K": "$0.067", "2K": "$0.101", "4K": "$0.151" }
    : capability.profileId === "nano-banana-pro"
      ? { "1K": "$0.134", "2K": "$0.134", "4K": "$0.240" }
      : { "1K": "$0.0336" };
  const estimate = tier === undefined ? undefined : estimates[tier];
  return estimate === undefined
    ? "Gemini cost estimate is unavailable for this profile setting."
    : `Estimated Gemini image output: ${estimate} USD. Estimate only; Google billing, input, and reasoning charges are authoritative.`;
}

function DrawingFields({ context }: { context: InspectorNodeContext }) {
  const { node, graph, document, apply, report } = context;
  const [publishChannel, setPublishChannel] = useState<"image" | "mask">("image");
  if (node.config.kind !== "canvas.drawing") return null;
  const drawing = node.config;
  const updateDrawing = (next: CanvasDrawingConfig, title: string) => void apply([{ type: "updateNode", graphId: graph.id, nodeId: node.id, node: { ...node, config: next } as EtherNode }] as GraphOperation[], title);
  const updateStrokes = (strokes: CanvasDrawingConfig["strokes"]) => {
    const next = { ...node, config: { ...drawing, strokes } } as EtherNode;
    void apply([{ type: "updateNode", graphId: graph.id, nodeId: node.id, node: next }] as GraphOperation[], "Update drawing").then((saved) => {
      if (saved) report(`Drawing saved with ${strokes.length} stroke${strokes.length === 1 ? "" : "s"}.`);
    });
  };
  const publish = async () => {
    try {
      const content = publishChannel === "mask" ? buildDrawingMaskSvg(drawing) : buildDrawingSvg(drawing);
      const response = await app()?.command(documentCommand("editWorkspace.commit", document.documentId, {
        graphId: graph.id,
        nodeId: node.id,
        kind: "drawing",
        channel: publishChannel,
        mediaType: "image/svg+xml",
        width: drawing.width,
        height: drawing.height,
        byteLength: new TextEncoder().encode(content).byteLength,
        content: { encoding: "utf8", data: content },
        ...(publishChannel === "mask" ? { geometry: drawingToMaskGeometry(drawing) } : {}),
        drawing
      }));
      const committed = response?.payload as { artifact?: Artifact } | undefined;
      if (!committed?.artifact) throw new Error("The drawing publisher did not return its immutable artifact.");
      report(publishChannel === "image"
        ? `Drawing artifact ${committed.artifact.id} committed from ${node.title}.`
        : `Drawing mask artifact ${committed.artifact.id} committed from ${node.title}.`);
    } catch (error) {
      report(error instanceof Error ? error.message : "The drawing could not be published.");
    }
  };
  return <InspectorSection title="Drawing" help="Draw, select, erase, and undo strokes. Publish the editable document as either an Image or a white-selected Mask artifact."><div className="inspector-drawing-size"><label>Width<input aria-label="Drawing width" type="number" min="1" disabled={document.mode !== "writable"} defaultValue={drawing.width} onBlur={(event) => updateDrawing({ ...drawing, width: Math.max(1, Number(event.target.value) || drawing.width) }, "Resize drawing")}/></label><label>Height<input aria-label="Drawing height" type="number" min="1" disabled={document.mode !== "writable"} defaultValue={drawing.height} onBlur={(event) => updateDrawing({ ...drawing, height: Math.max(1, Number(event.target.value) || drawing.height) }, "Resize drawing")}/></label></div><label>Background<input aria-label="Drawing background" disabled={document.mode !== "writable"} defaultValue={drawing.background} onBlur={(event) => { const background = event.target.value.trim(); if (background) updateDrawing({ ...drawing, background }, "Change drawing background"); }} /></label><label>Output channel<select aria-label="Drawing output channel" value={publishChannel} onChange={(event) => setPublishChannel(event.target.value === "mask" ? "mask" : "image")} disabled={document.mode !== "writable"}><option value="image">Image</option><option value="mask">Mask</option></select></label><StrokeCanvas width={drawing.width} height={drawing.height} background={drawing.background} strokes={drawing.strokes} disabled={document.mode !== "writable"} onChange={updateStrokes} /><div className="inspector-actions"><button type="button" disabled={document.mode !== "writable"} onClick={() => void publish()}>Publish drawing</button></div></InspectorSection>;
}

function ImageEditFields({ context }: { context: InspectorNodeContext }) {
  const { node, graph, document, apply, report, commitImageEdit } = context;
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [allArtifacts, setAllArtifacts] = useState<Artifact[]>([]);
  const [capabilities, setCapabilities] = useState<ProviderCapability[]>([]);
  const [outputVersionIds, setOutputVersionIds] = useState<string[]>([]);
  const [sourceId, setSourceId] = useState("");
  const incoming = useMemo(() => graph.edges.filter((edge) => edge.enabled && edge.to.kind === "node" && edge.to.nodeId === node.id), [graph.edges, node.id]);
  const imageEdges = useMemo(() => incoming.filter((edge) => edge.from.kind === "node" && edge.to.channel === "image"), [incoming]);

  useEffect(() => {
    if (node.config.kind !== "edit.image") return;
    let current = true;
    const upstreamNodeIds = [...new Set(imageEdges.flatMap((edge) => edge.from.kind === "node" ? [edge.from.nodeId] : []))];
    void (async () => {
      const [capabilityResponse, outputResponse, upstreamResponses] = await Promise.all([
        app()?.query(globalQuery("provider.capabilities", {})),
        app()?.query(documentQuery("node.outputs", document.documentId, { nodeId: node.id })),
        Promise.all(upstreamNodeIds.map(async (nodeId) => {
          const response = await app()?.query(documentQuery("node.outputs", document.documentId, { nodeId }));
          return [nodeId, (response?.payload?.outputs as NodeOutputVersion[] | undefined) ?? []] as const;
        }))
      ]);
      const outputs = (outputResponse?.payload?.outputs as NodeOutputVersion[] | undefined) ?? [];
      const upstreamOutputs = new Map(upstreamResponses);
      const selectedOutputIds = new Set(imageEdges.flatMap((edge) => edge.from.kind === "node" ? selectedOutputVersions(edge, upstreamOutputs.get(edge.from.nodeId) ?? []) : []));
      const requestedOutputIds = [...new Set([...selectedOutputIds, ...outputs.map((output) => output.id)])];
      const artifactResponse = await app()?.query(documentQuery("artifact.search", document.documentId, {
        text: "", channels: ["image"], collectionIds: [], tags: [], minimumRating: null,
        providerId: null, modelId: null, runId: null, graphId: null, outputVersionIds: requestedOutputIds,
        createdAfter: null, createdBefore: null, limit: Math.max(1, requestedOutputIds.length)
      }));
      if (!current) return;
      const nextArtifacts = ((artifactResponse?.payload?.artifacts as Artifact[] | undefined) ?? []).filter((artifact) => artifact.mediaType.startsWith("image/"));
      const nextSources = nextArtifacts.filter((artifact) => selectedOutputIds.has(artifact.source.outputVersionId));
      setAllArtifacts(nextArtifacts);
      setArtifacts(nextSources);
      setCapabilities((capabilityResponse?.payload?.capabilities as ProviderCapability[] | undefined) ?? []);
      setOutputVersionIds(outputs.map((output) => output.id));
      setSourceId((selected) => {
        if (nextSources.some((artifact) => artifact.id === selected)) return selected;
        const persisted = node.config.kind === "edit.image" ? node.config.workspace?.sourceArtifactId : undefined;
        return nextSources.some((artifact) => artifact.id === persisted) ? persisted! : nextSources[0]?.id ?? "";
      });
    })().catch((error: unknown) => { if (current) report(error instanceof Error ? error.message : "The image edit workspace could not load its source catalog."); });
    return () => { current = false; };
  }, [document.documentId, imageEdges, node.config, node.id, report]);

  if (node.config.kind !== "edit.image") return null;
  const config = node.config;
  const sourceArtifact = artifacts.find((artifact) => artifact.id === sourceId);
  const source = sourceArtifact ? artifactEditSource(document.documentId, sourceArtifact) : undefined;
  const outputArtifact = allArtifacts.find((artifact) => outputVersionIds.includes(artifact.source.outputVersionId));
  const selectedCapability = capabilities.find((capability) => capability.operation === "edit-image" && capability.providerId === resolveRendererImageProviderAlias(config.providerId) && capability.profileId === config.profileId);
  const capability = imageEditCapability(config.providerId, config.profileId, selectedCapability);
  const persistedWorkspace = config.workspace?.sourceArtifactId === sourceId ? config.workspace : undefined;
  const persistWorkspace = async (workspace: EditWorkspaceState, title = "Update edit workspace") => {
    const next = { ...node, config: { ...config, workspace } } as EtherNode;
    const saved = await apply([{ type: "updateNode", graphId: graph.id, nodeId: node.id, node: next }] as GraphOperation[], title);
    if (saved) report("Edit workspace saved.");
  };
  const selectSource = (nextSourceId: string) => {
    setSourceId(nextSourceId);
    const nextSource = artifacts.find((artifact) => artifact.id === nextSourceId);
    if (!nextSource) return;
    const width = numericMetadata(nextSource.metadata.width, 1024);
    const height = numericMetadata(nextSource.metadata.height, 1024);
    void persistWorkspace({
      sourceArtifactId: nextSourceId,
      recipeId: config.workspace?.recipeId ?? "freeform",
      frame: { mode: "source", x: 0, y: 0, width, height },
      maskGeometry: { width, height, strokes: [] },
      capability: {
        providerId: capability.providerId,
        profileId: capability.profileId,
        mode: capability.mode,
        ...(capability.detail ? { detail: capability.detail } : {})
      }
    }, "Change edit source");
  };
  const save = async (payload: ImageEditCommit) => {
    if (capability.mode === "unsupported") {
      report("This provider cannot accept a mask edit setup.");
      return;
    }
    try {
      let artifact: Artifact;
      if (commitImageEdit) {
        artifact = await commitImageEdit(payload);
        if (!artifact) throw new Error("The edit publisher did not return its immutable mask artifact.");
      } else {
        const content = payload.mask.raster.content;
        const response = await app()?.command(documentCommand("editWorkspace.commit", document.documentId, {
          graphId: context.graph.id,
          nodeId: node.id,
          kind: "mask",
          channel: "mask",
          mediaType: payload.mask.raster.mimeType,
          width: payload.mask.raster.width,
          height: payload.mask.raster.height,
          byteLength: new TextEncoder().encode(content).byteLength,
          content: { encoding: "utf8", data: content },
          geometry: payload.mask.geometry,
          editState: {
            sourceArtifactId: payload.source.artifactId,
            recipeId: payload.recipeId,
            frame: payload.frame,
            maskGeometry: payload.mask.geometry,
            capability: {
              providerId: capability.providerId,
              profileId: capability.profileId,
              mode: capability.mode,
              ...(capability.detail ? { detail: capability.detail } : {})
            }
          }
        }));
        const committed = response?.payload as { artifact?: Artifact } | undefined;
        if (!committed?.artifact) throw new Error("The edit workspace did not return its immutable mask artifact.");
        artifact = committed.artifact;
      }
      await persistWorkspace({
        sourceArtifactId: payload.source.artifactId,
        maskArtifactId: artifact.id,
        recipeId: payload.recipeId,
        frame: payload.frame,
        maskGeometry: payload.mask.geometry,
        capability: {
          providerId: capability.providerId,
          profileId: capability.profileId,
          mode: capability.mode,
          ...(capability.detail ? { detail: capability.detail } : {})
        }
      }, "Bind committed edit mask");
      report(`Mask artifact ${artifact.id} committed for ${node.title}.`);
    } catch (error) {
      report(error instanceof Error ? error.message : "The edit setup could not be published.");
    }
  };

  return <InspectorSection title="Edit workspace" help="Frame geometry and mask strokes remain editable. Saving requires a typed backend callback that publishes an immutable mask artifact before execution.">
    <div className="edit-input-summary" data-testid="edit-input-summary" aria-label="Connected edit inputs"><span>{incoming.filter((edge) => edge.to.channel === "image").length} Image</span><span>{incoming.filter((edge) => edge.to.channel === "mask").length} Mask</span><span>{incoming.filter((edge) => edge.to.channel === "text").length} Text</span></div>
    {incoming.some((edge) => edge.to.channel === "mask") ? <small className="edit-mask-precedence" data-testid="edit-mask-precedence">{config.workspace?.maskArtifactId ? "The saved local mask currently overrides the connected Mask lane for execution." : "Saving a local mask will override the connected Mask lane for execution."}</small> : null}
    {artifacts.length > 0 ? <label>Source image<select aria-label="Edit source image" value={sourceId} onChange={(event) => selectSource(event.target.value)}>{artifacts.map((artifact) => <option key={artifact.id} value={artifact.id}>{artifactTitle(artifact)}</option>)}</select></label> : <p className="inspector-unavailable">Connect an enabled Image lane with an available output to begin editing.</p>}
    <EditWorkspace config={config} source={source} outputPreviewUrl={outputArtifact ? embeddedArtifactSource(document.documentId, outputArtifact.id) : undefined} capability={capability} initialFrame={persistedWorkspace?.frame} initialMask={persistedWorkspace?.maskGeometry} initialRecipeId={persistedWorkspace?.recipeId} disabled={document.mode !== "writable"} onWorkspaceChange={(workspace) => void persistWorkspace(workspace)} onCommit={(payload) => void save(payload)} />
  </InspectorSection>;
}

function MaskFields({ context }: { context: InspectorNodeContext }) {
  const { node, graph, document, apply, report } = context;
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [sourceId, setSourceId] = useState("");
  const incoming = useMemo(() => graph.edges.filter((edge) => edge.enabled && edge.to.kind === "node" && edge.to.nodeId === node.id), [graph.edges, node.id]);
  const imageEdges = useMemo(() => incoming.filter((edge) => edge.from.kind === "node" && edge.to.channel === "image"), [incoming]);

  useEffect(() => {
    if (node.config.kind !== "edit.mask") return;
    let current = true;
    const upstreamNodeIds = [...new Set(imageEdges.flatMap((edge) => edge.from.kind === "node" ? [edge.from.nodeId] : []))];
    void (async () => {
      const upstreamResponses = await Promise.all(upstreamNodeIds.map(async (nodeId) => {
        const response = await app()?.query(documentQuery("node.outputs", document.documentId, { nodeId }));
        return [nodeId, (response?.payload?.outputs as NodeOutputVersion[] | undefined) ?? []] as const;
      }));
      const upstreamOutputs = new Map(upstreamResponses);
      const selectedOutputIds = [...new Set(imageEdges.flatMap((edge) => edge.from.kind === "node" ? selectedOutputVersions(edge, upstreamOutputs.get(edge.from.nodeId) ?? []) : []))];
      const artifactResponse = await app()?.query(documentQuery("artifact.search", document.documentId, {
        text: "", channels: ["image"], collectionIds: [], tags: [], minimumRating: null,
        providerId: null, modelId: null, runId: null, graphId: null, outputVersionIds: selectedOutputIds,
        createdAfter: null, createdBefore: null, limit: Math.max(1, selectedOutputIds.length)
      }));
      if (!current) return;
      const nextArtifacts = ((artifactResponse?.payload?.artifacts as Artifact[] | undefined) ?? []).filter((artifact) => artifact.mediaType.startsWith("image/") && selectedOutputIds.includes(artifact.source.outputVersionId));
      setArtifacts(nextArtifacts);
      setSourceId((selected) => {
        if (nextArtifacts.some((artifact) => artifact.id === selected)) return selected;
        const persisted = node.config.kind === "edit.mask" ? node.config.workspace?.sourceArtifactId : undefined;
        return nextArtifacts.some((artifact) => artifact.id === persisted) ? persisted! : nextArtifacts[0]?.id ?? "";
      });
    })().catch((error: unknown) => { if (current) report(error instanceof Error ? error.message : "The Mask workspace could not load its source catalog."); });
    return () => { current = false; };
  }, [document.documentId, imageEdges, node.config, node.id, report]);

  if (node.config.kind !== "edit.mask") return null;
  const config = node.config;
  const sourceArtifact = artifacts.find((artifact) => artifact.id === sourceId);
  const source = sourceArtifact ? artifactEditSource(document.documentId, sourceArtifact) : undefined;
  const persistedWorkspace = config.workspace?.sourceArtifactId === sourceId ? config.workspace : undefined;
  const writable = document.mode === "writable";
  const persistWorkspace = async (sourceArtifactId: string, geometry: EditMaskGeometry, maskArtifactId?: string, title = "Update mask workspace") => {
    const workspace = {
      sourceArtifactId,
      ...(maskArtifactId ? { maskArtifactId } : {}),
      geometry
    };
    const saved = await apply([{ type: "updateNode", graphId: graph.id, nodeId: node.id, node: { ...node, config: { ...config, workspace } } as EtherNode }] as GraphOperation[], title);
    if (saved) report("Mask workspace saved.");
  };
  const selectSource = (nextSourceId: string) => {
    setSourceId(nextSourceId);
    const nextSource = artifacts.find((artifact) => artifact.id === nextSourceId);
    if (!nextSource) return;
    const width = numericMetadata(nextSource.metadata.width, 1024);
    const height = numericMetadata(nextSource.metadata.height, 1024);
    void persistWorkspace(nextSourceId, { width, height, strokes: [] }, undefined, "Change mask source");
  };
  const persistGeometry = (next: MaskGeometry) => {
    const geometry = next as EditMaskGeometry;
    void persistWorkspace(sourceId, geometry, persistedWorkspace?.maskArtifactId, "Update mask geometry");
  };
  const save = async (payload: MaskCommitResult) => {
    if (!source) {
      report("Connect an image source before publishing a mask.");
      return;
    }
    try {
      const content = payload.raster.content;
      const width = payload.raster.width;
      const height = payload.raster.height;
      const response = await app()?.command(documentCommand("editWorkspace.commit", document.documentId, {
        graphId: graph.id,
        nodeId: node.id,
        kind: "mask",
        channel: "mask",
        mediaType: payload.raster.mimeType,
        width,
        height,
        byteLength: new TextEncoder().encode(content).byteLength,
        content: { encoding: "utf8", data: content },
        geometry: payload.geometry,
        editState: {
          sourceArtifactId: source.artifactId,
          recipeId: "freeform",
          frame: { mode: "source", x: 0, y: 0, width, height },
          maskGeometry: payload.geometry,
          capability: {
            providerId: "ether-local",
            profileId: "local-mask",
            mode: "native-inpainting",
            detail: "Locally authored mask; no provider call."
          }
        }
      }));
      const committed = response?.payload as { artifact?: Artifact } | undefined;
      if (!committed?.artifact) throw new Error("The Mask workspace did not return its immutable artifact.");
      await persistWorkspace(source.artifactId, payload.geometry as EditMaskGeometry, committed.artifact.id, "Bind committed mask artifact");
      report(`Mask artifact ${committed.artifact.id} committed for ${node.title}.`);
    } catch (error) {
      report(error instanceof Error ? error.message : "The mask could not be published.");
    }
  };

  return <InspectorSection title="Mask workspace" help="Paint, erase, and publish an immutable mask artifact. Connected Image outputs are the only accepted sources; geometry remains saved with this node.">
    <div className="edit-input-summary" data-testid="mask-input-summary"><span>{imageEdges.length} Image</span><span>Mode - {config.mode}</span><span>Feather - {config.feather}</span></div>
    {imageEdges.length === 0 ? <p className="inspector-unavailable" data-testid="mask-no-source">Connect an enabled Image lane with an available output to begin mask authoring.</p> : null}
    {artifacts.length > 0 ? <label>Source image<select aria-label="Mask source image" value={sourceId} onChange={(event) => selectSource(event.target.value)} disabled={!writable}>{artifacts.map((artifact) => <option key={artifact.id} value={artifact.id}>{artifactTitle(artifact)}</option>)}</select></label> : null}
    <MaskWorkspace source={source} initialGeometry={persistedWorkspace?.geometry} disabled={!writable} onGeometryChange={persistGeometry} onCommit={(payload) => void save(payload)} />
  </InspectorSection>;
}

function selectedOutputVersions(edge: EtherEdge, outputs: NodeOutputVersion[]) {
  if (edge.selector.kind === "pinned") {
    const outputVersionId = edge.selector.outputVersionId;
    return outputs.some((output) => output.id === outputVersionId) ? [outputVersionId] : [];
  }
  const newestFirst = [...outputs].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  if (edge.selector.kind === "all") return newestFirst.map((output) => output.id);
  if (edge.selector.kind === "latest-approved") return newestFirst.find((output) => output.approval.state === "approved") ? [newestFirst.find((output) => output.approval.state === "approved")!.id] : [];
  return newestFirst[0] ? [newestFirst[0].id] : [];
}

function artifactEditSource(documentId: string, artifact: Artifact): ImageEditSource {
  const width = numericMetadata(artifact.metadata.width, 1024);
  const height = numericMetadata(artifact.metadata.height, 1024);
  return { artifactId: artifact.id, previewUrl: embeddedArtifactSource(documentId, artifact.id), label: artifactTitle(artifact), width, height };
}

function artifactTitle(artifact: Artifact) {
  return typeof artifact.metadata.title === "string" && artifact.metadata.title.trim() ? artifact.metadata.title : artifact.id;
}

function numericMetadata(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function imageEditCapability(providerId: string, profileId: string, capability: ProviderCapability | undefined): ImageEditCapability {
  if (!capability || !capability.inputChannels.includes("image") || !capability.inputChannels.includes("mask")) {
    return { providerId, profileId, mode: "unsupported", detail: capability ? capability.limitations.join(" ") : "No verified edit-image profile matched this node." };
  }
  const limitations = capability.limitations.join(" ");
  const native = /native[- ]inpaint|pixel[- ]exact/i.test(limitations);
  return {
    providerId,
    profileId,
    mode: native ? "native-inpainting" : "guidance-only",
    detail: limitations || (native ? "Verified provider capability." : "The capability exposes a mask input without a pixel-exact native-inpainting guarantee.")
  };
}

function ReferenceFields({ context }: { context: InspectorNodeContext }) {
  const { node, graph, document, refreshGraph, report } = context;
  const [members, setMembers] = useState("");
  const [dropStorage, setDropStorage] = useState<"link" | "embed">("link");
  const [importing, setImporting] = useState(false);
  if (node.config.kind !== "reference.set") return null;
  const assign = async (replace: boolean) => { const ids = members.split(/[\s,]+/).filter(Boolean); if (!ids.length) { report("Enter one or more reference IDs first."); return; } try { await app()?.command(documentCommand("reference.assignToSet", document.documentId, { nodeId: node.id, members: ids.map((referenceId) => ({ kind: "linked-reference", referenceId, enabled: true })), replace })); const refreshed = await refreshGraph(); if (!refreshed) throw new Error("The updated Reference Set could not be refreshed."); setMembers(""); report(replace ? "Reference Set replaced." : "References added to the set."); } catch (error) { report(error instanceof Error ? error.message : "Reference assignment needs attention."); } };
  const choose = async (storage: "link" | "embed") => {
    setImporting(true);
    try {
      const result = await window.ether.references.chooseAndLink({ documentId: document.documentId, graphId: graph.id, nodeId: node.id, role: "general", storage });
      if (!result.cancelled) {
        await refreshGraph();
        report(`${storage === "embed" ? "Embedded" : "Linked"} file added to ${node.title}.`);
      }
    } catch (error) {
      report(error instanceof Error ? error.message : "The reference picker needs attention.");
    } finally {
      setImporting(false);
    }
  };
  const importDropped = async (event: ReactDragEvent<HTMLElement>) => {
    if (event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    setImporting(true);
    try {
      let imported = 0;
      for (const file of [...event.dataTransfer.files]) {
        const result = await window.ether.references.importDropped(file, { documentId: document.documentId, graphId: graph.id, nodeId: node.id, role: "general", storage: dropStorage });
        if (!result.cancelled) imported += 1;
      }
      await refreshGraph();
      report(`${imported} file${imported === 1 ? "" : "s"} ${dropStorage === "embed" ? "embedded in" : "linked to"} ${node.title}.`);
    } catch (error) {
      report(error instanceof Error ? error.message : "Dropped references could not be imported.");
    } finally {
      setImporting(false);
    }
  };
  return <InspectorSection title="Reference Set" help="Link external files or embed portable copies. Add and Replace are explicit actions; Ether never silently replaces a source set.">
    <div className="inspector-actions"><button type="button" disabled={importing} onClick={() => void choose("link")}>Link file</button><button type="button" disabled={importing} onClick={() => void choose("embed")}>Embed copy</button></div>
    <label>Drop behavior<select aria-label="Reference Set drop behavior" value={dropStorage} onChange={(event) => setDropStorage(event.target.value as "link" | "embed")}><option value="link">Link dropped files</option><option value="embed">Embed dropped files</option></select></label>
    <div className="inspector-reference-drop" aria-label="Drop files into Reference Set" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }} onDrop={(event) => void importDropped(event)}>{importing ? "Importing references…" : "Drop one or more files here"}</div>
    <label>Existing Reference IDs <Help label="Reference IDs" text={controlHelp.references} /><textarea aria-label="Reference IDs" value={members} placeholder="reference-id, another-reference-id" onChange={(event) => setMembers(event.target.value)} /></label>
    <div className="inspector-actions"><button type="button" onClick={() => void assign(false)}>Add references</button><button type="button" onClick={() => void assign(true)}>Replace set</button></div>
    <small>{(node.config.members ?? node.config.artifactIds ?? []).length} saved member{(node.config.members ?? node.config.artifactIds ?? []).length === 1 ? "" : "s"}; ordered {node.config.ordering}.</small>
  </InspectorSection>;
}

function NodeChannels({ context }: { context: InspectorNodeContext }) {
  const { node, graph } = context;
  const definition = getNodeDefinition(node.definitionId);
  const incoming = graph.edges.filter((edge) => edge.to.kind === "node" && edge.to.nodeId === node.id);
  const outgoing = graph.edges.filter((edge) => edge.from.kind === "node" && edge.from.nodeId === node.id);
  const valid = definition.configSchema.safeParse(node.config);
  return <InspectorSection title="Channels & routes" help="Inputs and outputs come from the canonical node contract. Lane roles and selectors stay visible at the receiving edge.">
    <div className="inspector-channel-summary"><div><strong>Inputs</strong><span>{definition.library.inputChannels.length ? definition.library.inputChannels.map(channelLabel).join(" · ") : "None"}</span><small>{incoming.length} connected lane{incoming.length === 1 ? "" : "s"}</small></div><div><strong>Outputs</strong><span>{definition.library.outputChannels.map(channelLabel).join(" · ")}</span><small>{outgoing.length} connected lane{outgoing.length === 1 ? "" : "s"}</small></div></div>
    {!valid.success ? <p className="inspector-unavailable" role="alert">Needs setup: {valid.error.issues[0]?.message ?? "The saved configuration is incomplete."}</p> : null}
  </InspectorSection>;
}

export function NodeInspector({ context }: { context: InspectorNodeContext }) {
  const { node, graph, document, apply, report } = context; const roles = useMemo(() => outgoingRoles(graph, node), [graph, node]);
  const update = async (next: EtherNode, title: string) => { if (!next.title.trim()) { report("A node title cannot be empty."); return false; } return apply([{ type: "updateNode", graphId: graph.id, nodeId: node.id, node: next }] as GraphOperation[], title); };
  return <div className="ether-inspector" data-testid="node-inspector"><NodeSetup node={node} disabled={document.mode !== "writable"} onUpdate={update} /><NodeChannels context={context} /><PromptFields context={context} /><WorkerFields context={context} /><ProviderFields context={context} /><DrawingFields context={context} /><ImageEditFields context={context} /><MaskFields context={context} /><ReferenceFields context={context} /><RegistryConfigFields context={context} />{roles.length ? <InspectorSection title="Outgoing roles" help="Roles describe how every receiver interprets an outgoing channel."><div className="inspector-role-list">{roles.map(({ edge, target }) => <span key={edge.id}><strong>{roleLabels[edge.role]}</strong> · {channelLabel(edge.from.channel)} → {channelLabel(edge.to.channel)} · {edge.selector.kind} · {target}</span>)}</div></InspectorSection> : null}<RunControls node={node} graphId={graph.id} graphRevisionId={document.graphId === graph.id ? document.graphRevisionId : `${document.documentRevisionId}:${graph.id}`} graphContextFingerprint={runPlanContextFingerprint(graph)} documentId={document.documentId} disabled={document.mode !== "writable"} hasDownstream={graph.edges.some((edge) => edge.enabled && edge.from.kind === "node" && edge.from.nodeId === node.id)} report={report} /><OutputVersions context={context} /><InspectorSection advanced title="Diagnostics & provenance" help={controlHelp.advanced}><p>Node ID: {node.id}</p><p>Definition: {node.definitionId}</p><p>Graph: {graph.id}</p></InspectorSection></div>;
}

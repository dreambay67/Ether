import type { ConnectionRole, EtherGraph, InputConsequence, NodeOutputVersion, OutputSelector, PayloadChannel, PayloadEnvelope } from "@ether/schema";
import { resolveAdapter } from "./adapters.js";
import { validateConnection } from "./connectionValidator.js";
import { getNodeDefinition } from "./registry.js";
import { deriveLineageKey, numberDirectRoles } from "./roleConsequences.js";
import { resolveOutputSelector, type OutputSelectorDiagnostic } from "./outputSelectors.js";

export type ExecutorManifestInput = {
  edgeId: string;
  role: PayloadEnvelope["role"];
  order: number;
  caption: string;
  lineageKey: string;
  payload: PayloadEnvelope;
  consequence: InputConsequence;
};

export type ExecutorManifest = {
  targetNodeId: string;
  executor: ReturnType<typeof getNodeDefinition>["executor"];
  instruction: string;
  positiveBody: string;
  negativeBody: string;
  lineageKey: string;
  inputs: ExecutorManifestInput[];
};

export type ExecutorContextDiagnostic = {
  code: OutputSelectorDiagnostic["code"] | "UPSTREAM_DISABLED";
  message: string;
  edgeId: string;
  selector: OutputSelector;
  sourceNodeId: string;
  role: ConnectionRole;
  order: number;
  channel: PayloadChannel;
  outputVersionId?: string;
};

function targetInstruction(config: object): string {
  const value = Reflect.get(config, "instruction");
  return typeof value === "string" ? value : "";
}

function textValue(payload: PayloadEnvelope): string | null {
  if (payload.content.kind === "text") return payload.content.value;
  if (payload.content.kind === "object") return JSON.stringify(payload.content.value);
  return null;
}

function adaptPayload(payload: PayloadEnvelope, targetChannel: PayloadEnvelope["channel"], adapterId: string | null): PayloadEnvelope {
  if (payload.channel === targetChannel) return payload;
  if (targetChannel === "text") return { ...payload, channel: "text", content: { kind: "text", value: payload.content.kind === "object" ? JSON.stringify(payload.content.value) : `[${adapterId ?? "adapter"}:${payload.id}]` }, metadata: { ...payload.metadata, adapterId } };
  if (targetChannel === "data") return { ...payload, channel: "data", content: { kind: "object", value: payload.content.kind === "text" ? { text: payload.content.value } : { sourcePayloadId: payload.id } }, metadata: { ...payload.metadata, adapterId } };
  return { ...payload, channel: targetChannel, metadata: { ...payload.metadata, adapterId } };
}

export function assembleExecutorContext(input: {
  graph: EtherGraph;
  targetNodeId: string;
  versions: readonly NodeOutputVersion[];
  payloads: readonly PayloadEnvelope[];
  capabilities: readonly string[];
  includeUpstream?: boolean;
}): { trace: readonly string[]; diagnostics: ExecutorContextDiagnostic[]; manifest: ExecutorManifest } {
  const target = input.graph.nodes.find((node) => node.id === input.targetNodeId);
  if (target === undefined) throw new Error(`Unknown target node: ${input.targetNodeId}`);
  const directEdges = input.graph.edges.filter((edge) => edge.enabled && edge.to.kind === "node" && edge.to.nodeId === target.id && edge.from.kind === "node");
  const lanes = numberDirectRoles(directEdges.map((edge) => ({ edgeId: edge.id, role: edge.role, order: edge.order, edge })));
  const diagnostics: ExecutorContextDiagnostic[] = [];
  const assembledLanes: Array<{ edgeId: string; payloads: PayloadEnvelope[] }> = [];
  const manifestInputs: ExecutorManifestInput[] = [];
  for (const lane of lanes) {
    const edge = lane.edge;
    if (edge.from.kind !== "node" || edge.to.kind !== "node") continue;
    const sourceNodeId = edge.from.nodeId;
    const provenance = {
      edgeId: edge.id,
      selector: edge.selector,
      sourceNodeId,
      role: edge.role,
      order: edge.order,
      channel: edge.from.channel
    };
    if (input.includeUpstream === false) {
      diagnostics.push({
        code: "UPSTREAM_DISABLED",
        message: "Upstream context is disabled by the worker context policy.",
        ...provenance
      });
      assembledLanes.push({ edgeId: edge.id, payloads: [] });
      continue;
    }
    const source = input.graph.nodes.find((node) => node.id === sourceNodeId);
    if (source === undefined) throw new Error(`Unknown source node: ${sourceNodeId}`);
    const selection = resolveOutputSelector({ selector: edge.selector, nodeId: source.id, channel: edge.from.channel, versions: input.versions, payloads: input.payloads });
    diagnostics.push(...selection.diagnostics.map((diagnostic) => ({ ...diagnostic, ...provenance })));
    const selectedVersions = new Set(selection.versionIds);
    const channelPayloads = input.payloads.filter((payload) => selectedVersions.has(payload.source.outputVersionId) && payload.source.nodeId === source.id && payload.channel === edge.from.channel);
    const decision = validateConnection({ sourceDefinitionId: source.definitionId, sourceChannel: edge.from.channel, targetDefinitionId: target.definitionId, targetChannel: edge.to.channel, role: edge.role, adapter: edge.adapter, capabilities: input.capabilities });
    if (!decision.allowed) throw new Error(`${decision.code}: ${decision.message}`);
    const adapter = resolveAdapter(edge.from.channel, edge.to.channel, edge.adapter, new Set(input.capabilities));
    const adapted = channelPayloads.map((payload) => ({ ...adaptPayload(payload, edge.to.channel, adapter?.id ?? null), role: edge.role, source: { ...payload.source, edgeId: edge.id } }));
    assembledLanes.push({ edgeId: edge.id, payloads: adapted });
    for (const payload of adapted) manifestInputs.push({ edgeId: edge.id, role: edge.role, order: edge.order, caption: lane.caption, lineageKey: payload.source.lineageKey, payload, consequence: decision.consequences[0]! });
  }
  const positiveBody = manifestInputs.flatMap((item) => {
    if (item.role === "negative") return [];
    const value = textValue(item.payload);
    return value === null ? [] : [`${item.caption}: ${value}`];
  }).join("\n\n");
  const negativeBody = manifestInputs.filter((item) => item.role === "negative").map((item) => textValue(item.payload)).filter((value): value is string => value !== null).join("\n");
  return {
    trace: ["selector", "channel-payload", "adapter", "role-order", "target-consequence", "executor-manifest"],
    diagnostics,
    manifest: { targetNodeId: target.id, executor: getNodeDefinition(target.definitionId).executor, instruction: targetInstruction(target.config), positiveBody, negativeBody, lineageKey: deriveLineageKey(assembledLanes), inputs: manifestInputs }
  };
}

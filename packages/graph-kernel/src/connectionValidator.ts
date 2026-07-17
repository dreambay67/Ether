import {
  canonicalNodeDefinitionIds,
  connectionRoles,
  payloadChannels,
  type ConnectionDecision,
  type ConnectionRole,
  type EdgeAdapter,
  type EtherEdge,
  type NodeDefinitionId,
  type OutputSelector,
  type PayloadChannel
} from "@ether/schema";
import { adapterCandidates, resolveAdapter } from "./adapters.js";
import { nodeRegistry } from "./registry.js";

export type ConnectionValidationInput = {
  sourceDefinitionId: NodeDefinitionId | string;
  sourceChannel: PayloadChannel | string;
  targetDefinitionId: NodeDefinitionId | string;
  targetChannel: PayloadChannel | string;
  role: ConnectionRole | string;
  adapter?: EdgeAdapter;
  candidate?: EtherEdge;
  existingEdges?: readonly EtherEdge[];
  capabilities?: readonly string[];
};

export function canonicalSelector(selector: OutputSelector): string {
  return selector.kind === "pinned" ? `pinned:${selector.outputVersionId}` : selector.kind;
}

function endpointIdentity(endpoint: EtherEdge["from"]): string {
  return endpoint.kind === "node" ? `node:${endpoint.nodeId}:${endpoint.channel}` : `module:${endpoint.moduleId}:${endpoint.portId}:${endpoint.channel}`;
}

export function canonicalConnectionIdentity(edge: EtherEdge): string {
  return [endpointIdentity(edge.from), endpointIdentity(edge.to), edge.role, canonicalSelector(edge.selector)].join("|");
}

function reject(code: Exclude<ConnectionDecision, { allowed: true }>["code"], message: string, remedies: Exclude<ConnectionDecision, { allowed: true }>["remedies"]): ConnectionDecision {
  return { allowed: false, code, message, remedies };
}

export function validateConnection(input: ConnectionValidationInput): ConnectionDecision {
  const sourceDefinition = nodeRegistry.get(input.sourceDefinitionId as NodeDefinitionId);
  if (sourceDefinition === undefined) return reject("UNKNOWN_NODE_DEFINITION", `Unknown source node definition: ${input.sourceDefinitionId}`, [{ kind: "select-node-definition", endpoint: "source", definitionIds: [...canonicalNodeDefinitionIds] }]);
  const targetDefinition = nodeRegistry.get(input.targetDefinitionId as NodeDefinitionId);
  if (targetDefinition === undefined) return reject("UNKNOWN_NODE_DEFINITION", `Unknown target node definition: ${input.targetDefinitionId}`, [{ kind: "select-node-definition", endpoint: "target", definitionIds: [...canonicalNodeDefinitionIds] }]);
  if (!payloadChannels.includes(input.sourceChannel as PayloadChannel)) return reject("UNKNOWN_CHANNEL", `Unknown source channel: ${input.sourceChannel}`, [{ kind: "select-channel", endpoint: "source", channels: sourceDefinition.library.outputChannels }]);
  if (!payloadChannels.includes(input.targetChannel as PayloadChannel)) return reject("UNKNOWN_CHANNEL", `Unknown target channel: ${input.targetChannel}`, [{ kind: "select-channel", endpoint: "target", channels: targetDefinition.library.inputChannels }]);
  const sourceChannel = input.sourceChannel as PayloadChannel;
  const targetChannel = input.targetChannel as PayloadChannel;
  if (!sourceDefinition.library.outputChannels.includes(sourceChannel)) return reject("SOURCE_CHANNEL_UNAVAILABLE", `${sourceDefinition.title} does not produce ${sourceChannel}.`, [{ kind: "select-channel", endpoint: "source", channels: sourceDefinition.library.outputChannels }]);
  if (!targetDefinition.library.inputChannels.includes(targetChannel)) return reject("TARGET_CHANNEL_UNAVAILABLE", `${targetDefinition.title} does not accept ${targetChannel}.`, [{ kind: "select-channel", endpoint: "target", channels: targetDefinition.library.inputChannels }]);
  if (!connectionRoles.includes(input.role as ConnectionRole)) return reject("ROLE_UNSUPPORTED", `Unknown connection role: ${input.role}`, [{ kind: "select-role", roles: [...connectionRoles] }]);
  if (input.candidate !== undefined) {
    const identity = canonicalConnectionIdentity(input.candidate);
    const duplicate = input.existingEdges?.find((edge) => edge.id !== input.candidate!.id && canonicalConnectionIdentity(edge) === identity);
    if (duplicate !== undefined) return reject("DUPLICATE_LANE", "An exact connection lane already exists.", [{ kind: "remove-edge", edgeId: duplicate.id }]);
  }
  const capabilities = new Set(input.capabilities ?? []);
  let adapter = null;
  if (sourceChannel !== targetChannel) {
    const candidates = adapterCandidates(sourceChannel, targetChannel);
    if (candidates.length === 0) return reject("ADAPTER_UNAVAILABLE", `No declared adapter converts ${sourceChannel} to ${targetChannel}.`, [{ kind: "select-channel", endpoint: "target", channels: targetDefinition.library.inputChannels }]);
    const selection = input.adapter ?? input.candidate?.adapter ?? { kind: "auto" as const };
    adapter = resolveAdapter(sourceChannel, targetChannel, selection, capabilities);
    if (adapter === null) {
      const explicit = selection.kind === "explicit" ? candidates.find((candidate) => candidate.id === selection.adapterId) : undefined;
      if (selection.kind === "explicit" && explicit === undefined) return reject("ADAPTER_UNAVAILABLE", `Adapter ${selection.adapterId} is not declared for this channel pair.`, [{ kind: "choose-adapter", adapterIds: candidates.map((candidate) => candidate.id) }]);
      const required = (explicit === undefined ? candidates : [explicit]).map((candidate) => candidate.requiredCapability).find((capability): capability is string => capability !== null && !capabilities.has(capability));
      if (required !== undefined) return reject("PROVIDER_CAPABILITY_UNAVAILABLE", `Adapter requires capability ${required}.`, [{ kind: "enable-capability", capability: required }]);
      return reject("ADAPTER_UNAVAILABLE", "The selected adapter cannot be resolved.", [{ kind: "choose-adapter", adapterIds: candidates.map((candidate) => candidate.id) }]);
    }
    if (adapter.requiredCapability !== null && !capabilities.has(adapter.requiredCapability)) return reject("PROVIDER_CAPABILITY_UNAVAILABLE", `Adapter requires capability ${adapter.requiredCapability}.`, [{ kind: "enable-capability", capability: adapter.requiredCapability }]);
  }
  const role = input.role as ConnectionRole;
  const targetConsequence = targetDefinition.contract.consequences[targetChannel]?.[role];
  if (targetConsequence === undefined || targetConsequence.executorInputField.length === 0) return reject("ROLE_UNSUPPORTED", `${targetDefinition.title} has no consequence for ${targetChannel}/${role}.`, [{ kind: "select-role", roles: [...connectionRoles] }]);
  const resolvedAdapter = adapter === null ? null : {
    adapterId: adapter.adapterId,
    fromChannel: adapter.fromChannel,
    toChannel: adapter.toChannel,
    requiredCapability: adapter.requiredCapability
  };
  return {
    allowed: true,
    adapter: resolvedAdapter,
    consequences: [{ ...targetConsequence, requiredAdapterCapability: adapter?.requiredCapability ?? null }]
  };
}

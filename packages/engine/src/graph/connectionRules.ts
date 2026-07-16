import { type EtherNodeKind, NODE_CATEGORY_LABELS, NODE_DEFINITIONS } from "./nodeCatalog.js";
import { getOptionalNodeContract, type ContractPort } from "./contracts.js";
import {
  canonicalChannel,
  resolveEdgeSemantics,
  type EdgeAdapter
} from "./edgeSemantics.js";
import { channelLabel, type ConnectionRole, type PayloadChannel } from "./channels.js";

export type ConnectionRuleResult = {
  allowed: boolean;
  reason?: string;
  defaultLabel?: string;
  defaultRole?: ConnectionRole;
  sourceChannel?: PayloadChannel;
  targetChannel?: PayloadChannel;
  adapter?: EdgeAdapter;
  disabledReason?: string;
};

export type ConnectionRuleContext = {
  sourceId?: string | null;
  targetId?: string | null;
  duplicate?: boolean;
  sourceDefinitionId?: string | null;
  targetDefinitionId?: string | null;
  sourcePortId?: string | null;
  targetPortId?: string | null;
  sourceChannel?: unknown;
  targetChannel?: unknown;
};

const validTargets: Record<EtherNodeKind, EtherNodeKind[]> = {
  Prompt: ["Prompt", "Generation", "Edit", "Review", "Store"],
  Reference: ["Prompt", "Generation", "Edit", "Review", "Store"],
  Generation: ["Edit", "Review", "Store"],
  Edit: ["Edit", "Generation", "Review", "Store"],
  Review: ["Review", "Store", "Edit"],
  Store: ["Review", "Store"],
  Note: ["Prompt", "Reference", "Review", "Store"]
};

const defaultLabels: Record<string, string> = {
  "Prompt:Prompt": "prompt",
  "Prompt:Generation": "prompt",
  "Prompt:Edit": "prompt",
  "Prompt:Review": "context",
  "Prompt:Store": "context",
  "Reference:Prompt": "context",
  "Reference:Generation": "context",
  "Reference:Edit": "context",
  "Reference:Review": "context",
  "Reference:Store": "context",
  "Generation:Edit": "variant",
  "Generation:Review": "result",
  "Generation:Store": "result",
  "Edit:Edit": "variant",
  "Edit:Generation": "variant",
  "Edit:Review": "result",
  "Edit:Store": "result",
  "Review:Review": "review",
  "Review:Store": "route",
  "Review:Edit": "needs-edit",
  "Store:Review": "context",
  "Store:Store": "route",
  "Note:Prompt": "context",
  "Note:Reference": "context",
  "Note:Review": "context",
  "Note:Store": "context"
};

function isNodeKind(value: string): value is EtherNodeKind {
  return NODE_CATEGORY_LABELS.includes(value as EtherNodeKind);
}

function resolveNodeKind(value: string): EtherNodeKind | null {
  if (value === "Assistant") {
    return "Prompt";
  }

  if (isNodeKind(value)) {
    return value;
  }

  return NODE_DEFINITIONS.find((definition) => definition.subtype === value)?.category ?? null;
}

function readableDefinitionName(definitionId: string | null | undefined, fallbackKind: string) {
  if (!definitionId) {
    return `${fallbackKind} node`;
  }

  const definition = NODE_DEFINITIONS.find((candidate) => candidate.id === definitionId);

  return definition ? `${definition.category} ${definition.title}` : `${fallbackKind} node`;
}

function portKind(port: ContractPort | undefined) {
  return port?.artifactKind ?? null;
}

function portChannel(port: ContractPort | undefined) {
  return canonicalChannel(portKind(port));
}

function channelContractReason(
  definitionId: string,
  nodeKind: string,
  direction: "produce" | "accept",
  channel: PayloadChannel
) {
  const name = readableDefinitionName(definitionId, nodeKind);
  const verb = direction === "produce" ? "produce" : "accept";

  return `${name} does not ${verb} ${channelLabel(channel)} channel connections.`;
}

function validateSelectedPorts(
  sourceKind: string,
  targetKind: string,
  context: ConnectionRuleContext,
  defaultLabel: string
): ConnectionRuleResult | null {
  if (!context.sourcePortId && !context.targetPortId) {
    return null;
  }

  const sourceContract = getOptionalNodeContract(context.sourceDefinitionId);
  const targetContract = getOptionalNodeContract(context.targetDefinitionId);

  if (!sourceContract || !targetContract) {
    return { allowed: false, reason: "Unknown node contract for selected ports." };
  }

  const sourcePort = sourceContract.outputPorts.find((port) => port.id === context.sourcePortId);
  const targetPort = targetContract.inputPorts.find((port) => port.id === context.targetPortId);

  if (!sourcePort) {
    return { allowed: false, reason: "Unknown output port for this connection." };
  }

  if (!targetPort) {
    return { allowed: false, reason: "Unknown input port for this connection." };
  }

  const sourceChannel = portChannel(sourcePort);
  const targetChannel = portChannel(targetPort);

  if (sourceChannel && !sourceContract.producedChannels.includes(sourceChannel)) {
    return {
      allowed: false,
      reason: channelContractReason(sourceContract.definitionId, sourceKind, "produce", sourceChannel)
    };
  }

  if (targetChannel && !targetContract.acceptedChannels.includes(targetChannel)) {
    return {
      allowed: false,
      reason: channelContractReason(targetContract.definitionId, targetKind, "accept", targetChannel)
    };
  }

  const channelResult = resolveEdgeSemantics(sourceChannel, targetChannel, defaultLabel);

  if (!channelResult.allowed) {
    const sourceName = readableDefinitionName(sourceContract.definitionId, sourceKind);
    const targetName = readableDefinitionName(targetContract.definitionId, targetKind);

    return {
      ...channelResult,
      allowed: false,
      reason: `Cannot connect ${sourcePort.label} output to ${targetPort.label} input. ${targetName} expects ${targetPort.artifactKind}, but ${sourceName} produces ${sourcePort.artifactKind}.`
    };
  }

  return {
    ...channelResult,
    defaultLabel
  };
}

export function canConnectNodeKinds(
  sourceKind: string,
  targetKind: string,
  context: ConnectionRuleContext = {}
): ConnectionRuleResult {
  if (context.sourceId && context.targetId && context.sourceId === context.targetId) {
    return { allowed: false, reason: "A node cannot connect to itself." };
  }

  if (context.duplicate) {
    return { allowed: false, reason: "This connection already exists." };
  }

  const resolvedSourceKind = resolveNodeKind(sourceKind);
  const resolvedTargetKind = resolveNodeKind(targetKind);

  if (!resolvedSourceKind || !resolvedTargetKind) {
    return { allowed: false, reason: "Unknown node type." };
  }

  if (!validTargets[resolvedSourceKind].includes(resolvedTargetKind)) {
    return {
      allowed: false,
      reason: `${sourceKind} nodes cannot connect directly to ${targetKind} nodes.`
    };
  }

  const defaultLabel = defaultLabels[`${resolvedSourceKind}:${resolvedTargetKind}`] ?? "context";
  const portResult = validateSelectedPorts(sourceKind, targetKind, context, defaultLabel);

  if (portResult) {
    return portResult;
  }

  const sourceChannel = canonicalChannel(context.sourceChannel);
  const targetChannel = canonicalChannel(context.targetChannel);
  const hasChannelContext = context.sourceChannel != null || context.targetChannel != null;

  if (hasChannelContext) {
    const sourceContract = getOptionalNodeContract(context.sourceDefinitionId);
    const targetContract = getOptionalNodeContract(context.targetDefinitionId);

    if (sourceContract && sourceChannel && !sourceContract.producedChannels.includes(sourceChannel)) {
      return {
        allowed: false,
        reason: channelContractReason(sourceContract.definitionId, sourceKind, "produce", sourceChannel)
      };
    }

    if (targetContract && targetChannel && !targetContract.acceptedChannels.includes(targetChannel)) {
      return {
        allowed: false,
        reason: channelContractReason(targetContract.definitionId, targetKind, "accept", targetChannel)
      };
    }

    const channelResult = resolveEdgeSemantics(sourceChannel, targetChannel, defaultLabel);

    return {
      ...channelResult,
      defaultLabel
    };
  }

  return {
    allowed: true,
    defaultLabel,
    defaultRole: resolveEdgeSemantics("text", "text", defaultLabel).defaultRole
  };
}

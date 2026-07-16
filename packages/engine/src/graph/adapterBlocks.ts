import { channelLabel, isPayloadChannel, type PayloadChannel } from "./channels.js";
import type { EtherGraph } from "../project/schema.js";

type AdapterEdge = EtherGraph["edges"][number] & {
  source: string;
  target: string;
  data?: Record<string, unknown> | null;
};

type BlockedAdapterEdge = AdapterEdge & {
  data: Record<string, unknown>;
};

const BLOCKED_ADAPTER_STATUSES = new Set(["unavailable", "blocked"]);
const PROMPT_ASSISTANT_SUBTYPES = new Set(["Brainstormer", "Mutator", "Expander", "Reinforcer"]);

export function blockedIncomingAdapterReason(
  graph: EtherGraph,
  targetNodeId: string
): string | undefined {
  const blockedEdges = incomingAdapterBlockedEdges(graph, targetNodeId);

  for (const edge of blockedEdges) {
    const disabledReason = cleanText(edge.data.disabledReason);

    if (disabledReason) {
      return disabledReason;
    }
  }

  for (const edge of blockedEdges) {
    const adapterReason = cleanText(recordFrom(edge.data.adapter).reason);

    if (adapterReason) {
      return adapterReason;
    }
  }

  const edge = blockedEdges[0];

  if (!edge) {
    return undefined;
  }

  return genericAdapterBlockedReason(edge);
}

function incomingAdapterBlockedEdges(graph: EtherGraph, targetNodeId: string): BlockedAdapterEdge[] {
  return edgesOf(graph).filter((edge): edge is BlockedAdapterEdge => {
    if (edge.target !== targetNodeId) {
      return false;
    }

    const data = recordFrom(edge.data);
    const adapter = recordFrom(data.adapter);
    const disabledReason = cleanText(data.disabledReason);
    const status = cleanText(adapter.status);

    if (disabledReason.length === 0 && !BLOCKED_ADAPTER_STATUSES.has(status)) {
      return false;
    }

    return !canTargetConsumeBlockedAdapterNatively(graph, targetNodeId, edge, data, adapter);
  });
}

function canTargetConsumeBlockedAdapterNatively(
  graph: EtherGraph,
  targetNodeId: string,
  edge: AdapterEdge,
  data: Record<string, unknown>,
  adapter: Record<string, unknown>
) {
  const target = nodesOf(graph).find((node) => node.id === targetNodeId);

  if (!isCodexVisionAssistantNode(target)) {
    return false;
  }

  const sourceChannel = channelFrom(data.sourceChannel);
  const targetChannel = channelFrom(data.targetChannel);
  const operation = cleanText(adapter.operation);

  return edge.target === targetNodeId && sourceChannel === "image" && targetChannel === "text" && operation === "caption";
}

function isCodexVisionAssistantNode(node: GraphNode | undefined) {
  const data = recordFrom(node?.data);
  const kind = cleanText(data.kind);
  const subtype = cleanText(data.subtype);

  return kind === "Assistant" || (kind === "Prompt" && PROMPT_ASSISTANT_SUBTYPES.has(subtype));
}

function genericAdapterBlockedReason(edge: BlockedAdapterEdge) {
  const sourceChannel = channelFrom(edge.data.sourceChannel);
  const targetChannel = channelFrom(edge.data.targetChannel);

  if (sourceChannel && targetChannel) {
    return `${channelLabel(sourceChannel)} to ${channelLabel(targetChannel)} connections require an adapter that is not available.`;
  }

  return "This connection requires an adapter that is not available.";
}

function channelFrom(value: unknown): PayloadChannel | undefined {
  return isPayloadChannel(value) ? value : undefined;
}

function edgesOf(graph: EtherGraph): AdapterEdge[] {
  return graph.edges as AdapterEdge[];
}

function nodesOf(graph: EtherGraph): GraphNode[] {
  return graph.nodes as GraphNode[];
}

type GraphNode = EtherGraph["nodes"][number] & {
  id: string;
  data?: Record<string, unknown> | null;
};

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

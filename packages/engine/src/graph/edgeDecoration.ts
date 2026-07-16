import { canConnectNodeKinds } from "./connectionRules.js";
import { getOptionalNodeContract, type ContractPort } from "./contracts.js";
import type { CanvasNodeData } from "./nodeCatalog.js";
import {
  EDGE_GRAPH_VERSION,
  canonicalChannel,
  canonicalRole,
  type CanonicalEdgeData
} from "./edgeSemantics.js";

export type EdgeDecorationNode = {
  id: string;
  data: Pick<CanvasNodeData, "definitionId" | "kind">;
};

export type EdgeDecorationEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: unknown;
  data?: Record<string, unknown> | null;
  type?: string;
  [key: string]: unknown;
};

export function defaultHandlesForConnection(source: EdgeDecorationNode, target: EdgeDecorationNode) {
  const sourceContract = getOptionalNodeContract(source.data.definitionId);
  const targetContract = getOptionalNodeContract(target.data.definitionId);

  if (!sourceContract || !targetContract) {
    return {};
  }

  const exactSourcePort = sourceContract.outputPorts.find((outputPort) =>
    targetContract.inputPorts.some((inputPort) => inputPort.artifactKind === outputPort.artifactKind)
  );
  const exactTargetPort = exactSourcePort
    ? targetContract.inputPorts.find((inputPort) => inputPort.artifactKind === exactSourcePort.artifactKind)
    : undefined;
  const sourcePort = exactSourcePort ?? sourceContract.outputPorts.find((outputPort) =>
    targetContract.inputPorts.some(
      (inputPort) => canonicalChannel(inputPort.artifactKind) === canonicalChannel(outputPort.artifactKind)
    )
  );
  const targetPort = exactTargetPort ?? (sourcePort
    ? targetContract.inputPorts.find(
        (inputPort) => canonicalChannel(inputPort.artifactKind) === canonicalChannel(sourcePort.artifactKind)
      )
    : undefined);

  return {
    sourceHandle: sourcePort?.id,
    targetHandle: targetPort?.id
  };
}

function portForHandle(ports: ContractPort[] | undefined, handle: string | null | undefined) {
  return ports?.find((port) => port.id === handle);
}

function stripCanonicalEdgeData(edgeData: Record<string, unknown>) {
  const {
    graphVersion: _graphVersion,
    sourceChannel: _sourceChannel,
    targetChannel: _targetChannel,
    role: _role,
    adapter: _adapter,
    disabledReason: _disabledReason,
    ...legacyEdgeData
  } = edgeData;

  return legacyEdgeData;
}

export function decorateEdgeForNodes(
  edge: EdgeDecorationEdge,
  graphNodes: EdgeDecorationNode[]
): EdgeDecorationEdge | null {
  const source = graphNodes.find((node) => node.id === edge.source);
  const target = graphNodes.find((node) => node.id === edge.target);

  if (!source || !target) {
    return null;
  }

  const sourceContract = getOptionalNodeContract(source.data.definitionId);
  const targetContract = getOptionalNodeContract(target.data.definitionId);
  const handles = defaultHandlesForConnection(source, target);
  const sourceHandle = edge.sourceHandle ?? handles.sourceHandle;
  const targetHandle = edge.targetHandle ?? handles.targetHandle;

  if (sourceContract && targetContract && (!sourceHandle || !targetHandle)) {
    return null;
  }

  const edgeData = edge.data && typeof edge.data === "object" ? edge.data : {};
  const sourcePort = portForHandle(sourceContract?.outputPorts, sourceHandle);
  const targetPort = portForHandle(targetContract?.inputPorts, targetHandle);
  const sourceHandleChannel = canonicalChannel(sourceHandle);
  const targetHandleChannel = canonicalChannel(targetHandle);

  if (sourceContract && sourceHandle && !sourcePort && !sourceHandleChannel) {
    return null;
  }

  if (targetContract && targetHandle && !targetPort && !targetHandleChannel) {
    return null;
  }

  const sourceChannel =
    canonicalChannel(edgeData.sourceChannel) ?? sourceHandleChannel ?? canonicalChannel(sourcePort?.artifactKind);
  const targetChannel =
    canonicalChannel(edgeData.targetChannel) ?? targetHandleChannel ?? canonicalChannel(targetPort?.artifactKind);
  const selectedPortPair = Boolean(sourcePort && targetPort);

  const result = canConnectNodeKinds(source.data.kind, target.data.kind, {
    sourceId: source.id,
    targetId: target.id,
    sourceDefinitionId: source.data.definitionId,
    targetDefinitionId: target.data.definitionId,
    sourcePortId: selectedPortPair ? sourceHandle : undefined,
    targetPortId: selectedPortPair ? targetHandle : undefined,
    sourceChannel,
    targetChannel
  });

  if (!result.allowed) {
    return null;
  }

  const label = String(edge.label ?? edgeData.label ?? result.defaultLabel ?? "context");
  const role = canonicalRole(edgeData.role ?? result.defaultRole ?? label);

  if (!result.sourceChannel || !result.targetChannel) {
    return null;
  }

  const canonicalData: CanonicalEdgeData = {
    graphVersion: EDGE_GRAPH_VERSION,
    sourceChannel: result.sourceChannel,
    targetChannel: result.targetChannel,
    role
  };

  if (result.adapter) {
    canonicalData.adapter = result.adapter;
  }

  if (result.disabledReason) {
    canonicalData.disabledReason = result.disabledReason;
  }

  return {
    ...edge,
    sourceHandle,
    targetHandle,
    label,
    data: { ...stripCanonicalEdgeData(edgeData), label, ...canonicalData },
    type: "etherEdge"
  };
}

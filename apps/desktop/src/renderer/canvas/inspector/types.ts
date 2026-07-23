import type { DocumentDescriptor } from "../../../shared/ipc/contracts";
import type { EtherEdge, EtherGraph, EtherNode, GraphOperation } from "@ether/schema";

export type InspectorApply = (operations: GraphOperation[], title: string) => Promise<boolean>;

export type InspectorContext = {
  graph: EtherGraph;
  document: DocumentDescriptor;
  nodeId: string | null;
  edgeId: string | null;
  apply: InspectorApply;
  refreshGraph(): Promise<EtherGraph | null>;
  report(message: string): void;
};

export type InspectorNodeContext = InspectorContext & { node: EtherNode };
export type InspectorEdgeContext = InspectorContext & { edge: EtherEdge };

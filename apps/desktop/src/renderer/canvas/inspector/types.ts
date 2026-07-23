import type { DocumentDescriptor } from "../../../shared/ipc/contracts";
import type { Artifact, EtherEdge, EtherGraph, EtherNode, GraphOperation } from "@ether/schema";
import type { ImageEditCommit } from "../edit/EditWorkspace";

export type InspectorApply = (operations: GraphOperation[], title: string) => Promise<boolean>;

export type InspectorContext = {
  graph: EtherGraph;
  document: DocumentDescriptor;
  nodeId: string | null;
  edgeId: string | null;
  apply: InspectorApply;
  refreshGraph(): Promise<EtherGraph | null>;
  report(message: string): void;
  commitImageEdit?(payload: ImageEditCommit): Promise<Artifact>;
};

export type InspectorNodeContext = InspectorContext & { node: EtherNode };
export type InspectorEdgeContext = InspectorContext & { edge: EtherEdge };

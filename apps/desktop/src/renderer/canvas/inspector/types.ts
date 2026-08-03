import type { DocumentDescriptor } from "../../../shared/ipc/contracts";
import type { Artifact, EtherEdge, EtherGraph, EtherModule, EtherNode, GraphOperation } from "@ether/schema";
import type { ImageEditCommit } from "../edit/EditWorkspace";

export type InspectorApply = (operations: GraphOperation[], title: string) => Promise<boolean>;

export type InspectorContext = {
  graph: EtherGraph;
  document: DocumentDescriptor;
  nodeId: string | null;
  edgeId: string | null;
  moduleId: string | null;
  selectedNodeIds: readonly string[];
  apply: InspectorApply;
  refreshGraph(): Promise<EtherGraph | null>;
  report(message: string): void;
  enterModule?(moduleId: string): void;
  dissolveModule?(moduleId: string): Promise<boolean>;
  addSelectedToModule?(moduleId: string, nodeIds: readonly string[]): Promise<boolean>;
  commitImageEdit?(payload: ImageEditCommit): Promise<Artifact>;
};

export type InspectorNodeContext = InspectorContext & { node: EtherNode };
export type InspectorEdgeContext = InspectorContext & { edge: EtherEdge };
export type InspectorModuleContext = InspectorContext & { module: EtherModule };

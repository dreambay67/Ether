import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import {
  type Edge,
  type Node,
  type OnSelectionChangeParams
} from "@xyflow/react";
import type { CanvasNodeData } from "@ether/engine/graph/nodeCatalog";
import type { CanvasHistory } from "../canvasHistory";

type UseCanvasSelectionArgs = {
  nodes: Node<CanvasNodeData>[];
  edges: Edge[];
  setHistory: Dispatch<SetStateAction<CanvasHistory>>;
};

export function useCanvasSelection({ nodes, edges, setHistory }: UseCanvasSelectionArgs) {
  const selectedNode = useMemo(() => nodes.find((node) => node.selected) ?? null, [nodes]);
  const selectedNodeIds = useMemo(
    () => nodes.filter((node) => node.selected).map((node) => node.id),
    [nodes]
  );
  const selectedEdge = useMemo(() => edges.find((edge) => edge.selected) ?? null, [edges]);
  const selectedArtifact = useMemo(() => {
    if (!selectedNode) {
      return null;
    }

    return selectedNode.data.assetId || selectedNode.data.assetPath
      ? {
          assetId: selectedNode.data.assetId,
          assetKind: selectedNode.data.assetKind,
          assetPath: selectedNode.data.assetPath,
          assetMetadata: selectedNode.data.assetMetadata
        }
      : null;
  }, [selectedNode]);

  const replaceSelection = useCallback(
    (selection: OnSelectionChangeParams<Node<CanvasNodeData>, Edge>) => {
      setHistory((current) => ({
        ...current,
        present: {
          nodes: current.present.nodes.map((node) => ({
            ...node,
            selected: selection.nodes.some((selected) => selected.id === node.id)
          })),
          edges: current.present.edges.map((edge) => ({
            ...edge,
            selected: selection.edges.some((selected) => selected.id === edge.id)
          }))
        }
      }));
    },
    [setHistory]
  );

  return {
    selectedNode,
    selectedNodeIds,
    selectedEdge,
    selectedArtifact,
    replaceSelection
  };
}

import { memo } from "react";
import { Handle, NodeResizer, Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import type { CanvasNodeData } from "@ether/engine";

export const EtherNode = memo(function EtherNode({
  id,
  data,
  selected
}: NodeProps & { data: CanvasNodeData }) {
  const flow = useReactFlow();

  return (
    <article className={`ether-node ether-node-${data.kind.toLowerCase()}`} data-testid="ether-node">
      <NodeResizer
        color="#37E6EA"
        isVisible={selected}
        minWidth={180}
        minHeight={118}
        handleClassName="node-resize-handle"
        lineClassName="node-resize-line"
      />
      <Handle type="target" position={Position.Left} />
      <div className="ether-node-topline">
        <span>{data.kind}</span>
        <span>{data.subtype}</span>
      </div>
      <div className="ether-node-main">
        <h3>{data.title}</h3>
        <p>{data.label}</p>
      </div>
      <div className="ether-node-footer">
        <span>{data.status}</span>
        <button
          type="button"
          aria-label={`Delete ${data.title}`}
          onClick={() => void flow.deleteElements({ nodes: [{ id }] })}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
      <Handle type="source" position={Position.Right} />
    </article>
  );
});

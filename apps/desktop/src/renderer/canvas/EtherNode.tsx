import { createContext, memo, useContext, useState, type DragEvent } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { Maximize2, Trash2, X } from "lucide-react";
import type { CanvasNodeData } from "@ether/engine";

export const EtherNodeDeleteContext = createContext<(id: string) => void>(() => undefined);

export const EtherNode = memo(function EtherNode({
  id,
  data,
  selected
}: NodeProps & { data: CanvasNodeData }) {
  const deleteNode = useContext(EtherNodeDeleteContext);
  const [isInspectingImage, setIsInspectingImage] = useState(false);
  const isLocked = data.locked === true;
  const previewAssetPath = data.assetPath ?? data.sourceAssetPath;
  const previewAssetId = data.assetPath ? data.assetId : data.sourceAssetId;
  const previewAssetKind = data.assetPath ? data.assetKind : data.sourceAssetKind;
  const previewAssetMetadata = data.assetPath ? data.assetMetadata : data.sourceAssetMetadata;
  const imageSrc = previewAssetPath ? localImageSource(previewAssetPath) : null;
  const maskSrc = data.maskAssetPath ? localImageSource(data.maskAssetPath) : null;

  const startImageDrag = (event: DragEvent<HTMLDivElement>) => {
    if (!previewAssetPath) {
      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      "application/ether-image-asset",
      JSON.stringify({
        nodeId: id,
        assetId: previewAssetId,
        assetKind: previewAssetKind,
        assetPath: previewAssetPath,
        assetMetadata: previewAssetMetadata ?? {},
        title: data.title
      })
    );
  };

  return (
    <article
      className={`ether-node ether-node-${data.kind.toLowerCase()}${isLocked ? " is-locked" : ""}`}
      data-testid="ether-node"
    >
      <NodeResizer
        color="#37E6EA"
        isVisible={selected && !isLocked}
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
      {imageSrc ? (
        <div
          className="ether-node-image-frame"
          data-testid="node-image-preview"
          draggable
          onDragStart={startImageDrag}
        >
          <img src={imageSrc} alt={`${data.title} asset preview`} draggable={false} />
          {maskSrc ? (
            <img
              className="ether-node-mask-overlay"
              data-testid="node-mask-overlay"
              src={maskSrc}
              alt=""
              draggable={false}
            />
          ) : null}
          <button
            type="button"
            aria-label="Inspect image asset"
            className="ether-node-inspect-button"
            onClick={(event) => {
              event.stopPropagation();
              setIsInspectingImage(true);
            }}
          >
            <Maximize2 size={13} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div className="ether-node-footer">
        <span>{isLocked ? "locked" : data.rerunState ?? data.status}</span>
        <button
          type="button"
          aria-label={`Delete ${data.title}`}
          onClick={() => deleteNode(id)}
          disabled={isLocked}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
      {isInspectingImage && imageSrc ? (
        <div className="ether-node-image-inspector" data-testid="node-image-inspector">
          <button
            type="button"
            aria-label="Close image inspector"
            onClick={(event) => {
              event.stopPropagation();
              setIsInspectingImage(false);
            }}
          >
            <X size={14} aria-hidden="true" />
          </button>
          <img src={imageSrc} alt={`${data.title} inspected asset`} draggable={false} />
          {maskSrc ? <img className="ether-node-mask-overlay" src={maskSrc} alt="" draggable={false} /> : null}
          <pre>{previewAssetPath}</pre>
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </article>
  );
});

function localImageSource(filePath: string) {
  if (/^(file|https?|data):/i.test(filePath)) {
    return filePath;
  }

  const normalizedPath = filePath.replace(/\\/g, "/");
  const url = normalizedPath.startsWith("/")
    ? `file://${normalizedPath}`
    : `file:///${normalizedPath}`;

  return encodeURI(url);
}

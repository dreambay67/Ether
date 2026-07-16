import { createContext, memo, useContext, useState, type DragEvent } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { Database, FileText, ImageIcon, ImagePlus, Layers, Maximize2, Music, RefreshCw, Trash2, Video, X } from "lucide-react";
import { referenceAssetsFromNodeData, type CanvasNodeData } from "@ether/engine/graph/nodeCatalog";
import type { PayloadChannel } from "./ports/channelRegistry";
import { ChannelRail } from "./ports/ChannelRail";
import { NoteNodeVisual } from "./nodes/NoteNodeVisual";

export const EtherNodeDeleteContext = createContext<(id: string) => void>(() => undefined);
export const EtherNodeReferenceUploadContext = createContext<{
  add(id: string): void;
  replace(id: string): void;
}>({
  add: () => undefined,
  replace: () => undefined
});
export const EtherNodeDataUpdateContext = createContext<
  (id: string, updates: Partial<CanvasNodeData>, traceMessage?: string) => void
>(() => undefined);
export type EtherNodeChannelActivity = {
  input: PayloadChannel[];
  output: PayloadChannel[];
};
export const EtherNodeChannelActivityContext = createContext<Record<string, EtherNodeChannelActivity>>({});
export type EtherNodeRunVisualStatus = "running" | "done" | "error";
export const EtherNodeRunStatusContext = createContext<Record<string, EtherNodeRunVisualStatus>>({});

type PreviewAsset = {
  assetId?: string;
  assetKind?: string;
  assetPath: string;
  assetMetadata?: Record<string, unknown>;
  title?: string;
};

type ReferencePreviewChannel = Extract<PayloadChannel, "text" | "image" | "mask" | "data" | "video" | "audio">;

const channelIcon = {
  text: FileText,
  image: ImageIcon,
  mask: Layers,
  data: Database,
  video: Video,
  audio: Music
} satisfies Record<ReferencePreviewChannel, typeof FileText>;

export const EtherNode = memo(function EtherNode({
  id,
  data,
  selected
}: NodeProps & { data: CanvasNodeData }) {
  const deleteNode = useContext(EtherNodeDeleteContext);
  const referenceUpload = useContext(EtherNodeReferenceUploadContext);
  const updateNodeData = useContext(EtherNodeDataUpdateContext);
  const channelActivity = useContext(EtherNodeChannelActivityContext)[id] ?? { input: [], output: [] };
  const runVisualStatus = useContext(EtherNodeRunStatusContext)[id];
  const [isInspectingImage, setIsInspectingImage] = useState(false);
  const isLocked = data.locked === true;
  const previewAssetPath = data.assetPath ?? data.sourceAssetPath;
  const previewAssetId = data.assetPath ? data.assetId : data.sourceAssetId;
  const previewAssetKind = data.assetPath ? data.assetKind : data.sourceAssetKind;
  const previewAssetMetadata = data.assetPath ? data.assetMetadata : data.sourceAssetMetadata;
  const maskSrc = data.maskAssetPath ? localImageSource(data.maskAssetPath) : null;
  const referenceAssets = data.kind === "Reference" ? referenceAssetsFromNodeData(data) : [];
  const previewAssets: PreviewAsset[] =
    referenceAssets.length > 0
      ? referenceAssets.map((asset) => ({
          assetId: asset.assetId,
          assetKind: asset.assetKind,
          assetPath: asset.assetPath,
          assetMetadata: asset.assetMetadata,
          title: asset.title
        }))
      : previewAssetPath
        ? [
            {
              assetId: previewAssetId,
              assetKind: previewAssetKind,
              assetPath: previewAssetPath,
              assetMetadata: previewAssetMetadata,
              title: data.title
            }
          ]
        : [];
  const inspectAsset = previewAssets.at(-1);
  const inspectImageSrc = inspectAsset ? localImageSource(inspectAsset.assetPath) : null;
  const bodyText =
    data.kind === "Prompt"
      ? data.instruction || data.assembledPrompt || data.textOutput || ""
      : data.textOutput || data.instruction || "";
  const noteText =
    data.notes && data.notes !== data.assetPath && data.notes !== data.sourceAssetPath && data.notes !== data.maskAssetPath
      ? data.notes
      : "";
  const referencePreviewMode = data.kind === "Reference" && previewAssets.length > 0
    ? previewAssets.every((asset) => inferReferenceChannel(asset, data) === "image")
      ? "image-grid"
      : "channel-cards"
    : "empty";

  const startImageDrag = (event: DragEvent<HTMLDivElement>, asset: PreviewAsset) => {
    if (!asset.assetPath) {
      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      "application/ether-image-asset",
      JSON.stringify({
        nodeId: id,
        assetId: asset.assetId,
        assetKind: asset.assetKind,
        assetPath: asset.assetPath,
        assetMetadata: asset.assetMetadata ?? {},
        title: asset.title ?? data.title
      })
    );
  };

  return (
    <article
      className={`ether-node ether-node-${data.kind.toLowerCase()}${nodeSubtypeClass(data)}${isLocked ? " is-locked" : ""}${selected ? " is-selected" : ""}`}
      data-testid="ether-node"
    >
      <NodeResizer
        color="#37E6EA"
        isVisible={selected && !isLocked}
        minWidth={180}
        minHeight={180}
        handleClassName="node-resize-handle"
        lineClassName="node-resize-line"
      />
      {runVisualStatus ? (
        <div
          className={`ether-node-run-status ether-node-run-status-${runVisualStatus}`}
          data-testid="node-run-status"
          aria-live="polite"
        >
          {runVisualStatus}
        </div>
      ) : null}
      <ChannelRail direction="input" nodeTitle={data.title} connectedChannels={channelActivity.input} />
      <div className="ether-node-topline">
        <span>{data.kind}</span>
        <span>{data.subtype}</span>
      </div>
      {data.kind === "Note" ? (
        <NoteNodeVisual nodeId={id} data={data} isLocked={isLocked} onUpdateData={updateNodeData} />
      ) : (
        <>
          <div className="ether-node-main">
            <h3>{data.title}</h3>
            {bodyText ? <p className="ether-node-body">{bodyText}</p> : null}
          </div>
          {noteText ? <div className="ether-node-note">{noteText}</div> : null}
        </>
      )}
      {data.kind === "Reference" ? (
        <div className="ether-node-reference-preview" data-testid="node-reference-preview">
          {referencePreviewMode === "image-grid" ? (
            <div
              className={`ether-node-reference-grid count-${Math.min(previewAssets.length, 6)}`}
              data-testid="node-reference-grid"
            >
              {previewAssets.slice(0, 6).map((asset, index) => (
                <div
                  key={`${asset.assetPath}-${index}`}
                  className="ether-node-reference-thumb"
                  data-testid="node-reference-image"
                  draggable
                  onDragStart={(event) => startImageDrag(event, asset)}
                  title={asset.title ?? asset.assetPath}
                >
                  <img src={localImageSource(asset.assetPath)} alt={asset.title ?? `${data.title} reference ${index + 1}`} draggable={false} />
                </div>
              ))}
              {previewAssets.length > 6 ? (
                <span className="ether-node-reference-more">+{previewAssets.length - 6}</span>
              ) : null}
            </div>
          ) : referencePreviewMode === "channel-cards" ? (
            <div className="ether-node-reference-channel-grid" data-testid="node-reference-channel-grid">
              {previewAssets.slice(0, 6).map((asset, index) => (
                <ReferencePreviewCard
                  key={`${asset.assetPath}-${index}`}
                  asset={asset}
                  channel={inferReferenceChannel(asset, data)}
                  title={asset.title ?? data.title}
                  onDragStart={(event) => startImageDrag(event, asset)}
                />
              ))}
              {previewAssets.length > 6 ? (
                <span className="ether-node-reference-more">+{previewAssets.length - 6}</span>
              ) : null}
            </div>
          ) : (
            <div className="ether-node-reference-empty">
              <span>No linked assets</span>
            </div>
          )}
          <div className="ether-node-reference-actions">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                referenceUpload.add(id);
              }}
              disabled={isLocked}
              title="Add another image into this Reference node"
              aria-label={`Add image to ${data.title}`}
              data-testid="node-reference-add"
            >
              <ImagePlus size={13} aria-hidden="true" />
              Add
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                referenceUpload.replace(id);
              }}
              disabled={isLocked}
              title="Replace this Reference node's image bundle"
              aria-label={`Replace image in ${data.title}`}
              data-testid="node-reference-replace"
            >
              <RefreshCw size={13} aria-hidden="true" />
              Replace
            </button>
          </div>
        </div>
      ) : previewAssetPath ? (
        <div
          className="ether-node-image-frame"
          data-testid="node-image-preview"
          draggable
          onDragStart={(event) =>
            startImageDrag(event, {
              assetId: previewAssetId,
              assetKind: previewAssetKind,
              assetPath: previewAssetPath,
              assetMetadata: previewAssetMetadata,
              title: data.title
            })
          }
        >
          <img src={localImageSource(previewAssetPath)} alt={`${data.title} asset preview`} draggable={false} />
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
      {isInspectingImage && inspectImageSrc && inspectAsset ? (
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
          <img src={inspectImageSrc} alt={`${data.title} inspected asset`} draggable={false} />
          {maskSrc ? <img className="ether-node-mask-overlay" src={maskSrc} alt="" draggable={false} /> : null}
          <pre>{inspectAsset.assetPath}</pre>
        </div>
      ) : null}
      <ChannelRail direction="output" nodeTitle={data.title} connectedChannels={channelActivity.output} />
    </article>
  );
});

function ReferencePreviewCard({
  asset,
  channel,
  title,
  onDragStart
}: {
  asset: PreviewAsset;
  channel: ReferencePreviewChannel;
  title: string;
  onDragStart(event: DragEvent<HTMLDivElement>): void;
}) {
  const Icon = channelIcon[channel];
  const fileName = title || getBasename(asset.assetPath);
  const summary = compactPath(asset.assetPath);

  if (channel === "image") {
    return (
      <div
        className="ether-node-reference-thumb ether-node-reference-card-image"
        data-testid="node-reference-image"
        draggable
        onDragStart={onDragStart}
        title={asset.assetPath}
      >
        <img src={localImageSource(asset.assetPath)} alt={fileName} draggable={false} />
      </div>
    );
  }

  return (
    <div
      className={`ether-node-reference-card ether-node-reference-card-${channel}`}
      data-channel={channel}
      data-testid={`node-reference-${channel}`}
      title={asset.assetPath}
    >
      <span className="reference-channel-marker" aria-hidden="true" />
      <Icon size={18} aria-hidden="true" />
      <div>
        <strong>{channelLabel(channel)}</strong>
        <em>{fileName}</em>
        <small>{summary}</small>
      </div>
    </div>
  );
}

function inferReferenceChannel(asset: PreviewAsset, data: CanvasNodeData): ReferencePreviewChannel {
  const metadata = asset.assetMetadata ?? {};
  const metadataChannel = stringMetadata(metadata, "channel") ?? stringMetadata(metadata, "payloadChannel");
  const metadataKind = stringMetadata(metadata, "kind") ?? stringMetadata(metadata, "type");
  const mimeType = stringMetadata(metadata, "mimeType") ?? stringMetadata(metadata, "contentType");
  const extension = extensionForPath(asset.assetPath);
  const subtype = data.subtype.toLowerCase();
  const candidates = [
    metadataChannel,
    metadataKind,
    mimeType,
    asset.assetKind,
    subtype,
    extension
  ].filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase());

  if (candidates.some((value) => value.includes("mask")) || asset.assetKind === "mask") {
    return "mask";
  }

  if (candidates.some((value) => value.includes("video") || ["mp4", "mov", "webm", "mkv"].includes(value))) {
    return "video";
  }

  if (candidates.some((value) => value.includes("audio") || ["mp3", "wav", "aiff", "flac", "m4a", "ogg"].includes(value))) {
    return "audio";
  }

  if (candidates.some((value) => value.includes("data") || value.includes("json") || value.includes("csv") || ["tsv", "parquet"].includes(value))) {
    return "data";
  }

  if (candidates.some((value) => value.includes("text") || ["txt", "md", "rtf"].includes(value))) {
    return "text";
  }

  if (
    asset.assetPath.startsWith("data:image/") ||
    candidates.some((value) => value.includes("image") || ["avif", "bmp", "gif", "jpg", "jpeg", "png", "svg", "tif", "tiff", "webp"].includes(value))
  ) {
    return "image";
  }

  return "text";
}

function stringMetadata(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extensionForPath(filePath: string) {
  const match = filePath.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  return match?.[1];
}

function getBasename(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

function compactPath(filePath: string) {
  if (filePath.startsWith("data:")) {
    return "embedded asset";
  }

  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `${parts.at(-2)} / ${parts.at(-1)}` : filePath;
}

function channelLabel(channel: ReferencePreviewChannel) {
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function nodeSubtypeClass(data: CanvasNodeData) {
  if (data.kind !== "Note") {
    return "";
  }

  const subtype = data.subtype
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return subtype ? ` ether-node-note-${subtype}` : "";
}

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

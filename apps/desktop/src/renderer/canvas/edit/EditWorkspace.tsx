import { Paintbrush } from "lucide-react";
import type { EditFrameData, EditFrameMode } from "@ether/engine/graph/nodeCatalog";
import { localImageSource } from "../../artifacts/localImageSource";
import type { InspectorNodeContext, MaskWorkspaceSavePayload } from "../inspector/types";
import { MaskCanvas, type MaskSaveResult } from "./MaskCanvas";

type EditWorkspaceProps = {
  context: InspectorNodeContext;
  onCreateMaskAsset(id: string, payload?: MaskWorkspaceSavePayload): void;
};

type EditRecipeOption = {
  id: string;
  label: string;
};

const EDIT_RECIPES: EditRecipeOption[] = [
  { id: "freeform", label: "Freeform edit" },
  { id: "product-cleanup", label: "Product clean-up" },
  { id: "object-removal", label: "Object removal" },
  { id: "outpaint-scene", label: "Outpaint scene" }
];

const DEFAULT_CANVAS_WIDTH = 1024;
const DEFAULT_CANVAS_HEIGHT = 768;

export function EditWorkspace({ context, onCreateMaskAsset }: EditWorkspaceProps) {
  const { selectedNode, nodeData, nodeDraft, isLocked, hasOpenProject, updateNodeDraft, commitNodeDraft } = context;
  const sourceAssetPath = stringValue(nodeDraft.sourceAssetPath) || nodeData.sourceAssetPath || nodeData.assetPath || "";
  const sourceAssetId = stringValue(nodeDraft.sourceAssetId) || nodeData.sourceAssetId || nodeData.assetId;
  const sourceAssetKind = stringValue(nodeDraft.sourceAssetKind) || nodeData.sourceAssetKind || nodeData.assetKind;
  const sourceAssetMetadata = recordValue(nodeDraft.sourceAssetMetadata) ?? nodeData.sourceAssetMetadata ?? nodeData.assetMetadata;
  const afterAssetPath = stringValue(nodeDraft.assetPath) || nodeData.assetPath || "";
  const recipeId = stringValue(nodeDraft.editRecipe) || nodeData.editRecipe || defaultRecipeForSubtype(nodeData.subtype);
  const recipe = EDIT_RECIPES.find((option) => option.id === recipeId) ?? EDIT_RECIPES[0]!;
  const frame = normalizeFrame(recordValue(nodeDraft.editFrame) ?? nodeData.editFrame, nodeData.subtype);
  const disabled = isLocked || !hasOpenProject;

  const updateRecipe = (nextRecipeId: string) => {
    updateNodeDraft({ editRecipe: nextRecipeId });
  };

  const updateFrame = (updates: Partial<EditFrameData>) => {
    updateNodeDraft({ editFrame: normalizeFrame({ ...frame, ...updates }, nodeData.subtype) });
  };

  const saveMask = (mask: MaskSaveResult) => {
    const frameWithCanvas = {
      ...frame,
      canvasWidth: frame.canvasWidth ?? DEFAULT_CANVAS_WIDTH,
      canvasHeight: frame.canvasHeight ?? DEFAULT_CANVAS_HEIGHT
    };
    const source = {
      assetId: sourceAssetId,
      assetKind: sourceAssetKind,
      assetPath: sourceAssetPath,
      artifactId: stringValue(sourceAssetMetadata?.artifactId),
      metadata: sourceAssetMetadata ?? {}
    };
    const payload: MaskWorkspaceSavePayload = {
      content: mask.content,
      mimeType: mask.mimeType,
      fileName: `mask-${selectedNode.id}.svg`,
      recipe,
      frame: frameWithCanvas,
      metadata: {
        ...mask.metadata,
        recipe,
        frame: frameWithCanvas,
        source,
        sourceAssetKind,
        sourceAssetMetadata: sourceAssetMetadata ?? {}
      }
    };

    onCreateMaskAsset(selectedNode.id, payload);
  };

  if (!sourceAssetPath) {
    return (
      <section className="edit-workspace inspector-preview" data-testid="edit-workspace">
        <div>
          <span>Mask Workspace</span>
          <button type="button" className="run-node-button" disabled>
            <Paintbrush size={14} aria-hidden="true" />
            Create mask overlay
          </button>
        </div>
        <p>Add a source image to paint a mask.</p>
      </section>
    );
  }

  return (
    <section className="edit-workspace" data-testid="edit-workspace">
      <div className="edit-preview-grid">
        <figure className="edit-preview-tile" data-testid="edit-before-preview">
          <figcaption>Before</figcaption>
          <img src={localImageSource(sourceAssetPath)} alt={`${nodeData.title} before`} draggable={false} />
        </figure>
        <figure className="edit-preview-tile" data-testid="edit-after-preview">
          <figcaption>After</figcaption>
          {afterAssetPath ? (
            <img src={localImageSource(afterAssetPath)} alt={`${nodeData.title} after`} draggable={false} />
          ) : (
            <span>No output yet</span>
          )}
        </figure>
      </div>

      <div className="edit-controls-grid">
        <label>
          Edit recipe
          <select
            aria-label="Edit recipe"
            value={recipe.id}
            onChange={(event) => updateRecipe(event.target.value)}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          >
            {EDIT_RECIPES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Frame mode
          <select
            aria-label="Frame mode"
            value={frame.mode}
            onChange={(event) => updateFrame({ mode: event.target.value as EditFrameMode })}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          >
            <option value="source">Source bounds</option>
            <option value="crop">Crop</option>
            <option value="outpaint">Outpaint</option>
          </select>
        </label>
        <label>
          Frame X
          <input
            aria-label="Frame X"
            type="number"
            value={frame.x}
            onChange={(event) => updateFrame({ x: numberFromInput(event.target.value, frame.x) })}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          />
        </label>
        <label>
          Frame Y
          <input
            aria-label="Frame Y"
            type="number"
            value={frame.y}
            onChange={(event) => updateFrame({ y: numberFromInput(event.target.value, frame.y) })}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          />
        </label>
        <label>
          Frame width
          <input
            aria-label="Frame width"
            type="number"
            min={1}
            value={frame.width}
            onChange={(event) => updateFrame({ width: positiveNumberFromInput(event.target.value, frame.width) })}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          />
        </label>
        <label>
          Frame height
          <input
            aria-label="Frame height"
            type="number"
            min={1}
            value={frame.height}
            onChange={(event) => updateFrame({ height: positiveNumberFromInput(event.target.value, frame.height) })}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          />
        </label>
      </div>

      <MaskCanvas
        sourceImagePath={sourceAssetPath}
        sourceLabel={nodeData.title}
        disabled={disabled}
        onSave={saveMask}
      />

      <div className="edit-mask-status" data-testid="inspector-mask-metadata">
        <span>Mask Artifact</span>
        {nodeData.maskAssetId ? <strong>{nodeData.maskAssetId}</strong> : <strong>Unsaved</strong>}
        {nodeData.maskAssetPath ? <pre>{nodeData.maskAssetPath}</pre> : <p>No mask saved.</p>}
      </div>
    </section>
  );
}

function normalizeFrame(value: unknown, subtype: string): EditFrameData {
  const frame = recordValue(value);
  const defaultMode: EditFrameMode = subtype === "Expand / Outpaint" ? "outpaint" : "source";
  const mode = isFrameMode(frame?.mode) ? frame.mode : defaultMode;

  return {
    mode,
    x: numberValue(frame?.x, 0),
    y: numberValue(frame?.y, 0),
    width: Math.max(1, numberValue(frame?.width, DEFAULT_CANVAS_WIDTH)),
    height: Math.max(1, numberValue(frame?.height, DEFAULT_CANVAS_HEIGHT)),
    canvasWidth: Math.max(1, numberValue(frame?.canvasWidth, DEFAULT_CANVAS_WIDTH)),
    canvasHeight: Math.max(1, numberValue(frame?.canvasHeight, DEFAULT_CANVAS_HEIGHT))
  };
}

function defaultRecipeForSubtype(subtype: string) {
  return subtype === "Expand / Outpaint" ? "outpaint-scene" : "freeform";
}

function isFrameMode(value: unknown): value is EditFrameMode {
  return value === "source" || value === "crop" || value === "outpaint";
}

function numberFromInput(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumberFromInput(value: string, fallback: number) {
  return Math.max(1, numberFromInput(value, fallback));
}

function numberValue(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

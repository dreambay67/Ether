import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Crop, Expand, ImageOff, Paintbrush, Save } from "lucide-react";
import type { EditFrame as SchemaEditFrame, EditImageConfig, EditWorkspaceState } from "@ether/schema";
import { MaskCanvas, type MaskCommitResult, type MaskGeometry } from "./MaskCanvas";

export type EditFrameMode = "source" | "crop" | "outpaint";

export type EditFrame = SchemaEditFrame;

export type ImageEditSource = {
  artifactId: string;
  previewUrl: string;
  label: string;
  width: number;
  height: number;
};

export type ImageEditCapability = {
  providerId: string;
  profileId: string;
  mode: "native-inpainting" | "guidance-only" | "unsupported";
  detail?: string;
};

export type ImageEditCommit = {
  config: EditImageConfig;
  source: ImageEditSource;
  recipeId: EditRecipeId;
  frame: EditFrame;
  mask: MaskCommitResult;
};

export type EditWorkspaceProps = {
  config: EditImageConfig;
  source?: ImageEditSource;
  outputPreviewUrl?: string;
  capability: ImageEditCapability;
  initialFrame?: EditFrame;
  initialMask?: MaskGeometry;
  initialRecipeId?: EditRecipeId;
  disabled?: boolean;
  onFrameChange?(frame: EditFrame): void;
  onWorkspaceChange?(workspace: EditWorkspaceState): void;
  onCommit(payload: ImageEditCommit): void;
};

export type EditRecipeId = "freeform" | "product-cleanup" | "object-removal" | "outpaint-scene";
type FrameInteraction = {
  pointerId: number;
  kind: "move" | "resize";
  startX: number;
  startY: number;
  startFrame: EditFrame;
  unitsPerPixelX: number;
  unitsPerPixelY: number;
};

const EDIT_RECIPES: ReadonlyArray<{ id: EditRecipeId; label: string }> = [
  { id: "freeform", label: "Freeform edit" },
  { id: "product-cleanup", label: "Product clean-up" },
  { id: "object-removal", label: "Object removal" },
  { id: "outpaint-scene", label: "Outpaint scene" }
];

export function EditWorkspace({
  config,
  source,
  outputPreviewUrl,
  capability,
  initialFrame,
  initialMask,
  initialRecipeId = "freeform",
  disabled = false,
  onFrameChange,
  onWorkspaceChange,
  onCommit
}: EditWorkspaceProps) {
  const sourceWidth = source?.width ?? 1;
  const sourceHeight = source?.height ?? 1;
  const [recipeId, setRecipeId] = useState<EditRecipeId>(initialRecipeId);
  const [frame, setFrame] = useState(() => normalizeFrame(initialFrame, sourceWidth, sourceHeight));
  const [mask, setMask] = useState<MaskCommitResult | null>(null);
  const [maskGeometry, setMaskGeometry] = useState<MaskGeometry>(() => initialMask ?? { width: sourceWidth, height: sourceHeight, strokes: [] });
  const interactionRef = useRef<FrameInteraction | null>(null);
  const frameRef = useRef(frame);

  useEffect(() => {
    const next = normalizeFrame(initialFrame, sourceWidth, sourceHeight);
    frameRef.current = next;
    setFrame(next);
  }, [initialFrame, sourceHeight, sourceWidth]);

  useEffect(() => setMask(null), [initialMask, source?.artifactId]);
  useEffect(() => {
    setRecipeId(initialRecipeId);
    setMaskGeometry(initialMask ?? { width: sourceWidth, height: sourceHeight, strokes: [] });
  }, [initialMask, initialRecipeId, source?.artifactId, sourceHeight, sourceWidth]);

  const viewport = useMemo(() => frameViewport(frame, sourceWidth, sourceHeight), [frame, sourceHeight, sourceWidth]);
  const blocked = disabled || !source || capability.mode === "unsupported";

  const publishWorkspace = (nextFrame: EditFrame, nextMask: MaskGeometry, nextRecipeId: EditRecipeId) => {
    if (!source) return;
    onWorkspaceChange?.({
      sourceArtifactId: source.artifactId,
      recipeId: nextRecipeId,
      frame: nextFrame,
      maskGeometry: nextMask,
      capability: {
        providerId: capability.providerId,
        profileId: capability.profileId,
        mode: capability.mode,
        ...(capability.detail ? { detail: capability.detail } : {})
      }
    });
  };

  const publishFrame = (next: EditFrame) => {
    const normalized = normalizeFrame(next, sourceWidth, sourceHeight);
    frameRef.current = normalized;
    setFrame(normalized);
    onFrameChange?.(normalized);
    publishWorkspace(normalized, maskGeometry, recipeId);
  };

  const chooseMode = (mode: EditFrameMode) => {
    if (mode === "source") {
      publishFrame({ mode, x: 0, y: 0, width: sourceWidth, height: sourceHeight });
      return;
    }
    if (mode === "outpaint" && frame.mode !== "outpaint") {
      publishFrame({ mode, x: sourceWidth * .1, y: sourceHeight * .1, width: sourceWidth * 1.2, height: sourceHeight * 1.2 });
      return;
    }
    publishFrame({ ...frame, mode });
  };

  const startFrameInteraction = (event: ReactPointerEvent<HTMLElement>, kind: FrameInteraction["kind"]) => {
    event.stopPropagation();
    if (blocked || frame.mode === "source" || interactionRef.current) return;
    const stage = event.currentTarget.closest<HTMLElement>(".edit-frame-stage");
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    interactionRef.current = {
      pointerId: event.pointerId,
      kind,
      startX: event.clientX,
      startY: event.clientY,
      startFrame: frameRef.current,
      unitsPerPixelX: viewport.width / Math.max(1, rect.width),
      unitsPerPixelY: viewport.height / Math.max(1, rect.height)
    };
  };

  const moveFrameInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId || event.buttons !== 1) return;
    event.stopPropagation();
    const dx = (event.clientX - interaction.startX) * interaction.unitsPerPixelX;
    const dy = (event.clientY - interaction.startY) * interaction.unitsPerPixelY;
    const next = interaction.kind === "move"
      ? { ...interaction.startFrame, x: interaction.startFrame.x + dx, y: interaction.startFrame.y + dy }
      : { ...interaction.startFrame, width: Math.max(16, interaction.startFrame.width + dx), height: Math.max(16, interaction.startFrame.height + dy) };
    frameRef.current = next;
    setFrame(next);
  };

  const finishFrameInteraction = (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    interactionRef.current = null;
    if (cancelled) {
      frameRef.current = interaction.startFrame;
      setFrame(interaction.startFrame);
      return;
    }
    publishFrame(frameRef.current);
  };

  if (!source) {
    return (
      <section className="edit-workspace edit-workspace-empty" data-testid="edit-workspace">
        <ImageOff size={24} aria-hidden="true" />
        <div><span className="eyebrow">Image edit workspace</span><h3>Add a source image</h3><p>Connect an image artifact to unlock crop, outpaint, and mask tools.</p></div>
      </section>
    );
  }

  return (
    <section className="edit-workspace" data-testid="edit-workspace">
      <header className="edit-workspace-header">
        <div><span className="eyebrow">Image edit workspace</span><h3>{source.label}</h3></div>
        <span className="edit-source-id" title={source.artifactId}>{source.artifactId}</span>
      </header>

      <CapabilityNotice capability={capability} />

      <div className="edit-preview-grid" aria-label="Edit preview">
        <figure className="edit-preview-tile" data-testid="edit-before-preview"><figcaption>Source</figcaption><img src={source.previewUrl} alt={`${source.label} source`} draggable={false} /></figure>
        <figure className="edit-preview-tile" data-testid="edit-after-preview"><figcaption>Edit preview</figcaption>{outputPreviewUrl ? <img src={outputPreviewUrl} alt={`${source.label} edited preview`} draggable={false} /> : <span>Preview appears after the first edit run.</span>}</figure>
      </div>

      <div className="edit-controls-grid">
        <label>Edit recipe<select aria-label="Edit recipe" value={recipeId} onChange={(event) => { const next = event.target.value as EditRecipeId; setRecipeId(next); publishWorkspace(frame, maskGeometry, next); }} disabled={disabled}>{EDIT_RECIPES.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.label}</option>)}</select></label>
        <label>Frame mode<select aria-label="Frame mode" value={frame.mode} onChange={(event) => chooseMode(event.target.value as EditFrameMode)} disabled={disabled}><option value="source">Source bounds</option><option value="crop">Crop</option><option value="outpaint">Outpaint</option></select></label>
        <FrameInput label="Frame X" value={frame.x} disabled={blocked || frame.mode === "source"} onChange={(value) => publishFrame({ ...frame, x: value })} />
        <FrameInput label="Frame Y" value={frame.y} disabled={blocked || frame.mode === "source"} onChange={(value) => publishFrame({ ...frame, y: value })} />
        <FrameInput label="Frame width" value={frame.width} min={16} disabled={blocked || frame.mode === "source"} onChange={(value) => publishFrame({ ...frame, width: value })} />
        <FrameInput label="Frame height" value={frame.height} min={16} disabled={blocked || frame.mode === "source"} onChange={(value) => publishFrame({ ...frame, height: value })} />
      </div>

      <div className="edit-frame-panel">
        <div className="edit-frame-panel-heading"><span>{frame.mode === "outpaint" ? <Expand size={14} aria-hidden="true" /> : <Crop size={14} aria-hidden="true" />}{frame.mode === "source" ? "Source frame" : frame.mode === "crop" ? "Crop frame" : "Outpaint frame"}</span><small>{Math.round(frame.width)} × {Math.round(frame.height)}</small></div>
        <div className="edit-frame-stage" data-testid="edit-frame-stage" style={{ aspectRatio: `${viewport.width} / ${viewport.height}` }}>
          <img src={source.previewUrl} alt="" aria-hidden="true" draggable={false} style={rectStyle(frame.mode === "outpaint" ? { x: frame.x, y: frame.y, width: sourceWidth, height: sourceHeight } : { x: 0, y: 0, width: sourceWidth, height: sourceHeight }, viewport)} />
          <div
            className={`edit-frame-box${frame.mode === "source" ? " is-source" : ""}`}
            data-testid="edit-frame-box"
            style={rectStyle(frame.mode === "outpaint" ? { ...frame, x: 0, y: 0 } : frame, viewport)}
            onPointerDown={(event) => startFrameInteraction(event, "move")}
            onPointerMove={moveFrameInteraction}
            onPointerUp={(event) => finishFrameInteraction(event, false)}
            onPointerCancel={(event) => finishFrameInteraction(event, true)}
          >
            <span>{frame.mode}</span>
            {frame.mode !== "source" ? <button type="button" className="edit-frame-handle" aria-label="Resize edit frame" onPointerDown={(event) => startFrameInteraction(event, "resize")} onPointerMove={moveFrameInteraction} onPointerUp={(event) => finishFrameInteraction(event, false)} onPointerCancel={(event) => finishFrameInteraction(event, true)} /> : null}
          </div>
        </div>
      </div>

      <MaskCanvas sourceKey={source.artifactId} sourcePreviewUrl={source.previewUrl} sourceLabel={source.label} width={source.width} height={source.height} initialGeometry={maskGeometry} disabled={blocked} onGeometryChange={(next) => { setMaskGeometry(next); setMask(null); publishWorkspace(frameRef.current, next, recipeId); }} onCommit={setMask} />

      <footer className="edit-commit-row">
        <div data-testid="staged-mask-summary"><Paintbrush size={15} aria-hidden="true" /><span>{mask ? `${mask.geometry.strokes.length} strokes staged · ${mask.raster.mimeType} · ${mask.raster.polarity}` : "Commit a mask before saving the edit setup."}</span></div>
        <button type="button" className="run-node-button" disabled={blocked || !mask} onClick={() => { if (mask) onCommit({ config, source, recipeId, frame, mask }); }}><Save size={14} aria-hidden="true" />Save edit setup</button>
      </footer>
    </section>
  );
}

function CapabilityNotice({ capability }: { capability: ImageEditCapability }) {
  const copy = capability.mode === "native-inpainting"
    ? "Native inpainting: this provider accepts pixel-exact mask raster input."
    : capability.mode === "guidance-only"
      ? "Guidance only: the mask guides composition, but the provider may not preserve exact mask boundaries."
      : "Unsupported: this provider cannot consume image edits or guidance masks.";
  return <div className={`edit-capability is-${capability.mode}`} role={capability.mode === "unsupported" ? "alert" : "status"}><strong>{capability.providerId}</strong><span>{copy}</span>{capability.detail ? <small>{capability.detail}</small> : null}</div>;
}

function FrameInput({ label, value, min, disabled, onChange }: { label: string; value: number; min?: number; disabled: boolean; onChange(value: number): void }) {
  return <label>{label}<input aria-label={label} type="number" min={min} value={round(value)} disabled={disabled} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(min === undefined ? next : Math.max(min, next)); }} /></label>;
}

function normalizeFrame(frame: EditFrame | undefined, width: number, height: number): EditFrame {
  return {
    mode: frame?.mode ?? "source",
    x: Math.max(0, finite(frame?.x, 0)),
    y: Math.max(0, finite(frame?.y, 0)),
    width: Math.max(16, finite(frame?.width, width)),
    height: Math.max(16, finite(frame?.height, height))
  };
}

function frameViewport(frame: EditFrame, sourceWidth: number, sourceHeight: number) {
  if (frame.mode === "outpaint") {
    return { x: 0, y: 0, width: Math.max(frame.width, frame.x + sourceWidth), height: Math.max(frame.height, frame.y + sourceHeight) };
  }
  const x = Math.min(0, frame.x);
  const y = Math.min(0, frame.y);
  const right = Math.max(sourceWidth, frame.x + frame.width);
  const bottom = Math.max(sourceHeight, frame.y + frame.height);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function rectStyle(rect: { x: number; y: number; width: number; height: number }, viewport: { x: number; y: number; width: number; height: number }) {
  return {
    left: `${((rect.x - viewport.x) / viewport.width) * 100}%`,
    top: `${((rect.y - viewport.y) / viewport.height) * 100}%`,
    width: `${(rect.width / viewport.width) * 100}%`,
    height: `${(rect.height / viewport.height) * 100}%`
  };
}

function finite(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

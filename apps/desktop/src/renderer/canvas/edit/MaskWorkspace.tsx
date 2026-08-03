import { ImageOff, ShieldCheck } from "lucide-react";
import type { EditMaskGeometry } from "@ether/schema";
import { MaskCanvas, type MaskCommitResult, type MaskGeometry } from "./MaskCanvas";
import type { ImageEditSource } from "./EditWorkspace";

export type StandaloneMaskWorkspaceProps = {
  source?: ImageEditSource;
  initialGeometry?: EditMaskGeometry;
  disabled?: boolean;
  onGeometryChange?(geometry: MaskGeometry): void;
  onCommit(result: MaskCommitResult): void;
};

/** Purpose-built authoring surface for the canonical edit.mask node. */
export function MaskWorkspace({
  source,
  initialGeometry,
  disabled = false,
  onGeometryChange,
  onCommit
}: StandaloneMaskWorkspaceProps) {
  if (!source) {
    return (
      <section className="edit-workspace edit-workspace-empty" data-testid="mask-workspace">
        <ImageOff size={24} aria-hidden="true" />
        <div>
          <span className="eyebrow">Mask workspace</span>
          <h3>Add a source image</h3>
          <p>Connect an enabled Image lane with an available output to unlock mask authoring.</p>
        </div>
      </section>
    );
  }

  const geometry = initialGeometry as MaskGeometry | undefined;
  return (
    <section className="edit-workspace standalone-mask-workspace" data-testid="mask-workspace">
      <header className="edit-workspace-header">
        <div><span className="eyebrow">Mask workspace</span><h3>{source.label}</h3></div>
        <span className="edit-source-id" title={source.artifactId}>{source.artifactId}</span>
      </header>
      <div className="edit-input-summary" data-testid="mask-provenance">
        <span><ShieldCheck size={12} aria-hidden="true" /> Source image</span>
        <span>Mask output - SVG</span>
        <small>White selected - black clear - geometry is saved with this node</small>
      </div>
      <MaskCanvas
        sourceKey={source.artifactId}
        sourcePreviewUrl={source.previewUrl}
        sourceLabel={source.label}
        width={source.width}
        height={source.height}
        initialGeometry={geometry}
        disabled={disabled}
        onGeometryChange={onGeometryChange}
        onCommit={onCommit}
      />
    </section>
  );
}

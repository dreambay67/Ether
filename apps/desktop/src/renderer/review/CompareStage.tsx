import { useEffect, useMemo, useState } from "react";
import { Check, Scale } from "lucide-react";
import type { ApplicationCommand, Artifact } from "@ether/schema";

import { embeddedArtifactSource } from "../artifacts/embeddedArtifactSource";

const EMPTY_SELECTION: readonly string[] = [];

export type CompareStageProps = {
  documentId: string;
  checkpointId: string;
  artifacts: readonly Artifact[];
  selectionMode?: "one" | "many";
  minimumSelections?: number;
  initialSelectedOutputVersionIds?: readonly string[];
  initialNote?: string;
  disabled?: boolean;
  onCompleted?(selectedOutputVersionIds: string[], note: string): void | Promise<void>;
  onStatus?(message: string): void;
};

/** A human-only checkpoint. Completing it persists the exact selection and note. */
export function CompareStage({
  documentId,
  checkpointId,
  artifacts,
  selectionMode = "one",
  minimumSelections = 1,
  initialSelectedOutputVersionIds = EMPTY_SELECTION,
  initialNote = "",
  disabled = false,
  onCompleted,
  onStatus
}: CompareStageProps) {
  const candidateIds = useMemo(
    () => new Set(artifacts.map((artifact) => artifact.source.outputVersionId)),
    [artifacts]
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    validInitialSelection(initialSelectedOutputVersionIds, candidateIds, selectionMode)
  );
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Selection is made by you. Compare never calls a model.");

  useEffect(() => {
    setSelectedIds(validInitialSelection(initialSelectedOutputVersionIds, candidateIds, selectionMode));
    setNote(initialNote);
    setMessage("Selection is made by you. Compare never calls a model.");
  }, [candidateIds, checkpointId, initialNote, initialSelectedOutputVersionIds, selectionMode]);

  const required = Math.max(0, minimumSelections);
  const canComplete = !disabled && !saving && selectedIds.length >= required;

  const toggle = (outputVersionId: string) => {
    setSelectedIds((current) => {
      if (current.includes(outputVersionId)) return current.filter((id) => id !== outputVersionId);
      return selectionMode === "one" ? [outputVersionId] : [...current, outputVersionId];
    });
  };

  const complete = async () => {
    if (!canComplete) return;
    setSaving(true);
    setMessage("Saving human selection…");
    try {
      const command: ApplicationCommand = {
        kind: "command",
        id: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        documentId,
        name: "review.completeCompare",
        payload: {
          checkpointId,
          selectedOutputVersionIds: selectedIds,
          ...(note.trim() ? { note: note.trim() } : {})
        }
      };
      const response = await window.ether.application.command(command);
      if (response.name !== "review.completeCompare") {
        throw new Error("Ether returned an unexpected Compare response.");
      }
      const savedMessage = `Human selection saved (${selectedIds.length} selected).`;
      setMessage(savedMessage);
      onStatus?.(savedMessage);
      await onCompleted?.(selectedIds, note.trim());
    } catch (cause) {
      const errorMessage = cause instanceof Error ? cause.message : "The Compare selection could not be saved.";
      setMessage(errorMessage);
      onStatus?.(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="compare-stage" aria-labelledby="compare-stage-title" data-testid="compare-stage">
      <header>
        <div>
          <span className="eyebrow">Human checkpoint</span>
          <h2 id="compare-stage-title"><Scale size={18} aria-hidden="true" /> Compare Stage</h2>
        </div>
        <strong>{selectedIds.length} selected</strong>
      </header>

      <p className="compare-stage-disclosure">No AI runs here. Your selected output versions and review note are stored on the durable checkpoint.</p>

      {artifacts.length === 0 ? (
        <p className="artifact-empty">No artifacts are available for this checkpoint.</p>
      ) : (
        <div className="compare-review-grid" role={selectionMode === "one" ? "radiogroup" : "group"} aria-label="Compare candidates">
          {artifacts.map((artifact) => {
            const outputVersionId = artifact.source.outputVersionId;
            const selected = selectedIds.includes(outputVersionId);
            const title = artifactTitle(artifact);
            return (
              <button
                key={artifact.id}
                type="button"
                className={`compare-review-tile${selected ? " is-selected" : ""}`}
                role={selectionMode === "one" ? "radio" : undefined}
                aria-checked={selectionMode === "one" ? selected : undefined}
                aria-pressed={selectionMode === "many" ? selected : undefined}
                disabled={disabled || saving}
                onClick={() => toggle(outputVersionId)}
                data-testid={`compare-candidate-${artifact.id}`}
              >
                {artifact.mediaType.startsWith("image/") ? (
                  <img src={embeddedArtifactSource(documentId, artifact.id)} alt="" draggable={false} />
                ) : (
                  <span className="artifact-media-fallback">{artifact.channel}</span>
                )}
                <strong>{title}</strong>
                <span>{artifact.mediaType}</span>
                <small>{outputVersionId}</small>
                {selected ? <Check size={16} aria-label="Selected" /> : null}
              </button>
            );
          })}
        </div>
      )}

      <label className="compare-stage-note">
        Review note
        <textarea
          value={note}
          disabled={disabled || saving}
          placeholder="Why did you choose these outputs?"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <footer>
        <p role="status">{message}</p>
        <button type="button" disabled={!canComplete} onClick={() => void complete()} data-testid="compare-complete">
          {saving ? "Saving…" : `Complete checkpoint${required > 0 ? ` · ${required} minimum` : ""}`}
        </button>
      </footer>
    </section>
  );
}

function validInitialSelection(
  initialIds: readonly string[],
  candidateIds: ReadonlySet<string>,
  selectionMode: "one" | "many"
) {
  const valid = [...new Set(initialIds)].filter((id) => candidateIds.has(id));
  return selectionMode === "one" ? valid.slice(0, 1) : valid;
}

function artifactTitle(artifact: Artifact) {
  const title = artifact.metadata.title ?? artifact.metadata.label ?? artifact.metadata.originalName;
  return typeof title === "string" && title.trim() ? title : artifact.id;
}

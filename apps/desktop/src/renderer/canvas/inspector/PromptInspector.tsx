import type { CanvasNodeData } from "@ether/engine/graph/nodeCatalog";
import type { MutationPreset, InspectorNodeContext } from "./types";

type PromptInspectorProps = {
  context: InspectorNodeContext;
  mutationPresets: MutationPreset[];
  previewPrompt: string;
  previewNegativePrompt: string;
  hasFrozenPrompt: boolean;
  lastRunAt?: string;
};

type MutationControlsProps = {
  context: InspectorNodeContext;
  mutationPresets: MutationPreset[];
};

export function TextMutationControls({ context, mutationPresets }: MutationControlsProps) {
  const { nodeDraft, isLocked, commitNodeDraft, commitInputOnEnter, updateNodeDraft } = context;
  const mutationEnabled = nodeDraft.mutationEnabled === true;
  const selectedMutationPreset =
    mutationPresets.find((preset) => preset.id === (nodeDraft.mutationPreset ?? "Whisper")) ??
    mutationPresets[0]!;

  return (
    <section className="inspector-preview" data-testid="inspector-mutation-controls">
      <div>
        <span>Mutation</span>
        <strong title={selectedMutationPreset.description}>{nodeDraft.mutationPreset ?? "Whisper"}</strong>
      </div>
      <label className="execution-toggle">
        <input
          aria-label="Enable prompt mutation"
          type="checkbox"
          checked={mutationEnabled}
          onChange={(event) => updateNodeDraft({ mutationEnabled: event.currentTarget.checked })}
          disabled={isLocked}
        />
        Enable
      </label>
      <label>
        Preset
        <select
          aria-label="Mutation preset"
          title={selectedMutationPreset.description}
          value={nodeDraft.mutationPreset ?? "Whisper"}
          onChange={(event) => updateNodeDraft({ mutationPreset: event.target.value })}
          onBlur={commitNodeDraft}
          disabled={isLocked}
        >
          {mutationPresets.map((preset) => (
            <option key={preset.id} value={preset.id} title={preset.description}>
              {preset.id}
            </option>
          ))}
        </select>
        <p className="preset-help">{selectedMutationPreset.description}</p>
      </label>
      <label>
        Seed
        <input
          aria-label="Mutation seed"
          title="Optional deterministic seed for repeatable text mutations."
          value={nodeDraft.mutationSeed ?? ""}
          onChange={(event) => updateNodeDraft({ mutationSeed: event.target.value })}
          onBlur={commitNodeDraft}
          onKeyDown={commitInputOnEnter}
          disabled={isLocked}
        />
      </label>
      {[
        ["Variation strength", "variationStrength", "How far the wording can move from the source text."],
        ["Novelty", "novelty", "How much new concept material the mutation can introduce."],
        ["Drift", "drift", "How freely the mutation can depart from the original structure."],
        ["Preserve subject", "preserveSubject", "How strongly the main subject should remain anchored."],
        ["Preserve style", "preserveStyle", "How strongly the existing style language should remain anchored."]
      ].map(([label, key, help]) => (
        <label key={key} title={help}>
          {label}
          <input
            aria-label={label}
            type="range"
            min={0}
            max={100}
            value={Number(nodeDraft[key as keyof CanvasNodeData] ?? 50)}
            onChange={(event) => updateNodeDraft({ [key]: Number(event.target.value) } as Partial<CanvasNodeData>)}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          />
        </label>
      ))}
      <label title="Terms that should remain unchanged across mutation runs.">
        Locked terms
        <textarea
          aria-label="Locked terms"
          value={nodeDraft.lockedTerms ?? ""}
          onChange={(event) => updateNodeDraft({ lockedTerms: event.target.value })}
          onBlur={commitNodeDraft}
          disabled={isLocked}
        />
      </label>
      <label title="Negative requirements the mutation should avoid adding or should preserve as constraints.">
        Negative constraints
        <textarea
          aria-label="Negative constraints"
          value={nodeDraft.negativeConstraints ?? ""}
          onChange={(event) => updateNodeDraft({ negativeConstraints: event.target.value })}
          onBlur={commitNodeDraft}
          disabled={isLocked}
        />
      </label>
      <label title="Optional creative direction for this mutation pass.">
        Mutation direction
        <textarea
          aria-label="Mutation direction"
          value={nodeDraft.mutationInstruction ?? ""}
          onChange={(event) => updateNodeDraft({ mutationInstruction: event.target.value })}
          onBlur={commitNodeDraft}
          disabled={isLocked}
        />
      </label>
    </section>
  );
}

export function PromptInspector({
  context,
  mutationPresets,
  previewPrompt,
  previewNegativePrompt,
  hasFrozenPrompt,
  lastRunAt
}: PromptInspectorProps) {
  const { nodeDraft, isLocked, commitNodeDraft, updateNodeDraft } = context;

  if (context.nodeData.kind !== "Prompt") {
    return null;
  }

  return (
    <>
      <TextMutationControls context={context} mutationPresets={mutationPresets} />
      <section className="inspector-preview" data-testid="inspector-assembly-preview">
        <div>
          <span>Assembled Prompt</span>
          <strong>preview</strong>
        </div>
        <label>
          Prompt
          <textarea
            aria-label="Assembled prompt"
            className="inspector-large-textarea"
            value={nodeDraft.assembledPrompt ?? previewPrompt ?? ""}
            placeholder="No prompt text assembled yet."
            onChange={(event) => updateNodeDraft({ assembledPrompt: event.target.value })}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          />
        </label>
        {previewNegativePrompt ? (
          <label>
            Negative
            <textarea
              aria-label="Assembled negative prompt"
              className="inspector-large-textarea"
              value={nodeDraft.assembledNegativePrompt ?? previewNegativePrompt ?? ""}
              onChange={(event) => updateNodeDraft({ assembledNegativePrompt: event.target.value })}
              onBlur={commitNodeDraft}
              disabled={isLocked}
            />
          </label>
        ) : null}
        {hasFrozenPrompt ? <p>Frozen {lastRunAt ?? "recently"}</p> : null}
      </section>
    </>
  );
}

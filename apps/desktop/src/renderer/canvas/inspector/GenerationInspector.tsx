import { ImagePlus } from "lucide-react";
import type { GenerationInputAssembly } from "@ether/engine/graph/artifacts";
import type { GenerationAspectRatio, GenerationResolution } from "@ether/engine/graph/nodeCatalog";
import type { InspectorNodeContext } from "./types";

type GenerationInspectorProps = {
  context: InspectorNodeContext;
  generationAssembly: GenerationInputAssembly | null;
  previewPrompt: string;
  previewNegativePrompt: string;
  onSaveFakeGeneratedAsset(id: string): void;
};

const ASPECT_RATIO_OPTIONS: Array<{ value: GenerationAspectRatio; label: string; description: string }> = [
  { value: "1:1", label: "1:1 Square", description: "Balanced square output for thumbnails, tiles, and neutral concept work." },
  { value: "4:5", label: "4:5 Portrait", description: "Social portrait crop with more vertical room than square." },
  { value: "3:4", label: "3:4 Portrait", description: "Classic portrait frame for posters, characters, and product shots." },
  { value: "9:16", label: "9:16 Vertical", description: "Tall vertical frame for mobile stories, reels, and phone-first compositions." },
  { value: "16:9", label: "16:9 Wide", description: "Wide landscape frame for banners, scenes, and cinematic compositions." },
  { value: "4:3", label: "4:3 Landscape", description: "Traditional landscape frame with moderate width." },
  { value: "3:2", label: "3:2 Camera", description: "Camera-like landscape ratio for editorial or photographic work." },
  { value: "2:3", label: "2:3 Poster", description: "Tall poster or print-style portrait ratio." }
];

const RESOLUTION_OPTIONS: Array<{ value: GenerationResolution; label: string; description: string }> = [
  { value: "1024-long-edge", label: "1024 long edge", description: "Fast draft size. Good for ideation and node workflow tests." },
  { value: "1536-long-edge", label: "1536 long edge", description: "Balanced working size for reviewable outputs." },
  { value: "2048-long-edge", label: "2048 long edge", description: "Larger final-oriented target when the provider supports it." }
];

const ASPECT_RATIO_VALUES: Record<GenerationAspectRatio, readonly [number, number]> = {
  "1:1": [1, 1],
  "4:5": [4, 5],
  "3:4": [3, 4],
  "9:16": [9, 16],
  "16:9": [16, 9],
  "4:3": [4, 3],
  "3:2": [3, 2],
  "2:3": [2, 3]
};

const RESOLUTION_LONG_EDGE: Record<GenerationResolution, number> = {
  "1024-long-edge": 1024,
  "1536-long-edge": 1536,
  "2048-long-edge": 2048
};

function isGenerationAspectRatio(value: unknown): value is GenerationAspectRatio {
  return typeof value === "string" && value in ASPECT_RATIO_VALUES;
}

function isGenerationResolution(value: unknown): value is GenerationResolution {
  return typeof value === "string" && value in RESOLUTION_LONG_EDGE;
}

function generationDimensions(aspectRatio: GenerationAspectRatio, resolution: GenerationResolution) {
  const [ratioWidth, ratioHeight] = ASPECT_RATIO_VALUES[aspectRatio];
  const longEdge = RESOLUTION_LONG_EDGE[resolution];
  const width = ratioWidth >= ratioHeight
    ? longEdge
    : Math.round((longEdge * ratioWidth) / ratioHeight);
  const height = ratioWidth >= ratioHeight
    ? Math.round((longEdge * ratioHeight) / ratioWidth)
    : longEdge;

  return { width, height };
}

export function GenerationInspector({
  context,
  generationAssembly,
  previewPrompt,
  previewNegativePrompt,
  onSaveFakeGeneratedAsset
}: GenerationInspectorProps) {
  const { selectedNode, nodeData, nodeDraft, isLocked, hasOpenProject, commitNodeDraft, updateNodeDraft } = context;

  if (nodeData.kind !== "Generation") {
    return null;
  }

  const aspectRatio = isGenerationAspectRatio(nodeDraft.generationAspectRatio ?? nodeData.generationAspectRatio)
    ? (nodeDraft.generationAspectRatio ?? nodeData.generationAspectRatio) as GenerationAspectRatio
    : "1:1";
  const resolution = isGenerationResolution(nodeDraft.generationResolution ?? nodeData.generationResolution)
    ? (nodeDraft.generationResolution ?? nodeData.generationResolution) as GenerationResolution
    : "1024-long-edge";
  const outputDimensions = generationDimensions(aspectRatio, resolution);
  const updateGenerationOutput = (nextAspectRatio: GenerationAspectRatio, nextResolution: GenerationResolution) => {
    const dimensions = generationDimensions(nextAspectRatio, nextResolution);

    updateNodeDraft({
      generationAspectRatio: nextAspectRatio,
      generationResolution: nextResolution,
      generationWidth: dimensions.width,
      generationHeight: dimensions.height
    });
  };

  return (
    <>
      <section className="inspector-preview" data-testid="inspector-generation-output-settings">
        <div>
          <span>Image Settings</span>
          <strong>{outputDimensions.width} x {outputDimensions.height}</strong>
        </div>
        <label title="Sets the intended canvas shape sent to the generation provider.">
          Aspect ratio
          <select
            aria-label="Aspect ratio"
            value={aspectRatio}
            onChange={(event) => updateGenerationOutput(event.target.value as GenerationAspectRatio, resolution)}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          >
            {ASPECT_RATIO_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} title={option.description}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label title="Sets the intended long-edge pixel target sent to the generation provider.">
          Resolution
          <select
            aria-label="Resolution"
            value={resolution}
            onChange={(event) => updateGenerationOutput(aspectRatio, event.target.value as GenerationResolution)}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          >
            {RESOLUTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} title={option.description}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p>
          Provider target: {outputDimensions.width} x {outputDimensions.height} px.
        </p>
      </section>
      <section className="inspector-preview" data-testid="inspector-generated-output">
        <div>
          <span>Generated Output</span>
          <button
            type="button"
            className="run-node-button"
            onClick={() => onSaveFakeGeneratedAsset(selectedNode.id)}
            disabled={!hasOpenProject || isLocked}
          >
            <ImagePlus size={14} aria-hidden="true" />
            Save fake output
          </button>
        </div>
        {nodeData.assetPath ? <pre>{nodeData.assetPath}</pre> : <p>Open a project to save fake output.</p>}
      </section>
      {generationAssembly ? (
        <section className="inspector-preview" data-testid="inspector-assembly-preview">
          <div>
            <span>Prepared Generation Inputs</span>
            <strong>input pack</strong>
          </div>
          <label>
            Prompt
            <textarea
              aria-label="Prepared generation prompt"
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
                aria-label="Prepared negative prompt"
                className="inspector-large-textarea"
                value={nodeDraft.assembledNegativePrompt ?? previewNegativePrompt ?? ""}
                onChange={(event) => updateNodeDraft({ assembledNegativePrompt: event.target.value })}
                onBlur={commitNodeDraft}
                disabled={isLocked}
              />
            </label>
          ) : null}
          {generationAssembly.references.length > 0 ? (
            <ul>
              {generationAssembly.references.map((reference) => (
                <li key={`${reference.nodeId}-${reference.role}`}>
                  {reference.role}: {reference.title}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

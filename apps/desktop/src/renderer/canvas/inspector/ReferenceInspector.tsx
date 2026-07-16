import { Upload } from "lucide-react";
import {
  getNodeDefinition,
  referenceAssetsFromNodeData,
  type CanvasNodeData
} from "@ether/engine/graph/nodeCatalog";
import type { ReferenceUploadMode } from "../hooks/useCanvasCommands";
import type { InspectorNodeContext } from "./types";

const referenceTypeOptions = [
  { definitionId: "reference-image", label: "Image" },
  { definitionId: "reference-video-reference", label: "Video Reference" },
  { definitionId: "reference-audio-reference", label: "Audio Reference" },
  { definitionId: "reference-colour-grid", label: "Colour Grid" },
  { definitionId: "reference-moodboard", label: "Moodboard" }
];

type ReferenceInspectorProps = {
  context: InspectorNodeContext;
  onUploadReferenceForNode(id: string, mode?: ReferenceUploadMode): void;
};

export function ReferenceInspector({ context, onUploadReferenceForNode }: ReferenceInspectorProps) {
  const { selectedNode, nodeData, nodeDraft, isLocked, hasOpenProject, commitNodeDraft, updateNodeDraft } = context;
  const referenceCount = referenceAssetsFromNodeData(nodeDraft ?? nodeData).length;

  if (nodeData.kind !== "Reference") {
    return null;
  }

  return (
    <section className="inspector-preview" data-testid="inspector-reference-controls">
      <div>
        <span>Reference</span>
        <strong>{nodeDraft.subtype ?? nodeData.subtype}</strong>
      </div>
      <label title="Switches the reference contract while keeping linked asset labels intact.">
        Type
        <select
          aria-label="Reference type"
          value={nodeDraft.definitionId ?? nodeData.definitionId}
          onChange={(event) => {
            const definition = getNodeDefinition(event.target.value);
            const updates: Partial<CanvasNodeData> = {
              definitionId: definition.id,
              subtype: definition.subtype,
              title: nodeData.assetPath ? nodeData.title : definition.title,
              label: nodeData.assetPath ? nodeData.label : definition.title
            };
            updateNodeDraft(updates);
          }}
          onBlur={commitNodeDraft}
          disabled={isLocked}
        >
          {referenceTypeOptions.map((option) => (
            <option key={option.definitionId} value={option.definitionId}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="run-node-button"
        onClick={() => onUploadReferenceForNode(selectedNode.id, "add")}
        disabled={!hasOpenProject || isLocked}
        title="Add another linked image to this Reference node. Existing images stay in the node bundle."
      >
        <Upload size={14} aria-hidden="true" />
        Add image
      </button>
      <button
        type="button"
        className="run-node-button"
        onClick={() => onUploadReferenceForNode(selectedNode.id, "replace")}
        disabled={!hasOpenProject || isLocked}
        title="Replace this Reference node's current image bundle with one newly selected image."
      >
        <Upload size={14} aria-hidden="true" />
        Replace image
      </button>
      <p>
        {referenceCount} linked asset{referenceCount === 1 ? "" : "s"} in this reference node. Image add/replace uses
        the current desktop image selector.
      </p>
    </section>
  );
}

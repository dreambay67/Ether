import type { InspectorNodeContext } from "./types";

type NoteInspectorProps = {
  context: InspectorNodeContext;
};

export function NoteInspector({ context }: NoteInspectorProps) {
  const { nodeData } = context;

  if (nodeData.kind !== "Note") {
    return null;
  }

  return (
    <section className="inspector-preview" data-testid="inspector-note-context">
      <div>
        <span>Note Context</span>
        <strong>{nodeData.subtype}</strong>
      </div>
      <p>Connected notes contribute context text to prompts, references, and store routing.</p>
    </section>
  );
}

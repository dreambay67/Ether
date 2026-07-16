import { TextMutationControls } from "./PromptInspector";
import type { InspectorNodeContext, MutationPreset } from "./types";

type AssistantInspectorProps = {
  context: InspectorNodeContext;
  mutationPresets: MutationPreset[];
};

export function AssistantInspector({ context, mutationPresets }: AssistantInspectorProps) {
  if (context.nodeData.kind !== "Assistant") {
    return null;
  }

  return <TextMutationControls context={context} mutationPresets={mutationPresets} />;
}

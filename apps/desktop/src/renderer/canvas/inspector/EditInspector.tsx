import { EditWorkspace } from "../edit/EditWorkspace";
import type { InspectorNodeContext, MaskWorkspaceSavePayload } from "./types";

type EditInspectorProps = {
  context: InspectorNodeContext;
  onCreateMaskAsset(id: string, payload?: MaskWorkspaceSavePayload): void;
};

export function EditInspector({ context, onCreateMaskAsset }: EditInspectorProps) {
  const { nodeData } = context;

  if (nodeData.kind !== "Edit") {
    return null;
  }

  return <EditWorkspace context={context} onCreateMaskAsset={onCreateMaskAsset} />;
}

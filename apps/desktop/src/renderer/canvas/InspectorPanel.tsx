import { InspectorShell } from "./inspector/InspectorShell";
import type { InspectorContext } from "./inspector/types";

export type InspectorPanelProps = { context: InspectorContext | null };

export function InspectorPanel(props: InspectorPanelProps) {
  return <InspectorShell {...props} />;
}

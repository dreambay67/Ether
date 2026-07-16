import { InspectorShell } from "./inspector/InspectorShell";
import type { InspectorShellProps } from "./inspector/types";

export type InspectorPanelProps = InspectorShellProps;

export function InspectorPanel(props: InspectorPanelProps) {
  return <InspectorShell {...props} />;
}

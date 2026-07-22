import { useMemo } from "react";
import type { DesktopReference } from "../../shared/ipc/contracts";

export function useProjectHealth(references: DesktopReference[]) {
  return useMemo(() => {
    const missing = references.filter((reference) => reference.state === "missing");
    return {
      missing,
      isHealthy: missing.length === 0,
      summary: missing.length === 0 ? "Project ready" : `${missing.length} reference${missing.length === 1 ? "" : "s"} need attention`
    };
  }, [references]);
}

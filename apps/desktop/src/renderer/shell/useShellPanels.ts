import { useCallback, useMemo, useState } from "react";
import { useDesktopSettings } from "../project/useDesktopSettings";

export const workspaces = ["build", "focus", "run", "review"] as const;
export type WorkspaceId = (typeof workspaces)[number];
export type ShellPanelId = "tools" | "inspector" | "artifacts" | "runs";

type PanelState = { size: number; collapsed: boolean };
type PanelLayout = Record<ShellPanelId, PanelState>;

export const shellPanelLimits: Record<ShellPanelId, { min: number; max: number }> = {
  tools: { min: 220, max: 360 },
  inspector: { min: 220, max: 400 },
  artifacts: { min: 120, max: 300 },
  runs: { min: 104, max: 260 }
};

export function shellPanelLimitsFor(workspace: WorkspaceId, panel: ShellPanelId) {
  const limits = shellPanelLimits[panel];
  if (workspace !== "build") return limits;
  if (panel === "artifacts") return { ...limits, max: 180 };
  if (panel === "runs") return { ...limits, max: 148 };
  return limits;
}

const initialWorkspacePanels: Record<WorkspaceId, PanelLayout> = {
  build: {
    tools: { size: 264, collapsed: false },
    inspector: { size: 260, collapsed: false },
    artifacts: { size: 180, collapsed: false },
    runs: { size: 148, collapsed: true }
  },
  focus: {
    tools: { size: 184, collapsed: true },
    inspector: { size: 240, collapsed: true },
    artifacts: { size: 220, collapsed: true },
    runs: { size: 148, collapsed: true }
  },
  run: {
    tools: { size: 184, collapsed: true },
    inspector: { size: 280, collapsed: false },
    artifacts: { size: 180, collapsed: false },
    runs: { size: 220, collapsed: false }
  },
  review: {
    tools: { size: 184, collapsed: true },
    inspector: { size: 300, collapsed: false },
    artifacts: { size: 180, collapsed: true },
    runs: { size: 148, collapsed: true }
  }
};

export function useShellPanels(documentId: string) {
  const [workspace, setWorkspace] = useState<WorkspaceId>("build");
  const preferenceKey = `ether.desktop.shell.v2:${documentId}`;
  const [workspacePanels, setWorkspacePanels] = useDesktopSettings<Record<WorkspaceId, PanelLayout>>(
    preferenceKey,
    initialWorkspacePanels,
    normalizeWorkspacePanels
  );
  const panels = workspacePanels[workspace];

  const setPanelSize = useCallback((panel: ShellPanelId, size: number) => {
    const limits = shellPanelLimitsFor(workspace, panel);
    setWorkspacePanels((current) => ({
      ...current,
      [workspace]: {
        ...current[workspace],
        [panel]: {
          ...current[workspace][panel],
          size: clamp(size, limits.min, limits.max)
        }
      }
    }));
  }, [setWorkspacePanels, workspace]);

  const togglePanel = useCallback((panel: ShellPanelId) => {
    setWorkspacePanels((current) => ({
      ...current,
      [workspace]: {
        ...current[workspace],
        [panel]: { ...current[workspace][panel], collapsed: !current[workspace][panel].collapsed }
      }
    }));
  }, [setWorkspacePanels, workspace]);

  return useMemo(
    () => ({ workspace, setWorkspace, panels, setPanelSize, togglePanel }),
    [panels, setPanelSize, togglePanel, workspace]
  );
}

function normalizeWorkspacePanels(
  value: unknown,
  fallback: Record<WorkspaceId, PanelLayout>
): Record<WorkspaceId, PanelLayout> {
  const candidate = isRecord(value) ? value : {};
  return Object.fromEntries(workspaces.map((workspace) => {
    const storedLayout = isRecord(candidate[workspace]) ? candidate[workspace] : {};
    const layout = Object.fromEntries(
      (Object.keys(fallback[workspace]) as ShellPanelId[]).map((panel) => {
        const stored = isRecord(storedLayout[panel]) ? storedLayout[panel] : {};
        const limits = shellPanelLimitsFor(workspace, panel);
        const size = typeof stored.size === "number" && Number.isFinite(stored.size)
          ? clamp(stored.size, limits.min, limits.max)
          : fallback[workspace][panel].size;
        const collapsed = typeof stored.collapsed === "boolean"
          ? stored.collapsed
          : fallback[workspace][panel].collapsed;
        return [panel, { size, collapsed }];
      })
    ) as PanelLayout;
    return [workspace, layout];
  })) as Record<WorkspaceId, PanelLayout>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, value)));
}

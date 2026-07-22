import { workspaces, type WorkspaceId } from "./useShellPanels";

const labels: Record<WorkspaceId, string> = {
  build: "Build",
  focus: "Focus",
  run: "Run",
  review: "Review"
};

export function WorkspaceSwitcher({ active, onChange }: { active: WorkspaceId; onChange(workspace: WorkspaceId): void }) {
  return (
    <nav className="workspace-switcher" aria-label="Ether workspaces" data-testid="workspace-switcher">
      {workspaces.map((workspace) => (
        <button
          key={workspace}
          type="button"
          aria-pressed={active === workspace}
          className={active === workspace ? "is-active" : ""}
          onClick={() => onChange(workspace)}
        >
          {labels[workspace]}
        </button>
      ))}
    </nav>
  );
}

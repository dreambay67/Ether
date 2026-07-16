import { useRef, type ReactNode } from "react";
import {
  Activity,
  FolderOpen,
  History,
  LifeBuoy,
  Plus,
  RotateCcw,
  ShieldCheck
} from "lucide-react";
import etherLogo from "../../../../../packages/brand/src/assets/Ether_logo.png";

type StartScreenProps = {
  projectName: string;
  parentDirectory: string;
  recentProjects: string[];
  message: string;
  providerPanel: ReactNode;
  onProjectNameChange(name: string): void;
  onChooseParentDirectory(): void;
  onCreateProject(): void;
  onOpenProject(): void;
  onOpenRecentProject(projectPath: string): void;
  onCheckProviders(): void;
};

export function StartScreen({
  projectName,
  parentDirectory,
  recentProjects,
  message,
  providerPanel,
  onProjectNameChange,
  onChooseParentDirectory,
  onCreateProject,
  onOpenProject,
  onOpenRecentProject,
  onCheckProviders
}: StartScreenProps) {
  const displayParent = parentDirectory.trim() || "Choose a parent folder";
  const projectNameRef = useRef<HTMLInputElement>(null);

  return (
    <section className="start-screen" data-testid="start-screen" aria-label="Ether start screen">
      <div className="start-hero">
        <div className="start-brand">
          <img src={etherLogo} alt="Ether logo" className="ether-logo" />
          <div>
            <p>by DreamBay</p>
            <h1>ETHER</h1>
          </div>
        </div>
        <p className="start-copy">
          Local-first creative systems start here. Create or open an Ether project without typing a path.
        </p>
      </div>

      <div className="start-grid">
        <section className="start-panel start-actions" aria-label="Project actions">
          <div className="start-action-row">
            <button type="button" className="primary-action" onClick={() => projectNameRef.current?.focus()}>
              <Plus size={17} aria-hidden="true" />
              New Project
            </button>
            <button type="button" onClick={onOpenProject}>
              <FolderOpen size={17} aria-hidden="true" />
              Open Project
            </button>
          </div>

          <div className="start-create-box" aria-label="New project setup">
            <label>
              Project name
              <input
                ref={projectNameRef}
                value={projectName}
                onChange={(event) => onProjectNameChange(event.target.value)}
                placeholder="Campaign Exploration"
              />
            </label>
            <div className="start-location">
              <span>Location</span>
              <strong title={displayParent}>{displayParent}</strong>
              <button type="button" onClick={onChooseParentDirectory}>
                <FolderOpen size={15} aria-hidden="true" />
                Choose Parent Folder
              </button>
            </div>
            <button type="button" className="primary-action" onClick={onCreateProject}>
              <Plus size={16} aria-hidden="true" />
              Create Project
            </button>
          </div>

          <div className="start-action-row">
            <button type="button" disabled title="Sample project workflow is planned for a later task.">
              <Activity size={17} aria-hidden="true" />
              Try Sample
            </button>
            <button type="button" onClick={onCheckProviders}>
              <ShieldCheck size={17} aria-hidden="true" />
              Check Providers
            </button>
            <button type="button" disabled title="Recovery workflow is planned for a later task.">
              <LifeBuoy size={17} aria-hidden="true" />
              Recover Project
            </button>
          </div>

          <p className="start-message" aria-live="polite">
            {message}
          </p>
        </section>

        <section className="start-panel recent-projects" aria-label="Recent Projects">
          <div className="start-panel-title">
            <History size={16} aria-hidden="true" />
            <h2>Recent Projects</h2>
          </div>
          {recentProjects.length > 0 ? (
            <div className="recent-list">
              {recentProjects.map((projectPath) => (
                <button type="button" key={projectPath} onClick={() => onOpenRecentProject(projectPath)}>
                  <RotateCcw size={15} aria-hidden="true" />
                  <span>{projectPath.split(/[\\/]/).pop() ?? projectPath}</span>
                  <small>{projectPath}</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-recent">Create or open a project and it will appear here.</p>
          )}
        </section>
      </div>

      {providerPanel}
    </section>
  );
}

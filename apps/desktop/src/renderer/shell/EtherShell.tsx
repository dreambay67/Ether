import type { DragEventHandler, ReactNode } from "react";
import { Activity, Boxes, PanelRight, Sparkles } from "lucide-react";

import type { DesktopReference } from "../../shared/ipc/contracts";
import { ArtifactBrowser } from "../artifacts/ArtifactBrowser";
import { ResizablePane } from "./ResizablePane";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { shellPanelLimits, useShellPanels } from "./useShellPanels";

export function EtherShell({
  documentId,
  header,
  tools,
  canvas,
  inspector,
  referenceDesk,
  batchMatrix,
  jobCenter,
  references,
  artifactRevision,
  status,
  onDragOver,
  onDrop,
  children
}: {
  documentId: string;
  header: (artifactsVisible: boolean, toggleArtifacts: () => void) => ReactNode;
  tools: ReactNode;
  canvas: ReactNode;
  inspector?: ReactNode;
  referenceDesk: ReactNode;
  batchMatrix: ReactNode;
  jobCenter: ReactNode;
  references: DesktopReference[];
  artifactRevision: number;
  status: ReactNode;
  onDragOver?: DragEventHandler<HTMLElement>;
  onDrop?: DragEventHandler<HTMLElement>;
  children?: ReactNode;
}) {
  const shell = useShellPanels(documentId);
  const { panels } = shell;
  const workspaceDescription = {
    build: "Arrange your graph and source material.",
    focus: "Keep the canvas clear for composition.",
    run: "Follow execution work and output readiness.",
    review: "Compare embedded artifacts and project attention."
  }[shell.workspace];
  const upperPane = shell.workspace === "build"
    ? { label: "Reference Desk", content: referenceDesk }
    : shell.workspace === "run"
      ? { label: "Batch Matrix", content: batchMatrix }
      : shell.workspace === "review"
        ? { label: "Artifact Observatory", content: <ArtifactBrowser key={`${documentId}:${artifactRevision}`} documentId={documentId} /> }
        : { label: "Live output", content: <ArtifactBrowser key={`${documentId}:${artifactRevision}`} documentId={documentId} /> };

  return (
    <main className="ether-shell task-nine-shell task-fifteen-shell" aria-label="Ether desktop workspace" onDragOver={onDragOver} onDrop={onDrop}>
      {header(!panels.artifacts.collapsed, () => shell.togglePanel("artifacts"))}
      <WorkspaceSwitcher active={shell.workspace} onChange={shell.setWorkspace} />
      <section className="adaptive-workspace" data-workspace={shell.workspace} aria-label={`${shell.workspace} workspace`}>
        <div className="workspace-context" aria-live="polite">
          <span>{shell.workspace}</span>
          <p>{workspaceDescription}</p>
        </div>
        <ResizablePane
          id="artifacts"
          label={upperPane.label}
          direction="vertical"
          side="start"
          size={panels.artifacts.size}
          collapsed={panels.artifacts.collapsed}
          minSize={shellPanelLimits.artifacts.min}
          maxSize={shellPanelLimits.artifacts.max}
          onResize={(size) => shell.setPanelSize("artifacts", size)}
          onToggle={() => shell.togglePanel("artifacts")}
        >
          {upperPane.content}
        </ResizablePane>
        <div className="adaptive-workspace-main">
          <ResizablePane
            id="tools"
            label="Build tools"
            size={panels.tools.size}
            collapsed={panels.tools.collapsed}
            side="start"
            minSize={shellPanelLimits.tools.min}
            maxSize={shellPanelLimits.tools.max}
            onResize={(size) => shell.setPanelSize("tools", size)}
            onToggle={() => shell.togglePanel("tools")}
          >
            {tools}
          </ResizablePane>
          <section className="document-canvas canvas-dominant" data-testid="document-canvas" aria-label="Document canvas">
            {canvas}
          </section>
          <ResizablePane
            id="inspector"
            label="Project lens"
            size={panels.inspector.size}
            collapsed={panels.inspector.collapsed}
            minSize={shellPanelLimits.inspector.min}
            maxSize={shellPanelLimits.inspector.max}
            onResize={(size) => shell.setPanelSize("inspector", size)}
            onToggle={() => shell.togglePanel("inspector")}
          >
            {inspector ?? <div className="shell-lens">
              <PanelRight size={16} aria-hidden="true" />
              <strong>{shell.workspace === "focus" ? "Focus lens" : "Project lens"}</strong>
              <p>{references.length === 0 ? "No linked reference attention." : `${references.length} linked reference${references.length === 1 ? "" : "s"} in this document.`}</p>
              <button type="button" onClick={() => shell.setWorkspace("focus")}>Focus canvas</button>
            </div>}
          </ResizablePane>
        </div>
        <ResizablePane
          id="runs"
          label="Run desk"
          direction="vertical"
          side="end"
          size={panels.runs.size}
          collapsed={panels.runs.collapsed}
          minSize={shellPanelLimits.runs.min}
          maxSize={shellPanelLimits.runs.max}
          onResize={(size) => shell.setPanelSize("runs", size)}
          onToggle={() => shell.togglePanel("runs")}
        >
          {shell.workspace === "run" ? jobCenter : <div className="shell-run-desk">
            <Activity size={16} aria-hidden="true" />
            <div><strong>Run desk</strong><p>Execution stays local to this portable Ether document.</p></div>
            <Boxes size={16} aria-hidden="true" />
            <span>{references.some((reference) => reference.state === "missing") ? "Attention required" : "No active work"}</span>
            <Sparkles size={15} aria-hidden="true" />
          </div>}
        </ResizablePane>
      </section>
      {status}
      {children}
    </main>
  );
}

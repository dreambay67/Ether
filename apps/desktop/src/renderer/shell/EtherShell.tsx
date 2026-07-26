import { lazy, Suspense, type CSSProperties, type DragEventHandler, type ReactNode } from "react";
import { Activity, Boxes, PanelRight, Sparkles } from "lucide-react";

import type { DesktopReference } from "../../shared/ipc/contracts";
import { ResizablePane } from "./ResizablePane";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { shellPanelLimitsFor, useShellPanels } from "./useShellPanels";

const ArtifactBrowser = lazy(async () => ({ default: (await import("../artifacts/ArtifactBrowser")).ArtifactBrowser }));

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
  const panelLimits = (panel: "tools" | "inspector" | "artifacts" | "runs") => shellPanelLimitsFor(shell.workspace, panel);
  const workspaceDescription = {
    build: "Arrange your graph and source material.",
    focus: "Keep the canvas clear for composition.",
    run: "Follow execution work and output readiness.",
    review: "Compare embedded artifacts and project attention."
  }[shell.workspace];
  const applicationAvailable = typeof window.ether.application?.onEvent === "function";
  const artifactObservatory = applicationAvailable
    ? <Suspense fallback={<p>Loading Artifact Observatory…</p>}><ArtifactBrowser key={`${documentId}:${artifactRevision}`} documentId={documentId} /></Suspense>
    : canvas;
  const upperPane = shell.workspace === "build"
    ? { label: "Reference Desk", content: referenceDesk }
    : shell.workspace === "run"
      ? { label: "Batch Matrix", content: batchMatrix }
      : shell.workspace === "review"
        ? { label: "Review focus", content: <div className="review-focus-brief"><Sparkles size={16} /><strong>Artifact decisions are centered below.</strong><p>Expand this desk only when you want more vertical review context.</p></div> }
        : { label: "Live output", content: applicationAvailable ? <Suspense fallback={<p>Loading live output…</p>}><ArtifactBrowser key={`${documentId}:${artifactRevision}`} documentId={documentId} /></Suspense> : <p>Live output is unavailable in this compatibility session.</p> };
  const upperPaneLimit = shell.workspace === "run" ? "16vh" : "24vh";
  const runPaneLimit = shell.workspace === "run" ? "35vh" : "24vh";

  return (
    <main className="ether-shell task-nine-shell task-fifteen-shell" aria-label="Ether desktop workspace" onDragOver={onDragOver} onDrop={onDrop}>
      {header(!panels.artifacts.collapsed, () => shell.togglePanel("artifacts"))}
      <WorkspaceSwitcher active={shell.workspace} onChange={shell.setWorkspace} />
      <section
        className="adaptive-workspace"
        data-workspace={shell.workspace}
        aria-label={`${shell.workspace} workspace`}
        style={{
          gridTemplateRows: `24px ${panels.artifacts.collapsed ? "32px" : `min(${panels.artifacts.size}px, ${upperPaneLimit})`} minmax(0, 1fr) ${panels.runs.collapsed ? "32px" : `min(${panels.runs.size}px, ${runPaneLimit})`}`
        } as CSSProperties}
      >
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
          minSize={panelLimits("artifacts").min}
          maxSize={panelLimits("artifacts").max}
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
            minSize={panelLimits("tools").min}
            maxSize={panelLimits("tools").max}
            onResize={(size) => shell.setPanelSize("tools", size)}
            onToggle={() => shell.togglePanel("tools")}
          >
            {tools}
          </ResizablePane>
          <section className="document-canvas canvas-dominant" data-testid="document-canvas" aria-label="Document canvas">
            {shell.workspace === "review" ? artifactObservatory : canvas}
          </section>
          <ResizablePane
            id="inspector"
            label="Project lens"
            size={panels.inspector.size}
            collapsed={panels.inspector.collapsed}
            minSize={panelLimits("inspector").min}
            maxSize={panelLimits("inspector").max}
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
          minSize={panelLimits("runs").min}
          maxSize={panelLimits("runs").max}
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

import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import {
  Activity,
  Command,
  Eye,
  EyeOff,
  Images,
  PanelLeft,
  PanelRight,
  RotateCcw,
  Save,
  ShieldCheck
} from "lucide-react";
import etherLogo from "../../../../../packages/brand/src/assets/Ether_logo.png";

type ProjectHeaderProps = {
  projectName: string;
  projectPath: string;
  saveMessage: string;
  providerMessage: string;
  healthIssueCount: number;
  healthStatus: "unknown" | "checking" | "clear" | "warning" | "error";
  healthMessage: string;
  showProjectTools: boolean;
  showHealthPanel: boolean;
  showTraceTools: boolean;
  showArtifactBrowser: boolean;
  onSave(): void;
  onLoadGraph(): void;
  onHealthCheck(): void;
  onProviderCheck(): void;
  onCommandPalette(): void;
  onToggleProjectTools(): void;
  onToggleTraceTools(): void;
  onToggleArtifactBrowser(): void;
  onHideHeader(): void;
  onResizeStart(event: ReactPointerEvent<HTMLDivElement>): void;
  onResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void;
  resizeMin: number;
  resizeMax: number;
  resizeValue: number;
  style?: CSSProperties;
};

export function ProjectHeader({
  projectName,
  projectPath,
  saveMessage,
  providerMessage,
  healthIssueCount,
  healthStatus,
  healthMessage,
  showProjectTools,
  showHealthPanel,
  showTraceTools,
  showArtifactBrowser,
  onSave,
  onLoadGraph,
  onHealthCheck,
  onProviderCheck,
  onCommandPalette,
  onToggleProjectTools,
  onToggleTraceTools,
  onToggleArtifactBrowser,
  onHideHeader,
  onResizeStart,
  onResizeKeyDown,
  resizeMin,
  resizeMax,
  resizeValue,
  style
}: ProjectHeaderProps) {
  return (
    <header className="project-header" data-testid="project-header" style={style}>
      <div className="project-header-brand">
        <img src={etherLogo} alt="Ether logo" className="ether-logo compact-logo" />
        <div>
          <p>ETHER</p>
          <h1 title={projectPath}>{projectName}</h1>
        </div>
      </div>

      <div className="project-header-state" aria-live="polite">
        <span>{saveMessage}</span>
        <em>{providerMessage}</em>
        <small className={`project-header-health health-${healthStatus}`}>
          Health: {healthStatusLabel(healthStatus, healthIssueCount, healthMessage)}
        </small>
      </div>

      <div className="project-header-actions" aria-label="Project commands">
        <button type="button" onClick={onCommandPalette} title="Open command palette">
          <Command size={15} aria-hidden="true" />
          Command Palette
        </button>
        <button
          type="button"
          onClick={onHealthCheck}
          title={showHealthPanel ? "Refresh project health" : "Open project health"}
          aria-pressed={showHealthPanel}
        >
          <Activity size={15} aria-hidden="true" />
          Check Health
          {healthIssueCount > 0 ? (
            <span className={`header-health-badge health-${healthStatus}`} aria-hidden="true">
              {healthIssueCount}
            </span>
          ) : null}
        </button>
        <button type="button" onClick={onProviderCheck} title="Open provider diagnostics and refresh real/simulation provider readiness">
          <ShieldCheck size={15} aria-hidden="true" />
          Providers
        </button>
        <button type="button" onClick={onSave} title="Save graph (Ctrl+S)">
          <Save size={15} aria-hidden="true" />
          Save Graph
        </button>
        <button type="button" onClick={onLoadGraph} title="Reload the saved graph from this local project bundle">
          <RotateCcw size={15} aria-hidden="true" />
          Load Graph
        </button>
        <button
          type="button"
          onClick={onToggleProjectTools}
          title={showProjectTools ? "Hide provider tools" : "Show provider tools"}
        >
          {showProjectTools ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
          <PanelLeft size={15} aria-hidden="true" />
          Tools
        </button>
        <button
          type="button"
          onClick={onToggleTraceTools}
          title={showTraceTools ? "Hide run trace" : "Show run trace"}
        >
          {showTraceTools ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
          <PanelRight size={15} aria-hidden="true" />
          Trace
        </button>
        <button
          type="button"
          onClick={onToggleArtifactBrowser}
          title={showArtifactBrowser ? "Hide artifacts" : "Show artifacts"}
        >
          {showArtifactBrowser ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
          <Images size={15} aria-hidden="true" />
          Artifacts
        </button>
        <button type="button" onClick={onHideHeader} title="Hide top toolbox" data-testid="panel-project-header-toggle">
          <EyeOff size={15} aria-hidden="true" />
          Hide Top
        </button>
      </div>
      <div
        className="panel-resize-handle panel-resize-handle-bottom"
        role="separator"
        aria-label="Resize top toolbox"
        aria-orientation="horizontal"
        aria-valuemin={resizeMin}
        aria-valuemax={Math.round(resizeMax)}
        aria-valuenow={Math.round(resizeValue)}
        data-testid="project-header-resize"
        tabIndex={0}
        title="Drag to resize top toolbox"
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKeyDown}
      />
    </header>
  );
}

function healthStatusLabel(
  status: ProjectHeaderProps["healthStatus"],
  issueCount: number,
  healthMessage: string
) {
  if (status === "checking") {
    return "checking";
  }

  if (status === "unknown") {
    return healthMessage;
  }

  if (status === "clear") {
    return "clear";
  }

  return `${issueCount} issue${issueCount === 1 ? "" : "s"}`;
}

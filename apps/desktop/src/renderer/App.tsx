import { type PointerEvent as ReactPointerEvent, type ReactNode, useRef, useState } from "react";
import { brandTokens } from "@ether/brand";
import etherLogo from "../../../../packages/brand/src/assets/Ether_logo.png";
import dreamBayLogo from "../../../../packages/brand/src/assets/DB_logo.png";

type PanelPosition = {
  x: number;
  y: number;
};

type FloatingPanelProps = {
  id: string;
  title: string;
  kicker: string;
  className: string;
  initialPosition: PanelPosition;
  children: ReactNode;
};

const operationalSignals = [
  { label: "selection", className: "signal signal-selection" },
  { label: "generation", className: "signal signal-generation" },
  { label: "refinement", className: "signal signal-refinement" }
];

function FloatingPanel({
  id,
  title,
  kicker,
  className,
  initialPosition,
  children
}: FloatingPanelProps) {
  const [position, setPosition] = useState(initialPosition);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !panelRef.current?.parentElement) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    const panel = panelRef.current;
    const surface = panel.parentElement;
    const panelBounds = panel.getBoundingClientRect();
    const surfaceBounds = surface.getBoundingClientRect();
    const offsetX = event.clientX - panelBounds.left;
    const offsetY = event.clientY - panelBounds.top;

    const movePanel = (moveEvent: PointerEvent) => {
      const nextX = moveEvent.clientX - surfaceBounds.left - offsetX;
      const nextY = moveEvent.clientY - surfaceBounds.top - offsetY;
      const maxX = Math.max(0, surfaceBounds.width - panel.offsetWidth);
      const maxY = Math.max(0, surfaceBounds.height - panel.offsetHeight);

      setPosition({
        x: Math.min(Math.max(0, nextX), maxX),
        y: Math.min(Math.max(0, nextY), maxY)
      });
    };

    const stopDrag = () => {
      window.removeEventListener("pointermove", movePanel);
      window.removeEventListener("pointerup", stopDrag);
    };

    window.addEventListener("pointermove", movePanel);
    window.addEventListener("pointerup", stopDrag);
  };

  return (
    <aside
      ref={panelRef}
      className={`floating-panel shell-panel ${className}${isCollapsed ? " is-collapsed" : ""}`}
      aria-label={title}
      data-testid={`panel-${id}`}
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      <div
        className="panel-titlebar"
        data-testid={`panel-${id}-drag`}
        onPointerDown={startDrag}
        aria-label={`Move ${title}`}
      >
        <div className="panel-handle" aria-hidden="true" />
        <div className="panel-title">
          <p className="panel-kicker">{kicker}</p>
          <h2>{title}</h2>
        </div>
      </div>
      <button
        className="panel-collapse"
        type="button"
        aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${title}`}
        aria-expanded={!isCollapsed}
        onClick={() => setIsCollapsed((current) => !current)}
      >
        {isCollapsed ? "+" : "-"}
      </button>
      <div className="panel-body" aria-hidden={isCollapsed}>
        {children}
      </div>
    </aside>
  );
}

export function App() {
  return (
    <main className="ether-shell" aria-label="Ether desktop shell">
      <header className="brand-strip">
        <div className="brand-mark">
          <img src={etherLogo} alt="Ether logo" className="ether-logo" />
          <div>
            <h1>ETHER</h1>
            <p>by DreamBay</p>
          </div>
        </div>
        <div className="provider-status" aria-label="Provider status">
          <span className="status-dot" />
          Providers offline
        </div>
      </header>

      <section className="workspace" aria-label={`${brandTokens.lockup} workspace`}>
        <section className="canvas-stage" aria-label="Canvas">
          <div className="air-field" aria-hidden="true">
            <div className="pressure-ring ring-one" />
            <div className="pressure-ring ring-two" />
            <div className="mask-flow" />
            {operationalSignals.map((signal) => (
              <span key={signal.label} className={signal.className} aria-hidden="true" />
            ))}
          </div>
          <div className="canvas-label">
            <p>Operational canvas</p>
            <h2>Canvas</h2>
          </div>
        </section>

        <FloatingPanel
          id="node-library"
          title="Node Library"
          kicker="Input"
          className="node-library"
          initialPosition={{ x: 0, y: 0 }}
        >
          <div className="panel-placeholder">Prompt, reference, generate, evaluate</div>
        </FloatingPanel>

        <FloatingPanel
          id="inspector"
          title="Inspector"
          kicker="State"
          className="inspector"
          initialPosition={{ x: 878, y: 0 }}
        >
          <div className="panel-placeholder">Selection, confidence, lineage</div>
        </FloatingPanel>

        <FloatingPanel
          id="run-trace"
          title="Run Trace"
          kicker="Trace"
          className="run-trace"
          initialPosition={{ x: 284, y: 574 }}
        >
          <div className="trace-content">
            <div className="trace-brand">
              <img src={dreamBayLogo} alt="DreamBay logo" className="dreambay-logo" />
              <span>Inherited highlight</span>
            </div>
            <p>No executions yet. Provider integrations are intentionally offline in this shell.</p>
          </div>
        </FloatingPanel>
      </section>
    </main>
  );
}

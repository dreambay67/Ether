import { brandTokens } from "@ether/brand";
import etherLogo from "../../../../packages/brand/src/assets/Ether_logo.png";
import dreamBayLogo from "../../../../packages/brand/src/assets/DB_logo.png";

const operationalSignals = [
  { label: "selection", className: "signal signal-selection" },
  { label: "generation", className: "signal signal-generation" },
  { label: "refinement", className: "signal signal-refinement" }
];

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
        <aside className="floating-panel node-library" aria-label="Node Library">
          <div className="panel-handle" />
          <p className="panel-kicker">Input</p>
          <h2>Node Library</h2>
          <div className="panel-placeholder">Prompt, reference, generate, evaluate</div>
        </aside>

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

        <aside className="floating-panel inspector" aria-label="Inspector">
          <div className="panel-handle" />
          <p className="panel-kicker">State</p>
          <h2>Inspector</h2>
          <div className="panel-placeholder">Selection, confidence, lineage</div>
        </aside>
      </section>

      <footer className="run-trace floating-panel" aria-label="Run Trace">
        <div className="trace-brand">
          <img src={dreamBayLogo} alt="DreamBay logo" className="dreambay-logo" />
          <span>Inherited highlight</span>
        </div>
        <h2>Run Trace</h2>
        <p>No executions yet. Provider integrations are intentionally offline in this shell.</p>
      </footer>
    </main>
  );
}

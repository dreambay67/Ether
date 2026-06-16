import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
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
  initialPlacement: PanelPosition;
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
  initialPlacement,
  children
}: FloatingPanelProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isCollapsed, setIsCollapsed] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  const clampPosition = useCallback((nextPosition: PanelPosition) => {
    const panel = panelRef.current;
    const surface = panel?.parentElement;

    if (!panel || !surface) {
      return nextPosition;
    }

    const maxX = Math.max(0, surface.clientWidth - panel.offsetWidth);
    const maxY = Math.max(0, surface.clientHeight - panel.offsetHeight);

    return {
      x: Math.min(Math.max(0, nextPosition.x), maxX),
      y: Math.min(Math.max(0, nextPosition.y), maxY)
    };
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    const surface = panel?.parentElement;

    if (!panel || !surface) {
      return;
    }

    const placePanel = () => {
      setPosition(
        clampPosition({
          x: surface.clientWidth * initialPlacement.x - panel.offsetWidth * initialPlacement.x,
          y: surface.clientHeight * initialPlacement.y - panel.offsetHeight * initialPlacement.y
        })
      );
    };

    placePanel();
  }, [clampPosition, initialPlacement.x, initialPlacement.y]);

  useEffect(() => {
    const panel = panelRef.current;
    const surface = panel?.parentElement;

    if (!panel || !surface) {
      return;
    }

    const reclamp = () => {
      setPosition((current) => clampPosition(current));
    };

    const resizeObserver = new ResizeObserver(reclamp);
    resizeObserver.observe(surface);
    resizeObserver.observe(panel);
    window.addEventListener("resize", reclamp);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", reclamp);
    };
  }, [clampPosition]);

  useEffect(() => {
    return () => {
      cleanupDragRef.current?.();
    };
  }, []);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !panelRef.current?.parentElement) {
      return;
    }

    cleanupDragRef.current?.();
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

      setPosition(clampPosition({ x: nextX, y: nextY }));
    };

    const stopDrag = () => {
      window.removeEventListener("pointermove", movePanel);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
      cleanupDragRef.current = null;
    };

    cleanupDragRef.current = stopDrag;
    window.addEventListener("pointermove", movePanel);
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
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
  const [parentDirectory, setParentDirectory] = useState("");
  const [projectName, setProjectName] = useState("Untitled Ether Project");
  const [projectPath, setProjectPath] = useState("");
  const [currentProject, setCurrentProject] = useState<{
    id: string;
    name: string;
    path: string;
    updatedAt: string;
  } | null>(null);
  const [projectMessage, setProjectMessage] = useState("No project open");

  const setProjectFromResult = (result: Awaited<ReturnType<typeof window.ether.project.open>>) => {
    setCurrentProject({
      id: result.projectId,
      name: result.metadata.displayName,
      path: result.path,
      updatedAt: result.metadata.updatedAt
    });
    setProjectPath(result.path);
  };

  const createLocalProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProjectMessage("Creating project...");

    try {
      const project = await window.ether.project.create({ parentDirectory, name: projectName });
      setProjectFromResult(project);
      setProjectMessage("Project created");
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "Project creation failed");
    }
  };

  const openLocalProject = async () => {
    setProjectMessage("Opening project...");

    try {
      const project = await window.ether.project.open(projectPath);
      setProjectFromResult(project);
      setProjectMessage("Project opened");
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "Project open failed");
    }
  };

  const saveCurrentGraph = async () => {
    if (!currentProject) {
      setProjectMessage("Open a project before saving graph state");
      return;
    }

    try {
      const graph = await window.ether.project.saveGraph(currentProject.id, {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        selectedSnapshotId: null,
        updatedAt: new Date().toISOString()
      });

      setCurrentProject((project) =>
        project ? { ...project, updatedAt: graph.updatedAt } : project
      );
      setProjectMessage("Graph saved");
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "Graph save failed");
    }
  };

  const checkProjectHealth = async () => {
    if (!currentProject) {
      setProjectMessage("Open a project before running health check");
      return;
    }

    try {
      const health = await window.ether.project.health(currentProject.id);
      setProjectMessage(
        health.issues.length === 0
          ? "Health check clear"
          : `${health.issues.length} health issue${health.issues.length === 1 ? "" : "s"} found`
      );
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "Health check failed");
    }
  };

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

      <section className="project-strip" aria-label="Project controls">
        <form className="project-form" onSubmit={createLocalProject}>
          <label>
            Parent directory
            <input
              value={parentDirectory}
              onChange={(event) => setParentDirectory(event.target.value)}
              placeholder="C:\\Users\\you\\Documents"
            />
          </label>
          <label>
            Project name
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Campaign Exploration"
            />
          </label>
          <button type="submit">Create</button>
        </form>
        <div className="project-open">
          <label>
            Project path
            <input
              value={projectPath}
              onChange={(event) => setProjectPath(event.target.value)}
              placeholder="C:\\Projects\\Campaign.ether"
            />
          </label>
          <button type="button" onClick={openLocalProject}>
            Open
          </button>
          <button type="button" onClick={saveCurrentGraph}>
            Save Graph
          </button>
          <button type="button" onClick={checkProjectHealth}>
            Health
          </button>
        </div>
        <div className="project-status" aria-live="polite">
          <strong>{currentProject?.name ?? "No project"}</strong>
          <span>{currentProject?.path ?? "Create or open a local project bundle"}</span>
          <em>{projectMessage}</em>
        </div>
      </section>

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
          initialPlacement={{ x: 0, y: 0 }}
        >
          <div className="panel-placeholder">Prompt, reference, generate, evaluate</div>
        </FloatingPanel>

        <FloatingPanel
          id="inspector"
          title="Inspector"
          kicker="State"
          className="inspector"
          initialPlacement={{ x: 1, y: 0 }}
        >
          <div className="panel-placeholder">Selection, confidence, lineage</div>
        </FloatingPanel>

        <FloatingPanel
          id="run-trace"
          title="Run Trace"
          kicker="Trace"
          className="run-trace"
          initialPlacement={{ x: 0.5, y: 1 }}
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

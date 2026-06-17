import "@xyflow/react/dist/style.css";
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
import type { EtherGraph } from "@ether/engine";
import type { DesktopSettings } from "./ether-env";
import etherLogo from "../../../../packages/brand/src/assets/Ether_logo.png";
import { EtherCanvasWithProvider, type EtherCanvasHandle } from "./canvas/EtherCanvas";
import { RunTracePanel } from "./canvas/RunTracePanel";

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

    setPosition(
      clampPosition({
        x: surface.clientWidth * initialPlacement.x - panel.offsetWidth * initialPlacement.x,
        y: surface.clientHeight * initialPlacement.y - panel.offsetHeight * initialPlacement.y
      })
    );
  }, [clampPosition, initialPlacement.x, initialPlacement.y]);

  useEffect(() => {
    const panel = panelRef.current;
    const surface = panel?.parentElement;

    if (!panel || !surface) {
      return;
    }

    const reclamp = () => setPosition((current) => clampPosition(current));
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
    return () => cleanupDragRef.current?.();
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
      setPosition(
        clampPosition({
          x: moveEvent.clientX - surfaceBounds.left - offsetX,
          y: moveEvent.clientY - surfaceBounds.top - offsetY
        })
      );
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
  const canvasRef = useRef<EtherCanvasHandle>(null);
  const settingsReadyRef = useRef(false);
  const settingsSaveInFlightRef = useRef(false);
  const pendingSettingsRef = useRef<DesktopSettings | null>(null);
  const [parentDirectory, setParentDirectory] = useState("");
  const [projectName, setProjectName] = useState("Untitled Ether Project");
  const [projectPath, setProjectPath] = useState("");
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [activeGraph, setActiveGraph] = useState<EtherGraph | null>(null);
  const [traceEntries, setTraceEntries] = useState<string[]>([]);
  const [currentProject, setCurrentProject] = useState<{
    id: string;
    name: string;
    path: string;
    updatedAt: string;
  } | null>(null);
  const [projectMessage, setProjectMessage] = useState("No project open");
  const [providerMessage, setProviderMessage] = useState("Fake ready; Nano unavailable");

  const appendTrace = useCallback((message: string) => {
    setTraceEntries((entries) => [message, ...entries].slice(0, 12));
  }, []);

  const setProjectFromResult = (result: Awaited<ReturnType<typeof window.ether.project.open>>) => {
    setCurrentProject({
      id: result.projectId,
      name: result.metadata.displayName,
      path: result.path,
      updatedAt: result.metadata.updatedAt
    });
    setProjectPath(result.path);
    setRecentProjects((projects) => uniqueProjectPaths([result.path, ...projects]));
    setActiveGraph(result.graph);
  };

  const flushSettingsSaveQueue = useCallback(() => {
    if (settingsSaveInFlightRef.current || !pendingSettingsRef.current || !window.ether?.settings?.save) {
      return;
    }

    const settings = pendingSettingsRef.current;
    pendingSettingsRef.current = null;
    settingsSaveInFlightRef.current = true;

    void window.ether.settings.save(settings)
      .catch(() => undefined)
      .finally(() => {
        settingsSaveInFlightRef.current = false;
        flushSettingsSaveQueue();
      });
  }, []);

  useEffect(() => {
    let cancelled = false;

    window.ether?.provider?.diagnostics()
      .then((diagnostics) => {
        if (!cancelled) {
          setProviderMessage(formatProviderDiagnostics(diagnostics));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProviderMessage("Fake ready; Nano unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    window.ether?.settings?.load()
      .then((settings) => {
        if (cancelled) {
          return;
        }

        setParentDirectory(settings.parentDirectory);
        setProjectName(settings.projectName);
        setProjectPath(settings.projectPath);
        setRecentProjects(settings.recentProjects);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          settingsReadyRef.current = true;
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsReadyRef.current || !window.ether?.settings?.save) {
      return;
    }

    const settings: DesktopSettings = {
      parentDirectory,
      projectName,
      projectPath,
      recentProjects: uniqueProjectPaths([projectPath, ...recentProjects])
    };

    pendingSettingsRef.current = settings;
    flushSettingsSaveQueue();
  }, [flushSettingsSaveQueue, parentDirectory, projectName, projectPath, recentProjects]);

  const createLocalProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProjectMessage("Creating project...");

    try {
      const project = await window.ether.project.create({ parentDirectory, name: projectName });
      setProjectFromResult(project);
      setProjectMessage("Project created");
      appendTrace("Project created");
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
      appendTrace("Graph hydrated from project");
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "Project open failed");
    }
  };

  const loadCurrentGraph = async () => {
    if (!currentProject) {
      setProjectMessage("Open a project before loading graph state");
      return;
    }

    try {
      const graph = await window.ether.project.loadGraph(currentProject.id);
      setActiveGraph(graph);
      setProjectMessage("Graph loaded");
      appendTrace("Graph loaded");
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "Graph load failed");
    }
  };

  const saveCurrentGraph = async () => {
    if (!currentProject) {
      setProjectMessage("Open a project before saving graph state");
      return;
    }

    try {
      const graph = await window.ether.project.saveGraph(currentProject.id, canvasRef.current!.serialize());
      setCurrentProject((project) =>
        project ? { ...project, updatedAt: graph.updatedAt } : project
      );
      setProjectMessage("Graph saved");
      appendTrace("Graph saved");
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
      appendTrace("Health check complete");
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
          {providerMessage}
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
          <button type="button" onClick={loadCurrentGraph}>
            Load Graph
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
          <EtherCanvasWithProvider
            canvasRef={canvasRef}
            graph={activeGraph}
            projectId={currentProject?.id ?? null}
            onStatus={setProjectMessage}
            onTrace={appendTrace}
          />
        </section>

        <FloatingPanel
          id="run-trace"
          title="Run Trace"
          kicker="Trace"
          className="run-trace"
          initialPlacement={{ x: 0.5, y: 1 }}
        >
          <RunTracePanel entries={traceEntries} queueCount={traceEntries.length} />
        </FloatingPanel>
      </section>
    </main>
  );
}

function formatProviderDiagnostics(diagnostics: Awaited<ReturnType<NonNullable<typeof window.ether.provider>["diagnostics"]>>) {
  const fake = diagnostics.providers.find((provider) => provider.id === "ether-fake-local");
  const codex = diagnostics.providers.find((provider) => provider.id === "codex-chatgpt-image-2");
  const nanoUnavailable = diagnostics.providers.filter(
    (provider) => provider.id.startsWith("google-nano-banana") && provider.availability === "unavailable"
  ).length;
  const fakeText = fake?.availability === "available" ? "Fake ready" : "Fake unavailable";
  const codexText = codex?.availability === "available" ? "Codex ready" : "Codex unavailable";

  return `${fakeText}; ${codexText}; Nano unavailable (${nanoUnavailable})`;
}

function uniqueProjectPaths(projects: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const project of projects) {
    const value = project.trim();
    const key = value.toLowerCase();

    if (!value || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result.slice(0, 12);
}

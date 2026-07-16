import "@xyflow/react/dist/style.css";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { Eye, EyeOff } from "lucide-react";
import { brandTokens } from "@ether/brand";
import type { EtherGraph, HealthIssue } from "@ether/engine";
import type { DesktopSettings, ProjectSession, ProviderDiagnostics } from "./ether-env";
import { ArtifactBrowser } from "./artifacts/ArtifactBrowser";
import { EtherCanvasWithProvider, type EtherCanvasHandle } from "./canvas/EtherCanvas";
import { RunTracePanel } from "./canvas/RunTracePanel";
import { ProjectHealthPanel } from "./project/ProjectHealthPanel";
import { ProjectHeader } from "./project/ProjectHeader";
import { ProviderStatusPanel } from "./project/ProviderStatusPanel";
import { StartScreen } from "./project/StartScreen";

type PanelPosition = {
  x: number;
  y: number;
};

const PROJECT_HEADER_DEFAULT_HEIGHT = 76;
const PROJECT_HEADER_MIN_HEIGHT = 58;
const PROJECT_HEADER_MAX_HEIGHT = 220;
const PROJECT_HEADER_MAX_VIEWPORT_RATIO = 0.32;
const RUN_TRACE_DEFAULT_HEIGHT = 118;
const RUN_TRACE_MIN_HEIGHT = 98;
const RUN_TRACE_MAX_HEIGHT = 380;
const RUN_TRACE_MAX_VIEWPORT_RATIO = 0.56;
const PANEL_KEYBOARD_RESIZE_STEP = 10;

function clampPanelHeight(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function panelMaxHeight(limit: number, viewportRatio: number) {
  return Math.min(limit, Math.max(0, window.innerHeight * viewportRatio));
}

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
  const [showProjectTools, setShowProjectTools] = useState(false);
  const [showHealthPanel, setShowHealthPanel] = useState(false);
  const [showProjectHeader, setShowProjectHeader] = useState(true);
  const [showTraceTools, setShowTraceTools] = useState(true);
  const [projectHeaderHeight, setProjectHeaderHeight] = useState(PROJECT_HEADER_DEFAULT_HEIGHT);
  const [runTraceHeight, setRunTraceHeight] = useState(RUN_TRACE_DEFAULT_HEIGHT);
  const projectHeaderResizeCleanupRef = useRef<(() => void) | null>(null);
  const runTraceResizeCleanupRef = useRef<(() => void) | null>(null);
  const [showArtifactBrowser, setShowArtifactBrowser] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [providerDiagnostics, setProviderDiagnostics] = useState<ProviderDiagnostics | null>(null);
  const [isProviderChecking, setIsProviderChecking] = useState(false);
  const [healthIssues, setHealthIssues] = useState<HealthIssue[]>([]);
  const [healthMessage, setHealthMessage] = useState("Health not checked");
  const [isHealthChecking, setIsHealthChecking] = useState(false);
  const [currentProject, setCurrentProject] = useState<{
    id: string;
    name: string;
    path: string;
    updatedAt: string;
  } | null>(null);
  const [projectMessage, setProjectMessage] = useState("No project open");
  const [providerMessage, setProviderMessage] = useState(
    "Simulation Mode ready; API disabled; Nano experimental unavailable"
  );

  const appendTrace = useCallback((message: string) => {
    setTraceEntries((entries) => [message, ...entries].slice(0, 12));
  }, []);

  const focusCanvasNode = useCallback((nodeId: string) => {
    canvasRef.current?.focusNode(nodeId);
  }, []);

  useEffect(() => {
    const clampVisiblePanels = () => {
      setProjectHeaderHeight((height) =>
        clampPanelHeight(
          height,
          PROJECT_HEADER_MIN_HEIGHT,
          panelMaxHeight(PROJECT_HEADER_MAX_HEIGHT, PROJECT_HEADER_MAX_VIEWPORT_RATIO)
        )
      );
      setRunTraceHeight((height) =>
        clampPanelHeight(
          height,
          RUN_TRACE_MIN_HEIGHT,
          panelMaxHeight(RUN_TRACE_MAX_HEIGHT, RUN_TRACE_MAX_VIEWPORT_RATIO)
        )
      );
    };

    window.addEventListener("resize", clampVisiblePanels);
    return () => window.removeEventListener("resize", clampVisiblePanels);
  }, []);

  useEffect(() => {
    return () => {
      projectHeaderResizeCleanupRef.current?.();
      runTraceResizeCleanupRef.current?.();
    };
  }, []);

  const resizeProjectHeaderTo = useCallback((height: number) => {
    setProjectHeaderHeight(
      clampPanelHeight(
        height,
        PROJECT_HEADER_MIN_HEIGHT,
        panelMaxHeight(PROJECT_HEADER_MAX_HEIGHT, PROJECT_HEADER_MAX_VIEWPORT_RATIO)
      )
    );
  }, []);

  const resizeRunTraceTo = useCallback((height: number) => {
    setRunTraceHeight(
      clampPanelHeight(
        height,
        RUN_TRACE_MIN_HEIGHT,
        panelMaxHeight(RUN_TRACE_MAX_HEIGHT, RUN_TRACE_MAX_VIEWPORT_RATIO)
      )
    );
  }, []);

  const startProjectHeaderResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      projectHeaderResizeCleanupRef.current?.();
      const activePointerId = event.pointerId;
      const handle = event.currentTarget;
      const startY = event.clientY;
      const startHeight = projectHeaderHeight;

      handle.setPointerCapture(activePointerId);

      const resizeHeader = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== activePointerId) {
          return;
        }

        resizeProjectHeaderTo(startHeight + moveEvent.clientY - startY);
      };

      const cleanupResize = () => {
        window.removeEventListener("pointermove", resizeHeader);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
        handle.removeEventListener("lostpointercapture", stopResize);
        if (handle.hasPointerCapture(activePointerId)) {
          handle.releasePointerCapture(activePointerId);
        }
        projectHeaderResizeCleanupRef.current = null;
      };

      const stopResize = (stopEvent: PointerEvent) => {
        if (stopEvent.pointerId !== activePointerId) {
          return;
        }

        cleanupResize();
      };

      projectHeaderResizeCleanupRef.current = cleanupResize;
      window.addEventListener("pointermove", resizeHeader);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
      handle.addEventListener("lostpointercapture", stopResize);
    },
    [projectHeaderHeight, resizeProjectHeaderTo]
  );

  const startRunTraceResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      runTraceResizeCleanupRef.current?.();
      const activePointerId = event.pointerId;
      const handle = event.currentTarget;
      const startY = event.clientY;
      const startHeight = runTraceHeight;

      handle.setPointerCapture(activePointerId);

      const resizeTrace = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== activePointerId) {
          return;
        }

        resizeRunTraceTo(startHeight - (moveEvent.clientY - startY));
      };

      const cleanupResize = () => {
        window.removeEventListener("pointermove", resizeTrace);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
        handle.removeEventListener("lostpointercapture", stopResize);
        if (handle.hasPointerCapture(activePointerId)) {
          handle.releasePointerCapture(activePointerId);
        }
        runTraceResizeCleanupRef.current = null;
      };

      const stopResize = (stopEvent: PointerEvent) => {
        if (stopEvent.pointerId !== activePointerId) {
          return;
        }

        cleanupResize();
      };

      runTraceResizeCleanupRef.current = cleanupResize;
      window.addEventListener("pointermove", resizeTrace);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
      handle.addEventListener("lostpointercapture", stopResize);
    },
    [resizeRunTraceTo, runTraceHeight]
  );

  const handleProjectHeaderResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        resizeProjectHeaderTo(projectHeaderHeight + PANEL_KEYBOARD_RESIZE_STEP);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        resizeProjectHeaderTo(projectHeaderHeight - PANEL_KEYBOARD_RESIZE_STEP);
      } else if (event.key === "Home") {
        event.preventDefault();
        resizeProjectHeaderTo(PROJECT_HEADER_MIN_HEIGHT);
      } else if (event.key === "End") {
        event.preventDefault();
        resizeProjectHeaderTo(PROJECT_HEADER_MAX_HEIGHT);
      }
    },
    [projectHeaderHeight, resizeProjectHeaderTo]
  );

  const handleRunTraceResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        resizeRunTraceTo(runTraceHeight + PANEL_KEYBOARD_RESIZE_STEP);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        resizeRunTraceTo(runTraceHeight - PANEL_KEYBOARD_RESIZE_STEP);
      } else if (event.key === "Home") {
        event.preventDefault();
        resizeRunTraceTo(RUN_TRACE_MIN_HEIGHT);
      } else if (event.key === "End") {
        event.preventDefault();
        resizeRunTraceTo(RUN_TRACE_MAX_HEIGHT);
      }
    },
    [resizeRunTraceTo, runTraceHeight]
  );

  const refreshProviderDiagnostics = useCallback(async () => {
    const providerBridge = window.ether?.provider;

    if (!providerBridge) {
      setProviderMessage("Simulation Mode ready; API disabled; Nano experimental unavailable");
      return;
    }

    setIsProviderChecking(true);

    try {
      const diagnostics = await (providerBridge.health?.() ?? providerBridge.diagnostics());
      setProviderDiagnostics(diagnostics);
      setProviderMessage(formatProviderDiagnostics(diagnostics));
    } catch {
      setProviderMessage("Provider health check unavailable");
    } finally {
      setIsProviderChecking(false);
    }
  }, []);

  const setProjectFromResult = (result: ProjectSession) => {
    setCurrentProject({
      id: result.projectId,
      name: result.metadata.displayName,
      path: result.path,
      updatedAt: result.metadata.updatedAt
    });
    setProjectPath(result.path);
    setRecentProjects((projects) => uniqueProjectPaths([result.path, ...projects]));
    setActiveGraph(result.graph);
    setHealthIssues([]);
    setHealthMessage(
      result.database.healthIssueCount > 0
        ? `${result.database.healthIssueCount} stored health issue${result.database.healthIssueCount === 1 ? "" : "s"}`
        : "Health not checked"
    );
  };

  const resolvedParentDirectory = useCallback(async () => {
    const currentParentDirectory = parentDirectory.trim();

    if (currentParentDirectory) {
      return currentParentDirectory;
    }

    const defaultParentDirectory = window.ether?.project?.defaultParentDirectory;

    if (!defaultParentDirectory) {
      return "";
    }

    try {
      return (await defaultParentDirectory()).trim();
    } catch {
      return "";
    }
  }, [parentDirectory]);

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

    refreshProviderDiagnostics()
      .catch(() => {
        if (!cancelled) {
          setProviderMessage("Provider health check unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshProviderDiagnostics]);

  useEffect(() => {
    let cancelled = false;

    window.ether?.settings?.load()
      .then(async (settings) => {
        if (cancelled) {
          return;
        }

        setParentDirectory(settings.parentDirectory);
        setProjectName(settings.projectName);
        setProjectPath(settings.projectPath);
        setRecentProjects(settings.recentProjects);

        if (!settings.parentDirectory.trim()) {
          const defaultParentDirectory = await window.ether?.project?.defaultParentDirectory?.();

          if (!cancelled && defaultParentDirectory?.trim()) {
            setParentDirectory((currentParentDirectory) =>
              currentParentDirectory.trim() ? currentParentDirectory : defaultParentDirectory.trim()
            );
          }
        }
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

  const chooseParentDirectory = async () => {
    const selectParentDirectory = window.ether?.project?.selectParentDirectory;

    if (!selectParentDirectory) {
      setProjectMessage("Native folder picker is unavailable; using the default project location");
      return;
    }

    try {
      const selectedDirectory = await selectParentDirectory();

      if (selectedDirectory) {
        setParentDirectory(selectedDirectory);
        setProjectMessage("Project location selected");
      }
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "Folder selection failed");
    }
  };

  const createLocalProject = async () => {
    const parent = await resolvedParentDirectory();
    const name = projectName.trim() || "Untitled Ether Project";

    if (!parent) {
      setProjectMessage("Choose a parent folder before creating a project");
      return;
    }

    setProjectMessage("Creating project...");

    try {
      const project = await window.ether.project.create({ parentDirectory: parent, name });
      setParentDirectory(parent);
      setProjectName(name);
      setProjectFromResult(project);
      setProjectMessage("Project created");
      appendTrace("Project created");
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "Project creation failed");
    }
  };

  const openLocalProject = async (projectPathOverride?: string) => {
    let pathToOpen = projectPathOverride?.trim() ?? "";
    setProjectMessage("Opening project...");

    try {
      if (!pathToOpen) {
        const selectedProjectPath = await window.ether.project.selectProjectBundle?.();

        if (!selectedProjectPath) {
          setProjectMessage(
            window.ether.project.selectProjectBundle
              ? "Project open canceled"
              : "Native project picker is unavailable"
          );
          return;
        }

        pathToOpen = selectedProjectPath;
      }

      const project = await window.ether.project.open(pathToOpen);
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
      const graph = await canvasRef.current?.loadProjectGraph();
      if (!graph) {
        setProjectMessage("Canvas is not ready to load graph state");
        return;
      }

      setActiveGraph(graph.graph);
      setProjectMessage("Graph loaded");
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "Graph load failed");
    }
  };

  const saveCurrentGraph = useCallback(async () => {
    if (!currentProject) {
      setProjectMessage("Open a project before saving graph state");
      return;
    }

    try {
      const graph = await canvasRef.current?.saveProjectGraph();
      if (!graph) {
        setProjectMessage("Canvas is not ready to save graph state");
        return;
      }

      if (graph.appliedToCanvas) {
        setActiveGraph(graph.graph);
      }
      setCurrentProject((project) =>
        project ? { ...project, updatedAt: graph.graph.updatedAt } : project
      );
      setProjectMessage("Graph saved");
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "Graph save failed");
    }
  }, [currentProject]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveCurrentGraph();
      }
    };
    const removeMenuSaveListener = window.ether?.menu?.onSave(() => {
      void saveCurrentGraph();
    });

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      removeMenuSaveListener?.();
    };
  }, [saveCurrentGraph]);

  const runProjectHealthCheck = useCallback(async (options: { openPanel?: boolean } = {}) => {
    if (!currentProject) {
      setProjectMessage("Open a project before running health check");
      return null;
    }

    if (options.openPanel) {
      setShowHealthPanel(true);
    }

    setIsHealthChecking(true);

    try {
      const health = await window.ether.project.health(currentProject.id);
      const message = formatHealthMessage(health.issues);
      setHealthIssues(health.issues);
      setHealthMessage(message);
      setProjectMessage(message);
      appendTrace("Health check complete");
      return health;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Health check failed";
      setHealthMessage(message);
      setProjectMessage(message);
      return null;
    } finally {
      setIsHealthChecking(false);
    }
  }, [appendTrace, currentProject]);

  const clearProviderLogs = async () => {
    if (!currentProject) {
      setProjectMessage("Open a project before clearing provider logs");
      return;
    }

    try {
      const result = await window.ether.project.clearProviderLogs(currentProject.id);
      const filePart = result.deletedProviderLogFiles
        ? ` and ${result.deletedProviderLogFiles} file${result.deletedProviderLogFiles === 1 ? "" : "s"}`
        : "";
      setProjectMessage(`Cleared ${result.deletedProviderRuns} provider log record${result.deletedProviderRuns === 1 ? "" : "s"}${filePart}`);
      appendTrace("Provider logs cleared");
      await runProjectHealthCheck({ openPanel: true });
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "Provider log cleanup failed");
    }
  };

  const clearRunArtifacts = async () => {
    if (!currentProject) {
      setProjectMessage("Open a project before clearing run metadata");
      return;
    }

    try {
      const result = await window.ether.project.clearRunArtifacts(currentProject.id);
      const deletedCount =
        result.deletedRunRecords +
        result.deletedRunArtifacts +
        result.deletedArtifactVersions +
        result.deletedAssetOperations +
        result.deletedJobRecords +
        result.deletedJobItems +
        result.deletedJobEvents;
      setProjectMessage(`Cleared ${deletedCount} run metadata record${deletedCount === 1 ? "" : "s"}`);
      appendTrace("Run metadata cleared");
      await runProjectHealthCheck({ openPanel: true });
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "Run metadata cleanup failed");
    }
  };

  const providerPanel = (
    <ProviderStatusPanel
      diagnostics={providerDiagnostics}
      message={providerMessage}
      isChecking={isProviderChecking}
      onHealthCheck={() => void refreshProviderDiagnostics()}
    />
  );
  const projectHeaderMaxHeight = panelMaxHeight(
    PROJECT_HEADER_MAX_HEIGHT,
    PROJECT_HEADER_MAX_VIEWPORT_RATIO
  );
  const runTraceMaxHeight = panelMaxHeight(RUN_TRACE_MAX_HEIGHT, RUN_TRACE_MAX_VIEWPORT_RATIO);

  return (
    <main className="ether-shell" aria-label="Ether desktop shell">
      {!currentProject ? (
        <StartScreen
          projectName={projectName}
          parentDirectory={parentDirectory}
          recentProjects={recentProjects}
          message={projectMessage}
          providerPanel={providerPanel}
          onProjectNameChange={setProjectName}
          onChooseParentDirectory={() => void chooseParentDirectory()}
          onCreateProject={() => void createLocalProject()}
          onOpenProject={() => void openLocalProject()}
          onOpenRecentProject={(recentProjectPath) => void openLocalProject(recentProjectPath)}
          onCheckProviders={() => void refreshProviderDiagnostics()}
        />
      ) : (
        <>
          {showProjectHeader ? (
            <ProjectHeader
              projectName={currentProject.name}
              projectPath={currentProject.path}
              saveMessage={projectMessage}
              providerMessage={providerMessage}
              healthIssueCount={healthIssues.length}
              healthStatus={healthStatusForIssues(healthIssues, isHealthChecking, healthMessage)}
              healthMessage={healthMessage}
              showProjectTools={showProjectTools}
              showHealthPanel={showHealthPanel}
              showTraceTools={showTraceTools}
              showArtifactBrowser={showArtifactBrowser}
              onSave={() => void saveCurrentGraph()}
              onLoadGraph={() => void loadCurrentGraph()}
              onHealthCheck={() => void runProjectHealthCheck({ openPanel: true })}
              onProviderCheck={() => {
                setShowProjectTools(true);
                void refreshProviderDiagnostics();
              }}
              onCommandPalette={() => setShowCommandPalette(true)}
              onToggleProjectTools={() => setShowProjectTools((current) => !current)}
              onToggleTraceTools={() => setShowTraceTools((current) => !current)}
              onToggleArtifactBrowser={() => setShowArtifactBrowser((current) => !current)}
              onHideHeader={() => setShowProjectHeader(false)}
              onResizeStart={startProjectHeaderResize}
              onResizeKeyDown={handleProjectHeaderResizeKeyDown}
              resizeMin={PROJECT_HEADER_MIN_HEIGHT}
              resizeMax={projectHeaderMaxHeight}
              resizeValue={projectHeaderHeight}
              style={{ height: projectHeaderHeight }}
            />
          ) : (
            <button
              type="button"
              className="project-header-restore"
              data-testid="panel-project-header-toggle"
              onClick={() => setShowProjectHeader(true)}
              title="Show top toolbox"
              aria-label="Show top toolbox"
            >
              <Eye size={15} aria-hidden="true" />
              Show Top Bar
            </button>
          )}

          {showHealthPanel ? (
            <ProjectHealthPanel
              issues={healthIssues}
              message={healthMessage}
              isChecking={isHealthChecking}
              onRefresh={() => void runProjectHealthCheck({ openPanel: true })}
              onClose={() => setShowHealthPanel(false)}
              onClearProviderLogs={() => clearProviderLogs()}
              onClearRunArtifacts={() => clearRunArtifacts()}
            />
          ) : null}

          {showProjectTools ? <div className="project-tools-dock">{providerPanel}</div> : null}

          <section
            className="workspace"
            aria-label={`${brandTokens.lockup} workspace`}
            data-testid="canvas-workspace"
          >
            <section className="canvas-stage" aria-label="Canvas">
              <EtherCanvasWithProvider
                canvasRef={canvasRef}
                graph={activeGraph}
                projectId={currentProject.id}
                isCommandPaletteOpen={showCommandPalette}
                onStatus={setProjectMessage}
                onTrace={appendTrace}
                onCloseCommandPalette={() => setShowCommandPalette(false)}
              />
            </section>
          </section>
          {showArtifactBrowser ? (
            <ArtifactBrowser projectId={currentProject.id} onStatus={setProjectMessage} />
          ) : null}
          {showTraceTools ? (
            <section
              className="trace-strip"
              aria-label="Run Trace"
              data-testid="panel-run-trace"
              style={{ height: runTraceHeight }}
            >
              <div
                className="panel-resize-handle panel-resize-handle-top"
                role="separator"
                aria-label="Resize run trace"
                aria-orientation="horizontal"
                aria-valuemin={RUN_TRACE_MIN_HEIGHT}
                aria-valuemax={Math.round(runTraceMaxHeight)}
                aria-valuenow={Math.round(runTraceHeight)}
                data-testid="run-trace-resize"
                tabIndex={0}
                title="Drag to resize run trace"
                onPointerDown={startRunTraceResize}
                onKeyDown={handleRunTraceResizeKeyDown}
              />
              <div className="trace-strip-title">
                <span>Trace</span>
                <strong>Run Trace</strong>
                <button
                  type="button"
                  className="trace-strip-toggle"
                  data-testid="panel-run-trace-toggle"
                  onClick={() => setShowTraceTools(false)}
                  title="Hide run trace"
                  aria-label="Hide run trace"
                >
                  <EyeOff size={14} aria-hidden="true" />
                </button>
              </div>
              <RunTracePanel
                entries={traceEntries}
                queueCount={traceEntries.length}
                projectId={currentProject.id}
                onFocusNode={focusCanvasNode}
              />
            </section>
          ) : (
            <button
              type="button"
              className="trace-strip-restore"
              data-testid="panel-run-trace-toggle"
              onClick={() => setShowTraceTools(true)}
              title="Show run trace"
              aria-label="Show run trace"
            >
              <Eye size={15} aria-hidden="true" />
              Show Trace
            </button>
          )}
        </>
      )}
    </main>
  );
}

function formatHealthMessage(issues: HealthIssue[]) {
  if (issues.length === 0) {
    return "Health check clear";
  }

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  return `${issues.length} health issue${issues.length === 1 ? "" : "s"} found (${errorCount} error${errorCount === 1 ? "" : "s"}, ${warningCount} warning${warningCount === 1 ? "" : "s"})`;
}

function healthStatusForIssues(
  issues: HealthIssue[],
  isChecking: boolean,
  healthMessage: string
): "unknown" | "checking" | "clear" | "warning" | "error" {
  if (isChecking) {
    return "checking";
  }

  if (issues.some((issue) => issue.severity === "error")) {
    return "error";
  }

  if (issues.length > 0) {
    return "warning";
  }

  return healthMessage === "Health check clear" ? "clear" : "unknown";
}

function formatProviderDiagnostics(diagnostics: ProviderDiagnostics) {
  if (diagnostics.matrix?.length) {
    const simulation = diagnostics.matrix.find((provider) => provider.mode === "simulation");
    const codexReady = diagnostics.matrix.filter(
      (provider) => provider.mode === "real" && provider.availability === "available"
    ).length;
    const apiDisabled = diagnostics.matrix.filter(
      (provider) => provider.id.startsWith("api-") && provider.readiness === "disabled"
    ).length;
    const nanoUnavailable = diagnostics.matrix.filter(
      (provider) => provider.id.startsWith("google-nano-banana") && provider.availability === "unavailable"
    ).length;
    const simulationText = simulation?.availability === "available"
      ? "Simulation Mode ready"
      : "Simulation Mode unavailable";

    return `${simulationText}; Codex ready (${codexReady}); API disabled (${apiDisabled}); Nano experimental unavailable (${nanoUnavailable})`;
  }

  const fake = diagnostics.providers.find((provider) => provider.id === "ether-fake-local");
  const codex = diagnostics.providers.find((provider) => provider.id === "codex-chatgpt-image-2");
  const nanoUnavailable = diagnostics.providers.filter(
    (provider) => provider.id.startsWith("google-nano-banana") && provider.availability === "unavailable"
  ).length;
  const fakeText = fake?.availability === "available" ? "Simulation Mode ready" : "Simulation Mode unavailable";
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

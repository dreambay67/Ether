import {
  forwardRef,
  useCallback,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider
} from "@xyflow/react";
import {
  Eye,
  EyeOff,
  GitBranch,
  ImagePlus,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  Undo2
} from "lucide-react";
import { getNodeDefinition, type CanvasNodeData } from "@ether/engine/graph/nodeCatalog";
import type { EtherGraph } from "@ether/engine";
import { CommandPalette } from "../commands/CommandPalette";
import {
  EtherNode,
  EtherNodeChannelActivityContext,
  EtherNodeDataUpdateContext,
  EtherNodeDeleteContext,
  EtherNodeRunStatusContext,
  EtherNodeReferenceUploadContext,
  type EtherNodeChannelActivity
} from "./EtherNode";
import { ConnectionHint } from "./edges/ConnectionHint";
import { EtherEdge, EtherEdgeCommandContext } from "./edges/EtherEdge";
import { InspectorPanel } from "./InspectorPanel";
import { NodeLibrary } from "./NodeLibrary";
import { useCanvasCommands } from "./hooks/useCanvasCommands";
import { useCanvasGraph } from "./hooks/useCanvasGraph";
import { useCanvasSelection } from "./hooks/useCanvasSelection";
import { useRunController } from "./hooks/useRunController";
import { RunPlanPreview } from "./run/RunPlanPreview";
import type { CanvasGraphPersistenceResult } from "./hooks/useCanvasGraph";
import { normalizePayloadChannel, type PayloadChannel } from "./ports/channelRegistry";

type EtherCanvasProps = {
  graph: EtherGraph | null;
  projectId: string | null;
  isCommandPaletteOpen?: boolean;
  onStatus(message: string): void;
  onTrace(message: string): void;
  onCloseCommandPalette?(): void;
};

export type EtherCanvasHandle = {
  serialize(): EtherGraph;
  saveProjectGraph(): Promise<CanvasGraphPersistenceResult>;
  loadProjectGraph(): Promise<CanvasGraphPersistenceResult>;
  focusNode(nodeId: string): void;
};

type ContextMenuState = {
  x: number;
  y: number;
  position: { x: number; y: number };
} | null;

type MarqueeSelectionState = {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
} | null;

type SelectionRunPromptState = {
  count: number;
  x: number;
  y: number;
} | null;

const nodeTypes = { etherNode: EtherNode };
const edgeTypes = { etherEdge: EtherEdge };
const relationshipLockMessage = "Unlock connected nodes before changing relationships";
const MIN_LIBRARY_WIDTH = 220;
const MAX_LIBRARY_WIDTH = 560;
const MIN_INSPECTOR_WIDTH = 280;
const MAX_INSPECTOR_WIDTH = 680;
const OVERLAY_PANEL_GUTTER = 72;
const PANEL_KEYBOARD_RESIZE_STEP = 10;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function InnerEtherCanvas(
  { graph, projectId, isCommandPaletteOpen = false, onStatus, onTrace, onCloseCommandPalette }: EtherCanvasProps,
  ref: React.ForwardedRef<EtherCanvasHandle>
) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [showNodeLibrary, setShowNodeLibrary] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [nodeLibraryWidth, setNodeLibraryWidth] = useState(274);
  const [inspectorWidth, setInspectorWidth] = useState(320);
  const [flowShellWidth, setFlowShellWidth] = useState(0);
  const overlayResizeCleanupRef = useRef<(() => void) | null>(null);
  const [localRunStatus, setLocalRunStatus] = useState<string | null>(null);
  const [connectionHint, setConnectionHint] = useState<string | null>(null);
  const [templateFocusSignal, setTemplateFocusSignal] = useState(0);
  const [marqueeSelection, setMarqueeSelection] = useState<MarqueeSelectionState>(null);
  const [selectionRunPrompt, setSelectionRunPrompt] = useState<SelectionRunPromptState>(null);
  const documentMarqueeSelectionRef = useRef<MarqueeSelectionState>(null);

  const reportRelationshipLocked = useCallback(() => {
    setLocalRunStatus(relationshipLockMessage);
    onStatus(relationshipLockMessage);
  }, [onStatus]);

  const canvasGraph = useCanvasGraph({
    graph,
    projectId,
    onTrace,
    onDurableStatus: setLocalRunStatus,
    onRelationshipLocked: reportRelationshipLocked
  });
  const {
    wrapperRef,
    flowRef,
    nodeCounterRef,
    dragBaselineRef,
    textEditBaselineRef,
    viewport,
    setViewport,
    history,
    setHistory,
    nodes,
    edges,
    assemblyGraph,
    serialize,
    serializeCurrentGraph,
    graphContentFingerprint,
    isCurrentGraphContent,
    saveProjectGraph,
    loadProjectGraph,
    commitSnapshot,
    commitDurableSnapshot,
    commitDurableGraphIfCurrent,
    onNodesChange,
    onEdgesChange,
    undo,
    redo
  } = canvasGraph;

  const {
    selectedNode,
    selectedNodeIds,
    selectedEdge,
    replaceSelection
  } = useCanvasSelection({ nodes, edges, setHistory });

  const clearCanvasSelection = useCallback(() => {
    setContextMenu(null);
    setSelectionRunPrompt(null);
    setLocalRunStatus(null);
    const applyClear = () => setHistory((current) => {
      const hasSelection =
        current.present.nodes.some((node) => node.selected) ||
        current.present.edges.some((edge) => edge.selected);

      if (!hasSelection) {
        return current;
      }

      return {
        ...current,
        present: {
          nodes: current.present.nodes.map((node) => ({ ...node, selected: false })),
          edges: current.present.edges.map((edge) => ({ ...edge, selected: false }))
        }
      };
    });
    applyClear();
    window.requestAnimationFrame(applyClear);
  }, [setHistory]);

  const clearCanvasSelectionOnClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;

      if (
        target?.closest(
          ".react-flow__node, .react-flow__edge, .ether-edge-label, .ether-edge-role-grid, .ether-edge-channel-picker, .artifact-browser, [draggable=\"true\"], .canvas-overlay-panel, .canvas-toolbar, .canvas-status, .canvas-selection-run-prompt, button, input, textarea, select"
        )
      ) {
        return;
      }

      clearCanvasSelection();
    },
    [clearCanvasSelection]
  );

  useEffect(() => {
    if (selectedNodeIds.length < 2) {
      setSelectionRunPrompt(null);
    }
  }, [selectedNodeIds.length]);

  const runController = useRunController({
    graph,
    projectId,
    localRunStatus,
    setLocalRunStatus,
    nodes,
    assemblyGraph,
    selectedNode,
    selectedNodeIds,
    commitSnapshot,
    commitDurableSnapshot,
    commitDurableGraphIfCurrent,
    graphContentFingerprint,
    isCurrentGraphContent,
    serializeCurrentGraph,
    onStatus,
    onTrace
  });

  const commands = useCanvasCommands({
    graph,
    projectId,
    wrapperRef,
    flowRef,
    nodeCounterRef,
    dragBaselineRef,
    textEditBaselineRef,
    viewport,
    nodes,
    edges,
    serializeCurrentGraph,
    setHistory,
    commitSnapshot,
    commitDurableSnapshot,
    setContextMenu,
    setLocalRunStatus,
    setConnectionHint,
    onStatus,
    onTrace,
    reportRelationshipLocked,
    undo,
    redo
  });

  const channelActivityByNodeId = useMemo(() => {
    const activity: Record<string, EtherNodeChannelActivity> = {};

    const ensure = (nodeId: string) => {
      activity[nodeId] ??= { input: [], output: [] };
      return activity[nodeId];
    };

    const addChannel = (channels: PayloadChannel[], channel: PayloadChannel) => {
      if (!channels.includes(channel)) {
        channels.push(channel);
      }
    };

    for (const edge of edges) {
      const edgeData = edge.data && typeof edge.data === "object"
        ? edge.data as { sourceChannel?: unknown; targetChannel?: unknown }
        : {};
      const sourceChannel = normalizePayloadChannel(edgeData.sourceChannel ?? edge.sourceHandle) ?? "text";
      const targetChannel = normalizePayloadChannel(edgeData.targetChannel ?? edge.targetHandle) ?? "text";

      addChannel(ensure(edge.source).output, sourceChannel);
      addChannel(ensure(edge.target).input, targetChannel);
    }

    return activity;
  }, [edges]);

  const focusNode = useCallback(
    (nodeId: string) => {
      const target = nodes.find((node) => node.id === nodeId);

      if (!target) {
        const message = `Timeline node ${nodeId} is not on the canvas`;
        setLocalRunStatus(message);
        onStatus(message);
        return;
      }

      setHistory((current) => ({
        ...current,
        present: {
          nodes: current.present.nodes.map((node) => ({
            ...node,
            selected: node.id === nodeId
          })),
          edges: current.present.edges.map((edge) => ({ ...edge, selected: false }))
        }
      }));
      flowRef.current?.setCenter(
        target.position.x + (target.width ?? 260) / 2,
        target.position.y + (target.height ?? 180) / 2,
        { duration: 320, zoom: Math.max(viewport.zoom, 0.9) }
      );
      setLocalRunStatus(`Selected ${target.data.title}`);
      onStatus(`Selected ${target.data.title}`);
    },
    [flowRef, nodes, onStatus, setHistory, viewport.zoom]
  );

  useImperativeHandle(
    ref,
    () => ({
      serialize,
      saveProjectGraph,
      loadProjectGraph,
      focusNode
    }),
    [focusNode, loadProjectGraph, saveProjectGraph, serialize]
  );

  const dropStarterPrompt = useCallback(() => {
    commands.addNodeFromLibrary(getNodeDefinition("prompt-general"));
  }, [commands]);

  const chooseTemplate = useCallback(() => {
    setShowNodeLibrary(true);
    setTemplateFocusSignal((current) => current + 1);
  }, []);

  useEffect(() => {
    const shell = wrapperRef.current;

    if (!shell) {
      return;
    }

    const measureShell = () => setFlowShellWidth(shell.clientWidth);
    const resizeObserver = new ResizeObserver(measureShell);

    measureShell();
    resizeObserver.observe(shell);

    return () => resizeObserver.disconnect();
  }, [wrapperRef]);

  useEffect(() => {
    return () => overlayResizeCleanupRef.current?.();
  }, []);

  useEffect(() => {
    const isExcludedTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      Boolean(target.closest(".react-flow__controls, .react-flow__node, .react-flow__edge, .ether-edge-label, .ether-edge-role-grid, .ether-edge-channel-picker, .artifact-browser, [draggable=\"true\"], .canvas-overlay-panel, .canvas-toolbar, .canvas-status, .canvas-selection-run-prompt, button, input, textarea, select"));

    const promptPositionForSelection = (selection: NonNullable<MarqueeSelectionState>, count: number) => {
      const shellBox = wrapperRef.current?.getBoundingClientRect();

      if (!shellBox) {
        return { count, x: 16, y: 16 };
      }

      const left = Math.min(selection.startX, selection.currentX);
      const bottom = Math.max(selection.startY, selection.currentY);

      return {
        count,
        x: clamp(left - shellBox.left, 16, Math.max(16, shellBox.width - 280)),
        y: clamp(bottom - shellBox.top + 12, 16, Math.max(16, shellBox.height - 126))
      };
    };

    const applySelection = (selection: MarqueeSelectionState) => {
      if (!selection) {
        return;
      }

      const left = Math.min(selection.startX, selection.currentX);
      const right = Math.max(selection.startX, selection.currentX);
      const top = Math.min(selection.startY, selection.currentY);
      const bottom = Math.max(selection.startY, selection.currentY);
      const selectedIds = new Set<string>();

      wrapperRef.current?.querySelectorAll<HTMLElement>(".react-flow__node[data-id]").forEach((element) => {
        const box = element.getBoundingClientRect();
        const intersects = box.left <= right && box.right >= left && box.top <= bottom && box.bottom >= top;

        if (intersects) {
          const nodeId = element.dataset.id;

          if (nodeId) {
            selectedIds.add(nodeId);
          }
        }
      });

      if (selectedIds.size === 0) {
        clearCanvasSelection();
        return;
      }

      window.requestAnimationFrame(() => {
        setHistory((current) => ({
          ...current,
          present: {
            nodes: current.present.nodes.map((node) => ({
              ...node,
              selected: selectedIds.has(node.id)
            })),
            edges: current.present.edges.map((edge) => ({ ...edge, selected: false }))
          }
        }));
        setSelectionRunPrompt(
          selectedIds.size > 1 ? promptPositionForSelection(selection, selectedIds.size) : null
        );
        setLocalRunStatus(`Selected ${selectedIds.size} nodes`);
        onStatus(`Selected ${selectedIds.size} nodes`);
      });
    };

    const startDocumentMarquee = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        isExcludedTarget(event.target)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const selection: MarqueeSelectionState = {
        pointerId: -2,
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY
      };

      documentMarqueeSelectionRef.current = selection;
      setContextMenu(null);
      setLocalRunStatus("Marquee selecting");
      setMarqueeSelection(selection);
    };

    const moveDocumentMarquee = (event: MouseEvent) => {
      const selection = documentMarqueeSelectionRef.current;

      if (!selection) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const nextSelection = {
        ...selection,
        currentX: event.clientX,
        currentY: event.clientY
      };

      documentMarqueeSelectionRef.current = nextSelection;
      setMarqueeSelection(nextSelection);
    };

    const finishDocumentMarquee = (event: MouseEvent) => {
      const selection = documentMarqueeSelectionRef.current;

      if (!selection) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      documentMarqueeSelectionRef.current = null;
      setMarqueeSelection(null);
      applySelection(selection);
    };

    document.addEventListener("mousedown", startDocumentMarquee, true);
    document.addEventListener("mousemove", moveDocumentMarquee, true);
    document.addEventListener("mouseup", finishDocumentMarquee, true);
    return () => {
      document.removeEventListener("mousedown", startDocumentMarquee, true);
      document.removeEventListener("mousemove", moveDocumentMarquee, true);
      document.removeEventListener("mouseup", finishDocumentMarquee, true);
    };
  }, [clearCanvasSelection, onStatus, setHistory, wrapperRef]);

  const maxOverlayWidth = flowShellWidth > 0
    ? Math.max(MIN_INSPECTOR_WIDTH, flowShellWidth - OVERLAY_PANEL_GUTTER)
    : MAX_INSPECTOR_WIDTH;
  const maxLibraryWidth = Math.min(MAX_LIBRARY_WIDTH, maxOverlayWidth);
  const maxInspectorWidth = Math.min(MAX_INSPECTOR_WIDTH, maxOverlayWidth);
  const renderedNodeLibraryWidth = showNodeLibrary
    ? clamp(nodeLibraryWidth, MIN_LIBRARY_WIDTH, maxLibraryWidth)
    : 0;
  const renderedInspectorWidth = showInspector
    ? clamp(inspectorWidth, MIN_INSPECTOR_WIDTH, maxInspectorWidth)
    : 0;

  useEffect(() => {
    setNodeLibraryWidth((width) => clamp(width, MIN_LIBRARY_WIDTH, maxLibraryWidth));
    setInspectorWidth((width) => clamp(width, MIN_INSPECTOR_WIDTH, maxInspectorWidth));
  }, [maxInspectorWidth, maxLibraryWidth]);

  const resizeNodeLibraryTo = useCallback(
    (width: number) => setNodeLibraryWidth(clamp(width, MIN_LIBRARY_WIDTH, maxLibraryWidth)),
    [maxLibraryWidth]
  );

  const resizeInspectorTo = useCallback(
    (width: number) => setInspectorWidth(clamp(width, MIN_INSPECTOR_WIDTH, maxInspectorWidth)),
    [maxInspectorWidth]
  );

  const startOverlayPanelResize = useCallback(
    (panel: "library" | "inspector", event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      overlayResizeCleanupRef.current?.();
      const activePointerId = event.pointerId;
      const handle = event.currentTarget;
      const startX = event.clientX;
      const startLibraryWidth = nodeLibraryWidth;
      const startInspectorWidth = inspectorWidth;

      handle.setPointerCapture(activePointerId);

      const resizePanel = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== activePointerId) {
          return;
        }

        if (panel === "library") {
          resizeNodeLibraryTo(startLibraryWidth + moveEvent.clientX - startX);
          return;
        }

        resizeInspectorTo(startInspectorWidth - (moveEvent.clientX - startX));
      };

      const cleanupResize = () => {
        window.removeEventListener("pointermove", resizePanel);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
        handle.removeEventListener("lostpointercapture", stopResize);
        if (handle.hasPointerCapture(activePointerId)) {
          handle.releasePointerCapture(activePointerId);
        }
        overlayResizeCleanupRef.current = null;
      };

      const stopResize = (stopEvent: PointerEvent) => {
        if (stopEvent.pointerId !== activePointerId) {
          return;
        }

        cleanupResize();
      };

      overlayResizeCleanupRef.current = cleanupResize;
      window.addEventListener("pointermove", resizePanel);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
      handle.addEventListener("lostpointercapture", stopResize);
    },
    [inspectorWidth, nodeLibraryWidth, resizeInspectorTo, resizeNodeLibraryTo]
  );

  const startMarqueeSelection = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const target = event.target;

      if (
        event.button !== 0 ||
        !(target instanceof Element) ||
        target.closest(".react-flow__controls, .react-flow__node, .react-flow__edge, .ether-edge-label, .ether-edge-role-grid, .ether-edge-channel-picker, .artifact-browser, [draggable=\"true\"], .canvas-overlay-panel, .canvas-toolbar, .canvas-status, .canvas-selection-run-prompt, button, input, textarea, select")
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setContextMenu(null);
      setLocalRunStatus("Marquee selecting");
      setMarqueeSelection({
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY
      });
    },
    []
  );

  const moveMarqueeSelection = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    setMarqueeSelection((current) => {
      if (!current || current.pointerId !== event.pointerId) {
        return current;
      }

      event.preventDefault();
      event.stopPropagation();

      return {
        ...current,
        currentX: event.clientX,
        currentY: event.clientY
      };
    });
  }, []);

  const startMouseMarqueeSelection = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target;

      if (
        event.button !== 0 ||
        !(target instanceof Element) ||
        target.closest(".react-flow__controls, .react-flow__node, .react-flow__edge, .ether-edge-label, .ether-edge-role-grid, .ether-edge-channel-picker, .artifact-browser, [draggable=\"true\"], .canvas-overlay-panel, .canvas-toolbar, .canvas-status, .canvas-selection-run-prompt, button, input, textarea, select")
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setContextMenu(null);
      setLocalRunStatus("Marquee selecting");
      setMarqueeSelection({
        pointerId: -1,
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY
      });
    },
    []
  );

  const moveMouseMarqueeSelection = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    setMarqueeSelection((current) => {
      if (!current || current.pointerId !== -1) {
        return current;
      }

      event.preventDefault();
      event.stopPropagation();

      return {
        ...current,
        currentX: event.clientX,
        currentY: event.clientY
      };
    });
  }, []);

  const finishMarqueeSelection = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const selection = marqueeSelection;

      if (!selection || selection.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const left = Math.min(selection.startX, selection.currentX);
      const right = Math.max(selection.startX, selection.currentX);
      const top = Math.min(selection.startY, selection.currentY);
      const bottom = Math.max(selection.startY, selection.currentY);
      const selectedIds = new Set<string>();

      wrapperRef.current?.querySelectorAll<HTMLElement>(".react-flow__node[data-id]").forEach((element) => {
        const box = element.getBoundingClientRect();
        const intersects = box.left <= right && box.right >= left && box.top <= bottom && box.bottom >= top;

        if (intersects) {
          const nodeId = element.dataset.id;

          if (nodeId) {
            selectedIds.add(nodeId);
          }
        }
      });

      setMarqueeSelection(null);

      if (selectedIds.size === 0) {
        clearCanvasSelection();
        return;
      }

      window.requestAnimationFrame(() => {
        setHistory((current) => ({
          ...current,
          present: {
            nodes: current.present.nodes.map((node) => ({
              ...node,
              selected: selectedIds.has(node.id)
            })),
            edges: current.present.edges.map((edge) => ({ ...edge, selected: false }))
          }
        }));
        const shellBox = wrapperRef.current?.getBoundingClientRect();
        const promptX = shellBox
          ? clamp(left - shellBox.left, 16, Math.max(16, shellBox.width - 280))
          : 16;
        const promptY = shellBox
          ? clamp(bottom - shellBox.top + 12, 16, Math.max(16, shellBox.height - 126))
          : 16;

        setSelectionRunPrompt(selectedIds.size > 1 ? { count: selectedIds.size, x: promptX, y: promptY } : null);
        setLocalRunStatus(`Selected ${selectedIds.size} nodes`);
        onStatus(`Selected ${selectedIds.size} nodes`);
      });
    },
    [clearCanvasSelection, marqueeSelection, onStatus, setHistory, wrapperRef]
  );

  const finishMouseMarqueeSelection = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const selection = marqueeSelection;

      if (!selection || selection.pointerId !== -1) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const left = Math.min(selection.startX, selection.currentX);
      const right = Math.max(selection.startX, selection.currentX);
      const top = Math.min(selection.startY, selection.currentY);
      const bottom = Math.max(selection.startY, selection.currentY);
      const selectedIds = new Set<string>();

      wrapperRef.current?.querySelectorAll<HTMLElement>(".react-flow__node[data-id]").forEach((element) => {
        const box = element.getBoundingClientRect();
        const intersects = box.left <= right && box.right >= left && box.top <= bottom && box.bottom >= top;

        if (intersects) {
          const nodeId = element.dataset.id;

          if (nodeId) {
            selectedIds.add(nodeId);
          }
        }
      });

      setMarqueeSelection(null);

      if (selectedIds.size === 0) {
        clearCanvasSelection();
        return;
      }

      window.requestAnimationFrame(() => {
        setHistory((current) => ({
          ...current,
          present: {
            nodes: current.present.nodes.map((node) => ({
              ...node,
              selected: selectedIds.has(node.id)
            })),
            edges: current.present.edges.map((edge) => ({ ...edge, selected: false }))
          }
        }));
        const shellBox = wrapperRef.current?.getBoundingClientRect();
        const promptX = shellBox
          ? clamp(left - shellBox.left, 16, Math.max(16, shellBox.width - 280))
          : 16;
        const promptY = shellBox
          ? clamp(bottom - shellBox.top + 12, 16, Math.max(16, shellBox.height - 126))
          : 16;

        setSelectionRunPrompt(selectedIds.size > 1 ? { count: selectedIds.size, x: promptX, y: promptY } : null);
        setLocalRunStatus(`Selected ${selectedIds.size} nodes`);
        onStatus(`Selected ${selectedIds.size} nodes`);
      });
    },
    [clearCanvasSelection, marqueeSelection, onStatus, setHistory, wrapperRef]
  );

  const handleNodeLibraryResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        resizeNodeLibraryTo(nodeLibraryWidth + PANEL_KEYBOARD_RESIZE_STEP);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        resizeNodeLibraryTo(nodeLibraryWidth - PANEL_KEYBOARD_RESIZE_STEP);
      } else if (event.key === "Home") {
        event.preventDefault();
        resizeNodeLibraryTo(MIN_LIBRARY_WIDTH);
      } else if (event.key === "End") {
        event.preventDefault();
        resizeNodeLibraryTo(maxLibraryWidth);
      }
    },
    [maxLibraryWidth, nodeLibraryWidth, resizeNodeLibraryTo]
  );

  const handleInspectorResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        resizeInspectorTo(inspectorWidth + PANEL_KEYBOARD_RESIZE_STEP);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        resizeInspectorTo(inspectorWidth - PANEL_KEYBOARD_RESIZE_STEP);
      } else if (event.key === "Home") {
        event.preventDefault();
        resizeInspectorTo(MIN_INSPECTOR_WIDTH);
      } else if (event.key === "End") {
        event.preventDefault();
        resizeInspectorTo(maxInspectorWidth);
      }
    },
    [inspectorWidth, maxInspectorWidth, resizeInspectorTo]
  );

  const flowShellStyle = {
    "--ether-inspector-width": `${renderedInspectorWidth}px`
  } as CSSProperties;
  const flowShellRect = wrapperRef.current?.getBoundingClientRect();
  const marqueeStyle = marqueeSelection
    ? {
        left: Math.min(marqueeSelection.startX, marqueeSelection.currentX) - (flowShellRect?.left ?? 0),
        top: Math.min(marqueeSelection.startY, marqueeSelection.currentY) - (flowShellRect?.top ?? 0),
        width: Math.abs(marqueeSelection.currentX - marqueeSelection.startX),
        height: Math.abs(marqueeSelection.currentY - marqueeSelection.startY)
      } as CSSProperties
    : null;

  return (
    <div
      className="flow-shell"
      ref={wrapperRef}
      style={flowShellStyle}
      onPointerDownCapture={startMarqueeSelection}
      onPointerMoveCapture={moveMarqueeSelection}
      onPointerUpCapture={finishMarqueeSelection}
      onPointerCancelCapture={finishMarqueeSelection}
      onMouseDownCapture={startMouseMarqueeSelection}
      onMouseMoveCapture={moveMouseMarqueeSelection}
      onMouseUpCapture={finishMouseMarqueeSelection}
      onClickCapture={clearCanvasSelectionOnClick}
    >
      <div className="canvas-toolbar" aria-label="Canvas history controls">
        <button
          type="button"
          aria-label="Undo"
          data-testid="canvas-undo"
          onClick={undo}
          disabled={history.past.length === 0}
        >
          <Undo2 size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Redo"
          data-testid="canvas-redo"
          onClick={redo}
          disabled={history.future.length === 0}
        >
          <Redo2 size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={showMiniMap ? "Hide minimap" : "Show minimap"}
          onClick={() => setShowMiniMap((current) => !current)}
        >
          {showMiniMap ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
        <button
          type="button"
          aria-label={showNodeLibrary ? "Hide node library" : "Show node library"}
          onClick={() => setShowNodeLibrary((current) => !current)}
          title={showNodeLibrary ? "Hide node library" : "Show node library"}
        >
          {showNodeLibrary ? <PanelLeftClose size={16} aria-hidden="true" /> : <PanelLeftOpen size={16} aria-hidden="true" />}
        </button>
        <button
          type="button"
          aria-label={showInspector ? "Hide inspector" : "Show inspector"}
          onClick={() => setShowInspector((current) => !current)}
          title={showInspector ? "Hide inspector" : "Show inspector"}
        >
          {showInspector ? <PanelRightClose size={16} aria-hidden="true" /> : <PanelRightOpen size={16} aria-hidden="true" />}
        </button>
        <button
          type="button"
          aria-label="Link reference image"
          data-testid="canvas-link-reference"
          onClick={commands.linkReferenceImage}
          disabled={!projectId}
          title={projectId ? "Link reference image" : "Open a project to link references"}
        >
          <ImagePlus size={16} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Connect first valid pair" onClick={commands.connectFirstValidPair}>
          <Link2 size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Add review router"
          data-testid="canvas-add-review-router"
          onClick={commands.addReviewRouterTemplate}
        >
          <GitBranch size={16} aria-hidden="true" />
        </button>
      </div>
      {showNodeLibrary ? (
      <aside
        className="canvas-overlay-panel canvas-node-library"
        aria-label="Node Library"
        data-testid="panel-node-library"
        style={{ width: renderedNodeLibraryWidth }}
      >
        <div className="overlay-panel-title">
          <div>
            <p>Input</p>
            <h2>Node Library</h2>
          </div>
          <button
            type="button"
            className="overlay-panel-toggle"
            aria-label="Hide node library"
            data-testid="panel-node-library-toggle"
            title="Hide node library"
            onClick={() => setShowNodeLibrary(false)}
          >
            <PanelLeftClose size={15} aria-hidden="true" />
          </button>
        </div>
        <NodeLibrary
          onAddNode={commands.addNodeFromLibrary}
          onAddTemplate={commands.addCanvasTemplate}
          templateFocusSignal={templateFocusSignal}
        />
        <div
          className="overlay-panel-resize overlay-panel-resize-right"
          role="separator"
          aria-label="Resize node library"
          aria-orientation="vertical"
          aria-valuemin={MIN_LIBRARY_WIDTH}
          aria-valuemax={Math.round(maxLibraryWidth)}
          aria-valuenow={Math.round(renderedNodeLibraryWidth)}
          data-testid="panel-node-library-resize"
          tabIndex={0}
          title="Drag to resize node library"
          onPointerDown={(event) => startOverlayPanelResize("library", event)}
          onKeyDown={handleNodeLibraryResizeKeyDown}
        />
      </aside>
      ) : null}
      {nodes.length === 0 ? (
        <div className="canvas-empty-actions" data-testid="canvas-empty-actions">
          <button type="button" onClick={dropStarterPrompt}>
            Drop Prompt
          </button>
          <button
            type="button"
            onClick={commands.linkReferenceImage}
            title={projectId ? "Link reference image" : "Open a project to link references"}
          >
            Drop Image
          </button>
          <button type="button" onClick={chooseTemplate}>
            Choose Template
          </button>
        </div>
      ) : null}
      {showInspector ? (
      <aside
        className="canvas-overlay-panel canvas-inspector"
        aria-label="Inspector"
        data-testid="panel-inspector"
        style={{ width: renderedInspectorWidth }}
      >
        <div className="overlay-panel-title">
          <div>
            <p>State</p>
            <h2>Inspector</h2>
          </div>
          <button
            type="button"
            className="overlay-panel-toggle"
            aria-label="Hide inspector"
            data-testid="panel-inspector-toggle"
            title="Hide inspector"
            onClick={() => setShowInspector(false)}
          >
            <PanelRightClose size={15} aria-hidden="true" />
          </button>
        </div>
        <InspectorPanel
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          graph={assemblyGraph}
          onPreviewNode={commands.previewNode}
          onPreviewEdge={commands.previewEdge}
          onCommitTextEdit={commands.commitTextEdit}
          onRunNode={runController.runNode}
          onToggleNodeLock={commands.toggleNodeLock}
          onPreviewRun={runController.previewRun}
          onEnsureStoreFolder={runController.ensureStoreFolderForNode}
          onSaveFakeGeneratedAsset={runController.saveFakeGeneratedAssetForNode}
          onCreateMaskAsset={runController.createMaskAssetForNode}
          onUploadReferenceForNode={commands.uploadReferenceForNode}
          onMoveLatestGeneratedAssetToCollection={runController.moveLatestGeneratedAssetToCollection}
          onDeleteSelection={commands.deleteSelection}
          executionPolicy={runController.executionPolicy}
          runCountCap={runController.runCountCap}
          parallelExecution={runController.parallelExecution}
          runProviderMode={runController.runProviderMode}
          selectedNodeCount={selectedNodeIds.length}
          onExecutionPolicyChange={runController.setExecutionPolicy}
          onRunCountCapChange={runController.setRunCountCap}
          onParallelExecutionChange={runController.setParallelExecution}
          onRunProviderModeChange={runController.setRunProviderMode}
          hasOpenProject={Boolean(projectId)}
        />
        <div
          className="overlay-panel-resize overlay-panel-resize-left"
          role="separator"
          aria-label="Resize inspector"
          aria-orientation="vertical"
          aria-valuemin={MIN_INSPECTOR_WIDTH}
          aria-valuemax={Math.round(maxInspectorWidth)}
          aria-valuenow={Math.round(renderedInspectorWidth)}
          data-testid="panel-inspector-resize"
          tabIndex={0}
          title="Drag to resize inspector"
          onPointerDown={(event) => startOverlayPanelResize("inspector", event)}
          onKeyDown={handleInspectorResizeKeyDown}
        />
      </aside>
      ) : null}
      {runController.runPreview ? (
        <RunPlanPreview
          graph={runController.runPreview.graph}
          preview={runController.runPreview.preview}
          request={runController.runPreview.request}
          isStarting={runController.isStartingPreviewRun}
          onStart={runController.startPreviewRun}
          onCancel={runController.closeRunPreview}
        />
      ) : null}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        previewPatch={commands.previewGraphPatchForCanvas}
        applyPatch={commands.applyGraphPatchToCanvas}
        onClose={onCloseCommandPalette ?? (() => undefined)}
      />
      <EtherNodeDeleteContext.Provider value={commands.deleteNodeById}>
      <EtherEdgeCommandContext.Provider
        value={{
          deleteEdgeById: commands.deleteEdgeById,
          setEdgeRole: commands.setEdgeRole,
          setEdgeChannel: commands.setEdgeChannel
        }}
      >
      <EtherNodeReferenceUploadContext.Provider
        value={{
          add: (nodeId) => void commands.uploadReferenceForNode(nodeId, "add"),
          replace: (nodeId) => void commands.uploadReferenceForNode(nodeId, "replace")
        }}
      >
      <EtherNodeDataUpdateContext.Provider value={commands.updateNodeDataDurable}>
      <EtherNodeChannelActivityContext.Provider value={channelActivityByNodeId}>
      <EtherNodeRunStatusContext.Provider value={runController.nodeRunVisualStatus}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(instance) => {
          flowRef.current = instance;
          instance.setViewport(viewport);
        }}
        onMoveEnd={(_event, nextViewport) => setViewport(nextViewport)}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={commands.onConnect}
        onSelectionChange={replaceSelection}
        onNodeDragStart={commands.onNodeDragStart}
        onNodeDragStop={commands.onNodeDragStop}
        onDrop={commands.onDrop}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          const position = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? {
            x: 0,
            y: 0
          };
          setContextMenu({ x: event.clientX, y: event.clientY, position });
        }}
        onPaneClick={clearCanvasSelection}
        deleteKeyCode={null}
        multiSelectionKeyCode="Shift"
        panOnDrag={[1, 2]}
      >
        <Background color="rgba(153, 168, 186, 0.16)" gap={36} />
        <Controls position="bottom-right" />
        {showMiniMap ? (
          <MiniMap
            data-testid="canvas-minimap"
            pannable
            zoomable
            nodeColor={(node) => (node.data as CanvasNodeData).kind === "Generation" ? "#37E6EA" : "#1470DB"}
          />
        ) : null}
      </ReactFlow>
      </EtherNodeRunStatusContext.Provider>
      </EtherNodeChannelActivityContext.Provider>
      </EtherNodeDataUpdateContext.Provider>
      </EtherNodeReferenceUploadContext.Provider>
      </EtherEdgeCommandContext.Provider>
      </EtherNodeDeleteContext.Provider>
      <ConnectionHint message={connectionHint} />
      {marqueeStyle ? <div className="canvas-marquee-selection" style={marqueeStyle} data-testid="canvas-marquee-selection" /> : null}
      {selectionRunPrompt && selectedNodeIds.length > 1 ? (
        <div
          className="canvas-selection-run-prompt"
          data-testid="selection-run-prompt"
          style={{ left: selectionRunPrompt.x, top: selectionRunPrompt.y }}
          role="dialog"
          aria-label="Run selected nodes"
        >
          <strong>{selectionRunPrompt.count} nodes selected</strong>
          <p>Run only selected nodes?</p>
          <div>
            <button
              type="button"
              onClick={() => {
                setSelectionRunPrompt(null);
                void runController.previewRun("selected");
              }}
            >
              Run selected nodes
            </button>
            <button
              type="button"
              aria-label="Dismiss selected run prompt"
              onClick={() => setSelectionRunPrompt(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      {contextMenu ? (
        <div
          className="canvas-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label="Canvas actions"
        >
          {commands.actionDefinitions.map((definition) => (
            <button
              key={definition.id}
              type="button"
              role="menuitem"
              onClick={() => commands.createNode(definition, contextMenu.position)}
            >
              Add {definition.category}
            </button>
          ))}
        </div>
      ) : null}
      <div className="canvas-status" aria-live="polite" data-testid="canvas-status">
        {localRunStatus ??
          (selectedNode
            ? `Selected ${selectedNode.data.title}`
            : selectedEdge
              ? `Selected ${selectedEdge.label}`
              : projectId
                ? "Canvas ready"
                : "Open a project to link references")}
      </div>
    </div>
  );
}

export const EtherCanvas = forwardRef(InnerEtherCanvas);

export function EtherCanvasWithProvider(
  props: EtherCanvasProps & { canvasRef: React.Ref<EtherCanvasHandle> }
) {
  const { canvasRef, ...canvasProps } = props;

  return (
    <ReactFlowProvider>
      <EtherCanvas ref={canvasRef} {...canvasProps} />
    </ReactFlowProvider>
  );
}

export type { CanvasNodeData };

import { useCallback, useMemo } from "react";
import type { EtherEdge, EtherGraph, EtherNode, GraphOperation } from "@ether/schema";
import type { CanvasEditorField } from "./directEditing";
import { moduleIsLocked } from "../modules/moduleModel";

export type GraphCommandId = "delete" | "duplicate" | "copy" | "cut" | "paste" | "selectAll" | "undo" | "redo" | "createModule" | "dissolveModule" | "rename" | "edit" | "runSelected" | "fit" | "palette";
export type GraphCommand = { id: GraphCommandId; label: string; shortcut: string; enabled: boolean; disabledReason?: string; execute(): void | Promise<unknown> };
type ClipboardSnapshot = { kind: "ether.graph-selection.v1"; nodes: EtherNode[]; edges: EtherEdge[]; pasteCount: number };
let graphClipboard: ClipboardSnapshot | null = null;

export function useGraphCommands({ graph, readOnly, selectedNodeIds, selectedEdgeId, selectedModuleId, apply, createModule, dissolveModule, undo, redo, onSelectNodes, onSelectEdge, onSelectModule, onEdit, onRenameModule, onEnterModule, onRunSelected, onFit, onPalette, onStatus }: {
  graph: EtherGraph;
  readOnly: boolean;
  selectedNodeIds: readonly string[];
  selectedEdgeId: string | null;
  selectedModuleId: string | null;
  apply(operations: GraphOperation[], title: string): Promise<boolean>;
  createModule(nodeIds: string[]): Promise<boolean> | undefined;
  dissolveModule(moduleId: string): Promise<boolean>;
  undo(): void;
  redo(): void;
  onSelectNodes(ids: string[]): void;
  onSelectEdge(id: string | null): void;
  onSelectModule(id: string | null): void;
  onEdit(nodeId: string, field: CanvasEditorField): void;
  onRenameModule(moduleId: string): void;
  onEnterModule(moduleId: string): void;
  onRunSelected(): void;
  onFit(): void;
  onPalette(): void;
  onStatus(message: string): void;
}) {
  const selection = useMemo(() => graph.nodes.filter((node) => selectedNodeIds.includes(node.id)), [graph.nodes, selectedNodeIds]);
  const copySelection = useCallback(async () => {
    if (selection.length === 0) return false;
    const ids = new Set(selection.map((node) => node.id));
    const snapshot: ClipboardSnapshot = {
      kind: "ether.graph-selection.v1",
      nodes: structuredClone(selection),
      edges: structuredClone(graph.edges.filter((edge) => edge.from.kind === "node" && edge.to.kind === "node" && ids.has(edge.from.nodeId) && ids.has(edge.to.nodeId))),
      pasteCount: 0
    };
    graphClipboard = snapshot;
    try { await navigator.clipboard.writeText(JSON.stringify(snapshot)); } catch { /* The in-process clipboard remains available. */ }
    onStatus(`Copied ${selection.length} node${selection.length === 1 ? "" : "s"}`);
    return true;
  }, [graph.edges, onStatus, selection]);
  const deleteSelection = useCallback(async () => {
    const ids = new Set(selectedNodeIds);
    const edgeIds = new Set<string>();
    if (selectedEdgeId) edgeIds.add(selectedEdgeId);
    graph.edges.forEach((edge) => {
      if ((edge.from.kind === "node" && ids.has(edge.from.nodeId)) || (edge.to.kind === "node" && ids.has(edge.to.nodeId))) edgeIds.add(edge.id);
    });
    const operations: GraphOperation[] = [
      ...[...edgeIds].map((edgeId) => ({ type: "removeEdge", graphId: graph.id, edgeId } as GraphOperation)),
      ...graph.groups.flatMap((group): GraphOperation[] => {
        const remaining = group.nodeIds.filter((id) => !ids.has(id));
        if (remaining.length === group.nodeIds.length) return [];
        return remaining.length === 0
          ? [{ type: "removeGroup", graphId: graph.id, groupId: group.id }]
          : [{ type: "updateGroup", graphId: graph.id, groupId: group.id, group: { ...group, nodeIds: remaining } }];
      }),
      ...selectedNodeIds.map((nodeId) => ({ type: "removeNode", graphId: graph.id, nodeId } as GraphOperation))
    ];
    if (operations.length === 0) return;
    if (await apply(operations, operations.length === 1 ? "Delete graph object" : "Delete graph selection")) {
      onSelectNodes([]); onSelectEdge(null);
    }
  }, [apply, graph.edges, graph.groups, graph.id, onSelectEdge, onSelectNodes, selectedEdgeId, selectedNodeIds]);
  const paste = useCallback(async (duplicate = false) => {
    let snapshot = duplicate ? (selection.length > 0 ? {
      kind: "ether.graph-selection.v1" as const,
      nodes: structuredClone(selection),
      edges: structuredClone(graph.edges.filter((edge) => edge.from.kind === "node" && edge.to.kind === "node" && selectedNodeIds.includes(edge.from.nodeId) && selectedNodeIds.includes(edge.to.nodeId))),
      pasteCount: 0
    } : null) : graphClipboard;
    if (snapshot === null && !duplicate) {
      try {
        const parsed = JSON.parse(await navigator.clipboard.readText()) as Partial<ClipboardSnapshot>;
        if (parsed.kind === "ether.graph-selection.v1" && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) snapshot = parsed as ClipboardSnapshot;
      } catch { /* Report the empty graph clipboard below. */ }
    }
    if (snapshot === null || snapshot.nodes.length === 0) { onStatus("The graph clipboard is empty."); return; }
    const offset = duplicate ? 40 : 40 * (snapshot.pasteCount + 1);
    const ids = new Map(snapshot.nodes.map((node) => [node.id, crypto.randomUUID()]));
    const nodes = snapshot.nodes.map((node) => ({ ...structuredClone(node), id: ids.get(node.id)!, title: duplicate ? `${node.title} copy` : node.title, position: { x: node.position.x + offset, y: node.position.y + offset } }));
    const edges = snapshot.edges.map((edge) => ({
      ...structuredClone(edge), id: crypto.randomUUID(),
      from: edge.from.kind === "node" ? { ...edge.from, nodeId: ids.get(edge.from.nodeId)! } : edge.from,
      to: edge.to.kind === "node" ? { ...edge.to, nodeId: ids.get(edge.to.nodeId)! } : edge.to
    }));
    const operations: GraphOperation[] = [
      ...nodes.map((node) => ({ type: "addNode", graphId: graph.id, node } as GraphOperation)),
      ...edges.map((edge) => ({ type: "addEdge", graphId: graph.id, edge } as GraphOperation))
    ];
    if (await apply(operations, duplicate ? "Duplicate selection" : "Paste graph selection")) {
      if (!duplicate) snapshot.pasteCount += 1;
      onSelectEdge(null); onSelectModule(null); onSelectNodes(nodes.map((node) => node.id));
    }
  }, [apply, graph.edges, graph.id, onSelectEdge, onSelectModule, onSelectNodes, onStatus, selectedNodeIds, selection]);
  const cut = useCallback(async () => { if (await copySelection()) await deleteSelection(); }, [copySelection, deleteSelection]);
  const primary = selectedNodeIds[0] ?? null;
  const selectedModule = selectedModuleId === null ? undefined : graph.modules.find((module) => module.id === selectedModuleId);
  const noSelection = "Select a node first.";
  const locked = readOnly ? "This document is read-only." : undefined;
  return useMemo<GraphCommand[]>(() => [
    command("delete", "Delete", "Delete", !readOnly && (selectedNodeIds.length > 0 || selectedEdgeId !== null), locked ?? "Select a node or connection first.", deleteSelection),
    command("duplicate", "Duplicate", "Ctrl+D", !readOnly && selection.length > 0, locked ?? noSelection, () => paste(true)),
    command("copy", "Copy", "Ctrl+C", selection.length > 0, noSelection, copySelection),
    command("cut", "Cut", "Ctrl+X", !readOnly && selection.length > 0, locked ?? noSelection, cut),
    command("paste", "Paste", "Ctrl+V", !readOnly, locked, () => paste(false)),
    command("selectAll", "Select all nodes", "Ctrl+A", graph.nodes.length > 0, "This canvas is blank.", () => { onSelectEdge(null); onSelectModule(null); onSelectNodes(graph.nodes.map((node) => node.id)); }),
    command("undo", "Undo graph transaction", "Ctrl+Z", !readOnly, locked, undo),
    command("redo", "Redo graph transaction", "Ctrl+Y", !readOnly, locked, redo),
    command("createModule", "Create module", "Ctrl+G", !readOnly && selection.length > 0, locked ?? noSelection, async () => { if (await createModule([...selectedNodeIds])) onSelectNodes([]); }),
    command("dissolveModule", "Dissolve module", "Ctrl+Shift+G", !readOnly && selectedModule !== undefined && !moduleIsLocked(selectedModule), locked ?? (selectedModule === undefined ? "Select a module first." : "Unlock this module before dissolving it."), async () => { if (selectedModuleId) await dissolveModule(selectedModuleId); }),
    command("rename", "Rename", "F2", !readOnly && (primary !== null || selectedModuleId !== null), locked ?? noSelection, () => { if (primary) onEdit(primary, "title"); else if (selectedModuleId) onRenameModule(selectedModuleId); }),
    command("edit", selectedModuleId ? "Enter module" : "Edit primary content", "Enter", !readOnly && (primary !== null || selectedModuleId !== null), locked ?? noSelection, () => { if (primary) onEdit(primary, "primary"); else if (selectedModuleId) onEnterModule(selectedModuleId); }),
    command("runSelected", "Preview selected run", "Ctrl+Enter", selectedNodeIds.length > 0, noSelection, onRunSelected),
    command("fit", "Fit current graph", "Home", graph.nodes.length + graph.modules.length > 0, "This canvas is blank.", onFit),
    command("palette", "Command palette", "Ctrl+K", true, undefined, onPalette)
  ], [copySelection, createModule, cut, deleteSelection, dissolveModule, graph.modules.length, graph.nodes, locked, onEdit, onEnterModule, onFit, onPalette, onRenameModule, onRunSelected, onSelectEdge, onSelectModule, onSelectNodes, paste, primary, readOnly, redo, selectedEdgeId, selectedModule, selectedModuleId, selectedNodeIds, selection.length, undo]);
}

function command(id: GraphCommandId, label: string, shortcut: string, enabled: boolean, disabledReason: string | undefined, execute: GraphCommand["execute"]): GraphCommand {
  return { id, label, shortcut, enabled, ...(enabled || disabledReason === undefined ? {} : { disabledReason }), execute };
}

export function commandIdForKeyboard(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): GraphCommandId | null {
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (!modifier && !event.altKey && (key === "delete" || key === "backspace")) return "delete";
  if (!modifier && !event.altKey && key === "f2") return "rename";
  if (!modifier && !event.altKey && key === "enter") return "edit";
  if (!modifier && !event.altKey && key === "home") return "fit";
  if (!modifier || event.altKey) return null;
  if (key === "d") return "duplicate";
  if (key === "c") return "copy";
  if (key === "x") return "cut";
  if (key === "v") return "paste";
  if (key === "a") return "selectAll";
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y") return "redo";
  if (key === "g") return event.shiftKey ? "dissolveModule" : "createModule";
  if (key === "enter") return "runSelected";
  if (key === "k") return "palette";
  return null;
}

export function commandPreservesCanvasFocus(id: GraphCommandId) {
  return id !== "rename" && id !== "edit" && id !== "palette";
}

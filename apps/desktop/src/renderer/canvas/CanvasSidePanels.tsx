import { useLayoutEffect, useRef, useState } from "react";
import type { EtherGraph } from "@ether/schema";
import { RunPlanDetails } from "./inspector/RunPlanDetails";
import type { RunPlanPresentation } from "./inspector/runPlanPresentation";

export function CanvasSidePanels({ graph, title, selectedIds, status, runPrompt, runLabel, runPlan, runBusy, onRunSelected, onDismissRun, onLeave, onExposeParameter, onRemoveFromModule, onConvertGroup }: {
  graph: EtherGraph;
  title?: string;
  selectedIds: string[];
  status: string;
  runPrompt: boolean;
  runLabel: string;
  runPlan: RunPlanPresentation | null;
  runBusy: boolean;
  onRunSelected(): void;
  onDismissRun(): void;
  onLeave?(): void;
  onExposeParameter?(nodeId: string): void;
  onRemoveFromModule?(nodeIds: readonly string[]): void;
  onConvertGroup?(groupId: string): void;
}) {
  const legacyGroup = graph.groups[0];
  return <>
    <aside className="canvas-legend" aria-label="Canvas legend">
      <strong>{title ?? graph.title}</strong><span>{graph.nodes.length} nodes - {graph.edges.length} lanes</span><small>Left drag selects - right drag pans</small>
      {onLeave ? <button type="button" onClick={onLeave}>Leave module</button> : null}
      {onExposeParameter && selectedIds.length === 1 ? <button type="button" onClick={() => onExposeParameter(selectedIds[0]!)}>Expose selected parameter</button> : null}
      {onRemoveFromModule && selectedIds.length > 0 ? <button type="button" onClick={() => onRemoveFromModule(selectedIds)}>Move selected to parent</button> : null}
    </aside>
    {legacyGroup && onConvertGroup ? <aside className="canvas-group-repair" aria-label="Legacy group repair preview">
      <strong>Module conversion available</strong>
      <p>{legacyGroup.title} contains {legacyGroup.nodeIds.length} recorded member{legacyGroup.nodeIds.length === 1 ? "" : "s"}. Visual Groups are no longer shown; preview a safe, undoable conversion to a locked Module.</p>
      <button type="button" onClick={() => onConvertGroup(legacyGroup.id)}>Review conversion</button>
      {graph.groups.length > 1 ? <small>{graph.groups.length - 1} more group record{graph.groups.length === 2 ? "" : "s"} can be reviewed after this one.</small> : null}
    </aside> : null}
    {runPrompt ? <SelectionRunPrompt selectedIds={selectedIds} runLabel={runLabel} runPlan={runPlan} runBusy={runBusy} onRunSelected={onRunSelected} onDismissRun={onDismissRun} /> : null}
    <div className="canvas-status" data-testid="canvas-status" aria-live="polite">{status}</div>
  </>;
}

function SelectionRunPrompt({ selectedIds, runLabel, runPlan, runBusy, onRunSelected, onDismissRun }: {
  selectedIds: string[];
  runLabel: string;
  runPlan: RunPlanPresentation | null;
  runBusy: boolean;
  onRunSelected(): void;
  onDismissRun(): void;
}) {
  const promptRef = useRef<HTMLElement>(null);
  const [placement, setPlacement] = useState<RunPromptPlacement>("bottom-right");
  useLayoutEffect(() => {
    const prompt = promptRef.current;
    if (prompt === null) return;
    const root = prompt.closest<HTMLElement>(".ether-canvas");
    if (root === null) return;
    const frame = globalThis.requestAnimationFrame(() => {
      const rootBounds = root.getBoundingClientRect();
      const width = prompt.getBoundingClientRect().width;
      const height = prompt.getBoundingClientRect().height;
      const compact = rootBounds.width <= 650;
      const candidates = compact
        ? promptPlacements({ width, height, rootWidth: rootBounds.width, rootHeight: rootBounds.height, rightInset: 14, bottomInset: 190 })
        : promptPlacements({ width, height, rootWidth: rootBounds.width, rootHeight: rootBounds.height, rightInset: 230, bottomInset: 14 });
      const blocked = [...root.querySelectorAll<HTMLElement>(".react-flow__node, .canvas-toolbar, .canvas-legend, .react-flow__minimap")]
        .filter((element) => element !== prompt && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0)
        .map((element) => element.getBoundingClientRect());
      const best = candidates.reduce((current, candidate) => {
        const candidateBounds = {
          left: rootBounds.left + candidate.left,
          top: rootBounds.top + candidate.top,
          right: rootBounds.left + candidate.left + width,
          bottom: rootBounds.top + candidate.top + height
        };
        const overlap = blocked.reduce((total, element) => total + overlapArea(candidateBounds, element), 0);
        return overlap < current.overlap ? { placement: candidate.placement, overlap } : current;
      }, { placement, overlap: Number.POSITIVE_INFINITY });
      setPlacement(best.placement);
    });
    return () => globalThis.cancelAnimationFrame(frame);
  }, [placement, runPlan?.id, runPlan?.blockingWarnings.length, runBusy, runLabel, selectedIds.length]);
  return <aside ref={promptRef} className="canvas-selection-run-prompt" data-placement={placement} aria-label="Selected run prompt"><strong>{selectedIds.length} nodes selected</strong>{runPlan ? <RunPlanDetails plan={runPlan} title="Selected plan" /> : <p>Prepare an exact selected-node plan before any provider work starts.</p>}<div><button type="button" disabled={runBusy || (runPlan?.blockingWarnings.length ?? 0) > 0} onClick={onRunSelected}>{runLabel}</button><button type="button" disabled={runBusy} onClick={onDismissRun}>Dismiss</button></div></aside>;
}

type RunPromptPlacement = "bottom-right" | "bottom-left" | "top-right" | "top-left";

function promptPlacements({ width, height, rootWidth, rootHeight, rightInset, bottomInset }: { width: number; height: number; rootWidth: number; rootHeight: number; rightInset: number; bottomInset: number }): Array<{ placement: RunPromptPlacement; left: number; top: number }> {
  return [
    { placement: "bottom-right", left: Math.max(14, rootWidth - width - rightInset), top: Math.max(14, rootHeight - height - bottomInset) },
    { placement: "bottom-left", left: 14, top: Math.max(14, rootHeight - height - bottomInset) },
    { placement: "top-right", left: Math.max(14, rootWidth - width - rightInset), top: 96 },
    { placement: "top-left", left: 14, top: 96 }
  ];
}

function overlapArea(left: { left: number; top: number; right: number; bottom: number }, right: DOMRect): number {
  return Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left)) * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
}

import type { EtherGraph } from "@ether/schema";

export function CanvasSidePanels({ graph, selectedIds, status, runPrompt, runLabel, runDetail, runBusy, onRunSelected, onDismissRun, onLeave, onExposeParameter, onRemoveFromModule, onConvertGroup }: {
  graph: EtherGraph;
  selectedIds: string[];
  status: string;
  runPrompt: boolean;
  runLabel: string;
  runDetail: string;
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
      <strong>{graph.title}</strong><span>{graph.nodes.length} nodes - {graph.edges.length} lanes</span><small>Left drag selects - right drag pans</small>
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
    {runPrompt ? <aside className="canvas-selection-run-prompt" aria-label="Selected run prompt"><strong>{selectedIds.length} nodes selected</strong><p>{runDetail}</p><div><button type="button" disabled={runBusy} onClick={onRunSelected}>{runLabel}</button><button type="button" disabled={runBusy} onClick={onDismissRun}>Dismiss</button></div></aside> : null}
    <div className="canvas-status" data-testid="canvas-status" aria-live="polite">{status}</div>
  </>;
}

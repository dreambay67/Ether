import { useCallback, useRef, useState } from "react";
function sameIds(left: readonly string[], right: readonly string[]) { return left.length === right.length && left.every((id, index) => id === right[index]); }
export function useMarqueeSelection(onSelected: (ids: string[]) => void) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]); const current = useRef<string[]>([]);
  const commit = useCallback((ids: string[]) => { if (sameIds(current.current, ids)) return; current.current = ids; setSelectedIds(ids); onSelected(ids); }, [onSelected]);
  const onSelectionChange = useCallback(({ nodes }: { nodes: Array<{ id: string }> }) => commit(nodes.map((node) => node.id)), [commit]);
  const selectNode = useCallback((id: string, additive: boolean) => { const next = additive && !current.current.includes(id) ? [...current.current, id] : additive ? current.current : [id]; commit(next); }, [commit]);
  return { selectedIds, onSelectionChange, selectNode, clearSelection: useCallback(() => commit([]), [commit]) };
}

export type GraphPoint = { x: number; y: number };
export type GeometryNode = { id: string; position: GraphPoint; width?: number | null; height?: number | null };
export type GeometryEdge = { id: string; source: string; target: string };

function centerOf(node: GeometryNode): GraphPoint {
  return { x: node.position.x + (node.width ?? 0) / 2, y: node.position.y + (node.height ?? 0) / 2 };
}

export function distanceFromPointToSegment(point: GraphPoint, start: GraphPoint, end: GraphPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function findEdgeInsertionTarget<NodeType extends GeometryNode, EdgeType extends GeometryEdge>({ draggedNodeId, nodes, edges, threshold = 54 }: { draggedNodeId: string; nodes: NodeType[]; edges: EdgeType[]; threshold?: number }): EdgeType | null {
  const dragged = nodes.find((node) => node.id === draggedNodeId);
  if (dragged === undefined) return null;
  let closest: EdgeType | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const edge of edges) {
    if (edge.source === draggedNodeId || edge.target === draggedNodeId) continue;
    const source = nodes.find((node) => node.id === edge.source);
    const target = nodes.find((node) => node.id === edge.target);
    if (source === undefined || target === undefined) continue;
    const candidate = distanceFromPointToSegment(centerOf(dragged), centerOf(source), centerOf(target));
    if (candidate <= threshold && candidate < distance) { closest = edge; distance = candidate; }
  }
  return closest;
}

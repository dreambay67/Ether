export type GraphPoint = {
  x: number;
  y: number;
};

export type GeometryNode = {
  id: string;
  position: GraphPoint;
  width?: number | null;
  height?: number | null;
};

export type GeometryEdge = {
  id: string;
  source: string;
  target: string;
};

type EdgeInsertionOptions<NodeType extends GeometryNode, EdgeType extends GeometryEdge> = {
  draggedNodeId: string;
  nodes: NodeType[];
  edges: EdgeType[];
  threshold?: number;
};

function centerOf(node: GeometryNode): GraphPoint {
  return {
    x: node.position.x + (node.width ?? 0) / 2,
    y: node.position.y + (node.height ?? 0) / 2
  };
}

export function distanceFromPointToSegment(point: GraphPoint, start: GraphPoint, end: GraphPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const projection = {
    x: start.x + t * dx,
    y: start.y + t * dy
  };

  return Math.hypot(point.x - projection.x, point.y - projection.y);
}

export function findEdgeInsertionTarget<NodeType extends GeometryNode, EdgeType extends GeometryEdge>({
  draggedNodeId,
  nodes,
  edges,
  threshold = 54
}: EdgeInsertionOptions<NodeType, EdgeType>): EdgeType | null {
  const draggedNode = nodes.find((node) => node.id === draggedNodeId);

  if (!draggedNode) {
    return null;
  }

  const draggedCenter = centerOf(draggedNode);
  let closestEdge: EdgeType | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const edge of edges) {
    if (edge.source === draggedNodeId || edge.target === draggedNodeId) {
      continue;
    }

    const source = nodes.find((node) => node.id === edge.source);
    const target = nodes.find((node) => node.id === edge.target);

    if (!source || !target) {
      continue;
    }

    const distance = distanceFromPointToSegment(draggedCenter, centerOf(source), centerOf(target));

    if (distance <= threshold && distance < closestDistance) {
      closestDistance = distance;
      closestEdge = edge;
    }
  }

  return closestEdge;
}

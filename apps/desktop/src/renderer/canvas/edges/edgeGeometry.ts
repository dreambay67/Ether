import type { EtherEdge } from "@ether/schema";

export type EdgeBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type EdgePoint = {
  x: number;
  y: number;
};

export type EdgeLane = {
  index: number;
  count: number;
};

export type EdgeGeometryInput = EdgePoint & {
  targetX: number;
  targetY: number;
  lane: EdgeLane;
};

export type EdgeLabelPlacementInput = EdgeGeometryInput & {
  sourceBounds?: EdgeBounds;
  targetBounds?: EdgeBounds;
};

const LABEL_ROW = 30;
const LABEL_GAP = 28;

function endpointKey(endpoint: EtherEdge["from"]): string {
  return endpoint.kind === "node"
    ? `node:${endpoint.nodeId}`
    : `module:${endpoint.moduleId}:${endpoint.portId}`;
}

/** Groups lanes by the node/module pair while leaving channel, role, and selector out of the key. */
export function edgeBundleKey(edge: Pick<EtherEdge, "from" | "to">): string {
  return `${endpointKey(edge.from)}->${endpointKey(edge.to)}`;
}

function center(bounds: EdgeBounds): EdgePoint {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function rackOffset(lane: EdgeLane): number {
  return Math.max(0, lane.index) * LABEL_ROW;
}

/**
 * Keeps an edge label in a dedicated gutter instead of the endpoint card's
 * content. The first lane sits nearest the cards; later lanes stack away from
 * the same gutter in a deterministic order.
 */
export function edgeLabelPlacement(input: EdgeLabelPlacementInput): EdgePoint {
  const sourceBounds = input.sourceBounds;
  const targetBounds = input.targetBounds;
  const count = Math.max(1, input.lane.count);

  if (sourceBounds !== undefined && targetBounds !== undefined) {
    const sourceCenter = center(sourceBounds);
    const targetCenter = center(targetBounds);
    const horizontal = Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y);

    if (horizontal) {
      const top = Math.min(sourceBounds.y, targetBounds.y);
      const bottom = Math.max(sourceBounds.y + sourceBounds.height, targetBounds.y + targetBounds.height);
      const above = top - LABEL_GAP - (count - 1) * LABEL_ROW >= 8;
      return {
        x: (sourceCenter.x + targetCenter.x) / 2,
        y: above
          ? top - LABEL_GAP - rackOffset(input.lane)
          : bottom + LABEL_GAP + rackOffset(input.lane)
      };
    }

    const left = Math.min(sourceBounds.x, targetBounds.x);
    const right = Math.max(sourceBounds.x + sourceBounds.width, targetBounds.x + targetBounds.width);
    const above = left - LABEL_GAP - (count - 1) * LABEL_ROW >= 8;
    return {
      x: above
        ? left - LABEL_GAP - rackOffset(input.lane)
        : right + LABEL_GAP + rackOffset(input.lane),
      y: (sourceCenter.y + targetCenter.y) / 2
    };
  }

  const horizontal = Math.abs(input.targetX - input.x) >= Math.abs(input.targetY - input.y);
  if (horizontal) {
    return {
      x: (input.x + input.targetX) / 2,
      y: Math.min(input.y, input.targetY) - 72 - rackOffset(input.lane)
    };
  }
  return {
    x: Math.min(input.x, input.targetX) - 96 - rackOffset(input.lane),
    y: (input.y + input.targetY) / 2
  };
}

function cubicPoint(start: EdgePoint, first: EdgePoint, second: EdgePoint, end: EdgePoint, t: number): EdgePoint {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * first.x + 3 * inverse * t ** 2 * second.x + t ** 3 * end.x,
    y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * first.y + 3 * inverse * t ** 2 * second.y + t ** 3 * end.y
  };
}

/**
 * Fans lanes with the same endpoints into a small, readable bundle. A null
 * result lets the renderer keep React Flow's canonical single-edge curve.
 */
export function bundledBezierPath(input: EdgeGeometryInput): { path: string; center: EdgePoint } | null {
  if (input.lane.count <= 1) return null;

  const start = { x: input.x, y: input.y };
  const end = { x: input.targetX, y: input.targetY };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const tangent = { x: dx / distance, y: dy / distance };
  const normal = { x: -tangent.y, y: tangent.x };
  const laneSpacing = Math.max(12, Math.min(20, 96 / input.lane.count));
  const laneOffset = (input.lane.index - (input.lane.count - 1) / 2) * laneSpacing;
  const controlDistance = Math.max(18, Math.min(110, distance * 0.35));
  const offset = { x: normal.x * laneOffset, y: normal.y * laneOffset };
  const first = {
    x: start.x + tangent.x * controlDistance + offset.x,
    y: start.y + tangent.y * controlDistance + offset.y
  };
  const second = {
    x: end.x - tangent.x * controlDistance + offset.x,
    y: end.y - tangent.y * controlDistance + offset.y
  };
  const middle = cubicPoint(start, first, second, end, 0.5);

  return {
    path: `M ${start.x},${start.y} C ${first.x},${first.y} ${second.x},${second.y} ${end.x},${end.y}`,
    center: middle
  };
}

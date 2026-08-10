import type { NodePosition } from "@ether/schema";

export function openCanvasPosition(
  origin: NodePosition,
  obstacles: readonly { position: NodePosition; size: { width: number; height: number } }[],
  candidateSize: { width: number; height: number } = { width: 220, height: 140 }
): NodePosition {
  const horizontalStep = Math.max(260, candidateSize.width + 40);
  const verticalStep = Math.max(180, candidateSize.height + 40);
  for (let radius = 0; radius <= 12; radius += 1) {
    for (let row = -radius; row <= radius; row += 1) {
      for (let column = -radius; column <= radius; column += 1) {
        if (radius > 0 && Math.abs(row) !== radius && Math.abs(column) !== radius) continue;
        const candidate = { x: origin.x + column * horizontalStep, y: origin.y + row * verticalStep };
        const occupied = obstacles.some((obstacle) => candidate.x < obstacle.position.x + obstacle.size.width + 20 && candidate.x + candidateSize.width > obstacle.position.x - 20 && candidate.y < obstacle.position.y + obstacle.size.height + 20 && candidate.y + candidateSize.height > obstacle.position.y - 20);
        if (!occupied) return candidate;
      }
    }
  }
  return { x: origin.x + obstacles.length * 32, y: origin.y + obstacles.length * 24 };
}

export function centeredCanvasPosition(center: NodePosition, size: { width: number; height: number }): NodePosition {
  return { x: center.x - size.width / 2, y: center.y - size.height / 2 };
}

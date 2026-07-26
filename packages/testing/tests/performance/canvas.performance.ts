import { describe, expect, it } from "vitest";
import { createThousandNodeFixture } from "../../fixtures/performance/index.js";
import { projectCanvasChannelActivity } from "../../../../apps/desktop/src/renderer/canvas/projection.js";

describe("canvas projection performance", () => {
  it("projects 1,000 nodes under the responsive-task budget", () => {
    const nodes = createThousandNodeFixture();
    const graph = {
      edges: nodes.slice(1).map((node, index) => ({
        id: `edge-${index}`,
        from: { kind: "node" as const, nodeId: nodes[index]!.id, channel: "text" as const },
        to: { kind: "node" as const, nodeId: node.id, channel: "text" as const },
        role: "general" as const,
        order: index,
        selector: { kind: "latest" as const },
        adapter: { kind: "auto" as const },
        enabled: true
      }))
    };
    const started = performance.now();
    const projected = projectCanvasChannelActivity(graph);
    const elapsed = performance.now() - started;
    expect(Object.keys(projected)).toHaveLength(1_000);
    expect(projected["node-0000"]?.output).toEqual(["text"]);
    expect(elapsed).toBeLessThan(50);
    console.info(`ETHER_PERFORMANCE_METRIC canvas-projection ${JSON.stringify({ nodeCount: nodes.length, edgeCount: graph.edges.length, elapsedMs: elapsed })}`);
  });
});

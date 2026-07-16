import { performance } from "node:perf_hooks";

import { assembleGenerationInputs, type EtherGraph } from "@ether/engine";
import { describe, expect, it } from "vitest";

const promptCount = 400;
const iterationCount = 25;
const budgetMs = 5_000;

function createFanInGraph(): EtherGraph {
  const promptNodes = Array.from({ length: promptCount }, (_, index) => ({
    id: `prompt-${index}`,
    type: "etherNode",
    position: { x: index, y: 0 },
    data: {
      definitionId: "prompt-prompt",
      kind: "Prompt",
      subtype: "Prompt",
      title: `Prompt ${index}`,
      label: `Prompt ${index}`,
      instruction: `fixed prompt instruction ${index}`,
      notes: "",
      status: "idle"
    }
  }));

  return {
    graphVersion: "2.5",
    nodes: [
      ...promptNodes,
      {
        id: "generation",
        type: "etherNode",
        position: { x: promptCount, y: 0 },
        data: {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image",
          title: "Generation",
          label: "Generation",
          instruction: "",
          notes: "",
          status: "idle"
        }
      }
    ],
    edges: promptNodes.map((node, index) => ({
      id: `edge-${index}`,
      source: node.id,
      target: "generation",
      data: { role: "general" }
    })),
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedSnapshotId: null,
    updatedAt: "2026-07-17T00:00:00.000Z"
  };
}

describe("prompt assembly performance", () => {
  it(`assembles ${promptCount} prompt lanes ${iterationCount} times within ${budgetMs}ms`, () => {
    const graph = createFanInGraph();
    assembleGenerationInputs(graph, "generation");

    let finalSectionCount = 0;
    let finalPrompt = "";
    const startedAt = performance.now();

    for (let iteration = 0; iteration < iterationCount; iteration += 1) {
      const assembly = assembleGenerationInputs(graph, "generation");
      finalSectionCount = assembly.sections.length;
      finalPrompt = assembly.prompt;
    }

    const elapsedMs = performance.now() - startedAt;

    expect(finalSectionCount).toBe(promptCount);
    expect(finalPrompt).toContain("General: fixed prompt instruction 0");
    expect(finalPrompt).toContain(`General ${promptCount}: fixed prompt instruction ${promptCount - 1}`);
    expect(elapsedMs).toBeLessThan(budgetMs);
  });
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createProject,
  executeGraphRun,
  listAssets,
  listRunRecords,
  markDownstreamStale,
  planExecution,
  runExecutionQueue,
  type CanvasNodeData,
  type EtherGraph,
  type ExecutionQueueItem
} from "@ether/engine";

const tempRoots: string[] = [];

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-execution-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function node(
  id: string,
  data: Partial<CanvasNodeData> & Pick<CanvasNodeData, "definitionId" | "kind" | "subtype">
) {
  const title = data.title ?? `${data.subtype} ${data.kind}`;

  return {
    id,
    type: "etherNode",
    position: { x: 0, y: 0 },
    data: {
      title,
      label: data.label ?? title,
      instruction: data.instruction ?? "",
      notes: data.notes ?? "",
      status: data.status ?? "idle",
      ...data
    }
  };
}

function edge(id: string, source: string, target: string, label = "prompt") {
  return { id, source, target, label, data: { label } };
}

function graph(nodes: EtherGraph["nodes"], edges: EtherGraph["edges"]): EtherGraph {
  return {
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedSnapshotId: null,
    updatedAt: "2026-06-17T00:00:00.000Z"
  };
}

function executionIds(items: ExecutionQueueItem[]) {
  return items.map((item) => `${item.nodeId}:${item.iteration}`);
}

describe("execution planning", () => {
  it("plans selected nodes in dependency order", () => {
    const canvas = graph(
      [
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        }),
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "clean studio portrait"
        })
      ],
      [edge("edge-prompt-generation", "prompt", "generation")]
    );

    const plan = planExecution(canvas, {
      policy: "selected",
      targetNodeIds: ["generation", "prompt"]
    });

    expect(executionIds(plan.items)).toEqual(["prompt:1", "generation:1"]);
    expect(plan.parallel).toBe(false);
  });

  it("refreshes upstream prompt artifacts before the target generation", () => {
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "silver product on acrylic"
        }),
        node("reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image",
          instruction: "use as framing context"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        edge("edge-prompt-generation", "prompt", "generation"),
        edge("edge-reference-generation", "reference", "generation", "reference")
      ]
    );

    const plan = planExecution(canvas, {
      policy: "refresh-upstream",
      targetNodeIds: ["generation"]
    });

    expect(executionIds(plan.items)).toEqual(["prompt:1", "reference:1", "generation:1"]);
  });

  it("uses cached inputs without rerunning upstream generation nodes", () => {
    const canvas = graph(
      [
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image",
          status: "complete"
        }),
        node("collection", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection"
        })
      ],
      [edge("edge-generation-collection", "generation", "collection", "result")]
    );

    const plan = planExecution(canvas, {
      policy: "cached-inputs",
      targetNodeIds: ["collection"]
    });

    expect(executionIds(plan.items)).toEqual(["collection:1"]);
  });

  it("runs queue items sequentially by default and in parallel when requested", async () => {
    const items: ExecutionQueueItem[] = [
      { nodeId: "first", iteration: 1 },
      { nodeId: "second", iteration: 1 }
    ];
    const sequentialStarts: string[] = [];
    let releaseFirst = () => undefined;
    const sequentialRun = runExecutionQueue(items, async (item) => {
      sequentialStarts.push(item.nodeId);

      if (item.nodeId === "first") {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }

      return item.nodeId;
    });

    await Promise.resolve();
    expect(sequentialStarts).toEqual(["first"]);
    releaseFirst();
    await expect(sequentialRun).resolves.toEqual(["first", "second"]);

    const parallelStarts: string[] = [];
    let releaseParallel = () => undefined;
    const parallelGate = new Promise<void>((resolve) => {
      releaseParallel = resolve;
    });
    const parallelRun = runExecutionQueue(
      items,
      async (item) => {
        parallelStarts.push(item.nodeId);
        await parallelGate;
        return item.nodeId;
      },
      { parallel: true }
    );

    await Promise.resolve();
    expect(parallelStarts.sort()).toEqual(["first", "second"]);
    releaseParallel();
    await expect(parallelRun).resolves.toEqual(["first", "second"]);
  });
});

describe("fake local execution", () => {
  it("runs a branch with exactly the requested fake generation count", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Branch Cap" });
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "soft chrome campaign hero"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [edge("edge-prompt-generation", "prompt", "generation")]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "branch",
      targetNodeIds: ["prompt"],
      runCountCap: 3,
      now: () => new Date("2026-06-17T12:00:00.000Z")
    });

    const generatedAssets = await listAssets(project.path, { kind: "generated" });
    const runRecords = await listRunRecords(project.path);
    const generationResults = result.results.filter(
      (entry) => entry.nodeId === "generation" && entry.status === "complete"
    );

    expect(generationResults).toHaveLength(3);
    expect(generatedAssets).toHaveLength(3);
    expect(runRecords).toHaveLength(3);
    expect(runRecords.map((record) => record.graphNodeId)).toEqual([
      "generation",
      "generation",
      "generation"
    ]);
  });

  it("refreshes prompts upstream before generating and writes fake provider lineage", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Refresh Upstream" });
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          title: "Campaign Prompt",
          instruction: "glass bottle under crisp studio light"
        }),
        node("negative", {
          definitionId: "prompt-negative",
          kind: "Prompt",
          subtype: "Negative",
          instruction: "no warped labels"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        edge("edge-prompt-generation", "prompt", "generation"),
        edge("edge-negative-generation", "negative", "generation", "negative")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "refresh-upstream",
      targetNodeIds: ["generation"],
      now: () => new Date("2026-06-17T13:00:00.000Z")
    });

    const promptNode = result.graph.nodes.find((candidate) => candidate.id === "prompt");
    const generationNode = result.graph.nodes.find((candidate) => candidate.id === "generation");
    const generatedAsset = (await listAssets(project.path, { kind: "generated" }))[0];

    expect(promptNode?.data).toMatchObject({
      status: "complete",
      rerunState: "complete",
      assembledPrompt: "glass bottle under crisp studio light"
    });
    expect(generationNode?.data).toMatchObject({
      status: "complete",
      rerunState: "complete",
      assembledPrompt: "glass bottle under crisp studio light",
      assembledNegativePrompt: "no warped labels",
      assetKind: "generated"
    });
    expect(generatedAsset?.metadata).toMatchObject({
      provider: "ether-fake-local",
      generationNodeId: "generation",
      lineage: {
        provider: "ether-fake-local",
        prompt: "glass bottle under crisp studio light",
        negativePrompt: "no warped labels"
      }
    });
    await expect(readFile(generatedAsset!.path, "utf8")).resolves.toContain(
      "glass bottle under crisp studio light"
    );
  });

  it("skips locked nodes without mutating their data", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Locked Nodes" });
    const canvas = graph(
      [
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image",
          locked: true,
          status: "complete",
          assetId: "existing-asset"
        })
      ],
      []
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["generation"],
      now: () => new Date("2026-06-17T14:00:00.000Z")
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "generation",
        status: "skipped",
        reason: "Node is locked"
      })
    ]);
    expect(result.graph.nodes[0]?.data).toMatchObject({
      locked: true,
      status: "complete",
      assetId: "existing-asset"
    });
    await expect(listAssets(project.path, { kind: "generated" })).resolves.toEqual([]);
  });

  it("marks downstream nodes stale after upstream edits and complete after rerun", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Rerun State" });
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "original prompt"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [edge("edge-prompt-generation", "prompt", "generation")]
    );
    const firstRun = await executeGraphRun(project.path, canvas, {
      policy: "refresh-upstream",
      targetNodeIds: ["generation"],
      now: () => new Date("2026-06-17T15:00:00.000Z")
    });

    const editedGraph = {
      ...firstRun.graph,
      nodes: firstRun.graph.nodes.map((candidate) =>
        candidate.id === "prompt"
          ? {
              ...candidate,
              data: {
                ...candidate.data,
                instruction: "revised prompt"
              }
            }
          : candidate
      )
    };
    const staleGraph = markDownstreamStale(editedGraph, ["prompt"], "2026-06-17T15:05:00.000Z");
    const staleGeneration = staleGraph.nodes.find((candidate) => candidate.id === "generation");

    expect(staleGeneration?.data).toMatchObject({
      rerunState: "stale",
      staleSince: "2026-06-17T15:05:00.000Z"
    });

    const secondRun = await executeGraphRun(project.path, staleGraph, {
      policy: "cached-inputs",
      targetNodeIds: ["generation"],
      now: () => new Date("2026-06-17T15:10:00.000Z")
    });
    const rerunGeneration = secondRun.graph.nodes.find((candidate) => candidate.id === "generation");

    expect(rerunGeneration?.data).toMatchObject({
      rerunState: "complete",
      assembledPrompt: "revised prompt"
    });
  });
});

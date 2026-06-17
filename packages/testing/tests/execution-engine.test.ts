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
  saveGeneratedAsset,
  saveMaskAsset,
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

  it("spends a branch generation cap across generation nodes in branch order", () => {
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General"
        }),
        node("generation-a", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        }),
        node("generation-b", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        edge("edge-prompt-generation-a", "prompt", "generation-a"),
        edge("edge-prompt-generation-b", "prompt", "generation-b")
      ]
    );

    const plan = planExecution(canvas, {
      policy: "branch",
      targetNodeIds: ["prompt"],
      runCountCap: 2
    });

    expect(executionIds(plan.items)).toEqual(["prompt:1", "generation-a:1", "generation-b:1"]);
  });

  it("keeps later generation jobs behind intervening dependencies when capped", () => {
    const canvas = graph(
      [
        node("generation-a", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        }),
        node("edit", {
          definitionId: "edit-crop",
          kind: "Edit",
          subtype: "Crop"
        }),
        node("generation-b", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        edge("edge-generation-a-edit", "generation-a", "edit", "result"),
        edge("edge-edit-generation-b", "edit", "generation-b", "prompt")
      ]
    );

    const plan = planExecution(canvas, {
      policy: "branch",
      targetNodeIds: ["generation-a"],
      runCountCap: 2
    });

    expect(executionIds(plan.items)).toEqual(["generation-a:1", "edit:1", "generation-b:1"]);
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

  it("serializes parallel queue work per node while allowing independent nodes to start", async () => {
    const starts: string[] = [];
    let releaseSameFirst = () => undefined;
    let releaseSameSecond = () => undefined;
    let releaseOther = () => undefined;

    const waitForSameFirst = new Promise<void>((resolve) => {
      releaseSameFirst = resolve;
    });
    const waitForSameSecond = new Promise<void>((resolve) => {
      releaseSameSecond = resolve;
    });
    const waitForOther = new Promise<void>((resolve) => {
      releaseOther = resolve;
    });

    const parallelRun = runExecutionQueue(
      [
        { nodeId: "same", iteration: 1 },
        { nodeId: "same", iteration: 2 },
        { nodeId: "other", iteration: 1 }
      ],
      async (item) => {
        starts.push(`${item.nodeId}:${item.iteration}`);

        if (item.nodeId === "same" && item.iteration === 1) {
          await waitForSameFirst;
        }
        if (item.nodeId === "same" && item.iteration === 2) {
          await waitForSameSecond;
        }
        if (item.nodeId === "other") {
          await waitForOther;
        }

        return `${item.nodeId}:${item.iteration}`;
      },
      { parallel: true }
    );

    await Promise.resolve();
    expect(starts).toEqual(["same:1", "other:1"]);

    releaseSameFirst();
    await Promise.resolve();
    await Promise.resolve();
    expect(starts).toEqual(["same:1", "other:1", "same:2"]);

    releaseSameSecond();
    releaseOther();
    await expect(parallelRun).resolves.toEqual(["same:1", "same:2", "other:1"]);
  });

  it("runs parallel queue groups by dependency layer", async () => {
    const starts: string[] = [];
    let releaseFirst = () => undefined;
    let releaseSecond = () => undefined;
    let releaseDownstream = () => undefined;
    const waitForFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const waitForSecond = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const waitForDownstream = new Promise<void>((resolve) => {
      releaseDownstream = resolve;
    });
    const options = {
      parallel: true,
      dependencies: new Map([["downstream", ["first", "second"]]])
    };

    const parallelRun = runExecutionQueue(
      [
        { nodeId: "first", iteration: 1 },
        { nodeId: "second", iteration: 1 },
        { nodeId: "downstream", iteration: 1 }
      ],
      async (item) => {
        starts.push(item.nodeId);

        if (item.nodeId === "first") {
          await waitForFirst;
        }
        if (item.nodeId === "second") {
          await waitForSecond;
        }
        if (item.nodeId === "downstream") {
          await waitForDownstream;
        }

        return item.nodeId;
      },
      options
    );

    await Promise.resolve();
    expect([...starts].sort()).toEqual(["first", "second"]);

    releaseFirst();
    await Promise.resolve();
    await Promise.resolve();
    expect([...starts].sort()).toEqual(["first", "second"]);

    releaseSecond();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect([...starts].sort()).toEqual(["downstream", "first", "second"]);

    releaseDownstream();
    await expect(parallelRun).resolves.toEqual(["first", "second", "downstream"]);
  });
});

describe("fake local execution", () => {
  it("runs Assistant text nodes and stores visible deterministic lineage", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Assistant Text" });
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "chrome bottle in a quiet campaign set"
        }),
        ...[
          ["brainstormer", "Brainstormer"],
          ["mutator", "Mutator"],
          ["expander", "Expander"],
          ["reinforcer", "Reinforcer"]
        ].map(([id, subtype]) =>
          node(id, {
            definitionId: `assistant-${subtype.toLowerCase()}`,
            kind: "Assistant",
            subtype,
            instruction: `${subtype} direction`,
            mutationSeed: "phase-8-seed",
            mutationPreset: "Lens Shift",
            variationStrength: 55,
            lockedTerms: "chrome bottle"
          } as any)
        )
      ],
      [
        edge("edge-prompt-brainstormer", "prompt", "brainstormer", "context"),
        edge("edge-prompt-mutator", "prompt", "mutator", "context"),
        edge("edge-prompt-expander", "prompt", "expander", "context"),
        edge("edge-prompt-reinforcer", "prompt", "reinforcer", "context")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["brainstormer", "mutator", "expander", "reinforcer"],
      now: () => new Date("2026-06-17T15:00:00.000Z")
    });

    expect(result.results.map((entry) => [entry.nodeId, entry.action, entry.status])).toEqual([
      ["brainstormer", "assistant-text", "complete"],
      ["mutator", "assistant-text", "complete"],
      ["expander", "assistant-text", "complete"],
      ["reinforcer", "assistant-text", "complete"]
    ]);

    for (const assistantId of ["brainstormer", "mutator", "expander", "reinforcer"]) {
      const assistantNode = result.graph.nodes.find((candidate) => candidate.id === assistantId);

      expect(assistantNode?.data).toMatchObject({
        status: "complete",
        rerunState: "complete",
        textOutput: expect.stringContaining("chrome bottle"),
        textOutputArtifact: expect.objectContaining({
          engine: "local-deterministic-text-engine",
          sourceText: expect.stringContaining("chrome bottle"),
          resultText: expect.stringContaining("chrome bottle"),
          settings: expect.objectContaining({
            seed: "phase-8-seed",
            preset: "Lens Shift"
          })
        })
      });
    }
  });

  it("applies seed-stable prompt mutation while preserving locked terms", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Prompt Mutation" });
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-subject",
          kind: "Prompt",
          subtype: "Subject",
          instruction: "a reflective launch portrait",
          mutationEnabled: true,
          mutationSeed: "same-seed",
          mutationPreset: "Material Swap",
          variationStrength: 70,
          novelty: 45,
          drift: 20,
          preserveSubject: 90,
          preserveStyle: 70,
          lockedTerms: "ETHER mark, chrome bottle",
          negativeConstraints: "no distorted logo",
          mutationInstruction: "keep the product premium"
        } as any)
      ],
      []
    );

    const request = {
      policy: "selected" as const,
      targetNodeIds: ["prompt"],
      now: () => new Date("2026-06-17T15:10:00.000Z")
    };
    const first = await executeGraphRun(project.path, canvas, request);
    const second = await executeGraphRun(project.path, canvas, request);
    const changedSeed = await executeGraphRun(
      project.path,
      graph(
        [
          {
            ...canvas.nodes[0]!,
            data: {
              ...canvas.nodes[0]!.data,
              mutationSeed: "different-seed"
            }
          }
        ],
        []
      ),
      request
    );

    const firstPrompt = first.graph.nodes[0]?.data.assembledPrompt;
    const secondPrompt = second.graph.nodes[0]?.data.assembledPrompt;
    const changedPrompt = changedSeed.graph.nodes[0]?.data.assembledPrompt;

    expect(firstPrompt).toBe(secondPrompt);
    expect(changedPrompt).not.toBe(firstPrompt);
    expect(firstPrompt).toContain("ETHER mark");
    expect(firstPrompt).toContain("chrome bottle");
    expect(first.graph.nodes[0]?.data.textOutputArtifact).toMatchObject({
      kind: "prompt-mutation",
      sourceText: "a reflective launch portrait",
      resultText: firstPrompt,
      settings: expect.objectContaining({
        seed: "same-seed",
        preset: "Material Swap",
        variationStrength: 70,
        novelty: 45,
        drift: 20,
        preserveSubject: 90,
        preserveStyle: 70,
        lockedTerms: ["ETHER mark", "chrome bottle"],
        negativeConstraints: "no distorted logo"
      })
    });
  });

  it("passes mutated prompt artifacts into downstream generation", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Mutated Generation" });
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "minimal studio product image",
          mutationEnabled: true,
          mutationSeed: "generation-seed",
          mutationPreset: "Lighting Weather",
          variationStrength: 60,
          lockedTerms: "DreamBay bottle"
        } as any),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [edge("edge-prompt-generation", "prompt", "generation", "prompt")]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "refresh-upstream",
      targetNodeIds: ["generation"],
      now: () => new Date("2026-06-17T15:20:00.000Z")
    });
    const promptNode = result.graph.nodes.find((candidate) => candidate.id === "prompt");
    const generationNode = result.graph.nodes.find((candidate) => candidate.id === "generation");
    const generatedAssets = await listAssets(project.path, { kind: "generated" });
    const generatedAsset = generatedAssets.find((asset) => asset.id === generationNode?.data.assetId);

    expect(promptNode?.data.assembledPrompt).toContain("DreamBay bottle");
    expect(promptNode?.data.assembledPrompt).not.toBe("minimal studio product image");
    expect(generationNode?.data.assembledPrompt).toBe(promptNode?.data.assembledPrompt);
    expect(generatedAsset?.metadata.lineage).toMatchObject({
      prompt: promptNode?.data.assembledPrompt,
      sections: [expect.objectContaining({ nodeId: "prompt", text: promptNode?.data.assembledPrompt })]
    });
  });

  it("runs an Inpaint edit with the fake provider and records parent lineage", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Fake Edit Lineage" });
    const parentAsset = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "parent.svg",
      content: "<svg xmlns=\"http://www.w3.org/2000/svg\"><title>parent</title></svg>",
      mimeType: "image/svg+xml",
      lineage: { prompt: "original parent" },
      now: new Date("2026-06-17T12:00:00.000Z")
    });
    const canvas = graph(
      [
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image",
          status: "complete",
          assetId: parentAsset.id,
          assetKind: parentAsset.kind,
          assetPath: parentAsset.path,
          assetMetadata: parentAsset.metadata
        }),
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "replace the label with a clean blue mark"
        }),
        node("edit", {
          definitionId: "edit-inpaint",
          kind: "Edit",
          subtype: "Inpaint",
          instruction: "repair only the label area",
          maskAssetId: "mask-asset-1" as any,
          maskAssetPath: path.join(project.path, "assets", "masks", "mask.svg") as any,
          maskMetadata: { overlay: "label area" } as any
        } as any)
      ],
      [
        edge("edge-generation-edit", "generation", "edit", "image"),
        edge("edge-prompt-edit", "prompt", "edit", "prompt")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "cached-inputs",
      targetNodeIds: ["edit"],
      now: () => new Date("2026-06-17T12:45:00.000Z")
    });

    const editResult = result.results.find((entry) => entry.nodeId === "edit");
    const editNode = result.graph.nodes.find((candidate) => candidate.id === "edit");
    const generatedAssets = await listAssets(project.path, { kind: "generated" });
    const editedAsset = generatedAssets.find((asset) => asset.id === editResult?.assetId);

    expect(editResult).toMatchObject({
      status: "complete",
      action: "edit",
      metadata: {
        provider: {
          id: "ether-fake-local",
          name: "Ether Fake Local",
          capabilities: expect.arrayContaining(["image.edit"])
        },
        sourceAsset: {
          id: parentAsset.id,
          path: parentAsset.path
        },
        mask: {
          assetId: "mask-asset-1",
          assetPath: path.join(project.path, "assets", "masks", "mask.svg")
        }
      }
    });
    expect(editNode?.data).toMatchObject({
      status: "complete",
      rerunState: "complete",
      assetId: editedAsset?.id,
      assetKind: "generated",
      assetPath: editedAsset?.path,
      sourceAssetId: parentAsset.id,
      sourceAssetPath: parentAsset.path,
      maskAssetId: "mask-asset-1",
      maskAssetPath: path.join(project.path, "assets", "masks", "mask.svg")
    });
    expect(editedAsset?.metadata).toMatchObject({
      provider: "ether-fake-local",
      editNodeId: "edit",
      editSubtype: "Inpaint",
      lineage: {
        edit: {
          nodeId: "edit",
          subtype: "Inpaint",
          instruction: "repair only the label area"
        },
        parent: {
          assetId: parentAsset.id,
          assetPath: parentAsset.path
        },
        mask: {
          assetId: "mask-asset-1",
          assetPath: path.join(project.path, "assets", "masks", "mask.svg")
        },
        prompt: "replace the label with a clean blue mark"
      }
    });
    await expect(readFile(editedAsset!.path, "utf8")).resolves.toContain("ETHER_FAKE_EDITED_IMAGE");
  });

  it("uses freshly rerun upstream image and mask assets before cached edit fields", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Fresh Edit Inputs" });
    const staleParentAsset = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "stale-parent.svg",
      content: "<svg xmlns=\"http://www.w3.org/2000/svg\"><title>stale parent</title></svg>",
      mimeType: "image/svg+xml",
      now: new Date("2026-06-17T11:00:00.000Z")
    });
    const staleMaskAsset = await saveMaskAsset(project.path, {
      editNodeId: "edit",
      sourceAssetId: staleParentAsset.id,
      sourceAssetPath: staleParentAsset.path,
      fileName: "stale-mask.svg",
      content: "<svg xmlns=\"http://www.w3.org/2000/svg\"><title>stale mask</title></svg>",
      mimeType: "image/svg+xml",
      now: new Date("2026-06-17T11:05:00.000Z")
    });
    const liveMaskAsset = await saveMaskAsset(project.path, {
      editNodeId: "mask-source",
      sourceAssetId: "live-mask-source",
      sourceAssetPath: path.join(project.path, "assets", "generated", "live.svg"),
      fileName: "live-mask.svg",
      content: "<svg xmlns=\"http://www.w3.org/2000/svg\"><title>live mask</title></svg>",
      mimeType: "image/svg+xml",
      metadata: { overlay: "fresh upstream mask" },
      now: new Date("2026-06-17T11:10:00.000Z")
    });
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "fresh parent image prompt"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image",
          status: "complete",
          assetId: staleParentAsset.id,
          assetKind: staleParentAsset.kind,
          assetPath: staleParentAsset.path,
          assetMetadata: staleParentAsset.metadata
        }),
        node("mask-source", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image",
          status: "complete",
          assetId: liveMaskAsset.id,
          assetKind: liveMaskAsset.kind,
          assetPath: liveMaskAsset.path,
          assetMetadata: liveMaskAsset.metadata
        }),
        node("edit", {
          definitionId: "edit-inpaint",
          kind: "Edit",
          subtype: "Inpaint",
          instruction: "repair using the fresh source",
          sourceAssetId: staleParentAsset.id,
          sourceAssetKind: staleParentAsset.kind,
          sourceAssetPath: staleParentAsset.path,
          sourceAssetMetadata: staleParentAsset.metadata,
          maskAssetId: staleMaskAsset.id,
          maskAssetPath: staleMaskAsset.path,
          maskMetadata: staleMaskAsset.metadata
        } as any)
      ],
      [
        edge("edge-prompt-generation", "prompt", "generation", "prompt"),
        edge("edge-generation-edit", "generation", "edit", "image"),
        edge("edge-mask-edit", "mask-source", "edit", "mask")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "refresh-upstream",
      targetNodeIds: ["edit"],
      now: () => new Date("2026-06-17T12:00:00.000Z")
    });
    const generationResult = result.results.find((entry) => entry.nodeId === "generation");
    const editResult = result.results.find((entry) => entry.nodeId === "edit");
    const editNode = result.graph.nodes.find((candidate) => candidate.id === "edit");
    const generatedAssets = await listAssets(project.path, { kind: "generated" });
    const freshParentAsset = generatedAssets.find((asset) => asset.id === generationResult?.assetId);
    const editedAsset = generatedAssets.find((asset) => asset.id === editResult?.assetId);

    expect(freshParentAsset?.id).toBeDefined();
    expect(freshParentAsset?.id).not.toBe(staleParentAsset.id);
    expect(editResult).toMatchObject({
      status: "complete",
      metadata: {
        sourceAsset: {
          id: freshParentAsset?.id,
          path: freshParentAsset?.path
        },
        mask: {
          assetId: liveMaskAsset.id,
          assetPath: liveMaskAsset.path
        }
      }
    });
    expect(editNode?.data).toMatchObject({
      sourceAssetId: freshParentAsset?.id,
      sourceAssetPath: freshParentAsset?.path,
      maskAssetId: liveMaskAsset.id,
      maskAssetPath: liveMaskAsset.path
    });
    expect(editedAsset?.metadata).toMatchObject({
      sourceAssetId: freshParentAsset?.id,
      sourceAssetPath: freshParentAsset?.path,
      maskAssetId: liveMaskAsset.id,
      maskAssetPath: liveMaskAsset.path,
      lineage: {
        parent: {
          assetId: freshParentAsset?.id,
          assetPath: freshParentAsset?.path
        },
        mask: {
          assetId: liveMaskAsset.id,
          assetPath: liveMaskAsset.path
        }
      }
    });
    await expect(readFile(editedAsset!.path, "utf8")).resolves.toContain(freshParentAsset!.id);
    await expect(readFile(editedAsset!.path, "utf8")).resolves.not.toContain(staleParentAsset.id);
  });

  it("reports a missing edit provider without writing generated edit assets", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Missing Edit Provider" });
    const parentAsset = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "parent.svg",
      content: "<svg xmlns=\"http://www.w3.org/2000/svg\"><title>parent</title></svg>"
    });
    const canvas = graph(
      [
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image",
          status: "complete",
          assetId: parentAsset.id,
          assetKind: parentAsset.kind,
          assetPath: parentAsset.path,
          assetMetadata: parentAsset.metadata
        }),
        node("edit", {
          definitionId: "edit-draw-and-note",
          kind: "Edit",
          subtype: "Draw & Note",
          instruction: "try a small annotation"
        })
      ],
      [edge("edge-generation-edit", "generation", "edit", "image")]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["edit"],
      providerId: "missing-provider"
    } as any);

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "edit",
        status: "error",
        action: "edit",
        reason: expect.stringMatching(/missing-provider.*not registered/i)
      })
    ]);
    expect(result.graph.nodes.find((candidate) => candidate.id === "edit")?.data?.assetId).toBeUndefined();
    await expect(listAssets(project.path, { kind: "generated" })).resolves.toEqual([
      expect.objectContaining({ id: parentAsset.id })
    ]);
  });

  it("runs fake/local Upscale edits with explicit local metadata", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Fake Upscale" });
    const parentAsset = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "parent.svg",
      content: "<svg xmlns=\"http://www.w3.org/2000/svg\"><title>parent</title></svg>"
    });
    const canvas = graph(
      [
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image",
          status: "complete",
          assetId: parentAsset.id,
          assetKind: parentAsset.kind,
          assetPath: parentAsset.path,
          assetMetadata: parentAsset.metadata
        }),
        node("upscale", {
          definitionId: "edit-upscale",
          kind: "Edit",
          subtype: "Upscale",
          instruction: "2x clean presentation upscale"
        })
      ],
      [edge("edge-generation-upscale", "generation", "upscale", "image")]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["upscale"]
    });
    const upscaleResult = result.results.find((entry) => entry.nodeId === "upscale");
    const editedAsset = (await listAssets(project.path, { kind: "generated" })).find(
      (asset) => asset.id === upscaleResult?.assetId
    );

    expect(upscaleResult).toMatchObject({
      status: "complete",
      action: "upscale",
      metadata: {
        provider: {
          id: "ether-fake-local",
          route: "local-fake"
        },
        operation: "upscale",
        localTool: {
          kind: "fake-deterministic-upscale",
          route: "local-fake"
        }
      }
    });
    expect(editedAsset?.metadata).toMatchObject({
      editSubtype: "Upscale",
      providerRoute: "local-fake",
      localTool: {
        kind: "fake-deterministic-upscale",
        route: "local-fake"
      },
      lineage: {
        edit: {
          operation: "upscale"
        }
      }
    });
  });

  it("uses the default fake image provider and records provider lineage", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Fake Provider Image" });
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "deterministic electric blue product render"
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
      policy: "refresh-upstream",
      targetNodeIds: ["generation"],
      now: () => new Date("2026-06-17T12:30:00.000Z")
    });

    const generatedAsset = (await listAssets(project.path, { kind: "generated" }))[0];

    expect(result.results.find((entry) => entry.nodeId === "generation")).toMatchObject({
      status: "complete",
      action: "generate",
      metadata: {
        provider: {
          id: "ether-fake-local",
          name: "Ether Fake Local"
        }
      }
    });
    expect(generatedAsset?.path.endsWith(".svg")).toBe(true);
    expect(generatedAsset?.metadata).toMatchObject({
      provider: "ether-fake-local",
      mimeType: "image/svg+xml",
      lineage: {
        provider: {
          id: "ether-fake-local",
          name: "Ether Fake Local",
          capabilities: expect.arrayContaining(["image.generate"])
        },
        iteration: 1,
        prompt: "deterministic electric blue product render"
      }
    });
    await expect(readFile(generatedAsset!.path, "utf8")).resolves.toContain(
      "ETHER_FAKE_GENERATED_IMAGE"
    );
  });

  it("reports a missing provider without writing generated assets", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Missing Provider" });
    const canvas = graph(
      [
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      []
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["generation"],
      providerId: "missing-provider"
    } as any);

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "generation",
        status: "error",
        action: "generate",
        reason: expect.stringMatching(/missing-provider.*not registered/i)
      })
    ]);
    expect(result.graph.nodes[0]?.data?.assetId).toBeUndefined();
    await expect(listAssets(project.path, { kind: "generated" })).resolves.toEqual([]);
  });

  it("reports unavailable provider diagnostics without writing generated assets", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Unavailable Provider" });
    const canvas = graph(
      [
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      []
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["generation"],
      providerId: "google-nano-banana-pro"
    } as any);

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "generation",
        status: "error",
        action: "generate",
        reason: expect.stringMatching(/google-nano-banana-pro.*clean local CLI\/MCP route/i)
      })
    ]);
    expect(result.graph.nodes[0]?.data?.assetId).toBeUndefined();
    await expect(listAssets(project.path, { kind: "generated" })).resolves.toEqual([]);
  });

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
    expect(runRecords).toHaveLength(4);
    expect(runRecords.filter((record) => record.metadata.action === "assemble-prompt")).toHaveLength(
      1
    );
    expect(runRecords.filter((record) => record.metadata.action === "generate")).toHaveLength(3);
    expect(runRecords.filter((record) => record.graphNodeId === "prompt")).toHaveLength(1);
    expect(runRecords.filter((record) => record.graphNodeId === "generation")).toHaveLength(3);
  });

  it("keeps parallel multi-iteration generation graph assets aligned with deterministic result order", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Parallel Fold" });
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "bright deterministic asset"
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
      parallel: true
    });

    const generationResults = result.results.filter(
      (entry) => entry.nodeId === "generation" && entry.status === "complete"
    );
    const finalGenerationResult = generationResults.at(-1);
    const finalGenerationNode = result.graph.nodes.find((candidate) => candidate.id === "generation");

    expect(finalGenerationResult).toMatchObject({
      action: "generate",
      iteration: 3,
      status: "complete"
    });
    expect(finalGenerationNode?.data?.assetId).toBe(finalGenerationResult?.assetId);
    expect(finalGenerationNode?.data?.assetPath).toBe(finalGenerationResult?.assetPath);
    expect(finalGenerationNode?.data?.assetMetadata).toMatchObject({
      generationNodeId: "generation",
      lineage: {
        iteration: 3
      }
    });
  });

  it("preflights cyclic parallel dependencies before independent durable work starts", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Parallel Cycle Preflight" });
    const canvas = graph(
      [
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        }),
        node("prompt-a", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "cycle prompt a"
        }),
        node("prompt-b", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "cycle prompt b"
        })
      ],
      [
        edge("edge-prompt-a-prompt-b", "prompt-a", "prompt-b"),
        edge("edge-prompt-b-prompt-a", "prompt-b", "prompt-a")
      ]
    );

    await expect(
      executeGraphRun(project.path, canvas, {
        policy: "selected",
        targetNodeIds: ["generation", "prompt-a", "prompt-b"],
        parallel: true
      })
    ).rejects.toThrow(/cyclic|unsatisfied/i);

    await expect(listAssets(project.path, { kind: "generated" })).resolves.toEqual([]);
    await expect(listRunRecords(project.path)).resolves.toEqual([]);
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
        provider: {
          id: "ether-fake-local"
        },
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
    expect(rerunGeneration?.data?.staleSince).toBeUndefined();
  });

  it("preserves linked Reference assets when marking an edited reference stale", () => {
    const canvas = graph(
      [
        node("reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image",
          status: "complete",
          assetId: "reference-asset-1",
          assetKind: "reference",
          assetPath: "C:\\Project\\assets\\references\\reference.png",
          assetMetadata: {
            source: "linked-file"
          }
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [edge("edge-reference-generation", "reference", "generation", "reference")]
    );

    const staleGraph = markDownstreamStale(canvas, ["reference"], "2026-06-17T16:30:00.000Z");
    const staleReference = staleGraph.nodes.find((candidate) => candidate.id === "reference");

    expect(staleReference?.data).toMatchObject({
      rerunState: "stale",
      staleSince: "2026-06-17T16:30:00.000Z",
      assetId: "reference-asset-1",
      assetKind: "reference",
      assetPath: "C:\\Project\\assets\\references\\reference.png",
      assetMetadata: {
        source: "linked-file"
      }
    });
  });

  it("skips unsupported selected nodes without marking them complete and records the skip", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Unsupported Skip" });
    const canvas = graph(
      [
        node("reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image",
          status: "idle",
          rerunState: "stale",
          staleSince: "2026-06-17T16:00:00.000Z"
        })
      ],
      []
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["reference"]
    });

    const referenceAfterRun = result.graph.nodes.find((candidate) => candidate.id === "reference");
    const runRecords = await listRunRecords(project.path);

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "reference",
        status: "skipped",
        action: "unsupported"
      })
    ]);
    expect(referenceAfterRun?.data?.status).toBe("idle");
    expect(referenceAfterRun?.data?.rerunState).toBe("stale");
    expect(runRecords).toHaveLength(1);
    expect(runRecords[0]?.status).toBe("skipped");
    expect(runRecords[0]?.metadata).toMatchObject({
      action: "unsupported",
      iteration: 1,
      policy: "selected"
    });
  });

  it("records prompt and store execution ledger entries", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Ledger Entries" });
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-general",
          kind: "Prompt",
          subtype: "General",
          instruction: "catalog the asset"
        }),
        node("collection", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection",
          collectionName: "finals"
        })
      ],
      []
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["prompt", "collection"]
    });

    expect(result.results.map((entry) => entry.action)).toEqual([
      "assemble-prompt",
      "ensure-collection"
    ]);
    expect(
      (await listRunRecords(project.path))
        .map((record) => record.metadata.action)
        .sort()
    ).toEqual(["assemble-prompt", "ensure-collection"].sort());
  });
});

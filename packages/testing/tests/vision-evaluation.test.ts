import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexCliVisionEvaluationProvider,
  type ProviderProcessCall,
  type VisionEvaluationProviderInput
} from "@ether/providers";
import {
  createProject,
  executeGraphRun,
  listArtifacts,
  listAssetMoves,
  listAssets,
  listProviderRuns,
  saveGeneratedAsset,
  type CanvasNodeData,
  type EtherGraph
} from "@ether/engine";

const tempRoots: string[] = [];

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-vision-evaluation-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function node(
  id: string,
  data: Partial<CanvasNodeData> &
    Pick<CanvasNodeData, "definitionId" | "kind" | "subtype"> &
    Record<string, unknown>
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
    graphVersion: "2.5",
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedSnapshotId: null,
    updatedAt: "2026-06-28T00:00:00.000Z"
  };
}

function recordValue(value: unknown, label = "value"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${label} to be an object.`);
  }

  return value as Record<string, unknown>;
}

function nodeData(node: EtherGraph["nodes"][number] | undefined): Record<string, unknown> {
  return recordValue(node?.data, "node data");
}

function evaluationInput(projectPath: string, imagePaths: string[]): VisionEvaluationProviderInput {
  return {
    projectPath,
    runId: "run-eval",
    evaluationNodeId: "evaluate",
    instruction: "Pass sharp DreamBay-ready hero images.",
    criteria: "Score visual polish, brand fit, and obvious rendering problems.",
    threshold: 70,
    images: imagePaths.map((imagePath, index) => ({
      id: `image-${index + 1}`,
      nodeId: `generation-${index + 1}`,
      title: `Hero ${index + 1}`,
      assetId: `asset-${index + 1}`,
      assetKind: "generated",
      assetPath: imagePath,
      tags: index === 0 ? ["keeper"] : ["needs-polish"],
      decision: index === 0 ? "select" : "needs-edit",
      notes: ""
    })),
    requestedAt: "2026-06-28T12:00:00.000Z"
  };
}

async function writeProviderResult(call: ProviderProcessCall, result: unknown) {
  const prompt = (call as ProviderProcessCall & { stdin?: string }).stdin ?? "";
  const outputDir = /Output directory:\s*([\s\S]+?)\n\n/.exec(prompt)?.[1]?.trim();

  if (!outputDir) {
    throw new Error("Output directory was not included in the Codex evaluation stdin prompt.");
  }

  await writeFile(path.join(outputDir, "result.json"), JSON.stringify(result), "utf8");
}

describe("vision evaluation provider", () => {
  it("evaluates one image with an instruction through a fake Codex vision runner", async () => {
    const projectPath = await createTempRoot();
    const imagePath = path.join(projectPath, "hero.png");
    await writeFile(imagePath, "fake image");
    const calls: ProviderProcessCall[] = [];
    const provider = new CodexCliVisionEvaluationProvider({
      codexCliPath: "C:\\Tools\\codex.exe",
      env: {
        OPENAI_API_KEY: "sk-must-not-leak",
        PATH: "C:\\Windows\\System32"
      },
      fileExists: async () => true,
      runner: async (call) => {
        calls.push(call);
        await writeProviderResult(call, {
          id: "run-eval-evaluate",
          status: "complete",
          items: [
            {
              id: "image-1",
              assetId: "asset-1",
              score: 91,
              tags: ["keeper", "sharp"],
              decision: "pass",
              confidence: 0.86,
              explanation: "Strong hero composition with clean product detail.",
              detectedIssues: []
            }
          ],
          summary: "One image passed.",
          error: null,
          caveats: ""
        });
        return { stdout: "{\"ok\":true}", stderr: "", exitCode: 0 };
      }
    });

    const result = await provider.evaluate(evaluationInput(projectPath, [imagePath]));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(expect.arrayContaining(["exec", "--image", imagePath]));
    expect(calls[0]?.env.OPENAI_API_KEY).toBeUndefined();
    expect(calls[0]?.args.join(" ")).not.toContain("sk-must-not-leak");
    expect(calls[0]?.args.at(-1)).toBe("-");
    expect((calls[0] as ProviderProcessCall & { stdin?: string }).stdin).toContain("Do not use OPENAI_API_KEY");
    expect((calls[0] as ProviderProcessCall & { stdin?: string }).stdin).toContain("Pass sharp DreamBay-ready hero images.");
    expect(result).toMatchObject({
      providerId: "codex-vision-evaluation",
      items: [
        {
          id: "image-1",
          assetId: "asset-1",
          score: 91,
          tags: ["keeper", "sharp"],
          decision: "pass",
          confidence: 0.86,
          explanation: "Strong hero composition with clean product detail.",
          detectedIssues: []
        }
      ]
    });
  });

  it("evaluates multiple images and validates score, tags, decision, confidence, explanation, and detected issues", async () => {
    const projectPath = await createTempRoot();
    const firstPath = path.join(projectPath, "first.png");
    const secondPath = path.join(projectPath, "second.png");
    await writeFile(firstPath, "first image");
    await writeFile(secondPath, "second image");
    const calls: ProviderProcessCall[] = [];
    const provider = new CodexCliVisionEvaluationProvider({
      codexCliPath: "C:\\Tools\\codex.exe",
      fileExists: async () => true,
      runner: async (call) => {
        calls.push(call);
        await writeProviderResult(call, {
          id: "run-eval-evaluate",
          status: "complete",
          items: [
            {
              id: "image-1",
              assetId: "asset-1",
              score: 88,
              tags: ["brand-fit"],
              decision: "pass",
              confidence: 0.81,
              explanation: "Polished and usable.",
              detectedIssues: []
            },
            {
              id: "image-2",
              assetId: "asset-2",
              score: 42,
              tags: ["warped-label"],
              decision: "fail",
              confidence: 0.74,
              explanation: "The label is visibly distorted.",
              detectedIssues: ["warped label", "soft product edge"]
            }
          ],
          summary: "One pass and one fail.",
          error: null,
          caveats: ""
        });
        return { stdout: "", stderr: "", exitCode: 0 };
      }
    });

    const result = await provider.evaluate(evaluationInput(projectPath, [firstPath, secondPath]));

    expect(calls[0]?.args).toEqual(expect.arrayContaining(["--image", firstPath, "--image", secondPath]));
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      score: 88,
      tags: ["brand-fit"],
      decision: "pass",
      confidence: 0.81,
      explanation: "Polished and usable.",
      detectedIssues: []
    });
    expect(result.items[1]).toMatchObject({
      score: 42,
      tags: ["warped-label"],
      decision: "fail",
      confidence: 0.74,
      explanation: "The label is visibly distorted.",
      detectedIssues: ["warped label", "soft product edge"]
    });
  });
});

describe("vision evaluation execution", () => {
  it("uses deterministic evaluation without calling the provider when inputs have no image paths", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Metadata Only Evaluation" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "metadata-only.png",
      content: "fake image",
      metadata: { variant: "metadata-only" },
      now: new Date("2026-06-28T12:01:00.000Z")
    });
    const calls: ProviderProcessCall[] = [];
    const canvas = graph(
      [
        node("compare", {
          definitionId: "store-compare",
          kind: "Store",
          subtype: "Compare",
          status: "complete",
          compareArtifact: {
            items: [
              {
                assetId: generated.id,
                rating: 5,
                tags: ["keeper"],
                decision: "select",
                notes: "Approved from metadata."
              }
            ]
          }
        }),
        node("evaluate", {
          definitionId: "store-evaluate",
          kind: "Store",
          subtype: "Evaluate",
          instruction: "Pass approved assets.",
          evaluationThreshold: 70
        })
      ],
      [edge("edge-compare-evaluate", "compare", "evaluate", "review")]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["evaluate"],
      evaluationCodexCliPath: "C:\\Tools\\codex.exe",
      evaluationProviderFileExists: async () => true,
      evaluationProviderRunner: async (call: ProviderProcessCall) => {
        calls.push(call);
        throw new Error("Provider should not be called without image paths.");
      },
      now: () => new Date("2026-06-28T12:06:00.000Z")
    } as any);
    const evaluateNode = result.graph.nodes.find((candidate) => candidate.id === "evaluate");
    const providerRuns = await listProviderRuns(project.path);

    expect(calls).toEqual([]);
    expect(providerRuns).toEqual([]);
    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "evaluate",
        status: "complete",
        action: "evaluate"
      })
    ]);
    expect(nodeData(evaluateNode).evaluationArtifact).toMatchObject({
      kind: "evaluation",
      items: [
        expect.objectContaining({
          assetId: generated.id,
          decision: "pass",
          tags: ["keeper"]
        })
      ]
    });
    expect(nodeData(evaluateNode).evaluationArtifact).not.toHaveProperty("provider");
  });

  it("creates an evaluation artifact from provider output and Filter uses the evaluation decision", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Vision Evaluation Filter" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "input.png",
      content: "fake image",
      metadata: { variant: "hero" },
      now: new Date("2026-06-28T12:05:00.000Z")
    });
    const calls: ProviderProcessCall[] = [];
    const canvas = graph(
      [
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image",
          status: "complete",
          assetId: generated.id,
          assetKind: generated.kind,
          assetPath: generated.path,
          assetMetadata: generated.metadata
        }),
        node("evaluate", {
          definitionId: "store-evaluate",
          kind: "Store",
          subtype: "Evaluate",
          instruction: "Reject images with distorted product typography.",
          evaluationThreshold: 70
        }),
        node("filter", {
          definitionId: "store-filter",
          kind: "Store",
          subtype: "Filter",
          filterAutoApply: true,
          filterRules: "pass -> Selected; fail -> Rejected"
        }),
        node("selected", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection",
          title: "Selected",
          label: "Selected"
        }),
        node("rejected", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection",
          title: "Rejected",
          label: "Rejected"
        })
      ],
      [
        edge("edge-generation-evaluate", "generation", "evaluate", "result"),
        edge("edge-evaluate-filter", "evaluate", "filter", "evaluation"),
        edge("edge-filter-selected", "filter", "selected", "pass"),
        edge("edge-filter-rejected", "filter", "rejected", "fail")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["evaluate", "filter"],
      evaluationCodexCliPath: "C:\\Tools\\codex.exe",
      evaluationProviderFileExists: async () => true,
      evaluationProviderRunner: async (call: ProviderProcessCall) => {
        calls.push(call);
        await writeProviderResult(call, {
          id: "run-eval-evaluate",
          status: "complete",
          items: [
            {
              id: generated.id,
              assetId: generated.id,
              score: 38,
              tags: ["warped-label"],
              decision: "fail",
              confidence: 0.82,
              explanation: "The product typography is distorted.",
              detectedIssues: ["distorted product typography"]
            }
          ],
          summary: "Reject distorted typography.",
          error: null,
          caveats: ""
        });
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      now: () => new Date("2026-06-28T12:10:00.000Z")
    } as any);

    const evaluateNode = result.graph.nodes.find((candidate) => candidate.id === "evaluate");
    const filterNode = result.graph.nodes.find((candidate) => candidate.id === "filter");
    const [movedAsset] = await listAssets(project.path, { kind: "generated" });
    const moves = await listAssetMoves(project.path, { assetId: generated.id });
    const providerRuns = await listProviderRuns(project.path);

    expect(calls).toHaveLength(1);
    expect(result.results.map((entry) => entry.action)).toEqual(["evaluate-codex", "filter-route"]);
    expect(providerRuns).toEqual([
      expect.objectContaining({
        providerId: "codex-vision-evaluation",
        status: "complete",
        request: expect.objectContaining({
          operation: "evaluation.vision",
          nodeId: "evaluate",
          iteration: 1,
          policy: "selected",
          providerInput: expect.objectContaining({
            evaluationNodeId: "evaluate",
            threshold: 70,
            images: [expect.objectContaining({ assetId: generated.id })]
          })
        }),
        response: expect.objectContaining({
          providerId: "codex-vision-evaluation",
          itemCount: 1,
          artifactCount: 1,
          artifactIds: expect.any(Array)
        }),
        error: null
      })
    ]);
    expect(nodeData(evaluateNode).evaluationArtifact).toMatchObject({
      provider: {
        id: "codex-vision-evaluation"
      },
      items: [
        expect.objectContaining({
          assetId: generated.id,
          score: 38,
          decision: "fail",
          confidence: 0.82,
          explanation: "The product typography is distorted.",
          detectedIssues: ["distorted product typography"]
        })
      ]
    });
    await expect(listArtifacts(project.path, { kind: "evaluation" })).resolves.toEqual([
      expect.objectContaining({
        nodeId: "evaluate",
        metadata: expect.objectContaining({
          kind: "evaluation",
          evaluateNodeId: "evaluate",
          provider: expect.objectContaining({ id: "codex-vision-evaluation" }),
          items: [
            expect.objectContaining({
              assetId: generated.id,
              score: 38,
              decision: "fail",
              confidence: 0.82,
              explanation: "The product typography is distorted.",
              detectedIssues: ["distorted product typography"]
            })
          ]
        })
      })
    ]);
    expect(nodeData(filterNode).filterResult).toMatchObject({
      routed: [
        expect.objectContaining({
          assetId: generated.id,
          decision: "fail",
          targetCollectionName: "Rejected",
          moved: true
        })
      ]
    });
    expect(movedAsset?.path).toContain(`${path.sep}collections${path.sep}Rejected${path.sep}`);
    expect(moves[0]).toMatchObject({
      assetId: generated.id,
      reason: "Filter filter routed fail to Rejected"
    });
    await expect(readFile(movedAsset!.path, "utf8")).resolves.toBe("fake image");
  });

  it("ignores mismatched provider result identities and routes from deterministic fallback", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Mismatched Provider Result" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "candidate.png",
      content: "fake image",
      metadata: { variant: "candidate" },
      now: new Date("2026-06-28T12:15:00.000Z")
    });
    const calls: ProviderProcessCall[] = [];
    const canvas = graph(
      [
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image",
          status: "complete",
          assetId: generated.id,
          assetKind: generated.kind,
          assetPath: generated.path,
          assetMetadata: generated.metadata
        }),
        node("evaluate", {
          definitionId: "store-evaluate",
          kind: "Store",
          subtype: "Evaluate",
          instruction: "Reject only visibly broken product images.",
          evaluationThreshold: 70
        }),
        node("filter", {
          definitionId: "store-filter",
          kind: "Store",
          subtype: "Filter",
          filterAutoApply: true,
          filterRules: "pass -> Selected; needs-edit -> Needs Edit; fail -> Rejected"
        }),
        node("selected", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection",
          title: "Selected",
          label: "Selected"
        }),
        node("needs-edit", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection",
          title: "Needs Edit",
          label: "Needs Edit"
        }),
        node("rejected", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection",
          title: "Rejected",
          label: "Rejected"
        })
      ],
      [
        edge("edge-generation-evaluate", "generation", "evaluate", "result"),
        edge("edge-evaluate-filter", "evaluate", "filter", "evaluation"),
        edge("edge-filter-selected", "filter", "selected", "pass"),
        edge("edge-filter-needs-edit", "filter", "needs-edit", "needs-edit"),
        edge("edge-filter-rejected", "filter", "rejected", "fail")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["evaluate", "filter"],
      evaluationCodexCliPath: "C:\\Tools\\codex.exe",
      evaluationProviderFileExists: async () => true,
      evaluationProviderRunner: async (call: ProviderProcessCall) => {
        calls.push(call);
        await writeProviderResult(call, {
          id: "run-eval-evaluate",
          status: "complete",
          items: [
            {
              id: "wrong-image-id",
              assetId: "wrong-asset-id",
              score: 12,
              tags: ["mismatched-failure"],
              decision: "fail",
              confidence: 0.91,
              explanation: "This belongs to a different submitted image.",
              detectedIssues: ["wrong asset"]
            },
            {
              id: "extra-unrelated-image",
              assetId: "extra-unrelated-asset",
              score: 96,
              tags: ["extra"],
              decision: "pass",
              confidence: 0.88,
              explanation: "An unrelated extra provider item.",
              detectedIssues: []
            }
          ],
          summary: "The returned items do not match the submitted image.",
          error: null,
          caveats: ""
        });
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      now: () => new Date("2026-06-28T12:20:00.000Z")
    } as any);

    const evaluateNode = result.graph.nodes.find((candidate) => candidate.id === "evaluate");
    const filterNode = result.graph.nodes.find((candidate) => candidate.id === "filter");
    const [movedAsset] = await listAssets(project.path, { kind: "generated" });
    const moves = await listAssetMoves(project.path, { assetId: generated.id });

    expect(calls).toHaveLength(1);
    expect(nodeData(evaluateNode).evaluationArtifact).toMatchObject({
      provider: {
        id: "codex-vision-evaluation"
      },
      items: [
        expect.objectContaining({
          assetId: generated.id,
          decision: "needs-edit",
          score: 50,
          tags: []
        })
      ]
    });
    expect(nodeData(evaluateNode).evaluationArtifact).not.toMatchObject({
      items: [
        expect.objectContaining({
          tags: expect.arrayContaining(["mismatched-failure"]),
          decision: "fail"
        })
      ]
    });
    expect(nodeData(filterNode).filterResult).toMatchObject({
      routed: [
        expect.objectContaining({
          assetId: generated.id,
          decision: "needs-edit",
          targetCollectionName: "Needs Edit",
          moved: true
        })
      ]
    });
    expect(movedAsset?.path).toContain(`${path.sep}collections${path.sep}Needs Edit${path.sep}`);
    expect(moves[0]).toMatchObject({
      assetId: generated.id,
      reason: "Filter filter routed needs-edit to Needs Edit"
    });
  });
});

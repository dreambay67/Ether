import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CODEX_PROVIDER_ID, FAKE_PROVIDER_ID, type ProviderProcessCall } from "@ether/providers";
import {
  completeProviderRun,
  createArtifact,
  createProviderRun,
  createProject,
  executeGraphRun,
  ensureCollectionFolder,
  failProviderRun,
  listArtifacts,
  listArtifactsByCollection,
  listAssetMoves,
  listAssets,
  listProviderRuns,
  listRunRecords,
  markDownstreamStale,
  planExecution,
  runExecutionQueue,
  saveGeneratedAsset,
  saveMaskAsset,
  updateAssetMetadata,
  type CanvasNodeData,
  type EtherGraph,
  type ExecutionQueueItem
} from "@ether/engine";

const tempRoots: string[] = [];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function expectPng(filePath: string, dimensions?: { width: number; height: number }) {
  const bytes = await readFile(filePath);
  expect(bytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
  expect(bytes.toString("ascii", 12, 16)).toBe("IHDR");
  if (dimensions !== undefined) {
    expect({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }).toEqual(dimensions);
  }
  return bytes;
}

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

function unavailableAdapterEdge(
  id: string,
  source: string,
  target: string,
  data: Record<string, unknown> = {}
) {
  return {
    id,
    source,
    target,
    label: "reference",
    data: {
      label: "reference",
      graphVersion: "2.5",
      sourceChannel: "image",
      targetChannel: "text",
      role: "reference",
      adapter: {
        operation: "caption",
        providerId: "visual-description",
        status: "unavailable",
        reason: "Adapter reason from provider setup."
      },
      ...data
    }
  };
}

function graph(nodes: EtherGraph["nodes"], edges: EtherGraph["edges"]): EtherGraph {
  return {
    graphVersion: "2.5",
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

function providerStdin(call: ProviderProcessCall) {
  return (call as ProviderProcessCall & { stdin?: string }).stdin ?? "";
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

const simulationProvider = {
  providerId: FAKE_PROVIDER_ID
};

describe("execution planning", () => {
  it("persists failed provider runs when Error objects contain enumerable cycles", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Cyclic Provider Error" });
    const providerRun = createProviderRun(project.path, {
      runId: "run-cyclic-error",
      providerId: "provider-cyclic-error",
      request: { operation: "image.generate" },
      now: new Date("2026-06-30T12:00:00.000Z")
    });
    const error = new Error("Provider error with cyclic diagnostic.");
    (error as Error & { self?: unknown }).self = error;

    const failed = failProviderRun(
      project.path,
      providerRun.id,
      error,
      new Date("2026-06-30T12:01:00.000Z")
    );
    const [listed] = await listProviderRuns(project.path);

    expect(failed).toMatchObject({
      id: providerRun.id,
      status: "failed",
      error: expect.objectContaining({
        name: "Error",
        message: "Provider error with cyclic diagnostic.",
        self: "[omitted:cyclic]"
      })
    });
    expect(listed).toMatchObject({
      id: providerRun.id,
      error: expect.objectContaining({
        self: "[omitted:cyclic]"
      })
    });
  });

  it("bounds huge provider run JSON strings in requests responses and errors", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Bounded Provider Strings" });
    const hugeDataUri = `data:image/png;base64,${"a".repeat(20000)}`;
    const requestRun = createProviderRun(project.path, {
      runId: "run-huge-request",
      providerId: "provider-huge-request",
      request: { dataUri: hugeDataUri }
    });
    const responseRun = createProviderRun(project.path, {
      runId: "run-huge-response",
      providerId: "provider-huge-response",
      request: { ok: true }
    });
    const errorRun = createProviderRun(project.path, {
      runId: "run-huge-error",
      providerId: "provider-huge-error",
      request: { ok: true }
    });

    completeProviderRun(project.path, responseRun.id, { outputText: hugeDataUri });
    failProviderRun(project.path, errorRun.id, { message: hugeDataUri });

    const providerRuns = await listProviderRuns(project.path);
    const request = providerRuns.find((entry) => entry.id === requestRun.id)?.request as { dataUri?: string };
    const response = providerRuns.find((entry) => entry.id === responseRun.id)?.response as { outputText?: string };
    const error = providerRuns.find((entry) => entry.id === errorRun.id)?.error as { message?: string };

    expect(request.dataUri?.length).toBeLessThan(6000);
    expect(response.outputText?.length).toBeLessThan(6000);
    expect(error.message?.length).toBeLessThan(6000);
    expect(request.dataUri).toContain("[truncated:");
    expect(response.outputText).toContain("[truncated:");
    expect(error.message).toContain("[truncated:");
  });

  it("does not overwrite terminal provider run rows", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Terminal Provider Run" });
    const providerRun = createProviderRun(project.path, {
      runId: "run-terminal",
      providerId: "provider-terminal",
      request: { operation: "image.generate" }
    });

    completeProviderRun(project.path, providerRun.id, { ok: true });

    expect(() => failProviderRun(project.path, providerRun.id, { message: "late failure" })).toThrow(
      /already complete|only running|not found/i
    );
    expect(() => completeProviderRun(project.path, "missing-provider-run", { ok: true })).toThrow(
      /not found|not running/i
    );

    const [listed] = await listProviderRuns(project.path);
    expect(listed).toMatchObject({
      id: providerRun.id,
      status: "complete",
      response: { ok: true },
      error: null
    });
  });

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

  it("skips generation execution before provider work when an incoming adapter edge is unavailable", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Adapter Blocked Generation" });
    const reason = "Image reference needs a caption adapter before this node can run.";
    let providerCalled = false;
    const canvas = graph(
      [
        node("reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        unavailableAdapterEdge("edge-reference-generation", "reference", "generation", {
          disabledReason: reason,
          adapter: {
            operation: "caption",
            providerId: "visual-description",
            status: "unavailable",
            reason: "Lower priority adapter reason."
          }
        })
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["generation"],
      imageProviderRunner: async () => {
        providerCalled = true;
        throw new Error("Provider runner should not be called.");
      },
      imageProviderFileExists: async () => true,
      imageCodexCliPath: "C:\\Tools\\codex.exe",
      now: () => new Date("2026-06-30T12:00:00.000Z")
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "generation",
        status: "skipped",
        action: "adapter-blocked",
        reason
      })
    ]);
    expect(providerCalled).toBe(false);
    expect(listProviderRuns(project.path)).toEqual([]);
  });

  it("keeps locked execution precedence over disabled incoming adapter edges", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Locked Adapter Generation" });
    let providerCalled = false;
    const canvas = graph(
      [
        node("reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image"
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image",
          locked: true
        })
      ],
      [
        unavailableAdapterEdge("edge-reference-generation", "reference", "generation", {
          disabledReason: "Adapter should not hide the locked state."
        })
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["generation"],
      imageProviderRunner: async () => {
        providerCalled = true;
        throw new Error("Provider runner should not be called.");
      },
      imageProviderFileExists: async () => true,
      imageCodexCliPath: "C:\\Tools\\codex.exe",
      now: () => new Date("2026-06-30T12:00:00.000Z")
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "generation",
        status: "skipped",
        action: "locked",
        reason: "Node is locked"
      })
    ]);
    expect(result.graph.nodes.find((candidate) => candidate.id === "generation")?.data).not.toMatchObject({
      rerunState: "ready"
    });
    expect(providerCalled).toBe(false);
    expect(listProviderRuns(project.path)).toEqual([]);
  });

  it("executes Compare nodes and writes manual ratings and tags into asset metadata", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Compare Metadata" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "hero.png",
      content: "fake image bytes",
      metadata: { variant: "hero" },
      now: new Date("2026-06-17T17:00:00.000Z")
    });
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
        node("compare", {
          definitionId: "review-compare",
          kind: "Review",
          subtype: "Compare",
          compareLayout: 4,
          reviewRating: 5,
          reviewTags: "keeper, on-brand",
          reviewDecision: "select",
          reviewNotes: "Best campaign hero so far."
        })
      ],
      [edge("edge-generation-compare", "generation", "compare", "result")]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["compare"],
      now: () => new Date("2026-06-17T17:05:00.000Z")
    });
    const compareNode = result.graph.nodes.find((candidate) => candidate.id === "compare");
    const assets = await listAssets(project.path, { kind: "generated" });

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "compare",
        status: "complete",
        action: "compare"
      })
    ]);
    expect(compareNode?.data).toMatchObject({
      status: "complete",
      rerunState: "complete",
      compareArtifact: {
        layout: 4,
        items: [
          expect.objectContaining({
            assetId: generated.id,
            rating: 5,
            tags: ["keeper", "on-brand"],
            decision: "select",
            notes: "Best campaign hero so far."
          })
        ]
      }
    });
    expect(assets[0]?.metadata).toMatchObject({
      review: {
        rating: 5,
        tags: ["keeper", "on-brand"],
        decision: "select",
        notes: "Best campaign hero so far.",
        compareNodeId: "compare"
      }
    });
    await expect(listArtifacts(project.path, { kind: "compare" })).resolves.toEqual([
      expect.objectContaining({
        kind: "compare",
        nodeId: "compare",
        metadata: expect.objectContaining({
          kind: "compare",
          compareNodeId: "compare",
          membership: [
            expect.objectContaining({
              assetId: generated.id,
              rating: 5,
              tags: ["keeper", "on-brand"],
              decision: "select",
              notes: "Best campaign hero so far."
            })
          ],
          winnerAssetId: generated.id,
          rating: 5,
          notes: "Best campaign hero so far."
        })
      })
    ]);
  });

  it("executes Evaluate nodes and writes score, tags, decision, confidence, and explanation", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Evaluate Metadata" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "selected.png",
      content: "fake image bytes",
      metadata: { variant: "selected" },
      now: new Date("2026-06-17T17:10:00.000Z")
    });
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
        node("compare", {
          definitionId: "review-compare",
          kind: "Review",
          subtype: "Compare",
          compareLayout: 2,
          reviewRating: 5,
          reviewTags: "keeper, premium",
          reviewDecision: "select"
        }),
        node("evaluate", {
          definitionId: "review-evaluation",
          kind: "Review",
          subtype: "Evaluation",
          instruction: "Pass premium keeper assets for the DreamBay hero campaign.",
          evaluationThreshold: 70
        })
      ],
      [
        edge("edge-generation-compare", "generation", "compare", "result"),
        edge("edge-compare-evaluate", "compare", "evaluate", "review")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      ...simulationProvider,
      policy: "selected",
      targetNodeIds: ["compare", "evaluate"],
      now: () => new Date("2026-06-17T17:15:00.000Z")
    });
    const evaluateNode = result.graph.nodes.find((candidate) => candidate.id === "evaluate");
    const assets = await listAssets(project.path, { kind: "generated" });

    expect(result.results.map((entry) => entry.action)).toEqual(["compare", "evaluate"]);
    expect(nodeData(evaluateNode).evaluationArtifact).toMatchObject({
      items: [
        expect.objectContaining({
          assetId: generated.id,
          decision: "pass",
          tags: expect.arrayContaining(["keeper", "premium"]),
          confidence: expect.any(Number),
          explanation: expect.stringContaining("DreamBay hero campaign")
        })
      ]
    });
    expect(assets[0]?.metadata.evaluation).toMatchObject({
      evaluateNodeId: "evaluate",
      decision: "pass",
      tags: expect.arrayContaining(["keeper", "premium"])
    });
    expect((assets[0]?.metadata.evaluation as { score?: number } | undefined)?.score).toBeGreaterThanOrEqual(70);
    await expect(listArtifacts(project.path, { kind: "evaluation" })).resolves.toEqual([
      expect.objectContaining({
        kind: "evaluation",
        nodeId: "evaluate",
        metadata: expect.objectContaining({
          kind: "evaluation",
          evaluateNodeId: "evaluate",
          threshold: 70,
          items: [
            expect.objectContaining({
              assetId: generated.id,
              decision: "pass",
              score: expect.any(Number),
              tags: expect.arrayContaining(["keeper", "premium"]),
              confidence: expect.any(Number),
              explanation: expect.stringContaining("DreamBay hero campaign"),
              detectedIssues: []
            })
          ]
        })
      })
    ]);
  });

  it("sends channel and role payload envelopes to vision evaluation providers", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Provider Evaluation Payloads" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "subject.png",
      content: "fake image bytes",
      mimeType: "image/png",
      metadata: { variant: "subject" },
      now: new Date("2026-06-17T17:30:00.000Z")
    });
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
          definitionId: "review-evaluation",
          kind: "Review",
          subtype: "Evaluation",
          instruction: "Rate the subject using the configured review rubric.",
          evaluationThreshold: 75
        })
      ],
      [
        {
          ...edge("edge-generation-evaluate", "generation", "evaluate", "subject"),
          data: {
            label: "subject",
            graphVersion: "2.5",
            sourceChannel: "image",
            targetChannel: "image",
            role: "subject"
          }
        }
      ]
    );

    await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["evaluate"],
      evaluationCodexCliPath: "C:\\Tools\\codex.exe",
      evaluationProviderFileExists: async () => true,
      evaluationProviderRunner: async (call: ProviderProcessCall) => {
        const outputDir = /Output directory:\s*([\s\S]+?)\n\nWrite/.exec(providerStdin(call))?.[1]?.trim();
        if (!outputDir) {
          throw new Error("Output directory was not included in the Codex evaluation prompt.");
        }
        await writeFile(
          path.join(outputDir, "result.json"),
          JSON.stringify({
            id: "run-evaluation",
            status: "complete",
            items: [
              {
                id: generated.id,
                assetId: generated.id,
                assetPath: generated.path,
                score: 88,
                tags: ["subject"],
                decision: "pass",
                confidence: 0.9,
                explanation: "The subject is clear and meets the review direction.",
                detectedIssues: []
              }
            ],
            summary: "One subject image passed.",
            error: null,
            caveats: ""
          }),
          "utf8"
        );
        return { stdout: "ok", stderr: "", exitCode: 0 };
      },
      now: () => new Date("2026-06-17T17:35:00.000Z")
    });

    const [providerRun] = await listProviderRuns(project.path);
    const providerInput = recordValue(providerRun?.request, "provider request").providerInput as
      | { inputs?: Array<Record<string, unknown>> }
      | undefined;
    expect(providerInput?.inputs).toEqual([
      expect.objectContaining({
        channel: "image",
        role: "subject",
        assetId: generated.id,
        assetPath: generated.path,
        sourceNodeId: "generation",
        sourceEdgeId: "edge-generation-evaluate"
      })
    ]);
  });

  it("executes Filter nodes, auto-applies routing, and physically moves passed assets to collections", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Filter Routing" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "winner.png",
      content: "fake image bytes",
      metadata: { variant: "winner" },
      now: new Date("2026-06-17T17:20:00.000Z")
    });
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
        node("compare", {
          definitionId: "review-compare",
          kind: "Review",
          subtype: "Compare",
          reviewRating: 5,
          reviewTags: "keeper",
          reviewDecision: "select"
        }),
        node("evaluate", {
          definitionId: "review-evaluation",
          kind: "Review",
          subtype: "Evaluation",
          instruction: "Pass keeper images.",
          evaluationThreshold: 70
        }),
        node("filter", {
          definitionId: "review-filter",
          kind: "Review",
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
        edge("edge-generation-compare", "generation", "compare", "result"),
        edge("edge-compare-evaluate", "compare", "evaluate", "review"),
        edge("edge-evaluate-filter", "evaluate", "filter", "evaluation"),
        edge("edge-filter-selected", "filter", "selected", "pass"),
        edge("edge-filter-rejected", "filter", "rejected", "fail")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      ...simulationProvider,
      policy: "selected",
      targetNodeIds: ["compare", "evaluate", "filter"],
      now: () => new Date("2026-06-17T17:25:00.000Z")
    });
    const filterNode = result.graph.nodes.find((candidate) => candidate.id === "filter");
    const [movedAsset] = await listAssets(project.path, { kind: "generated" });
    const moves = await listAssetMoves(project.path, { assetId: generated.id });

    expect(result.results.map((entry) => entry.action)).toEqual(["compare", "evaluate", "filter-route"]);
    expect(movedAsset?.path).toContain(`${path.sep}collections${path.sep}Selected${path.sep}`);
    expect(await readFile(movedAsset!.path, "utf8")).toBe("fake image bytes");
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      assetId: generated.id,
      reason: "Filter filter routed pass to Selected"
    });
    expect(nodeData(filterNode).filterResult).toMatchObject({
      dryRun: false,
      autoApply: true,
      routed: [
        expect.objectContaining({
          assetId: generated.id,
          decision: "pass",
          targetCollectionName: "Selected",
          moved: true
        })
      ]
    });
  });

  it("supports Filter dry-run and manual route overrides without moving assets", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Filter Dry Run" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "manual.png",
      content: "fake image bytes",
      metadata: {
        evaluation: {
          evaluateNodeId: "evaluate",
          decision: "fail",
          score: 30,
          tags: ["needs-edit"]
        }
      },
      now: new Date("2026-06-17T17:30:00.000Z")
    });
    const canvas = graph(
      [
        node("evaluate", {
          definitionId: "store-evaluate",
          kind: "Store",
          subtype: "Evaluate",
          status: "complete",
          evaluationArtifact: {
            items: [
              {
                assetId: generated.id,
                assetPath: generated.path,
                decision: "fail",
                score: 30,
                tags: ["needs-edit"]
              }
            ]
          }
        }),
        node("filter", {
          definitionId: "store-filter",
          kind: "Store",
          subtype: "Filter",
          filterAutoApply: true,
          filterDryRun: true,
          filterRouteMode: "copy",
          filterManualOverride: "Manual Picks",
          filterRules: "fail -> Rejected"
        }),
        node("manual", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection",
          title: "Manual Picks",
          label: "Manual Picks"
        })
      ],
      [
        edge("edge-evaluate-filter", "evaluate", "filter", "evaluation"),
        edge("edge-filter-manual", "filter", "manual", "manual")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["filter"],
      now: () => new Date("2026-06-17T17:35:00.000Z")
    });
    const [assetAfterDryRun] = await listAssets(project.path, { kind: "generated" });
    const moves = await listAssetMoves(project.path, { assetId: generated.id });

    expect(result.results[0]).toMatchObject({ action: "filter-dry-run", status: "complete" });
    expect(assetAfterDryRun?.path).toBe(generated.path);
    expect(moves).toEqual([]);
    expect(nodeData(result.graph.nodes.find((candidate) => candidate.id === "filter")).filterResult).toMatchObject({
      dryRun: true,
      routed: [
        expect.objectContaining({
          assetId: generated.id,
          decision: "fail",
          targetCollectionName: "Manual Picks",
          mode: "copy",
          preview: true,
          moved: false
        })
      ]
    });
    expect(nodeData(result.graph.nodes.find((candidate) => candidate.id === "filter")).filterResult).toMatchObject({
      candidateRoutes: [
        expect.objectContaining({
          assetId: generated.id,
          destinationCollectionName: "Manual Picks",
          mode: "copy",
          metadataChanges: expect.objectContaining({
            filter: expect.objectContaining({
              filterNodeId: "filter",
              decision: "fail",
              targetCollectionName: "Manual Picks",
              mode: "copy"
            })
          })
        })
      ]
    });
  });

  it("executes legacy Store Evaluation nodes through the review evaluator", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Legacy Store Evaluation" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "legacy-evaluation.png",
      content: "fake image bytes",
      metadata: { variant: "legacy" },
      now: new Date("2026-06-17T17:36:00.000Z")
    });
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
          subtype: "Evaluation",
          instruction: "Pass legacy evaluation assets.",
          evaluationThreshold: 70
        })
      ],
      [edge("edge-generation-evaluate", "generation", "evaluate", "evaluation")]
    );

    const result = await executeGraphRun(project.path, canvas, {
      ...simulationProvider,
      policy: "selected",
      targetNodeIds: ["evaluate"],
      now: () => new Date("2026-06-17T17:37:00.000Z")
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "evaluate",
        status: "complete",
        action: "evaluate"
      })
    ]);
    expect(result.graph.nodes.find((candidate) => candidate.id === "evaluate")?.data).toMatchObject({
      status: "complete",
      rerunState: "complete",
      evaluationArtifact: expect.objectContaining({
        evaluateNodeId: "evaluate"
      })
    });
  });

  it("links routed artifacts into collections without moving the source file", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Filter Link Mode" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "linked.png",
      content: "fake image bytes",
      metadata: {
        evaluation: {
          evaluateNodeId: "evaluate",
          decision: "pass",
          score: 92,
          tags: ["keeper"]
        }
      },
      now: new Date("2026-06-17T17:40:00.000Z")
    });
    const canvas = graph(
      [
        node("evaluate", {
          definitionId: "store-evaluate",
          kind: "Store",
          subtype: "Evaluate",
          status: "complete",
          evaluationArtifact: {
            items: [
              {
                assetId: generated.id,
                assetPath: generated.path,
                decision: "pass",
                score: 92,
                tags: ["keeper"]
              }
            ]
          }
        }),
        node("filter", {
          definitionId: "store-filter",
          kind: "Store",
          subtype: "Filter",
          filterAutoApply: true,
          filterRouteMode: "link",
          filterRules: "pass -> Selected"
        }),
        node("selected", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection",
          title: "Selected",
          label: "Selected"
        })
      ],
      [
        edge("edge-evaluate-filter", "evaluate", "filter", "evaluation"),
        edge("edge-filter-selected", "filter", "selected", "pass")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["filter"],
      now: () => new Date("2026-06-17T17:45:00.000Z")
    });
    const [assetAfterRoute] = await listAssets(project.path, { kind: "generated" });
    const moves = await listAssetMoves(project.path, { assetId: generated.id });
    const selectedCollectionId = nodeData(
      result.graph.nodes.find((candidate) => candidate.id === "selected")
    ).storeAssetId;

    expect(assetAfterRoute?.path).toBe(generated.path);
    expect(moves).toEqual([]);
    expect(selectedCollectionId).toEqual(expect.any(String));
    await expect(listArtifactsByCollection(project.path, selectedCollectionId as string)).resolves.toEqual([
      expect.objectContaining({
        id: generated.metadata.artifactId,
        path: generated.path
      })
    ]);
    expect(nodeData(result.graph.nodes.find((candidate) => candidate.id === "filter")).filterResult).toMatchObject({
      routed: [
        expect.objectContaining({
          assetId: generated.id,
          mode: "link",
          linked: true,
          moved: false
        })
      ]
    });
  });

  it("copies routed artifacts into collections while preserving the source asset", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Filter Copy Mode" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "copied.png",
      content: "fake image bytes",
      metadata: {
        evaluation: {
          evaluateNodeId: "evaluate",
          decision: "pass",
          score: 94,
          tags: ["keeper"]
        }
      },
      now: new Date("2026-06-17T17:46:00.000Z")
    });
    const canvas = graph(
      [
        node("evaluate", {
          definitionId: "store-evaluate",
          kind: "Store",
          subtype: "Evaluate",
          status: "complete",
          evaluationArtifact: {
            items: [
              {
                assetId: generated.id,
                assetPath: generated.path,
                decision: "pass",
                score: 94,
                tags: ["keeper"]
              }
            ]
          }
        }),
        node("filter", {
          definitionId: "store-filter",
          kind: "Store",
          subtype: "Filter",
          filterAutoApply: true,
          filterRouteMode: "copy",
          filterRules: "pass -> Selected"
        }),
        node("selected", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection",
          title: "Selected",
          label: "Selected"
        })
      ],
      [
        edge("edge-evaluate-filter", "evaluate", "filter", "evaluation"),
        edge("edge-filter-selected", "filter", "selected", "pass")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["filter"],
      now: () => new Date("2026-06-17T17:47:00.000Z")
    });
    const selectedCollectionId = nodeData(
      result.graph.nodes.find((candidate) => candidate.id === "selected")
    ).storeAssetId;
    const [assetAfterRoute] = await listAssets(project.path, { kind: "generated" });
    const moves = await listAssetMoves(project.path, { assetId: generated.id });

    expect(assetAfterRoute?.path).toBe(generated.path);
    expect(moves).toEqual([]);
    expect(selectedCollectionId).toEqual(expect.any(String));
    const collectionArtifacts = await listArtifactsByCollection(project.path, selectedCollectionId as string);

    expect(collectionArtifacts).toEqual([
      expect.objectContaining({
        path: expect.stringContaining(`${path.sep}collections${path.sep}Selected${path.sep}copied.png`),
        metadata: expect.objectContaining({
          copiedFromAssetId: generated.id,
          routeMode: "copy"
        })
      })
    ]);
    expect(collectionArtifacts[0]?.metadata.assetId).toBeUndefined();
    expect(nodeData(result.graph.nodes.find((candidate) => candidate.id === "filter")).filterResult).toMatchObject({
      routed: [
        expect.objectContaining({
          assetId: generated.id,
          mode: "copy",
          copied: true,
          moved: false,
          copiedPath: expect.stringContaining(`${path.sep}collections${path.sep}Selected${path.sep}copied.png`)
        })
      ]
    });
  });

  it("cleans up copied files and copied artifacts when copy-mode routing fails after the file copy", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Filter Copy Rollback" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "copy-rollback.png",
      content: "fake image bytes",
      metadata: {
        evaluation: {
          evaluateNodeId: "evaluate",
          decision: "pass",
          score: 94,
          tags: ["keeper"]
        }
      },
      now: new Date("2026-06-17T17:48:00.000Z")
    });
    const copiedPath = path.join(project.path, "collections", "Selected", "copy-rollback.png");
    const canvas = graph(
      [
        node("evaluate", {
          definitionId: "store-evaluate",
          kind: "Store",
          subtype: "Evaluate",
          status: "complete",
          evaluationArtifact: {
            items: [
              {
                assetId: generated.id,
                assetPath: generated.path,
                assetMetadata: { artifactId: "missing-copy-parent-artifact" },
                decision: "pass",
                score: 94,
                tags: ["keeper"]
              }
            ]
          }
        }),
        node("filter", {
          definitionId: "store-filter",
          kind: "Store",
          subtype: "Filter",
          filterAutoApply: true,
          filterRouteMode: "copy",
          filterRules: "pass -> Selected"
        }),
        node("selected", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection",
          title: "Selected",
          label: "Selected"
        })
      ],
      [
        edge("edge-evaluate-filter", "evaluate", "filter", "evaluation"),
        edge("edge-filter-selected", "filter", "selected", "pass")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["filter"],
      now: () => new Date("2026-06-17T17:49:00.000Z")
    });
    const selectedCollectionId = nodeData(
      result.graph.nodes.find((candidate) => candidate.id === "selected")
    ).storeAssetId;

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "filter",
        status: "error"
      })
    ]);
    await expect(access(copiedPath)).rejects.toThrow();
    expect((await listArtifacts(project.path, { kind: "image" })).filter((artifact) => artifact.path === copiedPath)).toEqual([]);
    if (typeof selectedCollectionId === "string") {
      await expect(listArtifactsByCollection(project.path, selectedCollectionId)).resolves.toEqual([]);
    }
  });

  it("preserves existing copy destinations and writes copied routes to the next available filename", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Filter Copy Collision" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "collision.png",
      content: "new image bytes",
      metadata: {
        evaluation: {
          evaluateNodeId: "evaluate",
          decision: "pass",
          score: 94,
          tags: ["keeper"]
        }
      },
      now: new Date("2026-06-17T17:49:10.000Z")
    });
    const selectedDirectory = path.join(project.path, "collections", "Selected");
    const existingPath = path.join(selectedDirectory, "collision.png");
    const copiedPath = path.join(selectedDirectory, "collision-2.png");
    await mkdir(selectedDirectory, { recursive: true });
    await writeFile(existingPath, "existing image bytes");
    const canvas = graph(
      [
        node("evaluate", {
          definitionId: "store-evaluate",
          kind: "Store",
          subtype: "Evaluate",
          status: "complete",
          evaluationArtifact: {
            items: [
              {
                assetId: generated.id,
                assetPath: generated.path,
                decision: "pass",
                score: 94,
                tags: ["keeper"]
              }
            ]
          }
        }),
        node("filter", {
          definitionId: "store-filter",
          kind: "Store",
          subtype: "Filter",
          filterAutoApply: true,
          filterRouteMode: "copy",
          filterRules: "pass -> Selected"
        }),
        node("selected", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection",
          title: "Selected",
          label: "Selected"
        })
      ],
      [
        edge("edge-evaluate-filter", "evaluate", "filter", "evaluation"),
        edge("edge-filter-selected", "filter", "selected", "pass")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["filter"],
      now: () => new Date("2026-06-17T17:49:20.000Z")
    });

    expect(result.results[0]).toMatchObject({ status: "complete" });
    await expect(readFile(existingPath, "utf8")).resolves.toBe("existing image bytes");
    await expect(readFile(copiedPath, "utf8")).resolves.toBe("new image bytes");
    expect(nodeData(result.graph.nodes.find((candidate) => candidate.id === "filter")).filterResult).toMatchObject({
      routed: [
        expect.objectContaining({
          copiedPath
        })
      ]
    });
  });

  it("routes copied artifact-only browser payloads without treating artifact ids as asset ids", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Artifact Only Review" });
    const copiedPath = path.join(project.path, "collections", "Selected", "artifact-only.png");
    const copiedArtifact = await createArtifact(project.path, {
      kind: "image",
      nodeId: "filter-source",
      path: copiedPath,
      metadata: {
        title: "Copied artifact only",
        artifactId: "artifact-only-source",
        copiedFromAssetId: "source-generated-asset",
        copiedFromPath: path.join(project.path, "assets", "generated", "source.png")
      },
      now: new Date("2026-06-17T17:49:30.000Z")
    });
    const canvas = graph(
      [
        node("artifact-reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image",
          status: "complete",
          assetKind: "generated",
          assetPath: copiedPath,
          assetMetadata: {
            artifactId: copiedArtifact.id,
            copiedFromAssetId: "source-generated-asset",
            copiedFromPath: path.join(project.path, "assets", "generated", "source.png")
          }
        }),
        node("compare", {
          definitionId: "store-compare",
          kind: "Store",
          subtype: "Compare",
          reviewRating: 5,
          reviewTags: "keeper",
          reviewDecision: "select"
        }),
        node("evaluate", {
          definitionId: "store-evaluate",
          kind: "Store",
          subtype: "Evaluate",
          instruction: "Pass copied artifact-only images.",
          evaluationThreshold: 70
        }),
        node("filter", {
          definitionId: "store-filter",
          kind: "Store",
          subtype: "Filter",
          filterAutoApply: true,
          filterRouteMode: "link",
          filterRules: "pass -> Selected"
        }),
        node("selected", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection",
          title: "Selected",
          label: "Selected"
        })
      ],
      [
        edge("edge-artifact-compare", "artifact-reference", "compare", "image"),
        edge("edge-compare-evaluate", "compare", "evaluate", "review"),
        edge("edge-evaluate-filter", "evaluate", "filter", "evaluation"),
        edge("edge-filter-selected", "filter", "selected", "pass")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      ...simulationProvider,
      policy: "selected",
      targetNodeIds: ["compare", "evaluate", "filter"],
      now: () => new Date("2026-06-17T17:49:40.000Z")
    });
    const selectedCollectionId = nodeData(
      result.graph.nodes.find((candidate) => candidate.id === "selected")
    ).storeAssetId;

    expect(result.results.map((entry) => entry.status)).toEqual(["complete", "complete", "complete"]);
    expect(nodeData(result.graph.nodes.find((candidate) => candidate.id === "compare")).compareArtifact).toMatchObject({
      items: [
        expect.objectContaining({
          artifactId: copiedArtifact.id,
          assetId: undefined
        })
      ]
    });
    expect(selectedCollectionId).toEqual(expect.any(String));
    await expect(listArtifactsByCollection(project.path, selectedCollectionId as string)).resolves.toEqual([
      expect.objectContaining({
        id: copiedArtifact.id,
        path: copiedPath
      })
    ]);
  });

  it("fails artifact-only copied inputs in move-mode filters instead of completing as a no-op", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Artifact Only Move Reject" });
    const copiedPath = path.join(project.path, "collections", "Selected", "artifact-only.png");
    const copiedArtifact = await createArtifact(project.path, {
      kind: "image",
      nodeId: "filter-source",
      path: copiedPath,
      metadata: {
        title: "Copied artifact only",
        artifactId: "artifact-only-source",
        copiedFromAssetId: "source-generated-asset",
        copiedFromPath: path.join(project.path, "assets", "generated", "source.png")
      },
      now: new Date("2026-06-17T17:49:45.000Z")
    });
    const selectedCollection = await ensureCollectionFolder(project.path, {
      name: "Selected",
      now: new Date("2026-06-17T17:49:46.000Z")
    });
    const canvas = graph(
      [
        node("artifact-reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image",
          status: "complete",
          assetKind: "generated",
          assetPath: copiedPath,
          assetMetadata: {
            artifactId: copiedArtifact.id,
            copiedFromAssetId: "source-generated-asset",
            copiedFromPath: path.join(project.path, "assets", "generated", "source.png")
          }
        }),
        node("filter", {
          definitionId: "store-filter",
          kind: "Store",
          subtype: "Filter",
          filterAutoApply: true,
          filterRules: "pass -> Selected"
        }),
        node("selected", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection",
          title: "Selected",
          label: "Selected",
          storeAssetId: selectedCollection.id,
          storePath: selectedCollection.path,
          storeMetadata: selectedCollection.metadata
        })
      ],
      [
        edge("edge-artifact-filter", "artifact-reference", "filter", "image"),
        edge("edge-filter-selected", "filter", "selected", "pass")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["filter"],
      now: () => new Date("2026-06-17T17:49:50.000Z")
    });

    expect(result.results[0]).toMatchObject({
      status: "error",
      reason: expect.stringContaining("cannot be moved without an asset id")
    });
    expect(nodeData(result.graph.nodes.find((candidate) => candidate.id === "filter")).filterResult).toBeUndefined();
    await expect(listAssetMoves(project.path)).resolves.toEqual([]);
    await expect(listArtifactsByCollection(project.path, selectedCollection.id)).resolves.toEqual([]);
  });

  it("rolls back the source file and move audit when a physical filter move fails", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Filter Move Rollback" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation",
      fileName: "rollback.png",
      content: "fake image bytes",
      metadata: {
        evaluation: {
          evaluateNodeId: "evaluate",
          decision: "pass",
          score: 92,
          tags: ["keeper"]
        }
      },
      now: new Date("2026-06-17T17:50:00.000Z")
    });
    await updateAssetMetadata(project.path, {
      assetId: generated.id,
      metadata: { artifactId: "missing-artifact-for-rollback" },
      now: new Date("2026-06-17T17:51:00.000Z")
    });
    const canvas = graph(
      [
        node("evaluate", {
          definitionId: "store-evaluate",
          kind: "Store",
          subtype: "Evaluate",
          status: "complete",
          evaluationArtifact: {
            items: [
              {
                assetId: generated.id,
                assetPath: generated.path,
                decision: "pass",
                score: 92,
                tags: ["keeper"]
              }
            ]
          }
        }),
        node("filter", {
          definitionId: "store-filter",
          kind: "Store",
          subtype: "Filter",
          filterAutoApply: true,
          filterRouteMode: "move",
          filterRules: "pass -> Selected"
        }),
        node("selected", {
          definitionId: "store-collection",
          kind: "Store",
          subtype: "Collection",
          title: "Selected",
          label: "Selected"
        })
      ],
      [
        edge("edge-evaluate-filter", "evaluate", "filter", "evaluation"),
        edge("edge-filter-selected", "filter", "selected", "pass")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
        policy: "selected",
        targetNodeIds: ["filter"],
        now: () => new Date("2026-06-17T17:55:00.000Z")
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "filter",
        status: "error",
        reason: expect.stringContaining("missing-artifact-for-rollback")
      })
    ]);
    await expect(readFile(generated.path, "utf8")).resolves.toBe("fake image bytes");
    await expect(listAssetMoves(project.path, { assetId: generated.id })).resolves.toEqual([]);
    await expect(listAssets(project.path, { kind: "generated" })).resolves.toEqual([
      expect.objectContaining({ id: generated.id, path: generated.path })
    ]);
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
    let releaseFirst: () => void = () => undefined;
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
    let releaseParallel: () => void = () => undefined;
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
    let releaseSameFirst: () => void = () => undefined;
    let releaseSameSecond: () => void = () => undefined;
    let releaseOther: () => void = () => undefined;

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
    let releaseFirst: () => void = () => undefined;
    let releaseSecond: () => void = () => undefined;
    let releaseDownstream: () => void = () => undefined;
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
  it("runs Prompt helper nodes through Codex vision workers without overwriting downstream Prompt instructions", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Assistant Vision" });
    const referencePath = path.join(project.path, "red-texture-reference.png");
    await writeFile(referencePath, "reference-image-bytes");
    const calls: ProviderProcessCall[] = [];
    const canvas = graph(
      [
        node("prompt", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "chrome bottle in a quiet campaign set"
        }),
        node("reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image",
          title: "red texture reference",
          assetId: "reference-1",
          assetKind: "reference",
          assetPath: referencePath,
          assetMetadata: { mimeType: "image/png" },
          notes: "Use the red texture as a surface read."
        }),
        node("assistant", {
          definitionId: "prompt-brainstormer",
          kind: "Prompt",
          subtype: "Brainstormer",
          instruction: "Inspect the reference and propose three image directions."
        }),
        node("assistant-prompt", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "Waiting for assistant."
        })
      ],
      [
        edge("edge-prompt-assistant", "prompt", "assistant", "context"),
        edge("edge-reference-assistant", "reference", "assistant", "style"),
        edge("edge-assistant-prompt", "assistant", "assistant-prompt", "prompt")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["assistant"],
      assistantCodexCliPath: "C:\\Tools\\codex.exe",
      assistantProviderFileExists: async () => true,
      assistantProviderRunner: async (call: ProviderProcessCall) => {
        calls.push(call);
        const outputDir = /Output directory:\s*([\s\S]+?)\n\nWrite/.exec(providerStdin(call))?.[1]?.trim();
        if (!outputDir) {
          throw new Error("Output directory was not included in the Codex assistant prompt.");
        }
        await writeFile(
          path.join(outputDir, "result.json"),
          JSON.stringify({
            id: "run-assistant",
            status: "complete",
            text: "Brainstorm routes\n1. Make the chrome bottle pick up the red texture as a glossy reflection.",
            error: null,
            caveats: ""
          }),
          "utf8"
        );
        return { stdout: "ok", stderr: "", exitCode: 0 };
      },
      now: () => new Date("2026-06-17T15:00:00.000Z")
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "assistant",
        action: "assistant-codex",
        status: "complete",
        metadata: expect.objectContaining({
          text: expect.objectContaining({
            provider: expect.objectContaining({ id: "codex-vision-assistant" }),
            prompt: expect.stringContaining("General: chrome bottle in a quiet campaign set"),
            references: [
              expect.objectContaining({
                nodeId: "reference",
                role: "style",
                assetPath: referencePath
              })
            ]
          })
        })
      })
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toContain("--image");
    expect(calls[0]?.args).toContain(referencePath);
    expect(calls[0]?.env.OPENAI_API_KEY).toBeUndefined();
    expect(calls[0]?.args.at(-1)).toBe("-");
    expect(providerStdin(calls[0]!)).toContain("Inspect any supplied images directly");
    expect(providerStdin(calls[0]!)).toContain("General: chrome bottle in a quiet campaign set");

    const [assistantProviderRun] = await listProviderRuns(project.path);
    const assistantProviderInput = recordValue(
      assistantProviderRun?.request,
      "assistant provider request"
    ).providerInput as
      | { inputs?: Array<Record<string, unknown>> }
      | undefined;
    expect(assistantProviderInput?.inputs).toEqual([
      expect.objectContaining({
        channel: "text",
        role: "general",
        text: "chrome bottle in a quiet campaign set",
        sourceNodeId: "prompt",
        sourceEdgeId: "edge-prompt-assistant"
      }),
      expect.objectContaining({
        channel: "image",
        role: "style",
        assetId: "reference-1",
        assetPath: referencePath,
        sourceNodeId: "reference",
        sourceEdgeId: "edge-reference-assistant"
      })
    ]);

    const assistantNode = result.graph.nodes.find((candidate) => candidate.id === "assistant");
    const downstreamPromptNode = result.graph.nodes.find((candidate) => candidate.id === "assistant-prompt");
    expect(assistantNode?.data).toMatchObject({
      status: "complete",
      rerunState: "complete",
      textOutput: expect.stringContaining("glossy reflection"),
      textOutputArtifact: expect.objectContaining({
        provider: expect.objectContaining({ id: "codex-vision-assistant" }),
        resultText: expect.stringContaining("glossy reflection"),
        references: [
          expect.objectContaining({
            role: "style",
            assetPath: referencePath
          })
        ]
      })
    });
    expect(
      recordValue(nodeData(assistantNode).textOutputArtifact, "text output artifact")
        .populatedPromptNodeIds
    ).toBeUndefined();
    expect(downstreamPromptNode?.data).toMatchObject({
      instruction: "Waiting for assistant.",
      status: "idle"
    });
  });

  it("allows Prompt helper nodes to consume unavailable image-to-text adapter edges through Codex vision", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Assistant Native Vision Adapter" });
    const referencePath = path.join(project.path, "subject-reference.png");
    await writeFile(referencePath, "reference-image-bytes");
    const calls: ProviderProcessCall[] = [];
    const canvas = graph(
      [
        node("reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image",
          title: "subject reference",
          assetId: "reference-subject",
          assetKind: "reference",
          assetPath: referencePath,
          assetMetadata: { mimeType: "image/png" }
        }),
        node("assistant", {
          definitionId: "prompt-brainstormer",
          kind: "Prompt",
          subtype: "Brainstormer",
          instruction: "Describe the subject from the image in prompt-ready language."
        })
      ],
      [
        unavailableAdapterEdge("edge-reference-assistant", "reference", "assistant", {
          label: "subject",
          role: "subject",
          disabledReason: "Visual caption adapter is unavailable."
        })
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["assistant"],
      assistantCodexCliPath: "C:\\Tools\\codex.exe",
      assistantProviderFileExists: async () => true,
      assistantProviderRunner: async (call: ProviderProcessCall) => {
        calls.push(call);
        const outputDir = /Output directory:\s*([\s\S]+?)\n\nWrite/.exec(providerStdin(call))?.[1]?.trim();
        if (!outputDir) {
          throw new Error("Output directory was not included in the Codex assistant prompt.");
        }
        await writeFile(
          path.join(outputDir, "result.json"),
          JSON.stringify({
            id: "run-assistant-vision",
            status: "complete",
            text: "Subject: elegant gentleman with autumn styling and cinematic posture.",
            error: null,
            caveats: ""
          }),
          "utf8"
        );
        return { stdout: "ok", stderr: "", exitCode: 0 };
      },
      now: () => new Date("2026-06-17T15:05:00.000Z")
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "assistant",
        action: "assistant-codex",
        status: "complete"
      })
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toContain("--image");
    expect(calls[0]?.args).toContain(referencePath);
    expect(calls[0]?.args.at(-1)).toBe("-");
    expect(providerStdin(calls[0]!)).toContain("Describe the subject from the image");

    const [assistantProviderRun] = await listProviderRuns(project.path);
    const assistantProviderInput = recordValue(
      assistantProviderRun?.request,
      "assistant provider request"
    ).providerInput as
      | { inputs?: Array<Record<string, unknown>>; references?: Array<Record<string, unknown>> }
      | undefined;
    expect(assistantProviderInput?.inputs).toEqual([
      expect.objectContaining({
        channel: "image",
        role: "subject",
        assetId: "reference-subject",
        assetPath: referencePath,
        sourceNodeId: "reference",
        sourceEdgeId: "edge-reference-assistant"
      })
    ]);
    expect(assistantProviderInput?.references).toEqual([
      expect.objectContaining({
        nodeId: "reference",
        role: "subject",
        assetPath: referencePath
      })
    ]);
  });

  it("normalizes assistant rewrite outputs so mutations do not narrate previous-state changes", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Assistant Rewrite Normalization" });
    const canvas = graph(
      [
        node("subject", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "Brazilian woman holding a watermelon"
        }),
        node("mutator", {
          definitionId: "prompt-mutator",
          kind: "Prompt",
          subtype: "Mutator",
          instruction: "Change the fruit to pineapple."
        }),
        node("expander", {
          definitionId: "prompt-expander",
          kind: "Prompt",
          subtype: "Expander",
          instruction: "Make the subject more detailed."
        })
      ],
      [
        edge("edge-subject-mutator", "subject", "mutator", "subject"),
        edge("edge-mutator-expander", "mutator", "expander", "subject")
      ]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["mutator"],
      assistantCodexCliPath: "C:\\Tools\\codex.exe",
      assistantProviderFileExists: async () => true,
      assistantProviderRunner: async (call: ProviderProcessCall) => {
        const outputDir = /Output directory:\s*([\s\S]+?)\n\nWrite/.exec(providerStdin(call))?.[1]?.trim();
        if (!outputDir) {
          throw new Error("Output directory was not included in the Codex assistant prompt.");
        }
        await writeFile(
          path.join(outputDir, "result.json"),
          JSON.stringify({
            id: "run-mutator",
            status: "complete",
            text: "Holding a ripe pineapple instead of a watermelon.",
            error: null,
            caveats: ""
          }),
          "utf8"
        );
        return { stdout: "ok", stderr: "", exitCode: 0 };
      },
      now: () => new Date("2026-06-17T15:10:00.000Z")
    });

    const mutatorNode = result.graph.nodes.find((candidate) => candidate.id === "mutator");
    const expanderNode = result.graph.nodes.find((candidate) => candidate.id === "expander");

    expect(nodeData(mutatorNode).textOutput).toBe("Holding a ripe pineapple.");
    expect(nodeData(expanderNode).instruction).toBe("Make the subject more detailed.");
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
              ...nodeData(canvas.nodes[0]),
              mutationSeed: "different-seed"
            }
          }
        ],
        []
      ),
      request
    );

    const firstPrompt = nodeData(first.graph.nodes[0]).assembledPrompt;
    const secondPrompt = nodeData(second.graph.nodes[0]).assembledPrompt;
    const changedPrompt = nodeData(changedSeed.graph.nodes[0]).assembledPrompt;

    expect(firstPrompt).toBe(secondPrompt);
    expect(changedPrompt).not.toBe(firstPrompt);
    expect(firstPrompt).toContain("ETHER mark");
    expect(firstPrompt).toContain("chrome bottle");
    expect(nodeData(first.graph.nodes[0]).textOutputArtifact).toMatchObject({
      kind: "prompt-mutation",
      sourceText: "a reflective launch portrait",
      resultText: expect.stringContaining("a reflective launch portrait"),
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
      ...simulationProvider,
      policy: "refresh-upstream",
      targetNodeIds: ["generation"],
      now: () => new Date("2026-06-17T15:20:00.000Z")
    });
    const promptNode = result.graph.nodes.find((candidate) => candidate.id === "prompt");
    const generationNode = result.graph.nodes.find((candidate) => candidate.id === "generation");
    const promptData = nodeData(promptNode);
    const generationData = nodeData(generationNode);
    const generatedAssets = await listAssets(project.path, { kind: "generated" });
    const generatedAsset = generatedAssets.find((asset) => asset.id === generationData.assetId);

    expect(promptData.assembledPrompt).toContain("DreamBay bottle");
    expect(promptData.assembledPrompt).not.toBe("minimal studio product image");
    expect(generationData.assembledPrompt).toBe(promptData.assembledPrompt);
    expect(generatedAsset?.metadata.lineage).toMatchObject({
      prompt: promptData.assembledPrompt,
      sections: [expect.objectContaining({ nodeId: "prompt", text: promptData.textOutput })]
    });
  });

  it("passes generation aspect ratio and resolution into provider input and lineage", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Generation Size" });
    const canvas = graph(
      [
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image",
          generationAspectRatio: "9:16",
          generationResolution: "1536-long-edge",
          generationWidth: 864,
          generationHeight: 1536
        } as any)
      ],
      []
    );

    const result = await executeGraphRun(project.path, canvas, {
      ...simulationProvider,
      policy: "cached-inputs",
      targetNodeIds: ["generation"],
      now: () => new Date("2026-06-17T15:30:00.000Z")
    });
    const [providerRun] = await listProviderRuns(project.path);
    const providerInput = recordValue(providerRun?.request, "provider request").providerInput as
      | { output?: Record<string, unknown> }
      | undefined;
    const generationNode = result.graph.nodes.find((candidate) => candidate.id === "generation");
    const generatedAssets = await listAssets(project.path, { kind: "generated" });
    const generatedAsset = generatedAssets.find((asset) => asset.id === nodeData(generationNode).assetId);

    expect(providerInput?.output).toMatchObject({
      aspectRatio: "9:16",
      resolution: "1536-long-edge",
      width: 864,
      height: 1536
    });
    expect(generatedAsset?.metadata.lineage).toMatchObject({
      output: {
        aspectRatio: "9:16",
        resolution: "1536-long-edge",
        width: 864,
        height: 1536
      }
    });
    await expectPng(generatedAsset!.path, { width: 864, height: 1536 });
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
      ...simulationProvider,
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
        prompt: "General: replace the label with a clean blue mark"
      }
    });
    const [providerRun] = await listProviderRuns(project.path);
    const providerInput = recordValue(providerRun?.request, "provider request").providerInput as
      | { inputs?: Array<Record<string, unknown>> }
      | undefined;
    expect(providerInput?.inputs).toEqual([
      expect.objectContaining({
        channel: "image",
        role: "general",
        assetId: parentAsset.id,
        assetPath: parentAsset.path,
        sourceNodeId: "generation",
        sourceEdgeId: "edge-generation-edit"
      }),
      expect.objectContaining({
        channel: "text",
        role: "general",
        text: "replace the label with a clean blue mark",
        sourceNodeId: "prompt",
        sourceEdgeId: "edge-prompt-edit"
      })
    ]);
    await expectPng(editedAsset!.path);
  });

  it("records a failed provider run when the application has not supplied its shared Codex bundle", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Failed Edit Provider Run" });
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
          definitionId: "edit-inpaint",
          kind: "Edit",
          subtype: "Inpaint",
          instruction: "repair only the label area"
        })
      ],
      [edge("edge-generation-edit", "generation", "edit", "image")]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["edit"]
    });
    const providerRuns = await listProviderRuns(project.path);

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "edit",
        status: "error",
        action: "edit",
        reason: expect.stringMatching(/shared App Server provider bundle/i)
      })
    ]);
    expect(providerRuns).toEqual([
      expect.objectContaining({
        providerId: CODEX_PROVIDER_ID,
        status: "failed",
        request: expect.objectContaining({
          operation: "image.edit",
          nodeId: "edit",
          iteration: 1
        }),
        error: expect.objectContaining({
          message: expect.stringMatching(/shared App Server provider bundle/i)
        })
      })
    ]);
    await expect(listAssets(project.path, { kind: "generated" })).resolves.toEqual([
      expect.objectContaining({ id: parentAsset.id })
    ]);
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
      ...simulationProvider,
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
    expect(recordValue(editResult?.metadata, "edit result metadata").references).toEqual([]);
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
    const editedLineage = recordValue(editedAsset?.metadata.lineage, "edited asset lineage");
    expect(editedLineage.references).toEqual([]);
    expect(editedLineage.edgeRoles).toEqual([]);
    await expectPng(editedAsset!.path);
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
    expect(nodeData(result.graph.nodes.find((candidate) => candidate.id === "edit")).assetId).toBeUndefined();
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
      ...simulationProvider,
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

  it("uses the explicit simulation image provider and records provider lineage", async () => {
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
      ...simulationProvider,
      policy: "refresh-upstream",
      targetNodeIds: ["generation"],
      now: () => new Date("2026-06-17T12:30:00.000Z")
    });

    const generatedAsset = (await listAssets(project.path, { kind: "generated" }))[0];
    const providerRuns = await listProviderRuns(project.path);

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
    expect(generatedAsset?.path.endsWith(".png")).toBe(true);
    expect(generatedAsset?.metadata).toMatchObject({
      provider: "ether-fake-local",
      mimeType: "image/png",
      lineage: {
        provider: {
          id: "ether-fake-local",
          name: "Ether Fake Local",
          capabilities: expect.arrayContaining(["image.generate"])
        },
        iteration: 1,
        prompt: "General: deterministic electric blue product render"
      }
    });
    await expectPng(generatedAsset!.path);
    expect(providerRuns).toEqual([
      expect.objectContaining({
        runId: expect.any(String),
        providerId: "ether-fake-local",
        model: "deterministic-png-v1",
        status: "complete",
        request: expect.objectContaining({
          operation: "image.generate",
          nodeId: "generation",
          iteration: 1,
          policy: "refresh-upstream",
          provider: expect.objectContaining({
            id: "ether-fake-local",
            route: "local-fake",
            capabilities: expect.arrayContaining(["image.generate"])
          }),
          providerInput: expect.objectContaining({
            generationNodeId: "generation",
            prompt: "General: deterministic electric blue product render"
          })
        }),
        response: expect.objectContaining({
          providerId: "ether-fake-local",
          artifactCount: 1,
          artifactIds: expect.arrayContaining([generatedAsset?.id])
        }),
        error: null
      })
    ]);
  });

  it("requires the application-owned Codex bundle for default image generation without simulation fallback", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Codex Default Unavailable" });
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
      imageCodexCliPath: "C:\\Tools\\missing-codex.exe",
      imageProviderFileExists: async () => false
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "generation",
        status: "error",
        action: "generate",
        reason: expect.stringMatching(/shared App Server provider bundle/i)
      })
    ]);
    expect(nodeData(result.graph.nodes[0]).assetId).toBeUndefined();
    await expect(listAssets(project.path, { kind: "generated" })).resolves.toEqual([]);
  });

  it("requires the application-owned Codex bundle for default image edits without simulation fallback", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Codex Default Edit Unavailable" });
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
          definitionId: "edit-inpaint",
          kind: "Edit",
          subtype: "Inpaint",
          instruction: "repair only the label area"
        })
      ],
      [edge("edge-generation-edit", "generation", "edit", "image")]
    );

    const result = await executeGraphRun(project.path, canvas, {
      policy: "selected",
      targetNodeIds: ["edit"],
      imageCodexCliPath: "C:\\Tools\\missing-codex.exe",
      imageProviderFileExists: async () => false
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "edit",
        status: "error",
        action: "edit",
        reason: expect.stringMatching(/shared App Server provider bundle/i)
      })
    ]);
    expect(nodeData(result.graph.nodes.find((candidate) => candidate.id === "edit")).assetId).toBeUndefined();
    await expect(listAssets(project.path, { kind: "generated" })).resolves.toEqual([
      expect.objectContaining({ id: parentAsset.id })
    ]);
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
    expect(nodeData(result.graph.nodes[0]).assetId).toBeUndefined();
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
    const providerRuns = await listProviderRuns(project.path);

    expect(result.results).toEqual([
      expect.objectContaining({
        nodeId: "generation",
        status: "error",
        action: "generate",
        reason: expect.stringMatching(/google-nano-banana-pro.*clean local CLI\/MCP route/i)
      })
    ]);
    expect(nodeData(result.graph.nodes[0]).assetId).toBeUndefined();
    await expect(listAssets(project.path, { kind: "generated" })).resolves.toEqual([]);
    expect(providerRuns).toEqual([
      expect.objectContaining({
        providerId: "google-nano-banana-pro",
        status: "failed",
        request: expect.objectContaining({
          operation: "image.generate",
          nodeId: "generation",
          iteration: 1,
          diagnostic: expect.objectContaining({
            availability: "unavailable"
          })
        }),
        error: expect.objectContaining({
          message: expect.stringMatching(/google-nano-banana-pro.*clean local CLI\/MCP route/i)
        }),
        response: null
      })
    ]);
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
      ...simulationProvider,
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
      ...simulationProvider,
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
    expect(nodeData(finalGenerationNode).assetId).toBe(finalGenerationResult?.assetId);
    expect(nodeData(finalGenerationNode).assetPath).toBe(finalGenerationResult?.assetPath);
    expect(nodeData(finalGenerationNode).assetMetadata).toMatchObject({
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
      ...simulationProvider,
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
      assembledPrompt: "General: glass bottle under crisp studio light"
    });
    expect(generationNode?.data).toMatchObject({
      status: "complete",
      rerunState: "complete",
      assembledPrompt: "General: glass bottle under crisp studio light",
      assembledNegativePrompt: "Negative: no warped labels",
      assetKind: "generated"
    });
    expect(generatedAsset?.metadata).toMatchObject({
      provider: "ether-fake-local",
      generationNodeId: "generation",
      lineage: {
        provider: {
          id: "ether-fake-local"
        },
        prompt: "General: glass bottle under crisp studio light",
        negativePrompt: "Negative: no warped labels"
      }
    });
    await expectPng(generatedAsset!.path);
  });

  it("sends channel and role payload envelopes to image generation providers", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Generation Payload Envelopes" });
    const referencePath = path.join(project.path, "style-reference.png");
    await writeFile(referencePath, "style-reference-bytes");
    const canvas = graph(
      [
        node("subject", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "chrome bottle portrait"
        }),
        node("negative", {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          instruction: "warped logo"
        }),
        node("reference", {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image",
          title: "Style plate",
          assetId: "style-reference-asset",
          assetKind: "reference",
          assetPath: referencePath,
          assetMetadata: { mimeType: "image/png" }
        }),
        node("generation", {
          definitionId: "generation-image",
          kind: "Generation",
          subtype: "Image"
        })
      ],
      [
        {
          id: "edge-subject-generation",
          source: "subject",
          target: "generation",
          label: "subject",
          data: { graphVersion: "2.5", sourceChannel: "text", targetChannel: "text", role: "subject" }
        },
        {
          id: "edge-negative-generation",
          source: "negative",
          target: "generation",
          label: "negative",
          data: { graphVersion: "2.5", sourceChannel: "text", targetChannel: "text", role: "negative" }
        },
        {
          id: "edge-reference-generation",
          source: "reference",
          target: "generation",
          label: "style",
          data: { graphVersion: "2.5", sourceChannel: "image", targetChannel: "image", role: "style" }
        }
      ]
    );

    await executeGraphRun(project.path, canvas, {
      ...simulationProvider,
      policy: "selected",
      targetNodeIds: ["generation"],
      now: () => new Date("2026-06-17T13:30:00.000Z")
    });

    const [providerRun] = await listProviderRuns(project.path);
    const providerInput = recordValue(providerRun?.request, "provider request").providerInput as
      | { inputs?: Array<Record<string, unknown>> }
      | undefined;

    expect(providerInput?.inputs).toEqual([
      expect.objectContaining({
        channel: "text",
        role: "subject",
        text: "chrome bottle portrait",
        sourceNodeId: "subject",
        sourceEdgeId: "edge-subject-generation"
      }),
      expect.objectContaining({
        channel: "text",
        role: "negative",
        text: "warped logo",
        sourceNodeId: "negative",
        sourceEdgeId: "edge-negative-generation"
      }),
      expect.objectContaining({
        channel: "image",
        role: "style",
        assetId: "style-reference-asset",
        assetPath: referencePath,
        sourceNodeId: "reference",
        sourceEdgeId: "edge-reference-generation"
      })
    ]);
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
      ...simulationProvider,
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
                ...nodeData(candidate),
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
      ...simulationProvider,
      policy: "cached-inputs",
      targetNodeIds: ["generation"],
      now: () => new Date("2026-06-17T15:10:00.000Z")
    });
    const rerunGeneration = secondRun.graph.nodes.find((candidate) => candidate.id === "generation");

    expect(rerunGeneration?.data).toMatchObject({
      rerunState: "complete",
      assembledPrompt: "General: revised prompt"
    });
    expect(nodeData(rerunGeneration).staleSince).toBeUndefined();
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
    expect(nodeData(referenceAfterRun).status).toBe("idle");
    expect(nodeData(referenceAfterRun).rerunState).toBe("stale");
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

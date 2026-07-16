import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGraphNodeData,
  getLatestGraphRevision,
  listRunRecords,
  normalizeEtherGraph,
  openProject,
  saveGraph,
  type EtherGraph
} from "@ether/engine";
import { applyGraphPatch, previewGraphPatch, type GraphPatch } from "../../engine/src/graph/graphPatch";
import { callEtherTool, listEtherMcpTools } from "../../mcp-server/src/index";

const tempRoots: string[] = [];

function recordValue(value: unknown, label = "value"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${label} to be an object.`);
  }

  return value as Record<string, unknown>;
}

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-mcp-2-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createProjectWithRevision() {
  const parentDirectory = await createTempRoot();
  const projectPath = path.join(parentDirectory, "Patch Lane.ether");

  await callEtherTool("ether_project_create", {
    projectPath,
    name: "Patch Lane"
  });

  return openProject(projectPath);
}

function starterPatch(): GraphPatch {
  return {
    id: "proposal-starter",
    title: "Starter prompt to image workflow",
    operations: [
      {
        type: "addNode",
        node: {
          id: "prompt",
          type: "etherNode",
          position: { x: 0, y: 0 },
          width: 224,
          height: 138,
          data: {
            ...createGraphNodeData("prompt-general"),
            instruction: "A clean product hero image"
          }
        }
      },
      {
        type: "addNode",
        node: {
          id: "generation",
          type: "etherNode",
          position: { x: 320, y: 0 },
          width: 260,
          height: 180,
          data: createGraphNodeData("generation-image")
        }
      },
      {
        type: "addEdge",
        edge: {
          id: "edge-prompt-generation",
          source: "prompt",
          target: "generation",
          label: "prompt",
          data: { label: "prompt" }
        }
      }
    ]
  };
}

function graphWithPromptAndGeneration(): EtherGraph {
  return {
    graphVersion: "2.5",
    nodes: [
      {
        id: "prompt",
        type: "etherNode",
        position: { x: 0, y: 0 },
        data: createGraphNodeData("prompt-general")
      },
      {
        id: "generation",
        type: "etherNode",
        position: { x: 320, y: 0 },
        data: createGraphNodeData("generation-image")
      },
      {
        id: "store",
        type: "etherNode",
        position: { x: 640, y: 0 },
        data: createGraphNodeData("store-collection")
      }
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedSnapshotId: null,
    updatedAt: "2026-06-17T12:00:00.000Z"
  };
}

function graphWithTypedPatchNodes(): EtherGraph {
  return {
    graphVersion: "2.5",
    nodes: [
      {
        id: "prompt-a",
        type: "etherNode",
        position: { x: 0, y: 0 },
        data: createGraphNodeData("prompt-general")
      },
      {
        id: "prompt-b",
        type: "etherNode",
        position: { x: 320, y: 0 },
        data: createGraphNodeData("prompt-mutator")
      },
      {
        id: "generation",
        type: "etherNode",
        position: { x: 640, y: 0 },
        data: createGraphNodeData("generation-image")
      },
      {
        id: "edit",
        type: "etherNode",
        position: { x: 960, y: 0 },
        data: createGraphNodeData("edit-inpaint")
      },
      {
        id: "review",
        type: "etherNode",
        position: { x: 1280, y: 0 },
        data: createGraphNodeData("review-evaluation")
      }
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedSnapshotId: null,
    updatedAt: "2026-06-17T12:00:00.000Z"
  };
}

describe("Ether 2.0 Codex co-pilot graph patch lane", () => {
  it("previews added, changed, and removed graph patch entities without mutating the graph", () => {
    const now = "2026-06-17T12:00:00.000Z";
    const graph = {
      graphVersion: "2.5" as const,
      nodes: [
        {
          id: "prompt",
          type: "etherNode",
          position: { x: 0, y: 0 },
          data: {
            ...createGraphNodeData("prompt-general"),
            instruction: "old prompt"
          }
        },
        {
          id: "note",
          type: "etherNode",
          position: { x: 0, y: 220 },
          data: createGraphNodeData("note-cloud")
        }
      ],
      edges: [
        {
          id: "edge-old",
          source: "note",
          target: "prompt",
          label: "context",
          data: { label: "context" }
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: now
    };
    const patch: GraphPatch = {
      id: "mixed-preview",
      operations: [
        {
          type: "updateNodeConfig",
          nodeId: "prompt",
          config: { instruction: "new prompt" }
        },
        {
          type: "deleteNode",
          nodeId: "note"
        },
        {
          type: "addNode",
          node: {
            id: "generation",
            type: "etherNode",
            position: { x: 320, y: 0 },
            data: createGraphNodeData("generation-image")
          }
        },
        {
          type: "addEdge",
          edge: {
            id: "edge-prompt-generation",
            source: "prompt",
            target: "generation",
            label: "prompt",
            data: { label: "prompt" }
          }
        }
      ]
    };

    const preview = previewGraphPatch(graph, patch);

    expect(preview.summary).toEqual({
      addedNodes: 1,
      changedNodes: 1,
      removedNodes: 1,
      addedEdges: 1,
      changedEdges: 0,
      removedEdges: 1
    });
    expect(preview.nodeDiffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "generation", change: "added" }),
        expect.objectContaining({ id: "prompt", change: "changed" }),
        expect.objectContaining({ id: "note", change: "removed" })
      ])
    );
    expect(graph.nodes).toHaveLength(2);
    expect(applyGraphPatch(graph, patch).nodes.map((node) => node.id)).toEqual(["prompt", "generation"]);
  });

  it("exposes inspect-first proposal, apply, and reject MCP tools for graph patches", () => {
    const tools = listEtherMcpTools();

    expect(tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ether_graph_patch_propose",
          executionMode: "inspect-first"
        }),
        expect.objectContaining({
          name: "ether_graph_patch_apply",
          executionMode: "inspect-first",
          inputSchema: expect.objectContaining({
            required: expect.arrayContaining(["projectPath", "baseRevisionId", "patch"])
          })
        }),
        expect.objectContaining({
          name: "ether_graph_patch_reject",
          executionMode: "inspect-first"
        })
      ])
    );
  });

  it("advertises structured MCP input schemas for graph, node, edge, and patch payloads", () => {
    const tools = listEtherMcpTools();
    const tool = (name: string) => tools.find((candidate) => candidate.name === name);

    expect(tool("ether_graph_save")?.inputSchema.properties.graph).toMatchObject({ type: "object" });
    expect(tool("ether_node_create")?.inputSchema.properties.node).toMatchObject({ type: "object" });
    expect(tool("ether_edge_create")?.inputSchema.properties.edge).toMatchObject({ type: "object" });
    expect(tool("ether_graph_patch_propose")?.inputSchema.properties.patch).toMatchObject({
      type: "object",
      required: ["operations"],
      properties: {
        operations: { type: "array" }
      }
    });
    expect(tool("ether_graph_patch_apply")?.inputSchema.properties.patch).toMatchObject({
      type: "object",
      required: ["operations"],
      properties: {
        operations: { type: "array" }
      }
    });
  });

  it("rejects graph patches that edit locked nodes or locked relationships", () => {
    const graph = graphWithPromptAndGeneration();
    graph.nodes[0] = {
      ...graph.nodes[0],
      data: { ...recordValue(graph.nodes[0].data, "node data"), locked: true }
    };
    graph.edges = [
      {
        id: "edge-prompt-generation",
        source: "prompt",
        target: "generation",
        label: "prompt",
        data: { label: "prompt" }
      }
    ];

    expect(() =>
      applyGraphPatch(graph, {
        operations: [{ type: "updateNodeConfig", nodeId: "prompt", config: { instruction: "bypass" } }]
      })
    ).toThrow(/unlock the node/i);
    expect(() =>
      applyGraphPatch(graph, {
        operations: [{ type: "deleteNode", nodeId: "prompt" }]
      })
    ).toThrow(/unlock the node/i);
    expect(() =>
      applyGraphPatch(graph, {
        operations: [{ type: "deleteNode", nodeId: "generation" }]
      })
    ).toThrow(/unlock connected nodes/i);
    expect(() =>
      applyGraphPatch(graph, {
        operations: [{ type: "deleteEdge", edgeId: "edge-prompt-generation" }]
      })
    ).toThrow(/unlock connected nodes/i);
    expect(() =>
      applyGraphPatch(graph, {
        operations: [
          {
            type: "addEdge",
            edge: {
              id: "edge-prompt-store",
              source: "prompt",
              target: "store",
              label: "context",
              data: { label: "context" }
            }
          }
        ]
      })
    ).toThrow(/unlock connected nodes/i);

    const edgeLockedGraph = graphWithPromptAndGeneration();
    edgeLockedGraph.edges = [
      {
        id: "edge-locked",
        source: "prompt",
        target: "generation",
        label: "prompt",
        data: { label: "prompt", locked: true }
      }
    ];

    expect(() =>
      applyGraphPatch(edgeLockedGraph, {
        operations: [{ type: "updateEdge", edgeId: "edge-locked", patch: { label: "context" } }]
      })
    ).toThrow(/unlock the edge/i);
  });

  it("validates patch edge operations with normal connection rules", () => {
    const graph = graphWithPromptAndGeneration();
    graph.edges = [
      {
        id: "edge-prompt-generation",
        source: "prompt",
        target: "generation",
        label: "prompt",
        data: { label: "prompt" }
      }
    ];

    expect(() =>
      applyGraphPatch(graph, {
        operations: [
          {
            type: "addEdge",
            edge: {
              id: "edge-duplicate",
              source: "prompt",
              target: "generation",
              label: "prompt",
              data: { label: "prompt" }
            }
          }
        ]
      })
    ).toThrow(/already exists/i);
    expect(() =>
      applyGraphPatch(graph, {
        operations: [
          {
            type: "addEdge",
            edge: {
              id: "edge-invalid-kind",
              source: "store",
              target: "prompt",
              label: "context",
              data: { label: "context" }
            }
          }
        ]
      })
    ).toThrow(/cannot connect/i);
    expect(() =>
      applyGraphPatch(graph, {
        operations: [
          {
            type: "addEdge",
            edge: {
              id: "edge-malformed",
              source: 12 as unknown as string,
              target: "generation"
            }
          }
        ]
      })
    ).toThrow(/source is required/i);
    expect(() =>
      applyGraphPatch(graph, {
        operations: [{ type: "updateEdge", edgeId: "edge-prompt-generation", patch: { id: "changed-id" } }]
      })
    ).toThrow(/edge id cannot be changed/i);
    expect(() =>
      applyGraphPatch(graph, {
        operations: [
          {
            type: "addEdge",
            edge: {
              id: "edge-generation-store",
              source: "generation",
              target: "store",
              label: "result",
              data: { label: "result" }
            }
          },
          {
            type: "updateEdge",
            edgeId: "edge-prompt-generation",
            patch: { source: "generation", target: "store" }
          }
        ]
      })
    ).toThrow(/already exists/i);
  });

  it("canonicalizes effectful Ether 2.5 channel metadata on patch edges", () => {
    const graph = graphWithTypedPatchNodes();

    const nextGraph = applyGraphPatch(graph, {
      operations: [
        {
          type: "addEdge",
          edge: {
            id: "edge-text-text",
            source: "prompt-a",
            target: "prompt-b",
            label: "context",
            data: {
              sourceChannel: "prompt",
              targetChannel: "text",
              role: "negativePrompt"
            }
          }
        },
        {
          type: "addEdge",
          edge: {
            id: "edge-text-image",
            source: "prompt-a",
            target: "generation",
            label: "style",
            data: {
              sourceChannel: "text",
              targetChannel: "image",
              role: "style"
            }
          }
        },
        {
          type: "addEdge",
          edge: {
            id: "edge-image-image",
            source: "generation",
            target: "edit",
            label: "variant",
            data: {
              sourceChannel: "outputImage",
              targetChannel: "editedImage",
              role: "reference"
            }
          }
        }
      ]
    });

    expect(nextGraph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "edge-text-text",
          type: "etherEdge",
          data: expect.objectContaining({
            graphVersion: "2.5",
            sourceChannel: "text",
            targetChannel: "text",
            role: "negative"
          })
        }),
        expect.objectContaining({
          id: "edge-text-image",
          type: "etherEdge",
          data: expect.objectContaining({
            graphVersion: "2.5",
            sourceChannel: "text",
            targetChannel: "image",
            role: "style"
          })
        }),
        expect.objectContaining({
          id: "edge-image-image",
          type: "etherEdge",
          data: expect.objectContaining({
            graphVersion: "2.5",
            sourceChannel: "image",
            targetChannel: "image",
            role: "general"
          })
        })
      ])
    );
    expect(nextGraph.edges.find((edge) => edge.id === "edge-text-image")?.data).not.toHaveProperty("adapter");
  });

  it("allows parallel lanes between the same nodes when channel or role differs", () => {
    const graph = graphWithTypedPatchNodes();
    const nextGraph = applyGraphPatch(graph, {
      operations: [
        {
          type: "addEdge",
          edge: {
            id: "edge-subject-text",
            source: "prompt-a",
            target: "generation",
            data: {
              sourceChannel: "text",
              targetChannel: "text",
              role: "subject"
            }
          }
        },
        {
          type: "addEdge",
          edge: {
            id: "edge-subject-data",
            source: "prompt-a",
            target: "generation",
            data: {
              sourceChannel: "data",
              targetChannel: "data",
              role: "subject"
            }
          }
        },
        {
          type: "addEdge",
          edge: {
            id: "edge-style-text",
            source: "prompt-a",
            target: "generation",
            data: {
              sourceChannel: "text",
              targetChannel: "text",
              role: "style"
            }
          }
        }
      ]
    });

    expect(nextGraph.edges.map((edge) => edge.id)).toEqual([
      "edge-subject-text",
      "edge-subject-data",
      "edge-style-text"
    ]);

    expect(() =>
      applyGraphPatch(nextGraph, {
        operations: [
          {
            type: "addEdge",
            edge: {
              id: "edge-duplicate-subject-text",
              source: "prompt-a",
              target: "generation",
              data: {
                sourceChannel: "text",
                targetChannel: "text",
                role: "subject"
              }
            }
          }
        ]
      })
    ).toThrow(/already exists/i);
  });

  it("rejects patch edges with unknown or unavailable adapter channel metadata", () => {
    const graph = graphWithTypedPatchNodes();

    expect(() =>
      applyGraphPatch(graph, {
        operations: [
          {
            type: "addEdge",
            edge: {
              id: "edge-unknown-channel",
              source: "prompt-a",
              target: "generation",
              data: {
                sourceChannel: "smell",
                targetChannel: "image"
              }
            }
          }
        ]
      })
    ).toThrow(/unknown payload channel/i);

    expect(() =>
      applyGraphPatch(graph, {
        operations: [
          {
            type: "addEdge",
            edge: {
              id: "edge-image-text",
              source: "generation",
              target: "review",
              data: {
                sourceChannel: "image",
                targetChannel: "text"
              }
            }
          }
        ]
      })
    ).toThrow(/adapter/i);
  });

  it("proposes, applies, rejects, and revision-protects patches without starting a run", async () => {
    const project = await createProjectWithRevision();
    const baseRevision = await getLatestGraphRevision(project.path);
    const patch = starterPatch();

    const proposal = await callEtherTool("ether_graph_patch_propose", {
      projectPath: project.path,
      patch
    });

    expect(proposal).toMatchObject({
      baseRevisionId: baseRevision?.id,
      patch: expect.objectContaining({ id: "proposal-starter" }),
      preview: {
        summary: expect.objectContaining({
          addedNodes: 2,
          addedEdges: 1
        })
      },
      applied: false,
      executionStarted: false
    });
    expect((await openProject(project.path)).graph.nodes).toHaveLength(0);

    const rejected = await callEtherTool("ether_graph_patch_reject", {
      projectPath: project.path,
      baseRevisionId: baseRevision?.id,
      patchId: patch.id
    });

    expect(rejected).toMatchObject({
      status: "rejected",
      patchId: "proposal-starter",
      graphChanged: false,
      executionStarted: false
    });

    const applied = await callEtherTool("ether_graph_patch_apply", {
      projectPath: project.path,
      baseRevisionId: baseRevision?.id,
      patch
    });

    expect(applied).toMatchObject({
      applied: true,
      executionStarted: false,
      preview: {
        summary: expect.objectContaining({
          addedNodes: 2,
          addedEdges: 1
        })
      },
      revision: expect.objectContaining({
        parentRevisionId: baseRevision?.id
      })
    });
    const appliedGraph = normalizeEtherGraph(recordValue(applied, "patch result").graph);
    expect(appliedGraph.nodes.map((node) => node.id)).toEqual(["prompt", "generation"]);
    expect(await listRunRecords(project.path)).toHaveLength(0);

    await expect(
      callEtherTool("ether_graph_patch_apply", {
        projectPath: project.path,
        baseRevisionId: baseRevision?.id,
        patch: {
          id: "stale",
          operations: [
            {
              type: "updateNodeConfig",
              nodeId: "prompt",
              config: { instruction: "stale edit" }
            }
          ]
        }
      })
    ).rejects.toThrow(/stale graph revision/i);
  });

  it("requires an explicit base revision id when applying a patch", async () => {
    const project = await createProjectWithRevision();

    await expect(
      callEtherTool("ether_graph_patch_apply", {
        projectPath: project.path,
        patch: starterPatch()
      })
    ).rejects.toThrow(/baseRevisionId is required/i);
  });

  it("supports template insertion patches", async () => {
    const project = await createProjectWithRevision();
    const baseRevision = await getLatestGraphRevision(project.path);

    const applied = await callEtherTool("ether_graph_patch_apply", {
      projectPath: project.path,
      baseRevisionId: baseRevision?.id,
      patch: {
        id: "insert-review-router",
        title: "Review router",
        operations: [
          {
            type: "insertTemplate",
            templateId: "review-router",
            options: {
              idPrefix: "review-router-test",
              origin: { x: 100, y: 200 }
            }
          }
        ]
      }
    });

    const appliedResult = recordValue(applied, "template patch result");
    const appliedGraph = normalizeEtherGraph(appliedResult.graph);
    const previewSummary = recordValue(
      recordValue(appliedResult.preview, "patch preview").summary,
      "patch summary"
    );
    expect(previewSummary.addedNodes).toBeGreaterThan(2);
    expect(appliedGraph.edges.length).toBeGreaterThan(0);

    await saveGraph(project.path, appliedGraph);
    expect(await listRunRecords(project.path)).toHaveLength(0);
  });
});

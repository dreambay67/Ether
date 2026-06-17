import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  callEtherTool,
  handleMcpJsonRpcMessage,
  listEtherMcpTools
} from "../../mcp-server/src/index";

const tempRoots: string[] = [];

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-mcp-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Ether MCP tool registry", () => {
  it("lists every required Phase 10 tool with explicit execution metadata", () => {
    const tools = listEtherMcpTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "ether_project_open",
        "ether_project_create",
        "ether_graph_get",
        "ether_graph_save",
        "ether_node_create",
        "ether_edge_create",
        "ether_node_update",
        "ether_run_node",
        "ether_run_selected",
        "ether_run_branch",
        "ether_assets_list",
        "ether_asset_import",
        "ether_collections_list",
        "ether_health_check",
        "ether_node_contracts",
        "ether_run_status"
      ])
    );
    expect(tools.filter((tool) => tool.name.startsWith("ether_run_"))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ether_run_node",
          executionMode: "explicit-only"
        }),
        expect.objectContaining({
          name: "ether_run_selected",
          executionMode: "explicit-only"
        }),
        expect.objectContaining({
          name: "ether_run_branch",
          executionMode: "explicit-only"
        })
      ])
    );
  });

  it("handles basic MCP JSON-RPC initialize, tools/list, and tools/call messages", async () => {
    await expect(
      handleMcpJsonRpcMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {}
      })
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        capabilities: { tools: {} },
        serverInfo: { name: "ether-mcp-server" }
      }
    });
    await expect(
      handleMcpJsonRpcMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
      })
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "ether_graph_get" })
        ])
      }
    });
    await expect(
      handleMcpJsonRpcMessage({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "ether_node_contracts",
          arguments: {}
        }
      })
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      result: {
        content: [
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining("generation-image")
          })
        ]
      }
    });
  });

  it("creates, edits, saves, inspects, runs, imports, and reports project state through tools", async () => {
    const parentDirectory = await createTempRoot();
    const projectPath = path.join(parentDirectory, "Mcp Flow.ether");
    const referencePath = path.join(parentDirectory, "reference.png");
    await writeFile(referencePath, "fake reference");

    const created = await callEtherTool("ether_project_create", {
      projectPath,
      name: "Mcp Flow"
    });
    expect(created).toMatchObject({
      path: projectPath,
      metadata: expect.objectContaining({ displayName: "Mcp Flow" })
    });

    await callEtherTool("ether_node_create", {
      projectPath,
      node: {
        id: "prompt",
        definitionId: "prompt-general",
        position: { x: 0, y: 0 },
        data: { instruction: "subscription-backed hero image" }
      }
    });
    await callEtherTool("ether_node_create", {
      projectPath,
      node: {
        id: "generation",
        definitionId: "generation-image",
        position: { x: 320, y: 0 }
      }
    });
    await callEtherTool("ether_edge_create", {
      projectPath,
      edge: {
        id: "edge-prompt-generation",
        source: "prompt",
        target: "generation"
      }
    });
    await callEtherTool("ether_node_update", {
      projectPath,
      nodeId: "prompt",
      patch: {
        instruction: "subscription-backed cinematic hero image"
      }
    });

    const graph = await callEtherTool("ether_graph_get", { projectPath });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ label: "prompt" });

    const contracts = await callEtherTool("ether_node_contracts", {});
    expect(contracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          definitionId: "generation-image",
          runnable: true
        })
      ])
    );

    const run = await callEtherTool("ether_run_selected", {
      projectPath,
      nodeIds: ["prompt"],
      policy: "selected"
    });
    expect(run.results[0]).toMatchObject({ action: "assemble-prompt", status: "complete" });

    const imported = await callEtherTool("ether_asset_import", {
      projectPath,
      filePath: referencePath,
      role: "subject",
      linkMode: "linked"
    });
    expect(imported).toMatchObject({
      kind: "reference",
      metadata: expect.objectContaining({ role: "subject" })
    });
    const assets = await callEtherTool("ether_assets_list", { projectPath, query: { kind: "reference" } });
    expect(assets).toHaveLength(1);

    await callEtherTool("ether_node_create", {
      projectPath,
      node: {
        id: "selected",
        definitionId: "store-collection",
        data: { title: "Selected", label: "Selected" },
        position: { x: 640, y: 0 }
      }
    });
    await callEtherTool("ether_run_node", {
      projectPath,
      nodeId: "selected",
      policy: "selected"
    });
    const collections = await callEtherTool("ether_collections_list", { projectPath });
    expect(collections).toEqual([
      expect.objectContaining({
        kind: "collection",
        path: expect.stringContaining("Selected")
      })
    ]);

    const status = await callEtherTool("ether_run_status", { projectPath });
    expect(status.map((record: { metadata: { action?: string } }) => record.metadata.action)).toEqual(
      expect.arrayContaining(["assemble-prompt", "ensure-collection"])
    );
    await expect(callEtherTool("ether_health_check", { projectPath })).resolves.toMatchObject({
      issues: []
    });

    const saved = await callEtherTool("ether_graph_save", {
      projectPath,
      graph
    });
    expect((await readFile(path.join(projectPath, "graph.json"), "utf8"))).toContain("edge-prompt-generation");
    expect(typeof saved.updatedAt).toBe("string");
    expect(saved.updatedAt).not.toEqual(graph.updatedAt);
  });
});

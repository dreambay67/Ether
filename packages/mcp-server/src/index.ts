#!/usr/bin/env node
import path from "node:path";
import {
  NODE_CONTRACTS,
  canConnectNodeKinds,
  createGraphNodeData,
  createProject,
  executeGraphRun,
  linkExternalReference,
  listAssets,
  listRunRecords,
  loadGraph,
  openProject,
  runHealthCheck,
  saveGraph,
  type CanvasNodeData,
  type EtherGraph,
  type ExecutionPolicy
} from "@ether/engine";

export type EtherMcpToolName =
  | "ether_project_open"
  | "ether_project_create"
  | "ether_graph_get"
  | "ether_graph_save"
  | "ether_node_create"
  | "ether_edge_create"
  | "ether_node_update"
  | "ether_run_node"
  | "ether_run_selected"
  | "ether_run_branch"
  | "ether_assets_list"
  | "ether_asset_import"
  | "ether_collections_list"
  | "ether_health_check"
  | "ether_node_contracts"
  | "ether_run_status";

export type EtherMcpToolDescriptor = {
  name: EtherMcpToolName;
  description: string;
  executionMode: "inspect-first" | "explicit-only";
  inputSchema: {
    type: "object";
    required?: string[];
    properties: Record<string, unknown>;
  };
};

type GraphNode = EtherGraph["nodes"][number] & {
  id: string;
  position?: { x?: number; y?: number };
  data?: Partial<CanvasNodeData>;
};

type GraphEdge = EtherGraph["edges"][number] & {
  id: string;
  source: string;
  target: string;
  label?: unknown;
  data?: { label?: unknown };
};

const toolDescriptors: EtherMcpToolDescriptor[] = [
  inspectTool("ether_project_open", "Open and inspect an existing Ether project bundle.", ["projectPath"]),
  inspectTool("ether_project_create", "Create a new local Ether project bundle.", ["projectPath", "name"]),
  inspectTool("ether_graph_get", "Read the current Ether graph JSON.", ["projectPath"]),
  inspectTool("ether_graph_save", "Save a complete Ether graph JSON payload.", ["projectPath", "graph"]),
  inspectTool("ether_node_create", "Create a graph node without executing it.", ["projectPath", "node"]),
  inspectTool("ether_edge_create", "Create a validated graph edge without executing nodes.", ["projectPath", "edge"]),
  inspectTool("ether_node_update", "Patch one graph node's editable data.", ["projectPath", "nodeId", "patch"]),
  runTool("ether_run_node", "Explicitly run one Ether node and save the resulting graph.", ["projectPath", "nodeId"]),
  runTool("ether_run_selected", "Explicitly run selected Ether nodes in dependency order.", ["projectPath", "nodeIds"]),
  runTool("ether_run_branch", "Explicitly run a branch with a generation cap.", ["projectPath", "nodeId"]),
  inspectTool("ether_assets_list", "List project assets by optional query.", ["projectPath"]),
  inspectTool("ether_asset_import", "Link a local reference asset into the project.", ["projectPath", "filePath"]),
  inspectTool("ether_collections_list", "List mirrored collection folders.", ["projectPath"]),
  inspectTool("ether_health_check", "Run a project health check.", ["projectPath"]),
  inspectTool("ether_node_contracts", "Inspect Ether node input/output contracts.", []),
  inspectTool("ether_run_status", "List durable Ether run records.", ["projectPath"])
];

export function listEtherMcpTools() {
  return toolDescriptors.map((tool) => ({ ...tool, inputSchema: { ...tool.inputSchema } }));
}

export async function callEtherTool(name: EtherMcpToolName | string, input: Record<string, unknown>) {
  switch (name) {
    case "ether_project_open":
      return openProject(requiredString(input, "projectPath"));
    case "ether_project_create":
      return createProjectFromPath(input);
    case "ether_graph_get":
      return loadGraph(requiredString(input, "projectPath"));
    case "ether_graph_save":
      return saveGraph(requiredString(input, "projectPath"), requiredGraph(input.graph));
    case "ether_node_create":
      return createNode(requiredString(input, "projectPath"), requiredRecord(input.node, "node"));
    case "ether_edge_create":
      return createEdge(requiredString(input, "projectPath"), requiredRecord(input.edge, "edge"));
    case "ether_node_update":
      return updateNode(
        requiredString(input, "projectPath"),
        requiredString(input, "nodeId"),
        requiredRecord(input.patch, "patch")
      );
    case "ether_run_node":
      return runAndSave(requiredString(input, "projectPath"), {
        policy: normalizePolicy(input.policy),
        targetNodeIds: [requiredString(input, "nodeId")]
      });
    case "ether_run_selected":
      return runAndSave(requiredString(input, "projectPath"), {
        policy: normalizePolicy(input.policy),
        targetNodeIds: requiredStringArray(input.nodeIds, "nodeIds")
      });
    case "ether_run_branch":
      return runAndSave(requiredString(input, "projectPath"), {
        policy: "branch",
        targetNodeIds: [requiredString(input, "nodeId")],
        runCountCap: optionalNumber(input.runCountCap),
        parallel: input.parallel === true
      });
    case "ether_assets_list":
      return listAssets(requiredString(input, "projectPath"), optionalRecord(input.query));
    case "ether_asset_import":
      return linkExternalReference(requiredString(input, "projectPath"), {
        filePath: requiredString(input, "filePath"),
        role: optionalString(input.role) || "reference",
        linkMode: optionalString(input.linkMode) === "linked" ? "linked" : "linked"
      });
    case "ether_collections_list":
      return listAssets(requiredString(input, "projectPath"), { kind: "collection" });
    case "ether_health_check":
      return runHealthCheck(requiredString(input, "projectPath"));
    case "ether_node_contracts":
      return NODE_CONTRACTS;
    case "ether_run_status":
      return listRunRecords(requiredString(input, "projectPath"));
    default:
      throw new Error(`Unknown Ether MCP tool: ${name}`);
  }
}

export async function handleMcpJsonRpcMessage(message: unknown) {
  const request = requiredRecord(message, "message");
  const id = request.id;
  const method = optionalString(request.method);

  if (!id && method.startsWith("notifications/")) {
    return null;
  }

  try {
    switch (method) {
      case "initialize":
        return jsonRpcResult(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: {
            name: "ether-mcp-server",
            version: "0.1.0"
          }
        });
      case "tools/list":
        return jsonRpcResult(id, {
          tools: listEtherMcpTools().map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        });
      case "tools/call": {
        const params = requiredRecord(request.params, "params");
        const result = await callEtherTool(
          requiredString(params, "name"),
          optionalRecord(params.arguments)
        );

        return jsonRpcResult(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        });
      }
      default:
        return jsonRpcError(id, -32601, `Unsupported MCP method: ${method}`);
    }
  } catch (error) {
    return jsonRpcError(id, -32000, error instanceof Error ? error.message : String(error));
  }
}

async function createProjectFromPath(input: Record<string, unknown>) {
  const projectPath = requiredString(input, "projectPath");
  const rawName = optionalString(input.name);
  const parsed = parseProjectCreatePath(projectPath, rawName);

  return createProject(parsed);
}

async function createNode(projectPath: string, nodeInput: Record<string, unknown>) {
  const graph = await loadGraph(projectPath);
  const definitionId = requiredString(nodeInput, "definitionId");
  const nodeId = optionalString(nodeInput.id) || `node-${definitionId}-${Date.now()}`;
  const position = positionFrom(nodeInput.position);
  const data = {
    ...createGraphNodeData(definitionId),
    ...optionalRecord(nodeInput.data)
  };
  const nextGraph: EtherGraph = {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        id: nodeId,
        type: optionalString(nodeInput.type) || "etherNode",
        position,
        width: optionalNumber(nodeInput.width) ?? 224,
        height: optionalNumber(nodeInput.height) ?? 138,
        data
      }
    ]
  };

  return saveGraph(projectPath, nextGraph);
}

async function createEdge(projectPath: string, edgeInput: Record<string, unknown>) {
  const graph = await loadGraph(projectPath);
  const source = requiredString(edgeInput, "source");
  const target = requiredString(edgeInput, "target");
  const sourceNode = findNode(graph, source);
  const targetNode = findNode(graph, target);
  const duplicate = graph.edges.some((edge) => {
    const candidate = edge as Partial<GraphEdge>;
    return candidate.source === source && candidate.target === target;
  });
  const rule = canConnectNodeKinds(
    sourceNode.data?.kind ?? "",
    targetNode.data?.kind ?? "",
    { sourceId: source, targetId: target, duplicate }
  );

  if (!rule.allowed) {
    throw new Error(rule.reason ?? "Connection is not allowed.");
  }

  const label = optionalString(edgeInput.label) || rule.defaultLabel || "context";
  const nextGraph: EtherGraph = {
    ...graph,
    edges: [
      ...graph.edges,
      {
        id: optionalString(edgeInput.id) || `edge-${source}-${target}-${Date.now()}`,
        source,
        target,
        label,
        data: { label }
      }
    ]
  };

  return saveGraph(projectPath, nextGraph);
}

async function updateNode(projectPath: string, nodeId: string, patch: Record<string, unknown>) {
  const graph = await loadGraph(projectPath);
  const nextGraph: EtherGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const candidate = node as Partial<GraphNode>;

      if (candidate.id !== nodeId) {
        return node;
      }

      return {
        ...node,
        data: {
          ...(candidate.data ?? {}),
          ...patch
        }
      };
    })
  };

  if (!nextGraph.nodes.some((node) => (node as Partial<GraphNode>).id === nodeId)) {
    throw new Error(`Unknown graph node: ${nodeId}`);
  }

  return saveGraph(projectPath, nextGraph);
}

async function runAndSave(
  projectPath: string,
  request: {
    policy: ExecutionPolicy;
    targetNodeIds: string[];
    runCountCap?: number;
    parallel?: boolean;
  }
) {
  const graph = await loadGraph(projectPath);
  const result = await executeGraphRun(projectPath, graph, request);
  const savedGraph = await saveGraph(projectPath, result.graph);

  return {
    ...result,
    graph: savedGraph
  };
}

function parseProjectCreatePath(projectPath: string, name?: string) {
  const resolved = path.resolve(projectPath);
  const hasBundleExtension = resolved.toLowerCase().endsWith(".ether");
  const parentDirectory = hasBundleExtension ? path.dirname(resolved) : resolved;
  const projectName = name?.trim() || (hasBundleExtension ? path.basename(resolved, ".ether") : "");

  if (!projectName) {
    throw new Error("Project name is required when projectPath is a parent directory.");
  }

  return { parentDirectory, name: projectName };
}

function findNode(graph: EtherGraph, nodeId: string): GraphNode {
  const node = graph.nodes.find((candidate) => (candidate as Partial<GraphNode>).id === nodeId) as
    | GraphNode
    | undefined;

  if (!node) {
    throw new Error(`Unknown graph node: ${nodeId}`);
  }

  return node;
}

function inspectTool(name: EtherMcpToolName, description: string, required: string[]): EtherMcpToolDescriptor {
  return tool(name, description, required, "inspect-first");
}

function runTool(name: EtherMcpToolName, description: string, required: string[]): EtherMcpToolDescriptor {
  return tool(name, `${description} Requires an explicit user execution request.`, required, "explicit-only");
}

function tool(
  name: EtherMcpToolName,
  description: string,
  required: string[],
  executionMode: EtherMcpToolDescriptor["executionMode"]
): EtherMcpToolDescriptor {
  return {
    name,
    description,
    executionMode,
    inputSchema: {
      type: "object",
      required,
      properties: Object.fromEntries(required.map((entry) => [entry, { type: "string" }]))
    }
  };
}

function requiredGraph(value: unknown): EtherGraph {
  const graph = requiredRecord(value, "graph");

  return graph as EtherGraph;
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function requiredString(input: Record<string, unknown>, field: string) {
  const value = input[field];

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }

  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function requiredStringArray(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`${field} must be a string array.`);
  }

  return value as string[];
}

function optionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function normalizePolicy(value: unknown): ExecutionPolicy {
  return value === "refresh-upstream" ||
    value === "downstream" ||
    value === "branch" ||
    value === "selected"
    ? value
    : "cached-inputs";
}

function positionFrom(value: unknown) {
  const record = optionalRecord(value);
  const x = optionalNumber(record.x) ?? 0;
  const y = optionalNumber(record.y) ?? 0;

  return { x, y };
}

function jsonRpcResult(id: unknown, result: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  };
}

function writeMcpMessage(message: unknown) {
  const body = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;

  process.stdout.write(`${header}${body}`);
}

function parseMcpMessages(buffer: Buffer) {
  const messages: unknown[] = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const headerEnd = buffer.indexOf("\r\n\r\n", cursor);

    if (headerEnd === -1) {
      break;
    }

    const header = buffer.subarray(cursor, headerEnd).toString("utf8");
    const lengthMatch = /content-length:\s*(\d+)/i.exec(header);

    if (!lengthMatch) {
      throw new Error("MCP message is missing Content-Length.");
    }

    const contentLength = Number(lengthMatch[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;

    if (buffer.length < bodyEnd) {
      break;
    }

    messages.push(JSON.parse(buffer.subarray(bodyStart, bodyEnd).toString("utf8")));
    cursor = bodyEnd;
  }

  return {
    messages,
    rest: Buffer.from(buffer.subarray(cursor))
  };
}

async function runStdioServer() {
  let pending = Buffer.alloc(0);

  process.stdin.on("data", async (chunk: Buffer) => {
    try {
      pending = Buffer.concat([pending, chunk]);
      const parsed = parseMcpMessages(pending);
      pending = parsed.rest;

      for (const message of parsed.messages) {
        const response = await handleMcpJsonRpcMessage(message);

        if (response) {
          writeMcpMessage(response);
        }
      }
    } catch (error) {
      writeMcpMessage(jsonRpcError(null, -32700, error instanceof Error ? error.message : String(error)));
      pending = Buffer.alloc(0);
    }
  });
}

if (require.main === module) {
  runStdioServer().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

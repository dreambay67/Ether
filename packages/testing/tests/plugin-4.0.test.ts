import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import type {
  ApplicationCommand,
  ApplicationCommandResponse,
  ApplicationErrorMessage,
  ApplicationQuery,
  ApplicationQueryResponse,
  EtherGraph,
  GraphTransaction
} from "@ether/schema";
import { EtherGraphSchema, GraphTransactionSchema } from "@ether/schema";
import { previewGraphTransaction, validateFullGraphState } from "../../graph-kernel/src/index.js";
import { nodeDefinitions } from "../../graph-kernel/src/registry.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createEtherMcpServer,
  ETHER_MCP_TOOLS,
  type EtherMcpApplicationAdapter
} from "../../mcp-server/src/index.js";
import { EtherMcpError } from "../../mcp-server/src/schemas.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const pluginRoot = path.join(repoRoot, "packages", "codex-plugin", "ether");
const primarySkills = [
  "ether-director", "ether-graph-architect", "ether-intelligence-director",
  "ether-reference-curator", "ether-run-operator", "ether-recipe-studio",
  "ether-review-director", "ether-artifact-librarian", "ether-project-doctor"
] as const;
const aliasSkills = [
  "ether-workflow", "ether-connection-model", "ether-prompt-systems",
  "ether-review-router", "ether-provider-safety", "ether-recovery"
] as const;
const channels = ["text", "image", "mask", "data", "video", "audio"];
const roles = ["general", "negative", "subject", "product", "face", "clothing", "pose", "setting", "composition", "style", "lighting", "colourPalette", "typography", "motion", "timing"];
const publicTools = ETHER_MCP_TOOLS.map((tool) => tool.name);
const timestamp = "2026-07-23T12:00:00.000Z";
const viewState = { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null };

type Fixture = {
  client: Client;
  server: ReturnType<typeof createEtherMcpServer>;
  executed: string[];
  acceptEditPermit(id: string): void;
  close(): Promise<void>;
};

const fixtures: Fixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

async function readSkill(name: string) {
  return readFile(path.join(pluginRoot, "skills", name, "SKILL.md"), "utf8");
}

async function readTransactionTemplate(name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(pluginRoot, "examples", name), "utf8"));
}

describe("Ether 4.0 Codex plugin", () => {
  it("ships exactly nine primary skills, six aliases, valid cards, and one safe MCP registration", async () => {
    const directories = (await readdir(path.join(pluginRoot, "skills"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    expect(directories).toEqual([...primarySkills, ...aliasSkills].sort());

    const manifest = JSON.parse(await readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
    const mcp = JSON.parse(await readFile(path.join(pluginRoot, ".mcp.json"), "utf8"));
    expect(manifest).toMatchObject({ name: "ether", version: "4.0.0", skills: "./skills/", mcpServers: "./.mcp.json" });
    expect(manifest.interface.skillHighlights.map((item: { skill: string }) => item.skill).sort()).toEqual([...primarySkills].sort());
    expect(mcp).toEqual({ mcpServers: { ether: { command: "node", args: ["../../mcp-server/dist/index.js"], env: {} } } });

    for (const name of primarySkills) {
      const [content, card] = await Promise.all([
        readSkill(name),
        readFile(path.join(pluginRoot, "skills", name, "agents", "openai.yaml"), "utf8")
      ]);
      expect(content).toContain(`Channels: ${channels.join(", ")}`);
      expect(content).toContain(`Roles: ${roles.join(", ")}`);
      expect(card.split(/\r?\n/).filter(Boolean)).toHaveLength(4);
      expect(card).toMatch(/^interface:\r?\n {2}display_name: .+\r?\n {2}short_description: .+\r?\n {2}default_prompt: .+$/m);
      expect(card).toContain(`Use $${name}`);
      expect(card).toContain("Ether 4.0");
    }
  });

  it("references only the stable MCP tool surface and rejects shorthand, grant calls, and invalid temp refs", async () => {
    expect(publicTools).toEqual([
      "ether.document.inspect", "ether.document.health", "ether.project.doctor", "ether.recovery.inspect", "ether.permission.inspect",
      "ether.node.catalog", "ether.graph.catalog", "ether.graph.inspect", "ether.graph.validate",
      "ether.graph.transaction.preview", "ether.graph.transaction.apply", "ether.graph.transaction.reject",
      "ether.provider.inspect", "ether.recipe.list", "ether.recipe.setup", "ether.recipe.preview", "ether.recipe.instantiate",
      "ether.reference.list", "ether.reference.inspect", "ether.artifact.search", "ether.artifact.inspect", "ether.artifact.lineage", "ether.collection.list",
      "ether.run.list", "ether.run.inspect", "ether.run.plan.inspect", "ether.run.plan.preview", "ether.run.start", "ether.run.cancel", "ether.run.retry"
    ]);

    for (const name of [...primarySkills, ...aliasSkills]) {
      const content = await readSkill(name);
      expect(contractViolations(content), name).toEqual([]);
      for (const tool of [...content.matchAll(/`(ether\.[a-z.]+)`/g)].map((match) => match[1])) {
        expect(publicTools, `${name} references ${tool}`).toContain(tool);
      }
    }
    expect(contractViolations("Call `graph.snapshot` then permission.grantEdit with `$prompt`.")).toEqual([
      "permission grant", "shorthand tool", "invalid reference $prompt"
    ]);
  });

  it("previews and applies the shared construction and repair transactions through MCP without execution", async () => {
    const fixture = await createFixture();
    const document = await call(fixture, "ether.document.inspect");
    const graphCatalog = await call(fixture, "ether.graph.catalog");
    const targetGraphId = requiredString(record(array(graphCatalog.graphs)[0]).id);
    const initialInspection = await call(fixture, "ether.graph.inspect", { graphId: targetGraphId });
    const references = array((await call(fixture, "ether.reference.list")).references).map(record);
    const pathPermit = array((await call(fixture, "ether.permission.inspect")).permits)
      .map(record).find((permit) => permit.permission === "path" && permit.state === "active");
    const baseDocumentRevisionId = requiredString(record(document.dirtyState).documentRevisionId);
    const baseGraphRevisionId = requiredString(initialInspection.graphRevisionId);
    const construction = GraphTransactionSchema.parse(hydrateTemplate(
      await readTransactionTemplate("editorial-campaign.transaction.json"),
      {
        baseDocumentRevisionId,
        baseGraphRevisionId,
        targetGraphId,
        productReferenceId: requiredString(references[0]?.id),
        styleReferenceId: requiredString(references[1]?.id),
        compositionReferenceId: requiredString(references[2]?.id),
        pathGrantId: requiredString(pathPermit?.id)
      }
    ));
    const preview = await call(fixture, "ether.graph.transaction.preview", { transaction: construction });
    const proposal = record(preview.proposal);
    expect(proposal).toMatchObject({
      state: "previewed",
      summary: { operationCount: 13, addedNodes: 7, addedEdges: 6, removedNodes: 0, removedEdges: 0 }
    });
    expect(Object.keys(record(proposal.tempIds))).toHaveLength(13);

    const denied = await callResult(fixture, "ether.graph.transaction.apply", {
      proposalId: proposal.proposalId,
      baseDocumentRevisionId,
      editPermitId: "missing-edit-permit"
    });
    expect(denied).toMatchObject({ isError: true, structuredContent: { error: { code: "PERMIT_REVOKED" } } });

    fixture.acceptEditPermit("host-edit-approved");
    const constructionApplied = await call(fixture, "ether.graph.transaction.apply", {
      proposalId: proposal.proposalId,
      baseDocumentRevisionId,
      editPermitId: "host-edit-approved"
    });
    expect(constructionApplied).toMatchObject({ state: "applied" });

    const inspected = await call(fixture, "ether.graph.inspect", { graphId: targetGraphId });
    const inspectedGraph = EtherGraphSchema.parse(inspected.graph);
    const validation = await call(fixture, "ether.graph.validate", { graphId: targetGraphId });
    const doctor = await call(fixture, "ether.project.doctor");
    expect(validation).toEqual({ valid: true, issues: [] });
    expect(doctor).toMatchObject({ validation: { valid: true, issues: [] }, doctor: { state: "inspected", mutationPerformed: false } });

    const tempIds = record(proposal.tempIds);
    const reviewNodeId = requiredString(tempIds["$temp:node:campaign-review"]);
    const collectionNodeId = requiredString(tempIds["$temp:node:campaign-collection"]);
    const reviewCollectionEdgeId = requiredString(tempIds["$temp:edge:review-collection"]);
    expect(inspectedGraph.nodes.some((node) => node.id === reviewNodeId && node.definitionId === "review.compare")).toBe(true);
    expect(inspectedGraph.nodes.some((node) => node.id === collectionNodeId && node.definitionId === "output.collection")).toBe(true);
    expect(inspectedGraph.edges.some((edge) => edge.id === reviewCollectionEdgeId)).toBe(true);

    const applyRevision = record(constructionApplied.result);
    const repairDocumentRevisionId = requiredString(inspected.documentRevisionId);
    const repairGraphRevisionId = requiredString(inspected.graphRevisionId);
    expect(applyRevision.documentRevisionId).toBe(repairDocumentRevisionId);
    expect(record(applyRevision.graphRevisions)[targetGraphId]).toBe(repairGraphRevisionId);

    const repair = GraphTransactionSchema.parse(hydrateTemplate(
      await readTransactionTemplate("review-repair.transaction.json"),
      {
        baseDocumentRevisionId: repairDocumentRevisionId,
        baseGraphRevisionId: repairGraphRevisionId,
        targetGraphId,
        reviewNodeId,
        collectionNodeId,
        reviewCollectionEdgeId
      }
    ));
    const repairPreview = await call(fixture, "ether.graph.transaction.preview", { transaction: repair });
    const repairProposal = record(repairPreview.proposal);
    expect(repairProposal).toMatchObject({
      state: "previewed",
      summary: { operationCount: 4, addedNodes: 1, addedEdges: 2, removedNodes: 0, removedEdges: 1 }
    });
    const repairApplied = await call(fixture, "ether.graph.transaction.apply", {
      proposalId: repairProposal.proposalId,
      baseDocumentRevisionId: repairDocumentRevisionId,
      editPermitId: "host-edit-approved"
    });
    expect(repairApplied).toMatchObject({ state: "applied" });

    expect(fixture.executed).toEqual(["graph.applyTransaction", "graph.applyTransaction"]);
    expect(fixture.executed.some((name) => name.startsWith("run."))).toBe(false);
    const repairedInspection = await call(fixture, "ether.graph.inspect", { graphId: targetGraphId });
    const repairedGraph = EtherGraphSchema.parse(repairedInspection.graph);
    const repairedValidation = await call(fixture, "ether.graph.validate", { graphId: targetGraphId });
    const repairedDoctor = await call(fixture, "ether.project.doctor");
    expect(repairedValidation).toEqual({ valid: true, issues: [] });
    expect(repairedDoctor).toMatchObject({ validation: { valid: true, issues: [] }, doctor: { state: "inspected", mutationPerformed: false } });
    expect(repairedGraph.nodes.map((node) => node.definitionId)).toEqual(expect.arrayContaining([
      "prompt.text", "prompt.worker", "reference.set", "generation.image", "review.compare", "review.evaluate", "output.collection", "output.export"
    ]));
    expect(repairedGraph.edges.some((edge) => edge.id === reviewCollectionEdgeId)).toBe(false);
    expect(repairedGraph.edges.filter((edge) => [reviewNodeId, collectionNodeId].includes(edge.from.kind === "node" ? edge.from.nodeId : "") || [reviewNodeId, collectionNodeId].includes(edge.to.kind === "node" ? edge.to.nodeId : ""))).toHaveLength(4);
  });

  it("repairs a locked module by explicitly unlocking before it is dissolved", async () => {
    const fixture = await createFixture();
    const document = await call(fixture, "ether.document.inspect");
    const graphCatalog = await call(fixture, "ether.graph.catalog");
    const targetGraphId = requiredString(record(array(graphCatalog.graphs)[0]).id);
    const graph = await call(fixture, "ether.graph.inspect", { graphId: targetGraphId });
    expect(requiredString(record(graph.graph).id)).toBe(targetGraphId);
    const baseDocumentRevisionId = requiredString(record(document.dirtyState).documentRevisionId);
    const baseGraphRevisionId = requiredString(graph.graphRevisionId);
    const moduleGraphId = "locked-module-graph";
    const module = lockedModule("locked-module", moduleGraphId);
    const moduleGraph = moduleChildGraph(moduleGraphId);
    const create = GraphTransactionSchema.parse({
      id: "plugin-create-locked-module",
      baseDocumentRevisionId,
      baseGraphRevisions: { [targetGraphId]: baseGraphRevisionId },
      title: "Create locked module",
      actor: "codex",
      layoutPolicy: "preserve",
      operations: [{ type: "createModule", graphId: targetGraphId, module, subtree: { rootGraphId: moduleGraphId, graphs: [moduleGraph] } }]
    });
    const createPreview = await call(fixture, "ether.graph.transaction.preview", { transaction: create });
    fixture.acceptEditPermit("host-edit-approved");
    const created = await call(fixture, "ether.graph.transaction.apply", {
      proposalId: requiredString(record(createPreview.proposal).proposalId),
      baseDocumentRevisionId,
      editPermitId: "host-edit-approved"
    });
    await expect(call(fixture, "ether.graph.inspect", { graphId: targetGraphId })).resolves.toMatchObject({
      graph: { modules: [expect.objectContaining({ id: module.id, locked: true })] }
    });

    const createdResult = record(created.result);
    const createdRevision = requiredString(createdResult.documentRevisionId);
    const createdGraphRevisions = record(createdResult.graphRevisions);
    const movedWhileLocked = await callResult(fixture, "ether.graph.transaction.preview", {
      transaction: {
        id: "plugin-move-locked-module",
        baseDocumentRevisionId: createdRevision,
        baseGraphRevisions: { [targetGraphId]: requiredString(createdGraphRevisions[targetGraphId]) },
        title: "Move locked module",
        actor: "codex",
        layoutPolicy: "preserve",
        operations: [{ type: "updateModule", graphId: targetGraphId, moduleId: module.id, module: { ...module, position: { x: 440, y: 120 } } }]
      }
    });
    expect(movedWhileLocked).toMatchObject({ isError: true, structuredContent: { error: { code: "MODULE_LOCKED" } } });

    const unlock = GraphTransactionSchema.parse({
      id: "plugin-unlock-module-repair",
      baseDocumentRevisionId: createdRevision,
      baseGraphRevisions: { [targetGraphId]: requiredString(createdGraphRevisions[targetGraphId]) },
      title: "Unlock module for repair",
      actor: "codex",
      layoutPolicy: "preserve",
      operations: [{ type: "updateModule", graphId: targetGraphId, moduleId: module.id, module: { ...module, locked: false } }]
    });
    const unlockPreview = await call(fixture, "ether.graph.transaction.preview", { transaction: unlock });
    const unlocked = await call(fixture, "ether.graph.transaction.apply", {
      proposalId: requiredString(record(unlockPreview.proposal).proposalId),
      baseDocumentRevisionId: createdRevision,
      editPermitId: "host-edit-approved"
    });

    const unlockedResult = record(unlocked.result);
    const dissolve = GraphTransactionSchema.parse({
      id: "plugin-dissolve-module-repair",
      baseDocumentRevisionId: requiredString(unlockedResult.documentRevisionId),
      baseGraphRevisions: {
        [targetGraphId]: requiredString(record(unlockedResult.graphRevisions)[targetGraphId]),
        [moduleGraphId]: "module-graph-revision-before-dissolve"
      },
      title: "Dissolve repaired module",
      actor: "codex",
      layoutPolicy: "preserve",
      operations: [{ type: "removeModule", graphId: targetGraphId, moduleId: module.id }]
    });
    const dissolvePreview = await call(fixture, "ether.graph.transaction.preview", { transaction: dissolve });
    await expect(call(fixture, "ether.graph.transaction.apply", {
      proposalId: requiredString(record(dissolvePreview.proposal).proposalId),
      baseDocumentRevisionId: dissolve.baseDocumentRevisionId,
      editPermitId: "host-edit-approved"
    })).resolves.toMatchObject({ state: "applied" });
    await expect(call(fixture, "ether.graph.inspect", { graphId: targetGraphId })).resolves.toMatchObject({
      graph: { modules: [] }
    });
    expect(fixture.executed).toEqual(["graph.applyTransaction", "graph.applyTransaction", "graph.applyTransaction"]);
  });
});

function contractViolations(content: string): string[] {
  const violations: string[] = [];
  if (/permission\.grant(?:Edit|Run)/i.test(content)) violations.push("permission grant");
  if (/`(?:document|graph|recipe|reference|artifact|collection|provider|permission|project|recovery|node|run)\.[^`]+`/i.test(content)) violations.push("shorthand tool");
  for (const token of content.match(/\$[A-Za-z][A-Za-z0-9:._<>|/-]*/g) ?? []) {
    if (token.startsWith("$ether-")) continue;
    if (/^\$temp:(graph|node|edge|group|module):[A-Za-z0-9][A-Za-z0-9._-]*$/.test(token)) continue;
    if (/^\$temp:(?:<kind>|<graph\|node\|edge\|group\|module>|graph|node|edge|group|module):<name>$/.test(token)) continue;
    violations.push(`invalid reference ${token}`);
  }
  return violations;
}

async function createFixture(): Promise<Fixture> {
  const executed: string[] = [];
  const nonce = randomUUID().slice(0, 8);
  const documentId = `portable-document-${nonce}`;
  const graphId = `portable-graph-${nonce}`;
  const pathGrantId = `host-path-grant-${nonce}`;
  const references = ["product", "style", "composition"].map((role, index) => ({
    id: `selected-${role}-${nonce}`,
    displayName: `${role}.png`,
    mediaType: "image/png",
    state: "linked" as const,
    originalPath: `C:\\approved\\${role}-${nonce}.png`,
    pathGrantId: `reference-path-grant-${role}-${nonce}`,
    contentKey: null,
    previewContentKey: null,
    identity: null,
    fingerprint: { byteLength: 2048 + index, modifiedAt: index + 1, sampleSha256: String(index + 1).repeat(64) },
    createdAt: timestamp,
    updatedAt: timestamp
  }));
  let documentRevisionId = `document-revision-${nonce}-41`;
  let graphRevisionId = `graph-revision-${nonce}-17`;
  let graphs = [emptyGraph(graphId)];
  const editPermits = new Set<string>();
  const resolvePreview = (transaction: GraphTransaction) => previewGraphTransaction({
    graphs,
    transaction,
    idFactory: ({ kind, name }) => `${kind}-${name}-resolved`
  });
  const application: EtherMcpApplicationAdapter = {
    activeDocument: async () => ({ documentId }),
    applyGraphTransaction: async ({ editPermitId, transaction }) => {
      if (!editPermits.has(editPermitId)) throw new EtherMcpError("PERMIT_REVOKED", "security", "The Edit Permit is unavailable.");
      executed.push("graph.applyTransaction");
      graphs = resolvePreview(transaction).graphs;
      documentRevisionId = nextRevision(documentRevisionId);
      graphRevisionId = nextRevision(graphRevisionId);
      return { documentRevisionId, graphRevisions: { [graphId]: graphRevisionId } };
    },
    cancelRun: async () => {
      executed.push("run.cancel");
      return { accepted: true };
    },
    inspectPermits: async () => [
      { id: pathGrantId, permission: "path" as const, expiresAt: null, state: "active" as const },
      ...[...editPermits].map((id) => ({ id, permission: "edit" as const, expiresAt: null, state: "active" as const }))
    ],
    instantiateRecipe: async () => ({ accepted: true }),
    previewGraphTransaction: async (transaction) => {
      const preview = resolvePreview(transaction);
      return {
        documentId,
        transaction,
        tempIds: preview.tempIds,
        summary: {
          operationCount: preview.forwardOperations.length,
          affectedGraphIds: [...new Set(preview.forwardOperations.map((operation) => operation.graphId))],
          addedNodes: preview.forwardOperations.filter((operation) => operation.type === "addNode").length,
          addedEdges: preview.forwardOperations.filter((operation) => operation.type === "addEdge").length,
          removedNodes: preview.forwardOperations.filter((operation) => operation.type === "removeNode").length,
          removedEdges: preview.forwardOperations.filter((operation) => operation.type === "removeEdge").length
        },
        warnings: []
      };
    },
    query: async (request) => response(request, queryPayload(
      request.name,
      graphs,
      documentId,
      documentRevisionId,
      graphRevisionId,
      references
    )) as ApplicationQueryResponse,
    execute: async (request) => {
      executed.push(request.name);
      return response(request, { accepted: true }) as ApplicationCommandResponse;
    },
    retryRun: async () => {
      executed.push("run.retry");
      return { accepted: true };
    }
  };
  const server = createEtherMcpServer({ application });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "plugin-4.0-test", version: "4.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const fixture: Fixture = {
    client,
    server,
    executed,
    acceptEditPermit(id: string) { editPermits.add(id); },
    async close() { await client.close(); await server.close().catch(() => undefined); }
  };
  fixtures.push(fixture);
  return fixture;
}

function emptyGraph(graphId: string): EtherGraph {
  return { id: graphId, title: "Portable target", kind: "root", createdAt: timestamp, updatedAt: timestamp, nodes: [], edges: [], groups: [], modules: [], viewState };
}

function queryPayload(
  name: ApplicationQuery["name"],
  graphs: readonly EtherGraph[],
  documentId: string,
  documentRevisionId: string,
  graphRevisionId: string,
  references: readonly Record<string, unknown>[]
): Record<string, unknown> {
  const graph = graphs.find((candidate) => candidate.kind === "root")!;
  if (name === "document.summary") return {
    header: {
      documentId,
      formatMarker: "ETHERDOC",
      formatVersion: "4.0.0",
      schemaVersion: 40000,
      title: "Portable plugin fixture",
      createdAt: timestamp,
      updatedAt: timestamp,
      appVersion: "4.0.0",
      featureFlags: {}
    },
    mode: "writable",
    graphCount: graphs.length,
    artifactCount: 0
  };
  if (name === "document.dirtyState") return { dirty: false, documentRevisionId };
  if (name === "graph.catalog") return { graphs: graphs.map((candidate) => ({ id: candidate.id, title: candidate.title, kind: candidate.kind })) };
  if (name === "graph.snapshot") return { graph, documentRevisionId, graphRevisionId };
  if (name === "graph.validation") return { valid: validateFullGraphState(graphs).length === 0, issues: validateFullGraphState(graphs) };
  if (name === "reference.list") return { references };
  if (name === "recovery.status") return { state: "healthy", reportId: null, message: null };
  if (name === "storage.status") return { documentBytes: 4096, blobBytes: 0, reclaimableBytes: 0 };
  if (name === "provider.health") return { providers: [{ providerId: "fake", status: "available", message: null, checkedAt: timestamp }] };
  return {};
}

function response(request: ApplicationQuery | ApplicationCommand, payload: Record<string, unknown>) {
  return {
    kind: "response", id: `response-${request.id}`, correlationId: request.correlationId,
    requestId: request.id, name: request.name,
    ...("documentId" in request ? { documentId: request.documentId } : {}), payload
  } as unknown as ApplicationQueryResponse | ApplicationCommandResponse | ApplicationErrorMessage;
}

async function call(fixture: Fixture, name: string, args: Record<string, unknown> = {}) {
  const result = await callResult(fixture, name, args);
  if (result.isError === true) throw new Error(JSON.stringify(result.structuredContent));
  return record(result.structuredContent);
}

async function callResult(fixture: Fixture, name: string, args: Record<string, unknown>) {
  const result = await fixture.client.callTool({ name, arguments: args });
  if (!("content" in result)) throw new TypeError("Unexpected MCP result");
  return result;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Expected object");
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("Expected array");
  return value;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError("Expected string");
  return value;
}

function hydrateTemplate(value: unknown, replacements: Record<string, string>): unknown {
  if (typeof value === "string") {
    const match = /^\{\{([A-Za-z][A-Za-z0-9]*)\}\}$/.exec(value);
    if (match === null) return value;
    const replacement = replacements[match[1]];
    if (replacement === undefined) throw new Error(`Missing template replacement ${match[1]}`);
    return replacement;
  }
  if (Array.isArray(value)) return value.map((item) => hydrateTemplate(item, replacements));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      requiredString(hydrateTemplate(key, replacements)),
      hydrateTemplate(item, replacements)
    ]));
  }
  return value;
}

function nextRevision(value: string): string {
  const match = /^(.*-)(\d+)$/.exec(value);
  return match === null ? `${value}-next` : `${match[1]}${Number(match[2]) + 1}`;
}

function lockedModule(id: string, graphId: string) {
  return {
    id,
    title: "Locked module",
    description: "A protected module created by the plugin.",
    accent: "#37e6ea",
    locked: true,
    graphId,
    position: { x: 320, y: 80 },
    size: { width: 260, height: 180 },
    interface: { inputs: [], outputs: [], parameters: [] },
    collapsed: false
  };
}

function moduleChildGraph(id: string): EtherGraph {
  return {
    ...emptyGraph(id),
    kind: "module",
    title: "Locked module interior",
    nodes: [{
      id: "locked-module-note",
      definitionId: "canvas.note",
      title: "Repair note",
      position: { x: 40, y: 40 },
      size: { width: 220, height: 140 },
      config: { kind: "canvas.note", body: "Unlock before structural repair.", style: "note" },
      presentation: { collapsed: false, accent: "default", previewMode: "content" }
    }]
  };
}

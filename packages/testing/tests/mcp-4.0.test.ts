import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FakeImageProvider } from "@ether/providers";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ApplicationCommand,
  ApplicationCommandResponse,
  ApplicationErrorMessage,
  ApplicationQuery,
  ApplicationQueryResponse,
  EtherEdge,
  EtherGraph,
  GraphTransaction
} from "@ether/schema";
import { GraphTransactionSchema } from "@ether/schema";

import { DesktopApplicationService, type NativeDialogPort } from "../../../apps/desktop/src/main/services/applicationService";
import { createDesktopMcpBridgeHost } from "../../../apps/desktop/src/main/services/mcpApplicationBridge";
import { previewGraphTransaction } from "../../graph-kernel/src/index.js";
import { nodeDefinitions } from "../../graph-kernel/src/registry.js";
import {
  createEtherMcpServer,
  startEtherMcpApplicationBridge,
  type EtherMcpApplicationAdapter,
  type EtherMcpServer,
  type PermitInspection
} from "../../mcp-server/src/index.js";

const timestamp = "2026-07-23T12:00:00.000Z";
const planHash = `sha256:v1:${"a".repeat(64)}`;
const presentation = { collapsed: false, accent: "default", previewMode: "summary" as const };
const viewState = { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null };
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

type ApplyGate = { entered: Promise<void>; release(): void };
type Fixture = {
  client: Client;
  server: EtherMcpServer;
  applied: GraphTransaction[];
  controlCommandIds: { cancel: string[]; retry: string[] };
  close(): Promise<void>;
  corruptNextCancel(): void;
  grantEdit(id?: string): string;
  grantRun(id?: string): string;
  holdApply(): ApplyGate;
  setActiveDocument(documentId: string): void;
};

const fixtures: Fixture[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Ether 4.0 official MCP SDK integration", () => {
  it("returns the serializable application node catalog for every canonical node", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-mcp-node-catalog-"));
    roots.push(root);
    const documentPath = path.join(root, "node-catalog.ether");
    const descriptorPath = path.join(root, "mcp-session.json");
    const service = new DesktopApplicationService({
      appDataRoot: path.join(root, "app-data"),
      appVersion: "4.0.0-test",
      dialogs: dialogs({ saveDocument: async () => documentPath }),
      provider: new FakeImageProvider(),
      simulationMode: true,
      dispatchMode: "manual"
    });
    const initial = await service.bootstrap();
    await service.saveAs(initial.documentId);
    const bridge = await startEtherMcpApplicationBridge(createDesktopMcpBridgeHost(service), { descriptorPath });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(workspaceRoot, "packages/mcp-server/dist/index.js")],
      cwd: workspaceRoot,
      env: { ...getDefaultEnvironment(), ETHER_MCP_SESSION_DESCRIPTOR: descriptorPath },
      stderr: "pipe"
    });
    const client = new Client({ name: "ether-node-catalog-test", version: "4.0.0" });
    try {
      await client.connect(transport);
      const catalog = await call(client, "ether.node.catalog");
      const nodes = catalog.nodes;
      if (!Array.isArray(nodes)) throw new TypeError("Expected node catalog entries.");
      expect(nodes.map((node) => requiredString(record(node).definitionId))).toEqual(nodeDefinitions.map((definition) => definition.id));
      expect(nodes.every((node) => {
        const entry = record(node);
        return !("library" in entry) && !("mcp" in entry) && !("recipe" in entry) && !("configSchema" in entry);
      })).toBe(true);
    } finally {
      await client.close().catch(() => undefined);
      await bridge.close().catch(() => undefined);
      await service.close().catch(() => undefined);
    }
  }, 30_000);

  it("advertises only the typed active-document surface and structures malformed input", async () => {
    const fixture = await createFixture();
    const tools = await fixture.client.listTools();
    const names = tools.tools.map((tool) => tool.name);

    expect(names).toEqual([
      "ether.document.inspect", "ether.document.health", "ether.project.doctor", "ether.recovery.inspect", "ether.permission.inspect",
      "ether.node.catalog", "ether.graph.catalog", "ether.graph.inspect", "ether.graph.validate",
      "ether.graph.transaction.preview", "ether.graph.transaction.apply", "ether.graph.transaction.reject",
      "ether.provider.inspect", "ether.recipe.list", "ether.recipe.setup", "ether.recipe.preview", "ether.recipe.instantiate",
      "ether.reference.list", "ether.reference.inspect", "ether.artifact.search", "ether.artifact.inspect", "ether.artifact.lineage", "ether.collection.list",
      "ether.run.list", "ether.run.inspect", "ether.run.plan.inspect", "ether.run.plan.preview", "ether.run.start", "ether.run.cancel", "ether.run.retry"
    ]);
    expect(names).not.toEqual(expect.arrayContaining(["ether.document.open", "ether.permission.grant", "ether.graph.replace"]));
    expect(tools.tools.every((tool) => {
      const schema = tool.outputSchema as {
        type?: unknown;
        properties?: Record<string, unknown>;
        anyOf?: Array<{ type?: unknown; properties?: Record<string, unknown> }>;
      } | undefined;
      const variants = schema?.anyOf ?? (schema === undefined ? [] : [schema]);
      return variants.some((variant) => (
        variant.type === "object" &&
        variant.properties !== undefined &&
        Object.keys(variant.properties).some((property) => property !== "error")
      ));
    })).toBe(true);
    expect(tools.tools.find((tool) => tool.name === "ether.run.plan.preview")?.annotations).toMatchObject({ readOnlyHint: false });

    const malformed = await callResult(fixture.client, "ether.graph.transaction.preview", {});
    expect(malformed).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "INVALID_MCP_INPUT", category: "validation" } }
    });
  });

  it("binds canonical proposals to one document and reserves a proposal during apply", async () => {
    const fixture = await createFixture();
    const editPermitId = fixture.grantEdit();
    const transaction = temporaryTransaction("doc-revision-1", "graph-revision-1");
    const impersonation = await callResult(fixture.client, "ether.graph.transaction.preview", {
      transaction: { ...transaction, actor: "user" }
    });
    expect(impersonation).toMatchObject({ isError: true, structuredContent: { error: { code: "MCP_TRANSACTION_ACTOR_INVALID" } } });

    const switchedPreview = await call(fixture.client, "ether.graph.transaction.preview", { transaction });
    fixture.setActiveDocument("document-2");
    const switched = await callResult(fixture.client, "ether.graph.transaction.apply", {
      proposalId: record(switchedPreview.proposal).proposalId,
      baseDocumentRevisionId: "doc-revision-1",
      editPermitId
    });
    expect(switched).toMatchObject({ isError: true, structuredContent: { error: { code: "DOCUMENT_SCOPE_REJECTED" } } });

    fixture.setActiveDocument("document-1");
    const preview = await call(fixture.client, "ether.graph.transaction.preview", {
      transaction: { ...transaction, id: "transaction-canonical" }
    });
    const proposal = record(preview.proposal);
    expect(proposal.tempIds).toMatchObject({
      "$temp:node:brief": "node-brief-resolved",
      "$temp:node:generator": "node-generator-resolved",
      "$temp:edge:brief-generator": "edge-brief-generator-resolved"
    });

    const gate = fixture.holdApply();
    const first = callResult(fixture.client, "ether.graph.transaction.apply", {
      proposalId: proposal.proposalId,
      baseDocumentRevisionId: "doc-revision-1",
      editPermitId
    });
    await gate.entered;
    const duplicate = await callResult(fixture.client, "ether.graph.transaction.apply", {
      proposalId: proposal.proposalId,
      baseDocumentRevisionId: "doc-revision-1",
      editPermitId
    });
    expect(duplicate).toMatchObject({ isError: true, structuredContent: { error: { code: "TRANSACTION_PROPOSAL_CLOSED" } } });
    gate.release();
    await expect(first).resolves.toMatchObject({ structuredContent: { state: "applied" } });
    expect(fixture.applied).toHaveLength(1);
    expect(JSON.stringify(fixture.applied[0])).not.toContain("$temp:");
  });

  it("returns a rebaseable BASE_REVISION_CONFLICT and lets the rebased proposal apply", async () => {
    const fixture = await createFixture();
    const editPermitId = fixture.grantEdit();
    const transaction = temporaryTransaction("doc-revision-1", "graph-revision-1");
    const preview = await call(fixture.client, "ether.graph.transaction.preview", { transaction });
    const proposalId = requiredString(record(preview.proposal).proposalId);

    const conflict = await callResult(fixture.client, "ether.graph.transaction.apply", {
      proposalId,
      baseDocumentRevisionId: "doc-revision-stale",
      editPermitId
    });
    expect(conflict).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "BASE_REVISION_CONFLICT",
          category: "graph",
          userAction: "Inspect the current graph revisions, rebase the transaction, and preview it again.",
          details: {
            proposalId,
            namedBaseRevision: "doc-revision-stale",
            expectedBaseRevision: "doc-revision-1",
            currentBaseRevision: "doc-revision-1",
            rebaseable: true
          }
        }
      }
    });

    await expect(call(fixture.client, "ether.graph.transaction.apply", {
      proposalId,
      baseDocumentRevisionId: "doc-revision-1",
      editPermitId
    })).resolves.toMatchObject({ state: "applied" });
  });

  it("creates every registry definition in one MCP transaction without provider execution", async () => {
    const fixture = await createFixture();
    const editPermitId = fixture.grantEdit();

    const transaction = registryTransaction("doc-revision-1", "graph-revision-1");
    const preview = await call(fixture.client, "ether.graph.transaction.preview", { transaction });
    const proposal = record(preview.proposal);
    expect(record(proposal.tempIds)).toHaveProperty("$temp:node:registry-16", "node-registry-16-resolved");
    expect(proposal).toMatchObject({
      summary: { operationCount: nodeDefinitions.length, addedNodes: nodeDefinitions.length, addedEdges: 0 }
    });

    await expect(call(fixture.client, "ether.graph.transaction.apply", {
      proposalId: requiredString(proposal.proposalId),
      baseDocumentRevisionId: transaction.baseDocumentRevisionId,
      editPermitId
    })).resolves.toMatchObject({ state: "applied" });
    expect(fixture.applied).toHaveLength(1);
    expect(fixture.applied[0]?.operations.map((operation) => operation.type === "addNode" ? operation.node.definitionId : null)).toEqual(nodeDefinitions.map((definition) => definition.id));
    expect(fixture.applied[0]?.operations.every((operation) => operation.type === "addNode" && operation.node.config.kind === operation.node.definitionId)).toBe(true);
  });

  it("keeps permits host-owned, consumes Run Permit once for start, and allows control of its own job", async () => {
    const fixture = await createFixture();
    const editPermitId = fixture.grantEdit("edit-approved");
    const runPermitId = fixture.grantRun("run-approved");
    const inspection = await call(fixture.client, "ether.permission.inspect");
    expect(inspection.permits).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: editPermitId, permission: "edit", state: "active" }),
      expect.objectContaining({ id: runPermitId, permission: "run", planId: "plan-1", contentHash: planHash, state: "active" })
    ]));

    await expect(call(fixture.client, "ether.run.start", {
      planId: "plan-1", contentHash: planHash, runPermitId
    })).resolves.toMatchObject({ job: { id: "job-1", planId: "plan-1" } });
    const reuse = await callResult(fixture.client, "ether.run.start", {
      planId: "plan-1", contentHash: planHash, runPermitId
    });
    expect(reuse).toMatchObject({ isError: true, structuredContent: { error: { code: "RUN_PERMIT_INVALID" } } });
    await expect(call(fixture.client, "ether.run.cancel", { jobId: "job-1", runPermitId })).resolves.toMatchObject({
      job: { id: "job-1", status: "cancelled" }
    });
    await expect(call(fixture.client, "ether.run.retry", { jobId: "job-1", workItemIds: ["work-1"], runPermitId })).resolves.toMatchObject({
      job: { id: "job-1", status: "queued" }
    });
    await expect(call(fixture.client, "ether.run.cancel", { jobId: "job-1", runPermitId })).resolves.toMatchObject({
      job: { id: "job-1", status: "cancelled" }
    });
    await expect(call(fixture.client, "ether.run.retry", { jobId: "job-1", workItemIds: ["work-1"], runPermitId })).resolves.toMatchObject({
      job: { id: "job-1", status: "queued" }
    });
    expect(new Set(fixture.controlCommandIds.cancel).size).toBe(2);
    expect(new Set(fixture.controlCommandIds.retry).size).toBe(2);

    fixture.corruptNextCancel();
    const invalidOutput = await callResult(fixture.client, "ether.run.cancel", { jobId: "job-1", runPermitId });
    expect(invalidOutput).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "INVALID_MCP_OUTPUT", category: "validation" } }
    });
    await expect(call(fixture.client, "ether.permission.inspect")).resolves.toMatchObject({
      permits: expect.arrayContaining([expect.objectContaining({ id: runPermitId, state: "start-consumed" })])
    });
  });

  it("launches stdio through a live desktop bridge and edits an ephemeral .ether document", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-mcp-live-"));
    roots.push(root);
    const documentPath = path.join(root, "live-session.ether");
    const descriptorPath = path.join(root, "mcp-session.json");
    const service = new DesktopApplicationService({
      appDataRoot: path.join(root, "app-data"),
      appVersion: "4.0.0-test",
      dialogs: dialogs({ saveDocument: async () => documentPath }),
      provider: new FakeImageProvider(),
      simulationMode: true,
      dispatchMode: "manual"
    });
    const initial = await service.bootstrap();
    const saved = await service.saveAs(initial.documentId);
    const bridge = await startEtherMcpApplicationBridge(createDesktopMcpBridgeHost(service), { descriptorPath });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(workspaceRoot, "packages/mcp-server/dist/index.js")],
      cwd: workspaceRoot,
      env: { ...getDefaultEnvironment(), ETHER_MCP_SESSION_DESCRIPTOR: descriptorPath },
      stderr: "pipe"
    });
    const client = new Client({ name: "ether-live-desktop-test", version: "4.0.0" });
    try {
      await client.connect(transport);
      await expect(call(client, "ether.document.inspect")).resolves.toMatchObject({ documentId: saved.documentId });
      const graphSnapshot = await call(client, "ether.graph.inspect", { graphId: "graph-root" });
      const transaction = temporaryTransaction(
        String(graphSnapshot.documentRevisionId),
        String(graphSnapshot.graphRevisionId)
      );
      const preview = await call(client, "ether.graph.transaction.preview", { transaction });
      const permit = await service.grantMcpEditPermit(saved.documentId);
      await expect(call(client, "ether.permission.inspect")).resolves.toMatchObject({
        permits: expect.arrayContaining([expect.objectContaining({ id: permit.id, permission: "edit", state: "active" })])
      });
      await expect(call(client, "ether.graph.transaction.apply", {
        proposalId: record(preview.proposal).proposalId,
        baseDocumentRevisionId: transaction.baseDocumentRevisionId,
        editPermitId: permit.id
      })).resolves.toMatchObject({ state: "applied" });
      const edited = await call(client, "ether.graph.inspect", { graphId: "graph-root" });
      const resolvedIds = record(record(preview.proposal).tempIds);
      expect(record(edited.graph).nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: resolvedIds["$temp:node:brief"] }),
        expect.objectContaining({ id: resolvedIds["$temp:node:generator"] })
      ]));

      const planPreview = await call(client, "ether.run.plan.preview", { graphId: "graph-root", scope: { kind: "graph" } });
      const plan = record(planPreview.plan);
      expect(service.latestMcpRunPlan(saved.documentId)).toMatchObject({ id: plan.id, contentHash: plan.contentHash });
      const runPermit = await service.approveLatestMcpRunPlan(saved.documentId);
      await expect(call(client, "ether.permission.inspect")).resolves.toMatchObject({
        permits: expect.arrayContaining([expect.objectContaining({
          id: runPermit.id, permission: "run", planId: plan.id, contentHash: plan.contentHash, state: "active"
        })])
      });
      const started = await call(client, "ether.run.start", {
        planId: plan.id,
        contentHash: plan.contentHash,
        runPermitId: runPermit.id
      });
      const jobId = String(record(started.job).id);
      const reused = await callResult(client, "ether.run.start", {
        planId: plan.id,
        contentHash: plan.contentHash,
        runPermitId: runPermit.id
      });
      expect(reused).toMatchObject({ isError: true, structuredContent: { error: { code: "RUN_PERMIT_INVALID" } } });
      await expect(call(client, "ether.run.cancel", { jobId, runPermitId: runPermit.id })).resolves.toMatchObject({
        job: expect.objectContaining({ id: jobId, status: "cancelled" })
      });
    } finally {
      await client.close().catch(() => undefined);
      await bridge.close().catch(() => undefined);
      await service.close().catch(() => undefined);
    }
  }, 30_000);
});

async function createFixture(): Promise<Fixture> {
  let documentId = "document-1";
  let documentRevisionId = "doc-revision-1";
  let applyGate: { entered(): void; wait: Promise<void> } | null = null;
  const permits = new Map<string, PermitInspection>();
  const applied: GraphTransaction[] = [];
  const controlCommandIds = { cancel: [] as string[], retry: [] as string[] };
  let corruptNextCancel = false;
  const rootGraph = graph("graph-root");
  const application: EtherMcpApplicationAdapter = {
    activeDocument: async () => ({ documentId }),
    inspectPermits: async () => [...permits.values()],
    previewGraphTransaction: async (transaction) => {
      const preview = previewGraphTransaction({
        graphs: [rootGraph],
        transaction,
        idFactory: ({ kind, name }) => `${kind}-${name}-resolved`
      });
      return {
        documentId,
        transaction: { ...transaction, operations: preview.forwardOperations },
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
    applyGraphTransaction: async (input) => {
      requirePermit(permits, input.editPermitId, "edit");
      if (input.documentId !== documentId) throw coded("DOCUMENT_SCOPE_REJECTED", "The active document changed.");
      const gate = applyGate;
      if (gate !== null) {
        gate.entered();
        await gate.wait;
        applyGate = null;
      }
      applied.push(input.transaction);
      documentRevisionId = "doc-revision-2";
      return { documentRevisionId, graphRevisions: { "graph-root": "graph-revision-2" } };
    },
    instantiateRecipe: async (input) => {
      requirePermit(permits, input.editPermitId, "edit");
      return { revision: { documentRevisionId: "doc-revision-2", graphRevisions: { "graph-root": "graph-revision-2" } } };
    },
    query: async (request) => response(request, queryPayload(request.name, documentRevisionId)) as unknown as ApplicationQueryResponse | ApplicationErrorMessage,
    execute: async (request) => {
      if (request.name === "run.start") {
        const payload = request.payload as { planId: string; contentHash: string; runPermitId: string };
        const permit = requirePermit(permits, payload.runPermitId, "run");
        if (permit.planId !== payload.planId || permit.contentHash !== payload.contentHash) {
          throw coded("RUN_PERMIT_MISMATCH", "The run permit does not match this exact plan.");
        }
        if (permit.state !== "active") throw coded("RUN_PERMIT_INVALID", "The run permit has already been consumed.");
        permits.set(permit.id, { ...permit, state: "start-consumed" });
      }
      return response(request, commandPayload(request.name)) as unknown as ApplicationCommandResponse | ApplicationErrorMessage;
    },
    cancelRun: async (input) => {
      requireRunControl(permits, input.runPermitId, input.planId, input.contentHash);
      controlCommandIds.cancel.push(input.commandId);
      if (corruptNextCancel) {
        corruptNextCancel = false;
        return { accepted: true };
      }
      return { job: executionJob("cancelled") };
    },
    retryRun: async (input) => {
      requireRunControl(permits, input.runPermitId, input.planId, input.contentHash);
      controlCommandIds.retry.push(input.commandId);
      return { job: executionJob("queued") };
    }
  };
  const server = createEtherMcpServer({ application });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "ether-mcp-test", version: "4.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const fixture: Fixture = {
    client,
    server,
    applied,
    controlCommandIds,
    corruptNextCancel() { corruptNextCancel = true; },
    grantEdit(id = "edit-approved") {
      permits.set(id, { id, permission: "edit", expiresAt: null, state: "active" });
      return id;
    },
    grantRun(id = "run-approved") {
      permits.set(id, { id, permission: "run", expiresAt: null, state: "active", planId: "plan-1", contentHash: planHash });
      return id;
    },
    holdApply() {
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => { enter = resolve; });
      const wait = new Promise<void>((resolve) => { release = resolve; });
      applyGate = { entered: enter, wait };
      return { entered, release };
    },
    setActiveDocument(value) { documentId = value; },
    async close() { await client.close(); await server.close().catch(() => undefined); }
  };
  fixtures.push(fixture);
  return fixture;
}

function queryPayload(name: ApplicationQuery["name"], revision: string): Record<string, unknown> {
  if (name === "document.dirtyState") return { dirty: false, documentRevisionId: revision };
  if (name === "plan.summary") return { plan: executionPlan() };
  if (name === "job.summary") return { job: executionJob() };
  throw coded("UNEXPECTED_QUERY", `Unexpected fixture query ${name}.`);
}

function commandPayload(name: ApplicationCommand["name"]): Record<string, unknown> {
  if (name === "run.preview") return { plan: executionPlan() };
  if (name === "run.start") return { job: executionJob() };
  throw coded("UNEXPECTED_COMMAND", `Unexpected fixture command ${name}.`);
}

function response(request: ApplicationQuery | ApplicationCommand, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: "response",
    id: `response-${request.id}`,
    correlationId: request.correlationId,
    requestId: request.id,
    name: request.name,
    ...("documentId" in request ? { documentId: request.documentId } : {}),
    payload
  };
}

function executionPlan(): Record<string, unknown> {
  return {
    id: "plan-1", capsuleVersion: 1, hashVersion: "sha256-v1", documentId: "document-1",
    documentRevisionId: "doc-revision-1", graphId: "graph-root", graphRevisionId: "graph-revision-1",
    scope: { kind: "graph" }, status: "previewed", steps: [], workItems: [], providerCapabilitySnapshots: [],
    estimatedCalls: 0, warnings: [], contentHash: planHash, createdAt: timestamp
  };
}

function executionJob(status = "failed"): Record<string, unknown> {
  const queued = status === "queued";
  return {
    id: "job-1", planId: "plan-1", planContentHash: planHash, status,
    createdAt: timestamp, startedAt: queued ? null : timestamp,
    completedAt: queued ? null : timestamp,
    cancellationRequestedAt: status === "cancelled" ? timestamp : null
  };
}

function temporaryTransaction(documentRevisionId: string, graphRevisionId: string): GraphTransaction {
  return {
    id: "transaction-temp-refs",
    baseDocumentRevisionId: documentRevisionId,
    baseGraphRevisions: { "graph-root": graphRevisionId },
    title: "Build an inspectable image chain",
    actor: "codex",
    layoutPolicy: "preserve",
    operations: [
      { type: "addNode", graphId: "graph-root", node: promptNode("$temp:node:brief") },
      { type: "addNode", graphId: "graph-root", node: generatorNode("$temp:node:generator") },
      { type: "addEdge", graphId: "graph-root", edge: edge("$temp:edge:brief-generator", "$temp:node:brief", "$temp:node:generator") }
    ]
  };
}

function registryTransaction(documentRevisionId: string, graphRevisionId: string): GraphTransaction {
  return GraphTransactionSchema.parse({
    id: "transaction-registry-all-nodes",
    baseDocumentRevisionId: documentRevisionId,
    baseGraphRevisions: { "graph-root": graphRevisionId },
    title: "Create every canonical node from the registry",
    actor: "codex",
    layoutPolicy: "preserve",
    operations: nodeDefinitions.map((definition, index) => ({
      type: "addNode" as const,
      graphId: "graph-root",
      node: {
        id: `$temp:node:registry-${index}`,
        definitionId: definition.id,
        title: definition.title,
        position: { x: (index % 4) * 280, y: Math.floor(index / 4) * 190 },
        size: { width: definition.presentation.width, height: definition.presentation.height },
        config: definition.defaultConfig(),
        presentation: { collapsed: false, accent: "default", previewMode: definition.presentation.previewMode }
      }
    }))
  });
}

function graph(id: string): EtherGraph {
  return { id, title: "Root", kind: "root", createdAt: timestamp, updatedAt: timestamp, nodes: [], edges: [], groups: [], modules: [], viewState };
}

function promptNode(id: string): EtherGraph["nodes"][number] {
  return {
    id, definitionId: "prompt.text", title: "Brief", position: { x: 0, y: 0 }, size: { width: 220, height: 140 },
    config: { kind: "prompt.text", body: "A precise creative brief", assembly: "append" }, presentation
  };
}

function generatorNode(id: string): EtherGraph["nodes"][number] {
  return {
    id, definitionId: "generation.image", title: "Generator", position: { x: 300, y: 0 }, size: { width: 240, height: 160 },
    config: {
      kind: "generation.image", providerId: "ether-fake-local", profileId: "fake-image-default", aspectRatio: "1:1",
      resolution: { width: 32, height: 32 }, outputCount: 1
    },
    presentation
  };
}

function edge(id: string, fromId: string, toId: string): EtherEdge {
  return {
    id,
    from: { kind: "node", nodeId: fromId, channel: "text" },
    to: { kind: "node", nodeId: toId, channel: "text" },
    role: "general", order: 0, selector: { kind: "latest-approved" }, adapter: { kind: "auto" }, enabled: true
  };
}

function dialogs(overrides: Partial<NativeDialogPort> = {}): NativeDialogPort {
  return {
    openDocument: async () => null,
    saveDocument: async () => null,
    locateReference: async () => null,
    searchReferenceFolder: async () => null,
    confirmPortable: async () => true,
    ...overrides
  };
}

function requirePermit(permits: Map<string, PermitInspection>, id: string, permission: PermitInspection["permission"]): PermitInspection {
  const permit = permits.get(id);
  if (permit === undefined) throw coded("PERMIT_REVOKED", "The requested permit is absent or revoked.");
  if (permit.permission !== permission) throw coded(permission === "run" ? "RUN_PERMIT_MISMATCH" : "EDIT_PERMISSION_REQUIRED", "The permit has the wrong scope.");
  return permit;
}

function requireRunControl(permits: Map<string, PermitInspection>, id: string, planId: string, contentHash: string): void {
  const permit = requirePermit(permits, id, "run");
  if (permit.planId !== planId || permit.contentHash !== contentHash) throw coded("RUN_PERMIT_MISMATCH", "The run permit does not authorize this job.");
}

function coded(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await callResult(client, name, args);
  if (result.isError === true) throw new Error(JSON.stringify(result.structuredContent));
  return record(result.structuredContent);
}

async function callResult(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  if (!("content" in result)) throw new TypeError("Unexpected task-based MCP tool result.");
  return result;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Expected an object.");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError("Expected a non-empty string.");
  return value;
}

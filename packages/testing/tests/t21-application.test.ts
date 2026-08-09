import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EtherApplication } from "../../application/src/application.js";
import type { ExecutionProviderFacets } from "@ether/execution";
import { previewGraphTransaction } from "@ether/graph-kernel";
import { FakeImageProvider } from "@ether/providers";
import { EtherGraphSchema, GraphTransactionSchema, type EtherGraph, type GraphTransaction } from "@ether/schema";
import { nodeDefinitions } from "../../graph-kernel/src/registry.js";
import { PermitInspectionSchema } from "../../mcp-server/src/bridgeProtocol.js";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const timestamp = "2026-08-03T10:00:00.000Z";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("T21 application and plugin recovery boundaries", () => {
  it("keeps application-owned collection/export facets when a desktop resolver is present", async () => {
    const root = await temporaryRoot();
    const application = new EtherApplication({
      appDataRoot: root,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider(),
      providerResolver: async () => ({})
    });
    await application.createDocument({ path: path.join(root, "facet-test.ether"), title: "Facet test", initialGraph: blankGraph() });
    try {
      const scheduler = (application as unknown as {
        scheduler?: { options?: { providerResolver?: (input: unknown) => Promise<ExecutionProviderFacets> } };
      }).scheduler;
      const resolver = scheduler?.options?.providerResolver;
      expect(resolver).toBeTypeOf("function");
      const providers = await resolver!({});
      expect(providers.collection?.apply).toBeTypeOf("function");
      expect(providers.export?.export).toBeTypeOf("function");
    } finally {
      await application.closeDocument();
    }
  });

  it("exposes path-grant purpose through the permit inspection schema", async () => {
    const root = await temporaryRoot();
    const application = new EtherApplication({
      appDataRoot: root,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider(),
      pathGrantResolver: { resolve: ({ purpose }) => ({ kind: purpose === "reference" ? "file" : "directory", path: root }) }
    });
    await application.createDocument({ path: path.join(root, "permit-test.ether"), title: "Permit test", initialGraph: blankGraph() });
    try {
      const permit = await application.grantPathPermit("grant-export", "host-export", "export");
      const inspected = PermitInspectionSchema.parse(application.inspectPermits());
      expect(inspected).toContainEqual(expect.objectContaining({
        id: permit.id,
        permission: "path",
        pathGrantId: "host-export",
        purpose: "export"
      }));
    } finally {
      await application.closeDocument();
    }
  });

  it("validates the blank-safe plugin transaction without references, export, or execution", async () => {
    const template = JSON.parse(await readFile(fileURLToPath(new URL("../../codex-plugin/ether/examples/blank-document.transaction.json", import.meta.url)), "utf8")) as Record<string, unknown>;
    const transaction = GraphTransactionSchema.parse(hydrate(template, {
      baseDocumentRevisionId: "document-revision-1",
      baseGraphRevisionId: "graph-revision-1",
      targetGraphId: "root"
    }));
    const preview = previewGraphTransaction({ graphs: [blankGraph()], transaction });
    expect(preview.forwardOperations).toHaveLength(3);
    expect(preview.graphs[0]?.nodes.map((node) => node.definitionId)).toEqual(["prompt.text", "prompt.worker"]);
    expect(JSON.stringify(transaction)).not.toContain("referenceId");
    expect(JSON.stringify(transaction)).not.toContain("pathGrantId");
    expect(JSON.stringify(transaction)).not.toContain("output.export");
  });

  it("keeps registry-built canvas and plugin transactions equivalent through application undo and redo", async () => {
    const root = await temporaryRoot();
    const application = new EtherApplication({
      appDataRoot: root,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider(),
      dispatchMode: "manual"
    });
    await application.createDocument({ path: path.join(root, "registry-equivalence.ether"), title: "Registry equivalence", initialGraph: blankGraph() });
    try {
      const document = await application.queryDocument();
      const canvasTransaction = registryAddTransaction({
        id: "canvas-registry-add",
        actor: "user",
        documentRevisionId: document.documentRevisionId,
        graphRevisionId: document.graphRevisions.root!
      });
      const pluginTransaction = { ...canvasTransaction, id: "plugin-registry-add", actor: "codex" as const };
      const [canvasPreview, pluginPreview] = [
        previewGraphTransaction({ graphs: [blankGraph()], transaction: canvasTransaction }),
        previewGraphTransaction({ graphs: [blankGraph()], transaction: pluginTransaction })
      ];

      expect(pluginPreview.forwardOperations).toEqual(canvasPreview.forwardOperations);
      expect(pluginPreview.graphs).toEqual(canvasPreview.graphs);
      expect(pluginPreview.graphs[0]?.nodes.map((node) => node.definitionId)).toEqual(nodeDefinitions.map((definition) => definition.id));

      await application.applyGraphTransaction({ commandId: "apply-plugin-registry-add", transaction: pluginTransaction });
      await expect(application.queryGraph("root")).resolves.toMatchObject({
        nodes: nodeDefinitions.map((definition) => expect.objectContaining({
          definitionId: definition.id,
          config: definition.defaultConfig(),
          size: { width: definition.presentation.width, height: definition.presentation.height }
        }))
      });

      await application.applyHistory("undo-plugin-registry-add", "graph.undo");
      await expect(application.queryGraph("root")).resolves.toMatchObject({ nodes: [] });
      await application.applyHistory("redo-plugin-registry-add", "graph.redo");
      await expect(application.queryGraph("root")).resolves.toMatchObject({
        nodes: nodeDefinitions.map((definition) => expect.objectContaining({ definitionId: definition.id }))
      });
    } finally {
      await application.closeDocument();
    }
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-t21-"));
  roots.push(root);
  return root;
}

function blankGraph(): EtherGraph {
  return EtherGraphSchema.parse({
    id: "root",
    title: "Blank",
    kind: "root",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [],
    edges: [],
    groups: [],
    modules: [],
    viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
  });
}

function registryAddTransaction(input: {
  id: string;
  actor: GraphTransaction["actor"];
  documentRevisionId: string;
  graphRevisionId: string;
}): GraphTransaction {
  return GraphTransactionSchema.parse({
    id: input.id,
    baseDocumentRevisionId: input.documentRevisionId,
    baseGraphRevisions: { root: input.graphRevisionId },
    title: "Create every canonical node from the registry",
    actor: input.actor,
    layoutPolicy: "preserve",
    operations: nodeDefinitions.map((definition, index) => ({
      type: "addNode" as const,
      graphId: "root",
      node: {
        id: `registry-${index}`,
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

function hydrate(value: unknown, values: Record<string, string>): unknown {
  if (typeof value === "string") return value.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_match, key: string) => values[key] ?? "");
  if (Array.isArray(value)) return value.map((item) => hydrate(item, values));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [replacePlaceholders(key, values), hydrate(item, values)]));
  }
  return value;
}

function replacePlaceholders(value: string, values: Record<string, string>): string {
  return value.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_match, key: string) => values[key] ?? "");
}

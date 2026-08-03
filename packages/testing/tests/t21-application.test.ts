import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EtherApplication } from "../../application/src/application.js";
import type { ExecutionProviderFacets } from "@ether/execution";
import { previewGraphTransaction } from "@ether/graph-kernel";
import { FakeImageProvider } from "@ether/providers";
import { EtherGraphSchema, GraphTransactionSchema, type EtherGraph, type GraphTransaction } from "@ether/schema";
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

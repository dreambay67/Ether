import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EtherApplication } from "@ether/application";
import { FakeImageProvider } from "@ether/providers";
import type { EtherGraph, GraphTransaction } from "@ether/schema";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const timestamp = "2026-07-22T10:00:00.000Z";

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-application-contract-"));
  roots.push(root);
  return root;
}

function graph(): EtherGraph {
  return {
    id: "root", title: "Contract", kind: "root", createdAt: timestamp, updatedAt: timestamp,
    nodes: [], edges: [], groups: [], modules: [],
    viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
  };
}

function transaction(documentRevisionId: string, graphRevisionId: string): GraphTransaction {
  return {
    id: "add-generator", baseDocumentRevisionId: documentRevisionId, baseGraphRevisions: { root: graphRevisionId },
    title: "Prompt to image", actor: "user", layoutPolicy: "preserve", operations: [
      {
        type: "addNode", graphId: "root", node: {
          id: "prompt", definitionId: "prompt.text", title: "Prompt", position: { x: 0, y: 0 }, size: { width: 240, height: 180 },
          config: { kind: "prompt.text", body: "A precise studio product photograph.", assembly: "append" },
          presentation: { collapsed: false, accent: "default", previewMode: "content" }
        }
      },
      {
        type: "addNode", graphId: "root", node: {
          id: "image", definitionId: "generation.image", title: "Image", position: { x: 320, y: 0 }, size: { width: 240, height: 180 },
          config: { kind: "generation.image", providerId: "ether-fake-local", profileId: "fake-image-default", aspectRatio: "1:1", resolution: { width: 32, height: 32 }, outputCount: 1 },
          presentation: { collapsed: false, accent: "default", previewMode: "summary" }
        }
      },
      {
        type: "addEdge", graphId: "root", edge: {
          id: "prompt-image", from: { kind: "node", nodeId: "prompt", channel: "text" }, to: { kind: "node", nodeId: "image", channel: "text" },
          role: "subject", order: 0, selector: { kind: "latest-approved" }, adapter: { kind: "auto" }, enabled: true
        }
      }
    ]
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Ether 4.0 application boundary", () => {
  it("dispatches an idempotent durable workflow with output lineage, review, collection routing, events, and job inspection", async () => {
    const root = await temporaryRoot();
    const app = new EtherApplication({ appDataRoot: root, appVersion: "4.0.0-test", provider: new FakeImageProvider() });
    const eventNames: string[] = [];
    app.subscribe((event) => eventNames.push(event.name));
    await app.createDocument({ path: path.join(root, "Contract.ether"), title: "Contract", initialGraph: graph() });
    const initial = await app.queryDocument();
    await app.applyGraphTransaction({ commandId: "graph", transaction: transaction(initial.documentRevisionId, initial.graphRevisions.root!) });

    const preview = await app.execute({ kind: "command", id: "preview", correlationId: "c-preview", documentId: initial.documentId, name: "run.preview", payload: { graphId: "root", scope: { kind: "graph" } } });
    expect(preview.kind).toBe("response");
    if (preview.kind !== "response" || preview.name !== "run.preview") throw new Error("Preview did not return a plan.");
    const permit = await app.execute({ kind: "command", id: "permit", correlationId: "c-permit", documentId: initial.documentId, name: "permission.grantRun", payload: { planId: preview.payload.plan.id, contentHash: preview.payload.plan.contentHash } });
    if (permit.kind !== "response" || permit.name !== "permission.grantRun") throw new Error("Permit did not return.");
    const started = await app.execute({ kind: "command", id: "start", correlationId: "c-start", documentId: initial.documentId, name: "run.start", payload: { planId: preview.payload.plan.id, contentHash: preview.payload.plan.contentHash, runPermitId: permit.payload.permitId } });
    if (started.kind !== "response" || started.name !== "run.start") throw new Error("Run did not start.");
    await app.waitForJob(started.payload.job.id);

    const artifacts = await app.query({ kind: "query", id: "artifacts", correlationId: "c-artifacts", documentId: initial.documentId, name: "artifact.search", payload: { text: "", channels: [], collectionIds: [], tags: [], minimumRating: null, providerId: null, modelId: null, runId: null, graphId: null, createdAfter: null, createdBefore: null } });
    if (artifacts.kind !== "response" || artifacts.name !== "artifact.search") throw new Error("Artifacts did not return.");
    const artifact = artifacts.payload.artifacts[0]!;

    const collection = await app.execute({ kind: "command", id: "collection", correlationId: "c-collection", documentId: initial.documentId, name: "collection.create", payload: { title: "Selects", primary: true } });
    if (collection.kind !== "response" || collection.name !== "collection.create") throw new Error("Collection did not return.");
    await app.execute({ kind: "command", id: "route", correlationId: "c-route", documentId: initial.documentId, name: "review.route", payload: { artifactId: artifact.id, collectionId: collection.payload.collection.id, role: "subject" } });
    const editCommand = { kind: "command" as const, id: "edit", correlationId: "c-edit", documentId: initial.documentId, name: "output.edit" as const, payload: { outputVersionId: artifact.source.outputVersionId, payload: { title: "Retouched" } } };
    const firstEdit = await app.execute(editCommand);
    const duplicateEdit = await app.execute(editCommand);
    if (firstEdit.kind !== "response" || firstEdit.name !== "output.edit") throw new Error("Edit did not return.");
    expect(duplicateEdit).toMatchObject({ kind: "response", name: "output.edit", payload: firstEdit.payload });
    expect(firstEdit.payload.outputVersion.parentOutputVersionId).toBe(artifact.source.outputVersionId);
    await app.execute({ kind: "command", id: "approve", correlationId: "c-approve", documentId: initial.documentId, name: "review.approve", payload: { outputVersionId: firstEdit.payload.outputVersion.id, approved: true } });

    const memberships = await app.query({ kind: "query", id: "membership", correlationId: "c-membership", documentId: initial.documentId, name: "collection.membership", payload: { collectionId: collection.payload.collection.id } });
    expect(memberships).toMatchObject({ kind: "response", name: "collection.membership", payload: { memberships: [expect.objectContaining({ artifactId: artifact.id })] } });
    const job = await app.query({ kind: "query", id: "job", correlationId: "c-job", documentId: initial.documentId, name: "job.summary", payload: { jobId: started.payload.job.id } });
    expect(job).toMatchObject({ kind: "response", name: "job.summary", payload: { job: { status: "completed" } } });
    expect(eventNames).toEqual(expect.arrayContaining(["collection.changed", "output.created", "output.reviewed"]));
    await app.closeDocument();
  });
});

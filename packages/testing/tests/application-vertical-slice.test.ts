import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EtherApplication } from "@ether/application";
import { FakeImageProvider } from "@ether/providers";
import type { EtherGraph, GraphTransaction } from "@ether/schema";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const timestamp = "2026-07-18T08:00:00.000Z";

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function blankGraph(): EtherGraph {
  return {
    id: "graph-root",
    title: "Campaign",
    kind: "root",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [],
    edges: [],
    groups: [],
    modules: [],
    viewState: {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedNodeIds: [],
      selectedEdgeIds: [],
      inspectorTarget: null
    }
  };
}

function campaignTransaction(
  documentRevisionId: string,
  graphRevisionId: string
): GraphTransaction {
  return {
    id: "transaction-campaign-graph",
    baseDocumentRevisionId: documentRevisionId,
    baseGraphRevisions: { "graph-root": graphRevisionId },
    title: "Add campaign generator",
    actor: "user",
    layoutPolicy: "preserve",
    operations: [
      {
        type: "addNode",
        graphId: "graph-root",
        node: {
          id: "prompt",
          definitionId: "prompt.text",
          title: "Campaign prompt",
          position: { x: 40, y: 80 },
          size: { width: 220, height: 140 },
          config: {
            kind: "prompt.text",
            body: "A cobalt perfume bottle on a clean studio plinth.",
            assembly: "append"
          },
          presentation: { collapsed: false, accent: "default", previewMode: "content" }
        }
      },
      {
        type: "addNode",
        graphId: "graph-root",
        node: {
          id: "generator",
          definitionId: "generation.image",
          title: "Image Generator",
          position: { x: 340, y: 80 },
          size: { width: 220, height: 140 },
          config: {
            kind: "generation.image",
            providerId: "ether-fake-local",
            profileId: "fake-image-default",
            aspectRatio: "1:1",
            resolution: { width: 64, height: 64 },
            outputCount: 1
          },
          presentation: { collapsed: false, accent: "default", previewMode: "summary" }
        }
      },
      {
        type: "addEdge",
        graphId: "graph-root",
        edge: {
          id: "prompt-to-generator",
          from: { kind: "node", nodeId: "prompt", channel: "text" },
          to: { kind: "node", nodeId: "generator", channel: "text" },
          role: "subject",
          order: 0,
          selector: { kind: "latest-approved" },
          adapter: { kind: "auto" },
          enabled: true
        }
      }
    ]
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Ether application vertical slice", () => {
  it("persists and executes the exact Campaign.ether plan, then reopens its artifact read-only", async () => {
    const documentsRoot = await temporaryRoot("ether-task-8-documents-");
    const appDataRoot = await temporaryRoot("ether-task-8-appdata-");
    const documentPath = path.join(documentsRoot, "Campaign.ether");
    const application = new EtherApplication({
      appDataRoot,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider()
    });
    const eventNames: string[] = [];
    application.events.subscribe((event) => eventNames.push(event.name));

    await application.createDocument({
      path: documentPath,
      title: "Campaign",
      initialGraph: blankGraph()
    });
    const initial = await application.queryDocument();
    await application.applyGraphTransaction({
      commandId: "command-graph",
      transaction: campaignTransaction(
        initial.documentRevisionId,
        initial.graphRevisions["graph-root"]!
      )
    });

    const preview = await application.previewRun({
      commandId: "command-preview",
      graphId: "graph-root",
      scope: { kind: "graph" }
    });

    expect(preview.contentHash).toMatch(/^sha256:v1:[a-f0-9]{64}$/);
    expect(preview.capsuleVersion).toBe(1);
    expect(preview.steps).toEqual([
      expect.objectContaining({
        nodeId: "generator",
        compiledPrompt: "Subject: A cobalt perfume bottle on a clean studio plinth.",
        provider: expect.objectContaining({ providerId: "ether-fake-local" })
      })
    ]);
    expect(Object.isFrozen(preview)).toBe(true);
    expect(await application.queryPlan(preview.id)).toEqual(preview);

    const permit = await application.grantRunPermit({
      commandId: "command-permit",
      planId: preview.id,
      contentHash: preview.contentHash
    });
    const started = await application.startRun({
      commandId: "command-start",
      planId: preview.id,
      contentHash: preview.contentHash,
      runPermitId: permit.id
    });
    const completed = await application.waitForJob(started.id);

    expect(completed.status).toBe("completed");
    expect(eventNames).toEqual(
      expect.arrayContaining([
        "graph.revisionChanged",
        "plan.stateChanged",
        "permission.changed",
        "job.stateChanged",
        "artifact.accepted"
      ])
    );
    const artifacts = await application.searchArtifacts({ text: "" });
    expect(artifacts).toHaveLength(1);
    const artifact = artifacts[0]!;
    expect(artifact.mediaType).toBe("image/png");
    await expect(application.readArtifactBytes(artifact.id)).resolves.toEqual(
      expect.objectContaining({ 0: 0x89, 1: 0x50, 2: 0x4e, 3: 0x47 })
    );
    await application.saveDocument({ commandId: "command-save" });
    await application.closeDocument();

    const reopened = new EtherApplication({
      appDataRoot,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider()
    });
    await reopened.openDocument({ path: documentPath, access: "read-only" });

    expect((await reopened.queryJob(started.id)).status).toBe("completed");
    expect((await reopened.queryPlan(preview.id)).contentHash).toBe(preview.contentHash);
    expect(await reopened.searchArtifacts({ text: "" })).toEqual([artifact]);
    expect(await reopened.queryArtifactLineage(artifact.id)).toEqual(
      expect.objectContaining({
        artifact,
        outputVersion: expect.objectContaining({ nodeId: "generator", runId: started.id }),
        providerRun: expect.objectContaining({ providerId: "ether-fake-local" })
      })
    );
    expect(await readdir(documentsRoot)).toEqual(["Campaign.ether"]);

    await reopened.closeDocument();
  });
});

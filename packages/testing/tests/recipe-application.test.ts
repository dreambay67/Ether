import { mkdtemp, rm } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EtherApplication } from "@ether/application";
import { importBlob } from "@ether/document";
import { FakeImageProvider } from "@ether/providers";
import type { EtherGraph, NodeOutputVersion, PayloadEnvelope, RecipeManifest, RecipeParameterValue } from "@ether/schema";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_RECIPES } from "../../recipes/src/index.js";

const roots: string[] = [];
const openApps: EtherApplication[] = [];

function graph(): EtherGraph {
  return {
    id: "root", title: "Recipe target", kind: "root", createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z",
    nodes: [], edges: [], groups: [], modules: [],
    viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
  };
}

function valuesFor(recipe: RecipeManifest): RecipeParameterValue[] {
  const values: RecipeParameterValue[] = recipe.parameters
    .filter((parameter) => parameter.type === "artifact")
    .map((parameter) => ({ parameterId: parameter.id, value: ["artifact-source-1"] }));
  const exportGrant = recipe.parameters.find((parameter) => parameter.id === "exportPathGrantId");
  if (exportGrant !== undefined) values.push({ parameterId: exportGrant.id, value: "opaque-export-grant" });
  return values;
}

function applicationCapabilitiesFor(recipe: RecipeManifest) {
  return recipe.substitutions
    .filter((item) => item.priority === 0)
    .flatMap((item) => {
      if (item.capability.operation === "llm") {
        return [{
          ...item.capability,
          providerId: "codex-vision-assistant",
          profileId: "worker:gpt-5",
          modelId: "gpt-5",
          reasoningEfforts: ["low", "medium", "high"],
          provenance: "runtime-discovered" as const
        }];
      }
      if (item.capability.operation === "evaluate") {
        const evaluation = {
          ...item.capability,
          providerId: "codex-vision-evaluation",
          profileId: "evaluation:gpt-5",
          modelId: "gpt-5",
          reasoningEfforts: ["low", "medium", "high"],
          provenance: "runtime-discovered" as const
        };
        return [evaluation, { ...evaluation, operation: "llm" as const }];
      }
      return [item.capability];
    });
}

async function seedReferenceArtifact(app: EtherApplication, root: string) {
  const id = "artifact-source-1";
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const sourcePath = path.join(root, `${id}.png`);
  await writeFile(sourcePath, bytes);
  const blob = await importBlob(app.boundaryStore(), { sourcePath, mediaType: "image/png" }, { appDataRoot: root });
  return { id, contentKey: blob.contentKey, byteLength: bytes.byteLength };
}

async function seedReferenceOutput(app: EtherApplication, artifact: { id: string; contentKey: string; byteLength: number }, nodeId: string) {
  const document = await app.queryDocument();
  const outputVersionId = `output-reference-${artifact.id}`;
  const payload: PayloadEnvelope = {
    id: `payload-reference-${artifact.id}`,
    channel: "image",
    role: "subject",
    content: { kind: "artifact", artifactId: artifact.id },
    source: { nodeId, outputVersionId, lineageKey: "seeded-reference" },
    metadata: {}
  };
  const version: NodeOutputVersion = {
    id: outputVersionId,
    nodeId,
    graphId: "root",
    graphRevisionId: document.graphRevisions.root!,
    inputPayloadIds: [],
    selectedOutputVersionIds: [],
    compiledContextHash: `hash-${artifact.id}`,
    producer: { kind: "local", executor: "transform" },
    outputPayloadIds: [payload.id],
    parentOutputVersionId: null,
    approval: { state: "approved", actor: "system", at: "2026-08-03T12:00:00.000Z" },
    runId: null,
    stepId: null,
    workItemId: null,
    attemptId: null,
    timing: { startedAt: "2026-08-03T12:00:00.000Z", completedAt: "2026-08-03T12:00:00.000Z" },
    failure: null,
    createdAt: "2026-08-03T12:00:00.000Z"
  };
  await app.boundaryStore().transaction(({ outputs, artifacts }) => {
    outputs.insert(version, [payload]);
    artifacts.attach({
      id: artifact.id,
      contentKey: artifact.contentKey,
      channel: "image",
      mediaType: "image/png",
      byteLength: artifact.byteLength,
      source: { outputVersionId, payloadId: payload.id },
      createdAt: "2026-08-03T12:00:00.000Z",
      metadata: { title: "Recipe source" }
    });
  });
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.closeDocument().catch(() => undefined)));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("recipe application boundary", () => {
  it("catalogs, describes, previews, atomically instantiates, reloads, and undoes a recipe", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-recipe-boundary-"));
    roots.push(root);
    const recipe = BUILTIN_RECIPES.find((item) => item.id === "prompt-to-image")!;
    const app = new EtherApplication({
      appDataRoot: root,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider()
    });
    openApps.push(app);
    const created = await app.createDocument({ path: path.join(root, "Recipes.ether"), title: "Recipes", initialGraph: graph() });

    const catalog = await app.query({ kind: "query", id: "catalog", correlationId: "c-catalog", name: "recipe.catalog", payload: {} });
    expect(catalog).toMatchObject({ kind: "response", name: "recipe.catalog", payload: { recipes: expect.arrayContaining([expect.objectContaining({ id: "prompt-to-image", version: "4.0.0" })]) } });
    const setup = await app.query({ kind: "query", id: "setup", correlationId: "c-setup", name: "recipe.setupSchema", payload: { recipeId: recipe.id, version: recipe.version } });
    expect(setup).toMatchObject({
      kind: "response",
      name: "recipe.setupSchema",
      payload: {
        parameters: [expect.objectContaining({ id: "brief", type: "string" })],
        capabilities: [expect.objectContaining({
          requirementId: "image",
          state: "compatible",
          selectedProviderId: "ether-fake-local",
          options: [
            expect.objectContaining({ providerId: expect.stringMatching(/^codex(?:-chatgpt-image-2)?$/), available: false }),
            expect.objectContaining({ providerId: "google-gemini-api-nano-banana-2", available: false })
          ]
        })]
      }
    });

    const preview = await app.execute({
      kind: "command", id: "preview", correlationId: "c-preview", documentId: created.documentId, name: "recipe.preview",
      payload: { recipeId: recipe.id, version: recipe.version, parameters: [] }
    });
    expect(preview).toMatchObject({ kind: "response", name: "recipe.preview", payload: { transaction: { actor: "recipe", layoutPolicy: "preserve", operations: expect.any(Array) }, warnings: [expect.stringContaining("first root graph")] } });

    const instantiated = await app.execute({
      kind: "command", id: "instantiate", correlationId: "c-instantiate", documentId: created.documentId, name: "recipe.instantiate",
      payload: { recipeId: recipe.id, version: recipe.version, targetGraphId: "root", parameters: [] }
    });
    expect(instantiated).toMatchObject({ kind: "response", name: "recipe.instantiate", payload: { kind: "revision" } });
    expect((await app.queryGraph("root")).nodes).toHaveLength(recipe.graph.nodes.length);

    await app.execute({ kind: "command", id: "undo", correlationId: "c-undo", documentId: created.documentId, name: "graph.undo", payload: { graphId: "root" } });
    expect((await app.queryGraph("root")).nodes).toEqual([]);
    await app.closeDocument();
  });

  it("instantiates and compiles the measured application plan for all twelve recipes", async () => {
    for (const recipe of BUILTIN_RECIPES) {
      const root = await mkdtemp(path.join(os.tmpdir(), `ether-recipe-${recipe.id}-`));
      roots.push(root);
      const app = new EtherApplication({
        appDataRoot: root,
        appVersion: "4.0.0-test",
        provider: new FakeImageProvider(),
        providerCapabilities: applicationCapabilitiesFor(recipe),
        dispatchMode: "manual"
      });
      openApps.push(app);
      const created = await app.createDocument({
        path: path.join(root, `${recipe.id}.ether`),
        title: recipe.title,
        initialGraph: graph()
      });
      const seededArtifact = recipe.parameters.some((parameter) => parameter.type === "artifact")
        ? await seedReferenceArtifact(app, root)
        : null;
      const setup = await app.query({
        kind: "query",
        id: `setup-${recipe.id}`,
        correlationId: `correlation-setup-${recipe.id}`,
        name: "recipe.setupSchema",
        payload: { recipeId: recipe.id, version: recipe.version }
      });
      const setupParameterIds = setup.kind === "response" && setup.name === "recipe.setupSchema"
        ? new Set(setup.payload.parameters.map((parameter) => parameter.id))
        : new Set<string>();
      const parameters = valuesFor(recipe).filter((value) => setupParameterIds.has(value.parameterId));
      const instantiated = await app.execute({
        kind: "command",
        id: `instantiate-${recipe.id}`,
        correlationId: `correlation-instantiate-${recipe.id}`,
        documentId: created.documentId,
        name: "recipe.instantiate",
        payload: {
          recipeId: recipe.id,
          version: recipe.version,
          targetGraphId: "root",
          parameters
        }
      });
      expect(instantiated, `${recipe.id}: ${JSON.stringify(instantiated)}`).toMatchObject({
        kind: "response",
        name: "recipe.instantiate",
        payload: { kind: "revision" }
      });
      if (seededArtifact !== null) {
        const referenceNode = (await app.queryGraph("root")).nodes.find((node) => node.definitionId === "reference.set");
        if (referenceNode === undefined) throw new Error(`Recipe ${recipe.id} did not insert a reference set.`);
        await seedReferenceOutput(app, seededArtifact, referenceNode.id);
      }

      const preview = await app.execute({
        kind: "command",
        id: `run-preview-${recipe.id}`,
        correlationId: `correlation-run-preview-${recipe.id}`,
        documentId: created.documentId,
        name: "run.preview",
        payload: { graphId: "root", scope: { kind: "graph" } }
      });
      if (preview.kind !== "response" || preview.name !== "run.preview") {
        throw new Error(`Application did not compile ${recipe.id}: ${JSON.stringify(preview)}`);
      }
      expect(preview.payload.plan.estimatedCalls, `${recipe.id} calls`).toBe(recipe.expectedWork.minimumCalls);
      expect(preview.payload.plan.estimatedCalls, `${recipe.id} maximum calls`).toBe(recipe.expectedWork.maximumCalls);
      expect(preview.payload.plan.workItems, `${recipe.id} work items`).toHaveLength(recipe.expectedWork.minimumWorkItems);
      expect(preview.payload.plan.workItems, `${recipe.id} maximum work items`).toHaveLength(recipe.expectedWork.maximumWorkItems);
      if (recipe.id === "batch-variations-contact-sheet") {
        expect(preview.payload.plan.steps).toEqual(expect.arrayContaining([
          expect.objectContaining({
            nodeId: expect.stringContaining("contact-sheet"),
            executor: "join",
            compiledContext: expect.objectContaining({ join: expect.objectContaining({ strategy: "ordered", requireComplete: true }) })
          })
        ]));
      }
      await app.closeDocument();
    }
  }, 30_000);
});

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EtherApplication } from "@ether/application";
import { FakeImageProvider } from "@ether/providers";
import type { EtherGraph, RecipeManifest, RecipeParameterValue } from "@ether/schema";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_RECIPES } from "../../recipes/src/index.js";

const roots: string[] = [];

function graph(): EtherGraph {
  return {
    id: "root", title: "Recipe target", kind: "root", createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z",
    nodes: [], edges: [], groups: [], modules: [],
    viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
  };
}

function valuesFor(recipe: RecipeManifest): RecipeParameterValue[] {
  return recipe.parameters
    .filter((parameter) => parameter.type === "artifact")
    .map((parameter) => ({ parameterId: parameter.id, value: ["artifact-source-1"] }));
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

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
            expect.objectContaining({ providerId: "codex", available: false }),
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
        providerCapabilities: recipe.substitutions
          .filter((item) => item.priority === 0)
          .map((item) => item.capability),
        dispatchMode: "manual"
      });
      const created = await app.createDocument({
        path: path.join(root, `${recipe.id}.ether`),
        title: recipe.title,
        initialGraph: graph()
      });
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
          parameters: valuesFor(recipe)
        }
      });
      expect(instantiated, recipe.id).toMatchObject({
        kind: "response",
        name: "recipe.instantiate",
        payload: { kind: "revision" }
      });

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
      await app.closeDocument();
    }
  }, 30_000);
});

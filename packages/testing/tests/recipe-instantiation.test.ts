import { describe, expect, it } from "vitest";
import { previewGraphTransaction } from "@ether/graph-kernel";
import type { EtherGraph, ProviderCapability, RecipeManifest } from "@ether/schema";
import { BUILTIN_RECIPES, instantiateRecipe } from "../../recipes/src/index.js";

function targetGraph(): EtherGraph {
  return {
    id: "root", title: "Recipe target", kind: "root",
    createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z",
    nodes: [], edges: [], groups: [], modules: [],
    viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
  };
}

function capabilitiesFor(recipe: RecipeManifest, substitutionIndex = 0): ProviderCapability[] {
  return recipe.capabilityRequirements.map((requirement) => recipe.substitutions
    .filter((item) => item.requirementId === requirement.id)
    .sort((left, right) => left.priority - right.priority)[substitutionIndex]!.capability);
}

function valuesFor(recipe: RecipeManifest) {
  return recipe.parameters
    .filter((parameter) => parameter.type === "artifact")
    .map((parameter) => ({ parameterId: parameter.id, value: ["artifact-source-1"] }));
}

describe("recipe instantiation", () => {
  it("inserts every built-in recipe as one previewable, undoable graph transaction", () => {
    for (const recipe of BUILTIN_RECIPES) {
      const graph = targetGraph();
      const result = instantiateRecipe({
        manifest: recipe, graphs: [graph], targetGraphId: graph.id,
        baseDocumentRevisionId: "document-revision", baseGraphRevisions: { root: "root-revision" },
        parameters: valuesFor(recipe), providerCapabilities: capabilitiesFor(recipe)
      });
      expect(result.kind, recipe.id).toBe("ready");
      if (result.kind !== "ready") continue;
      expect(result.transaction.actor).toBe("recipe");
      expect(result.transaction.operations).toHaveLength(recipe.graph.nodes.length + recipe.graph.edges.length + recipe.graph.groups.length);
      expect(result.focus?.nodeId).toContain(recipe.id);
      expect(previewGraphTransaction({ graphs: [graph], transaction: result.transaction }).graphs[0]?.nodes).toHaveLength(recipe.graph.nodes.length);
    }
  });

  it("blocks before mutation when a required provider or artifact input is unavailable", () => {
    const recipe = BUILTIN_RECIPES.find((item) => item.id === "reference-guided-image")!;
    const missingProvider = instantiateRecipe({
      manifest: recipe, graphs: [targetGraph()], targetGraphId: "root",
      baseDocumentRevisionId: "document-revision", baseGraphRevisions: { root: "root-revision" },
      parameters: valuesFor(recipe), providerCapabilities: []
    });
    expect(missingProvider).toMatchObject({ kind: "blocked", blockers: [expect.objectContaining({ code: "CAPABILITY_MISSING", supportedSubstitutions: expect.any(Array) })] });
    const missingArtifact = instantiateRecipe({
      manifest: recipe, graphs: [targetGraph()], targetGraphId: "root",
      baseDocumentRevisionId: "document-revision", baseGraphRevisions: { root: "root-revision" },
      providerCapabilities: capabilitiesFor(recipe)
    });
    expect(missingArtifact).toMatchObject({ kind: "blocked", blockers: [expect.objectContaining({ code: "PARAMETER_REQUIRED", parameterId: "references" })] });
  });

  it("uses a declared fallback visibly instead of silently retaining the primary provider", () => {
    const recipe = BUILTIN_RECIPES.find((item) => item.id === "prompt-to-image")!;
    const result = instantiateRecipe({
      manifest: recipe, graphs: [targetGraph()], targetGraphId: "root",
      baseDocumentRevisionId: "document-revision", baseGraphRevisions: { root: "root-revision" },
      providerCapabilities: capabilitiesFor(recipe, 1)
    });
    expect(result).toMatchObject({ kind: "ready", providers: [expect.objectContaining({ mode: "substitution", substitutionProviderId: "antigravity" })] });
    if (result.kind !== "ready") return;
    const generated = result.transaction.operations.find((operation) => operation.type === "addNode" && operation.node.definitionId === "generation.image");
    expect(generated).toMatchObject({ node: { config: { providerId: "antigravity", profileId: "nano-banana-2" } } });
  });

  it("binds providers to their requirement nodes, including two nodes with the same operation", () => {
    const base = structuredClone(BUILTIN_RECIPES.find((item) => item.id === "draft-lite-finish-pro")!);
    const draftRequirement = base.capabilityRequirements.find((item) => item.id === "draft")!;
    const finishRequirement = base.capabilityRequirements.find((item) => item.id === "finish")!;
    Object.assign(finishRequirement, { operation: "generate-image", inputChannels: ["image"] });
    const finish = base.graph.nodes.find((node) => node.id === "finish")!;
    Object.assign(finish, {
      definitionId: "generation.image",
      config: { kind: "generation.image", providerId: "codex", profileId: "image-default", aspectRatio: "1:1", resolution: { width: 1024, height: 1024 }, outputCount: 1 }
    });
    const draftSubstitutions = base.substitutions.filter((item) => item.requirementId === "draft");
    base.substitutions = [
      ...draftSubstitutions,
      ...draftSubstitutions.map((item) => ({
        ...item,
        requirementId: "finish",
        priority: item.providerId === "codex" ? 0 : 1,
        capability: { ...item.capability, inputChannels: ["image" as const] }
      }))
    ];
    const available = [
      base.substitutions.find((item) => item.requirementId === "draft" && item.priority === 0)!.capability,
      base.substitutions.find((item) => item.requirementId === "finish" && item.priority === 0)!.capability
    ];
    expect(draftRequirement.operation).toBe("generate-image");
    const result = instantiateRecipe({
      manifest: base, graphs: [targetGraph()], targetGraphId: "root",
      baseDocumentRevisionId: "document-revision", baseGraphRevisions: { root: "root-revision" }, providerCapabilities: available
    });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    const configured = result.transaction.operations.flatMap((operation) =>
      operation.type === "addNode" && operation.node.definitionId === "generation.image" ? [operation.node.config] : []);
    expect(configured).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: "antigravity", profileId: "nano-banana-2" }),
      expect.objectContaining({ providerId: "codex", profileId: "image-default" })
    ]));
  });

  it("creates declared module graphs in the same atomic transaction and places the recipe deterministically", () => {
    const recipe = structuredClone(BUILTIN_RECIPES.find((item) => item.id === "prompt-to-image")!);
    const innerPrompt = { ...structuredClone(recipe.graph.nodes[0]!), id: "inner-prompt" };
    const moduleGraph = {
      ...structuredClone(recipe.graph), graphRef: "recipe.prompt-to-image.module", title: "Recipe module", kind: "module" as const,
      nodes: [innerPrompt], edges: [], groups: [], modules: [],
      viewState: { ...recipe.graph.viewState, selectedNodeIds: [innerPrompt.id], selectedEdgeIds: [], inspectorTarget: { kind: "node" as const, id: innerPrompt.id } }
    };
    recipe.moduleGraphs = [moduleGraph];
    recipe.graph.modules = [{ id: "module", title: "Recipe module", graphId: moduleGraph.graphRef, position: { x: 54, y: 300 }, size: { width: 220, height: 140 }, interface: { inputs: [], outputs: [], parameters: [] }, collapsed: false }];
    const existing = targetGraph();
    existing.nodes.push({ ...structuredClone(recipe.graph.nodes[0]!), id: "existing", position: { x: 100, y: 100 } } as EtherGraph["nodes"][number]);
    const input = {
      manifest: recipe, graphs: [existing], targetGraphId: "root", baseDocumentRevisionId: "document-revision",
      baseGraphRevisions: { root: "root-revision" }, providerCapabilities: capabilitiesFor(recipe)
    };
    const first = instantiateRecipe(input);
    const second = instantiateRecipe(input);
    expect(first.kind).toBe("ready");
    expect(second.kind).toBe("ready");
    if (first.kind !== "ready" || second.kind !== "ready") return;
    expect(first.transaction.layoutPolicy).toBe("preserve");
    expect(first.transaction.operations).toEqual(second.transaction.operations);
    const createModule = first.transaction.operations.find((operation) => operation.type === "createModule");
    expect(createModule).toMatchObject({ module: { id: "prompt-to-image-module" }, subtree: { rootGraphId: "prompt-to-image-recipe.prompt-to-image.module" } });
    const preview = previewGraphTransaction({ graphs: [existing], transaction: first.transaction });
    expect(preview.graphs.find((graph) => graph.id === "prompt-to-image-recipe.prompt-to-image.module")?.kind).toBe("module");
    const insertedPrompt = preview.graphs.find((graph) => graph.id === "root")!.nodes.find((node) => node.id === "prompt-to-image-prompt")!;
    expect(insertedPrompt.position.x).toBe(378);
  });
});

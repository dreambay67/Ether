import { describe, expect, it } from "vitest";
import { BUILTIN_RECIPES, runFakeRecipeAcceptanceScenario } from "../../recipes/src/index.js";

describe("recipe fake-provider acceptance", () => {
  it("turns every declared fake-provider output into a traceable artifact", () => {
    for (const recipe of BUILTIN_RECIPES) {
      const result = runFakeRecipeAcceptanceScenario(recipe);
      expect(result.passed, recipe.id).toBe(true);
      const expectedOutputs = recipe.acceptanceScenario.steps
        .flatMap((step) => step.kind === "success" ? step.outputs : []);
      expect(result.artifacts).toHaveLength(expectedOutputs.length);
      expect(result.artifacts.map((artifact) => artifact.fixtureId)).toEqual(expectedOutputs.map((output) => output.fixtureId));
      expect(result.artifacts.every((artifact) => artifact.id.startsWith(`${recipe.id}:`))).toBe(true);
    }
  });

  it("reaches every declared review checkpoint and carries collection/export destinations honestly", () => {
    for (const recipe of BUILTIN_RECIPES) {
      const result = runFakeRecipeAcceptanceScenario(recipe);
      const declaredCheckpointIds = recipe.checkpoints.map((checkpoint) => checkpoint.id).sort();
      expect(result.checkpointsReached).toEqual(declaredCheckpointIds);
      const collectionIds = recipe.graph.nodes
        .filter((node) => node.definitionId === "output.collection")
        .filter((node) => !recipe.graph.edges.some((edge) =>
          edge.role === "negative"
          && edge.to.kind === "node"
          && edge.to.nodeId === node.id))
        .map((node) => String(node.config.collectionId))
        .sort();
      expect(result.collectionIds).toEqual(collectionIds);
      const exportNodeIds = recipe.graph.nodes
        .filter((node) => node.definitionId === "output.export")
        .map((node) => node.id)
        .sort();
      expect(result.exportNodeIds).toEqual(exportNodeIds);
    }
  });

  it("takes exactly one declared filter route for matched and unmatched outcomes", () => {
    const recipe = BUILTIN_RECIPES.find((item) => item.id === "evaluate-and-route")!;
    const matched = runFakeRecipeAcceptanceScenario(recipe);
    expect(matched.passed).toBe(true);
    expect(matched.collectionIds).toEqual(["selects"]);
    expect(matched.skippedNodeIds).toEqual(["rework"]);

    const unmatched = runFakeRecipeAcceptanceScenario(recipe, { filterOutcomes: { filter: "unmatched" } });
    expect(unmatched.passed).toBe(true);
    expect(unmatched.collectionIds).toEqual(["needs-rework"]);
    expect(unmatched.skippedNodeIds).toEqual(["selects"]);
  });

  it("cannot cross an unapproved review gate or a broken route", () => {
    const recipe = BUILTIN_RECIPES.find((item) => item.id === "curate-collect-export")!;
    const unapproved = runFakeRecipeAcceptanceScenario(recipe, { approveCheckpoints: false });
    expect(unapproved.passed).toBe(false);
    expect(unapproved.checkpointsReached).toEqual([]);
    expect(unapproved.collectionIds).toEqual([]);
    expect(unapproved.exportNodeIds).toEqual([]);
    expect(unapproved.blockedNodeIds).toContain("compare");

    const routeToCollection = recipe.graph.edges.find((edge) => edge.to.kind === "node" && edge.to.nodeId === "collection")!;
    const broken = runFakeRecipeAcceptanceScenario(recipe, { approveCheckpoints: true, disabledEdgeIds: [routeToCollection.id] });
    expect(broken.passed).toBe(false);
    expect(broken.collectionIds).toEqual([]);
    expect(broken.exportNodeIds).toEqual(["export"]);
    expect(broken.blockedNodeIds).toContain("collection");
  });
});

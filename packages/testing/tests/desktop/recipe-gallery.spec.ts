import { expect, test } from "@playwright/test";

test("loads typed recipe setup, previews blockers, inserts atomically, reloads, and focuses", async ({ page }) => {
  await page.addInitScript(() => {
    const node = {
      id: "prompt-to-image-prompt", definitionId: "prompt.text", title: "Recipe brief",
      position: { x: 4_200, y: 2_600 }, size: { width: 220, height: 140 },
      config: { kind: "prompt.text", body: "A precise editorial still life", assembly: "replace" },
      presentation: { collapsed: false, accent: "#37e6ea", previewMode: "content" }
    };
    let graph = {
      id: "graph-root", title: "Recipe canvas", kind: "root", createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z",
      nodes: [] as typeof node[], edges: [], groups: [], modules: [],
      viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
    };
    const recipe = (id: string, title: string) => ({
      id, version: "4.0.0", title, description: "A typed application-boundary recipe.",
      capabilityRequirements: [{ id: "prompt", operation: "generate-image" }],
      expectedWork: { minimumCalls: 1, maximumCalls: 1, minimumWorkItems: 1, maximumWorkItems: 1 },
      layout: { focusNodeRef: "prompt" }
    });
    const recipes = [recipe("prompt-to-image", "Prompt to Image"), recipe("provider-blocked", "Provider Blocked")];
    const descriptor = {
      documentId: "recipe-document", displayName: "Recipes", named: true, mode: "writable", readOnlyReason: null,
      commands: { save: true, saveAs: true, saveCopy: true, compact: true, makePortable: true }, saveState: "saved",
      documentRevisionId: "revision-1", graphId: "graph-root", graphRevisionId: "graph-revision-1", simulationEnabled: false, revision: 1
    };
    const preview = {
      id: "recipe-preview", baseDocumentRevisionId: "revision-1", baseGraphRevisions: { "graph-root": "graph-revision-1" },
      title: "Insert recipe", actor: "recipe", layoutPolicy: "preserve",
      operations: [{ type: "addNode", graphId: "graph-root", node }]
    };
    Object.defineProperty(window, "ether", { value: {
      document: {
        onEvent: () => () => undefined, bootstrap: async () => descriptor, new: async () => descriptor, open: async () => descriptor,
        openDropped: async () => descriptor, save: async () => descriptor, saveAs: async () => descriptor, saveCopy: async () => descriptor,
        compact: async () => ({ beforeBytes: 1, afterBytes: 1 }), makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] }), close: async () => null
      },
      graph: { snapshot: async () => ({ graph, revision: 1 }), applyTransaction: async () => ({ graph, revision: 1 }) },
      application: {
        onEvent: () => () => undefined,
        query: async (query: { name: string; payload?: { recipeId?: string } }) => {
          if (query.name === "recipe.catalog") return { payload: { recipes } };
          if (query.name === "recipe.setupSchema") {
            await new Promise((resolve) => setTimeout(resolve, query.payload?.recipeId === "provider-blocked" ? 80 : 5));
            return { payload: {
                parameters: [{ id: "brief", title: "Creative brief", description: "The direction for this graph.", type: "string", required: true, defaultValue: "A precise editorial still life", minLength: 3, maxLength: 1200 }],
                capabilities: [{
                  requirementId: "prompt", operation: "generate-image", inputChannels: ["text"], outputChannels: ["image"],
                  state: query.payload?.recipeId === "provider-blocked" ? "missing" : "compatible",
                  selectedProviderId: query.payload?.recipeId === "provider-blocked" ? null : "ether-fake-local",
                  selectedProfileId: query.payload?.recipeId === "provider-blocked" ? null : "fake-image-default",
                  options: [
                    { providerId: "codex", profileId: "image-default", priority: 0, available: false },
                    { providerId: "antigravity", profileId: "nano-banana-2", priority: 1, available: false }
                  ]
                }]
              } };
          }
          return { payload: { graph, documentRevisionId: "revision-1", graphRevisionId: "graph-revision-1" } };
        },
        command: async (command: { name: string; payload: { recipeId?: string } }) => {
          if (command.name === "recipe.preview") {
            if (command.payload.recipeId === "provider-blocked") throw new Error("No enabled provider can satisfy prompt (generate-image).");
            return { payload: { transaction: preview, warnings: ["Preview targets the first root graph (Recipe canvas)."] } };
          }
          if (command.name === "recipe.instantiate") graph = { ...graph, nodes: [node] };
          return { payload: { kind: "revision", documentRevisionId: "revision-2", graphRevisions: [{ graphId: "graph-root", revisionId: "graph-revision-2" }] } };
        }
      },
      artifacts: { search: async () => [], generateFake: async () => [] }, references: { list: async () => [], act: async () => [] },
      runtime: { versions: async () => ({ electron: "43", node: "24" }) }
    } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Recipes" }).click();
  const dialog = page.getByRole("dialog", { name: "Recipe Gallery" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Recipes" })).toBeFocused();
  await page.getByRole("button", { name: "Recipes" }).click();
  await expect(page.getByTestId("recipe-gallery")).toBeVisible();
  await page.getByTestId("recipe-card-provider-blocked").click();
  await page.getByTestId("recipe-card-prompt-to-image").click();
  await expect(page.getByTestId("recipe-capability-prompt")).toContainText("Compatible provider");
  await page.waitForTimeout(100);
  await expect(page.getByTestId("recipe-capability-prompt")).toContainText("Compatible provider");
  await page.getByTestId("recipe-card-provider-blocked").click();
  await expect(page.getByTestId("recipe-gallery-status")).toContainText("Blocked: 1 provider requirement");
  await expect(page.getByTestId("recipe-capability-prompt")).toContainText("Provider missing");
  await expect(page.getByTestId("recipe-capability-prompt")).toContainText("No enabled provider");
  await expect(page.getByRole("button", { name: "Preview" })).toBeDisabled();

  await page.getByTestId("recipe-card-prompt-to-image").click();
  await expect(page.getByTestId("recipe-capability-prompt")).toContainText("Compatible provider");
  await expect(page.getByTestId("recipe-capability-prompt")).toContainText("ether-fake-local");
  await expect(page.getByTestId("recipe-capability-prompt")).toContainText("Fallback · antigravity");
  const previewButton = page.getByRole("button", { name: "Preview" });
  await expect(previewButton).toHaveCSS("background-color", "rgb(16, 29, 42)");
  await expect(previewButton).toHaveCSS("color", "rgb(233, 244, 248)");
  await previewButton.click();
  await expect(page.getByTestId("recipe-gallery-status")).toContainText("Preview ready");
  await page.getByRole("button", { name: "Insert recipe" }).click();
  await expect(page.getByRole("dialog", { name: "Recipe Gallery" })).toBeHidden();
  const insertedNode = page.locator('[data-testid="rf__node-prompt-to-image-prompt"]');
  await expect(insertedNode).toBeVisible();
  await expect(insertedNode).toBeInViewport({ ratio: 0.999 });
  await page.setViewportSize({ width: 900, height: 760 });
  await expect(insertedNode).toBeInViewport({ ratio: 0.999 });
  await expect(page.getByTestId("canvas-status")).toContainText("Focused the inserted recipe node");
});

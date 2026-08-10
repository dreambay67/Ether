import { expect, test, type Page } from "@playwright/test";

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
    const recipes = [
      recipe("prompt-to-image", "Prompt to Image"),
      recipe("provider-blocked", "Provider Blocked"),
      recipe("reference-guided", "Reference-Guided Image"),
      recipe("reference-without-artifacts", "Reference Without Artifacts"),
      recipe("curate-export", "Curate and Export")
    ];
    const artifact = {
      id: "artifact-source-1", contentKey: "a".repeat(64), channel: "image", mediaType: "image/png", byteLength: 128,
      source: { outputVersionId: "artifact-output-1", payloadId: "artifact-payload-1" }, createdAt: "2026-07-23T00:00:00.000Z",
      metadata: { title: "Current document reference.png" }
    };
    const recipeCommands: Array<{ name: string; payload: { recipeId?: string; parameters?: Array<{ parameterId: string; value: unknown }> } }> = [];
    let folderGrantCalls = 0;
    (window as typeof window & { __recipeGalleryCommands: typeof recipeCommands; __recipeGalleryFolderGrantCalls: () => number }).__recipeGalleryCommands = recipeCommands;
    (window as typeof window & { __recipeGalleryCommands: typeof recipeCommands; __recipeGalleryFolderGrantCalls: () => number }).__recipeGalleryFolderGrantCalls = () => folderGrantCalls;
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
        query: async (query: { name: string; payload?: { recipeId?: string; channels?: string[] } }) => {
          if (query.name === "node.catalog") return { name: query.name, payload: { nodes: [] } };
          if (query.name === "recipe.catalog") return { name: query.name, payload: { recipes } };
          if (query.name === "recipe.setupSchema") {
            await new Promise((resolve) => setTimeout(resolve, query.payload?.recipeId === "provider-blocked" ? 80 : 5));
            if (query.payload?.recipeId === "reference-guided" || query.payload?.recipeId === "reference-without-artifacts") {
              return { name: query.name, payload: {
                parameters: [{
                  id: "referenceArtifact", title: "Reference artifact", description: "Choose an artifact already embedded in this document.",
                  type: "artifact", channels: query.payload.recipeId === "reference-guided" ? ["image"] : ["video"],
                  required: true, minimumItems: 1, maximumItems: 1
                }],
                capabilities: []
              } };
            }
            if (query.payload?.recipeId === "curate-export") {
              return { name: query.name, payload: {
                parameters: [{
                  id: "exportPathGrantId", title: "Export folder", description: "Choose a document-scoped export destination.",
                  type: "string", required: true, defaultValue: "__ether_export_grant_required__", minLength: 1, maxLength: 256
                }],
                capabilities: []
              } };
            }
            return { name: query.name, payload: {
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
          if (query.name === "artifact.search") return { name: query.name, payload: {
            artifacts: query.payload?.channels?.includes("image") ? [artifact] : [],
            total: query.payload?.channels?.includes("image") ? 1 : 0,
            nextCursor: null
          } };
          return { name: query.name, payload: { graph, documentRevisionId: "revision-1", graphRevisionId: "graph-revision-1" } };
        },
        command: async (command: { name: string; payload: { recipeId?: string; parameters?: Array<{ parameterId: string; value: unknown }> } }) => {
          recipeCommands.push(command);
          if (command.name === "recipe.preview") {
            if (command.payload.recipeId === "provider-blocked") throw new Error("No enabled provider can satisfy prompt (generate-image).");
            return { payload: { transaction: preview, warnings: ["Preview targets the first root graph (Recipe canvas)."] } };
          }
          if (command.name === "recipe.instantiate") graph = { ...graph, nodes: [node] };
          return { payload: { kind: "revision", documentRevisionId: "revision-2", graphRevisions: [{ graphId: "graph-root", revisionId: "graph-revision-2" }] } };
        }
      },
      artifacts: { search: async () => [], generateFake: async () => [] }, references: { list: async () => [], act: async () => [] },
      permissions: { grantFolder: async () => {
        folderGrantCalls += 1;
        return { grantId: "recipe-export-grant", displayName: "Recipe exports" };
      } },
      runtime: { versions: async () => ({ electron: "43", node: "24" }) }
    } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Recipes" }).click();
  const dialog = page.getByRole("dialog", { name: "Recipe Gallery" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => modalOwnsCanvasOverlap(page, "Recipe Gallery")).toBe(true);
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
  await expect(page.getByTestId("recipe-setup-sheet").getByRole("button", { name: "Preview" })).toBeDisabled();

  await page.getByTestId("recipe-card-prompt-to-image").click();
  await expect(page.getByTestId("recipe-capability-prompt")).toContainText("Compatible provider");
  await expect(page.getByTestId("recipe-capability-prompt")).toContainText("ether-fake-local");
  await expect(page.getByTestId("recipe-capability-prompt")).toContainText("Fallback · antigravity");
  const previewButton = page.getByTestId("recipe-setup-sheet").getByRole("button", { name: "Preview" });
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

  await page.getByRole("button", { name: "Recipes" }).click();
  await page.getByTestId("recipe-card-curate-export").click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __recipeGalleryFolderGrantCalls: () => number }).__recipeGalleryFolderGrantCalls())).toBe(0);
  await page.getByRole("button", { name: "Choose export folder" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __recipeGalleryFolderGrantCalls: () => number }).__recipeGalleryFolderGrantCalls())).toBe(1);

  await page.getByTestId("recipe-card-reference-without-artifacts").click();
  await expect(page.getByTestId("recipe-artifact-empty-referenceArtifact")).toContainText("No video artifacts are available in this document");
  await expect(page.getByTestId("recipe-setup-sheet").getByRole("button", { name: "Preview" })).toBeDisabled();

  await page.getByTestId("recipe-card-reference-guided").click();
  const artifactChoices = page.getByLabel("Reference artifact artifact choices");
  await expect(artifactChoices).toContainText("Current document reference.png · image/png");
  await expect(page.getByTestId("recipe-setup-sheet").getByRole("button", { name: "Preview" })).toBeDisabled();
  await artifactChoices.selectOption("artifact-source-1");
  await expect(page.getByTestId("recipe-setup-sheet").getByRole("button", { name: "Preview" })).toBeEnabled();
  await page.getByTestId("recipe-setup-sheet").getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("recipe-gallery-status")).toContainText("Preview ready");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __recipeGalleryCommands: Array<{ name: string; payload: { recipeId?: string; parameters?: Array<{ parameterId: string; value: unknown }> } }> }).__recipeGalleryCommands.at(-1))).toEqual(expect.objectContaining({
    name: "recipe.preview",
    payload: expect.objectContaining({ recipeId: "reference-guided", parameters: [{ parameterId: "referenceArtifact", value: ["artifact-source-1"] }] })
  }));
});

async function modalOwnsCanvasOverlap(page: Page, label: string) {
  return page.getByRole("dialog", { name: label }).evaluate((dialog) => {
    const toolbar = document.querySelector<HTMLElement>(".canvas-toolbar");
    if (toolbar === null) return true;
    const left = Math.max(dialog.getBoundingClientRect().left, toolbar.getBoundingClientRect().left);
    const top = Math.max(dialog.getBoundingClientRect().top, toolbar.getBoundingClientRect().top);
    const right = Math.min(dialog.getBoundingClientRect().right, toolbar.getBoundingClientRect().right);
    const bottom = Math.min(dialog.getBoundingClientRect().bottom, toolbar.getBoundingClientRect().bottom);
    if (left >= right || top >= bottom) return false;
    return document.elementFromPoint((left + right) / 2, (top + bottom) / 2)?.closest("[role='dialog']") === dialog;
  });
}

import { expect, test, type Page } from "@playwright/test";

test("completes the practical Review journey across a 10k embedded library", async ({ page }) => {
  await openReviewFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Review", exact: true }).click();

  const observatory = page.getByTestId("artifact-observatory");
  await expect(observatory).toBeVisible();
  await expect(observatory.getByText("10,000")).toBeVisible();
  await expect(page.getByTestId("artifact-card")).toHaveCount(35);
  expect(await page.locator(".artifact-embedded-preview").first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: "../../test-results/phase3-artifact-observatory-grid-1440x900.png", fullPage: true });
  await page.getByTestId("artifact-grid").evaluate((element) => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event("scroll")); });
  await expect(page.locator(".observatory-actionbar p")).toContainText("600 loaded");

  const search = page.getByLabel("Search artifacts");
  await search.fill("Artifact 09999");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByTestId("artifact-card")).toHaveCount(1);
  await search.fill("");
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByLabel("Approved selects").check();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect.poll(() => reviewState(page, "lastCollectionIds")).toEqual(["collection-approved"]);
  await page.getByRole("button", { name: "Clear all" }).click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();

  await page.getByRole("button", { name: "Filmstrip", exact: true }).click();
  await expect(page.locator(".filmstrip-card").first()).toBeVisible();
  expect(await page.locator(".filmstrip-card").count()).toBeLessThanOrEqual(12);
  expect(await page.locator(".filmstrip-card .artifact-embedded-preview").first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await page.getByLabel("Select Artifact 00000").check();
  await page.getByText("Artifact 00000", { exact: true }).click();
  const detail = page.getByRole("complementary", { name: "Artifact details" });
  await expect(detail.getByText("Recorded evaluation")).toBeVisible();
  await detail.getByPlaceholder("portrait, approved").fill("reviewed, hero");
  await detail.getByRole("button", { name: "Save tags" }).click();
  await expect(detail.getByPlaceholder("portrait, approved")).toHaveValue("reviewed, hero");
  await detail.getByRole("button", { name: "Close artifact details" }).click();

  await page.getByRole("button", { name: "Lineage", exact: true }).click();
  await expect(page.getByTestId("artifact-lineage").getByText("edited-from", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Collections", exact: true }).click();
  for (const collection of ["Approved selects", "Campaign set"]) {
    await page.locator(".collection-cards article").filter({ hasText: collection }).getByRole("button", { name: "Add selection" }).click();
  }
  await expect.poll(() => reviewState(page, "membershipCount")).toBe(2);

  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await page.locator("[data-testid^=compare-candidate]").first().click();
  await page.getByTestId("compare-complete").click();
  await expect.poll(() => reviewState(page, "compareCompleted")).toBe(true);

  await page.getByRole("button", { name: "Evaluate", exact: true }).click();
  await expect(page.getByText("Configured Codex instruction")).toBeVisible();
  await expect(page.getByText("Recorded provenance")).toBeVisible();
  await page.getByTestId("evaluation-preview").click();
  await expect(page.getByText("Instruction sent to Codex")).toBeVisible();
  await expect(page.getByText("Compiled: judge clarity and composition.", { exact: true })).toBeVisible();
  await page.getByTestId("evaluation-start").click();
  await expect.poll(() => reviewState(page, "evaluationStarted")).toBe(true);

  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(page.getByTestId("filter-match-mode")).toHaveText("match:all");
  const firstExplanation = page.getByTestId("filter-result-artifact-00000");
  await expect(firstExplanation).toContainText("quality gte 3; actual 0: did not match");
  await expect(firstExplanation).toContainText("Route: Hold");

  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await page.getByTestId("artifact-card").first().evaluate((element) => element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: new DataTransfer() })));
  await expect.poll(() => reviewState(page, "dragCount")).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export artifacts" });
  await exportDialog.getByRole("button", { name: "Destination" }).click();
  await exportDialog.getByRole("button", { name: "Export", exact: true }).click();
  await expect.poll(() => reviewState(page, "exported")).toBe(true);
  await expect(exportDialog.getByTestId("export-verification")).toContainText("Files written and verified");
  await expect(exportDialog.getByTestId("export-verification")).toContainText("written and verified");
  await expect(exportDialog.getByTestId("export-verification")).toContainText("Approved selects/Artifact 00000-artifact-00000.png");
  await exportDialog.getByRole("button", { name: "Done", exact: true }).click();

  await page.getByRole("button", { name: "Live Output", exact: true }).click();
  await expect(page.getByText("Disabled by default.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Choose mirror folder…" }).click();
  await page.getByRole("button", { name: "Enable Live Output" }).click();
  await expect(page.locator(".live-output-panel>header strong")).toHaveText("Enabled");
  await page.getByRole("button", { name: "Reconcile" }).click();
  await page.getByRole("button", { name: "Disable" }).click();
  await expect(page.locator(".live-output-panel>header strong")).toHaveText("Disabled");

  await page.screenshot({ path: "../../test-results/phase3-artifact-observatory-1440x900.png", fullPage: true });
});

async function reviewState(page: Page, key: string) {
  return page.evaluate((stateKey) => (window as unknown as { __reviewState: Record<string, unknown> }).__reviewState[stateKey], key);
}

async function openReviewFixture(page: Page) {
  const png = Buffer.from("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", "base64");
  await page.route("ether-asset://**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
  await page.addInitScript(() => {
    const artifacts = Array.from({ length: 10_000 }, (_, index) => ({ id: `artifact-${String(index).padStart(5, "0")}`, contentKey: `sha256-${String(index).padStart(5, "0")}`, channel: index % 3 === 0 ? "image" : "text", mediaType: index < 12 ? "image/png" : "text/plain", byteLength: 2048 + index, source: { outputVersionId: `output-${String(index).padStart(5, "0")}`, payloadId: `payload-${String(index).padStart(5, "0")}` }, createdAt: "2026-07-22T12:00:00.000Z", metadata: { title: `Artifact ${String(index).padStart(5, "0")}`, quality: index % 5 } }));
    for (const artifact of artifacts.slice(0, 12)) {
      const metadata = artifact.metadata as Record<string, unknown>;
      metadata.thumbnailContentKey = "a".repeat(64);
      metadata.thumbnailByteLength = 4_096;
      metadata.thumbnailMediaType = "image/png";
    }
    const collections = [{ id: "collection-approved", title: "Approved selects", description: "Final choices", primary: true, createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z" }, { id: "collection-campaign", title: "Campaign set", description: "Campaign delivery", primary: false, createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z" }];
    const memberships: Record<string, Array<{ collectionId: string; artifactId: string; role: string; position: number; createdAt: string }>> = { "collection-approved": [], "collection-campaign": [] };
    const state: Record<string, unknown> = { lastCollectionIds: [], membershipCount: 0, compareCompleted: false, evaluationStarted: false, dragCount: 0, exported: false };
    (window as unknown as { __reviewState: Record<string, unknown> }).__reviewState = state;
    const reviewNodes = [{ id: "evaluate-1", title: "Evaluate", definitionId: "review.evaluate", position: { x: 0, y: 0 }, size: { width: 260, height: 180 }, presentation: { collapsed: false, color: null }, config: { kind: "review.evaluate", instruction: "Judge clarity and composition.", rubric: [{ id: "composition", label: "Composition", weight: 1 }], profile: "reviewer", model: "gpt-5", reasoningEffort: "high" } }, { id: "filter-1", title: "Filter", definitionId: "review.filter", position: { x: 300, y: 0 }, size: { width: 260, height: 180 }, presentation: { collapsed: false, color: null }, config: { kind: "review.filter", match: "all", rules: [{ id: "quality-rule", field: "quality", operator: "gte", value: 3 }], routes: [{ id: "approved", label: "Approved", outcome: "matched" }, { id: "hold", label: "Hold", outcome: "unmatched" }] } }];
    const graph = { id: "graph-root", title: "Review fixture", kind: "root", createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z", nodes: reviewNodes, edges: [], groups: [], modules: [], viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null } };
    let liveEnabled = false; let tags = ["review"];
    const snapshot = () => ({ documentId: "review-document", displayName: "Review fixture", named: true, mode: "writable", readOnlyReason: null, commands: { save: true, saveAs: true, saveCopy: true, compact: true, makePortable: true }, saveState: "saved", documentRevisionId: "revision-1", graphId: "graph-root", graphRevisionId: "graph-revision-1", simulationEnabled: false, revision: 1 });
    Object.defineProperty(window, "ether", { value: {
      document: { onEvent: () => () => undefined, bootstrap: async () => snapshot(), new: async () => snapshot(), open: async () => snapshot(), openDropped: async () => snapshot(), save: async () => snapshot(), saveAs: async () => snapshot(), saveCopy: async () => snapshot(), close: async () => null, compact: async () => ({ beforeBytes: 10, afterBytes: 9 }), makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] }) },
      graph: { snapshot: async () => ({ graph, revision: 1 }), applyTransaction: async () => ({ graph, revision: 1 }) },
      artifacts: { search: async () => [], generateFake: async () => [], startDrag: async () => { state.dragCount = Number(state.dragCount) + 1; return null; } }, references: { list: async () => [], act: async () => [] }, permissions: { grantFolder: async (_id: string, purpose: string) => ({ grantId: `grant-${purpose}`, displayName: purpose === "export" ? "Review Exports" : "Review Mirror" }) }, runtime: { versions: async () => ({ electron: "43", node: "24" }) },
      application: { onEvent: () => () => undefined,
        query: async (query: { name: string; payload: Record<string, unknown> }) => {
          if (query.name === "artifact.search") { state.lastCollectionIds = query.payload.collectionIds; const text = String(query.payload.text ?? "").toLowerCase(); let matches = text ? artifacts.filter((artifact) => String(artifact.metadata.title).toLowerCase().includes(text)) : artifacts; if ((query.payload.collectionIds as string[]).length) matches = matches.filter((_, index) => index % 2 === 0); const offset = query.payload.cursor ? Number(query.payload.cursor) : 0; const result = matches.slice(offset, offset + 300); return { name: query.name, payload: { artifacts: result, total: matches.length, nextCursor: offset + result.length < matches.length ? String(offset + result.length) : null } }; }
          if (query.name === "artifact.detail") { const artifact = artifacts.find((item) => item.id === query.payload.artifactId) ?? artifacts[0]; return { name: query.name, payload: { artifact, outputVersion: { id: artifact.source.outputVersionId }, sourcePayload: { id: artifact.source.payloadId }, collections: [], lineage: [], tags, ratings: [], evaluation: { summary: "Recorded evaluation", providerId: "codex", modelId: "gpt-5", reasoningEffort: "high", schemaId: "review-v1", instruction: "Judge clarity", rubric: [] } } }; }
          if (query.name === "artifact.lineage") return { name: query.name, payload: { lineage: [{ id: "edge-1", parentArtifactId: "artifact-00000", childArtifactId: "artifact-00001", relation: "edited-from", role: "general", createdAt: "2026-07-22T00:00:00.000Z" }] } };
          if (query.name === "collection.list") return { name: query.name, payload: { collections } };
          if (query.name === "collection.membership") return { name: query.name, payload: { memberships: memberships[String(query.payload.collectionId)] } };
          if (query.name === "review.checkpoints") return { name: query.name, payload: { checkpoints: [{ id: "checkpoint-1", planId: "plan-1", stepId: "step-1", workItemId: null, state: "waiting-review", selectedOutputVersionIds: [], completion: null, createdAt: "2026-07-22T00:00:00.000Z", completedAt: null }], nextCursor: null } };
          if (query.name === "graph.catalog") return { name: query.name, payload: { graphs: [{ id: "graph-root", title: "Review fixture", kind: "root" }] } };
          if (query.name === "graph.snapshot") return { name: query.name, payload: { graph, documentRevisionId: "revision-1", graphRevisionId: "graph-revision-1" } };
          if (query.name === "liveOutput.status") return { name: query.name, payload: { settings: { enabled: liveEnabled, pathGrantId: liveEnabled ? "grant-live-output" : null, namingPolicy: { kind: "artifact", template: null }, collisionPolicy: "rename", transferPolicy: "copy", lastReconciledAt: null } } };
          return { name: query.name, payload: {} };
        },
        command: async (command: { name: string; payload: Record<string, unknown> }) => { if (command.name === "review.tag") tags = command.payload.tags as string[]; if (command.name === "collection.addMembers") { const collectionId = String(command.payload.collectionId); memberships[collectionId].push(...(command.payload.members as typeof memberships[string])); state.membershipCount = Object.values(memberships).reduce((sum, items) => sum + items.length, 0); } if (command.name === "review.completeCompare") state.compareCompleted = true; if (command.name === "run.preview") return { name: command.name, payload: { plan: { id: "plan-evaluate", contentHash: "hash-evaluate-123456789", estimatedCalls: 1, workItems: [{}], warnings: [], steps: [{ nodeId: "evaluate-1", executor: "codex-evaluation", compiledPrompt: "Compiled: judge clarity and composition." }] } } }; if (command.name === "permission.grantRun") return { name: command.name, payload: { permitId: "permit-1" } }; if (command.name === "run.start") { state.evaluationStarted = true; return { name: command.name, payload: { job: { id: "job-1" } } }; } if (command.name === "artifact.export") state.exported = true; if (command.name === "liveOutput.enable") liveEnabled = true; if (command.name === "liveOutput.disable") liveEnabled = false; return { name: command.name, payload: command.name === "artifact.export" ? { records: [{ id: "export-1", artifactId: "artifact-00000", pathGrantId: "grant-export", relativePath: "Approved selects/Artifact 00000-artifact-00000.png", contentKey: "sha256-00000", status: "committed", createdAt: "2026-07-22T00:00:00.000Z", completedAt: "2026-07-22T00:00:01.000Z" }] } : command.name === "liveOutput.enable" ? { operationId: "operation-1", enabled: true } : {} }; }
      }
    } });
  });
  await page.goto("/");
  await expect(page.getByTestId("document-canvas")).toBeVisible();
}

import { expect, test } from "@playwright/test";

test("Ctrl+S routes to the document bridge, records a visible manual milestone, and recovery remains reviewable", async ({ page }) => {
  await page.addInitScript(() => {
    const graph = {
      id: "history-graph", title: "History canvas", kind: "root", createdAt: "2026-08-02T10:00:00.000Z", updatedAt: "2026-08-02T10:00:00.000Z",
      nodes: [], edges: [], groups: [], modules: [],
      viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
    };
    const descriptor = {
      documentId: "history-document", displayName: "History.ether", named: true, mode: "writable", readOnlyReason: null,
      commands: { save: true, saveAs: true, saveCopy: true, compact: true, makePortable: true }, saveState: "saved",
      documentRevisionId: "revision-recovery", graphId: graph.id, graphRevisionId: "graph-revision-1", simulationEnabled: false, revision: 2
    };
    let saved = false;
    let saves = 0;
    Object.defineProperty(window, "ether", { value: {
      document: {
        onEvent: () => () => undefined, bootstrap: async () => descriptor, new: async () => descriptor, open: async () => descriptor,
        openDropped: async () => descriptor, save: async () => { saved = true; saves += 1; return descriptor; }, saveAs: async () => descriptor, saveCopy: async () => descriptor,
        compact: async () => ({ beforeBytes: 1, afterBytes: 1 }), makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] }), close: async () => null
      },
      graph: { snapshot: async () => ({ graph, revision: 2 }), applyTransaction: async () => ({ graph, revision: 2 }) },
      application: {
        onEvent: () => () => undefined,
        query: async (query: { name: string }) => {
          if (query.name === "document.history") return { payload: {
            recovery: { state: "healthy", reportId: null, message: null },
            revisions: [
              { id: "revision-recovery", kind: "recovery", title: "Recovered artifact — review required", createdAt: "2026-08-02T10:03:00.000Z", isHead: true, milestones: [], recovery: { id: "recovery-1", reviewRequired: true, state: "recovered" } },
              { id: "revision-1", kind: "edit", title: "Add prompt", createdAt: "2026-08-02T10:01:00.000Z", isHead: false, milestones: saved ? [{ id: "milestone-manual", kind: "manual", name: "Manual save", createdAt: "2026-08-02T10:02:00.000Z" }] : [], recovery: null }
            ]
          } };
          return { payload: { graph, documentRevisionId: descriptor.documentRevisionId, graphRevisionId: descriptor.graphRevisionId } };
        },
        command: async () => ({ payload: { kind: "acknowledgement", accepted: true } })
      },
      artifacts: { search: async () => [], generateFake: async () => [] }, references: { list: async () => [], act: async () => [] },
      runtime: { versions: async () => ({ app: "4.0.0", electron: "43", node: "24" }) },
      __historyTest: { saves: () => saves }
    } });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Document History" })).toBeVisible();
  await page.keyboard.press("Control+S");
  await expect.poll(() => page.evaluate(() => (window as unknown as { ether: { __historyTest: { saves(): number } } }).ether.__historyTest.saves())).toBe(1);
  await page.getByRole("button", { name: "Document History" }).click();

  const dialog = page.getByRole("dialog", { name: "Document History" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Manual milestone: Manual save")).toBeVisible();
  await expect(dialog.getByText("Recovered artifact — review required")).toBeVisible();
  await expect(dialog.getByText("Recovered · review required")).toBeVisible();
  await expect(dialog.getByText("Current head")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Document History" })).toBeFocused();
});

test("repair review groups media and graph losses into distinct UI sections", async ({ page }) => {
  await page.addInitScript(() => {
    const graph = {
      id: "repair-graph", title: "Repair canvas", kind: "root", createdAt: "2026-08-02T10:00:00.000Z", updatedAt: "2026-08-02T10:00:00.000Z",
      nodes: [], edges: [], groups: [], modules: [],
      viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
    };
    const descriptor = {
      documentId: "repair-document", displayName: "Repair.ether", named: true, mode: "writable", readOnlyReason: null,
      commands: { save: true, saveAs: true, saveCopy: true, compact: true, makePortable: true }, saveState: "saved",
      documentRevisionId: "repair-revision", graphId: graph.id, graphRevisionId: "repair-graph-revision", simulationEnabled: false, revision: 1
    };
    const report = {
      losses: [
        { entityId: "blob-1", type: "blob", reason: "Embedded media chunk blob-1 could not be recovered." },
        { entityId: "edge-1", type: "graph", reason: "Graph edge edge-1 was omitted because its source is invalid." }
      ],
      recovered: { artifacts: 0, blobs: 0, graphs: 1, references: 0 },
      statement: "logical-row-repair-only"
    };
    Object.defineProperty(window, "ether", { value: {
      document: {
        onEvent: () => () => undefined, bootstrap: async () => descriptor, new: async () => descriptor, open: async () => descriptor,
        openDropped: async () => descriptor, save: async () => descriptor, saveAs: async () => descriptor, saveCopy: async () => descriptor,
        compact: async () => ({ beforeBytes: 1, afterBytes: 1 }), makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] }),
        close: async () => null, repair: async () => ({ kind: "needs-confirmation", confirmationId: "repair-confirmation", report }), cancelRepair: async () => undefined
      },
      graph: { snapshot: async () => ({ graph, revision: 1 }), applyTransaction: async () => ({ graph, revision: 1 }) },
      application: { onEvent: () => () => undefined, query: async () => ({ payload: { graph, documentRevisionId: descriptor.documentRevisionId, graphRevisionId: descriptor.graphRevisionId } }), command: async () => ({ payload: { kind: "acknowledgement", accepted: true } }) },
      artifacts: { search: async () => [], generateFake: async () => [] }, references: { list: async () => [], act: async () => [] },
      runtime: { versions: async () => ({ app: "4.0.0", electron: "43", node: "24" }) }
    } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Repair damaged document" }).click();
  const dialog = page.getByRole("dialog", { name: "Review repair losses" });
  await expect(dialog).toBeVisible();
  const media = dialog.locator('[aria-label="Media and artifact losses"]');
  const graph = dialog.locator('[aria-label="Graph losses"]');
  await expect(media.getByRole("heading", { name: "Media and artifact losses" })).toBeVisible();
  await expect(graph.getByRole("heading", { name: "Graph losses" })).toBeVisible();
  await expect(media.locator("li")).toHaveCount(1);
  await expect(media).toContainText("Embedded media chunk blob-1");
  await expect(graph.locator("li")).toHaveCount(1);
  await expect(graph).toContainText("Graph edge edge-1");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

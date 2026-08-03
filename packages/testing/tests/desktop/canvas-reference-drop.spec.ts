import { expect, test } from "@playwright/test";

test("drops an ordinary file into a Reference Set and leaves .ether opening to the shell", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const now = "2026-08-03T00:00:00.000Z";
    let graph = {
      id: "drop-graph", title: "Drop canvas", kind: "root", createdAt: now, updatedAt: now,
      nodes: [] as Array<Record<string, unknown>>, edges: [], groups: [], modules: [],
      viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
    };
    const catalog = [{
      definitionId: "reference.set", family: "reference", title: "Reference Set", description: "Collect reusable source material.",
      example: "Moodboard references", synonyms: ["reference", "assets"], inputChannels: ["image", "data"], outputChannels: ["image", "data"],
      defaultConfig: { kind: "reference.set", members: [], enabledChannels: ["image"], ordering: "manual" },
      inspector: { sections: [{ id: "main", title: "Reference Set", fields: ["members", "enabledChannels", "ordering"] }] }, executor: "non-runnable",
      presentation: { width: 250, height: 150, previewMode: "summary" }, setupRequirement: "none"
    }];
    const state = { imports: [] as Array<{ name: string; nodeId: string }>, opened: 0, commands: [] as Array<Record<string, unknown>> };
    Object.defineProperty(window, "__referenceDrop", { value: state });
    const descriptor = () => ({ documentId: "drop-document", displayName: "Drop canvas", named: false, mode: "writable", readOnlyReason: null,
      commands: { save: true, saveAs: true, saveCopy: true, compact: true, makePortable: true }, saveState: "saved",
      documentRevisionId: "document-revision-1", graphId: graph.id, graphRevisionId: "graph-revision-1", simulationEnabled: false, revision: 1 });
    Object.defineProperty(window, "ether", { value: {
      document: {
        onEvent: () => () => undefined, bootstrap: async () => descriptor(), new: async () => descriptor(), open: async () => descriptor(),
        openDropped: async () => { state.opened += 1; return descriptor(); }, save: async () => descriptor(), saveAs: async () => descriptor(), saveCopy: async () => descriptor(),
        compact: async () => ({ beforeBytes: 1, afterBytes: 1 }), makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] }), close: async () => null
      },
      graph: { snapshot: async () => ({ graph, revision: 1 }), applyTransaction: async () => ({ graph, revision: 1 }) },
      references: {
        list: async () => [], act: async () => [],
        importDropped: async (file: File, input: { nodeId: string }) => { state.imports.push({ name: file.name, nodeId: input.nodeId }); return { cancelled: false, referenceId: `ref-${file.name}` }; },
        chooseAndLink: async () => ({ cancelled: true, referenceId: "" })
      },
      application: {
        onEvent: () => () => undefined,
        query: async (query: { name: string; payload?: { graphId?: string } }) => {
          if (query.name === "node.catalog") return { name: query.name, payload: { nodes: catalog } };
          if (query.name === "job.list") return { name: query.name, payload: { jobs: [] } };
          return { name: "graph.snapshot", payload: { graph, documentRevisionId: "document-revision-1", graphRevisionId: "graph-revision-1" } };
        },
        command: async (command: { name: string; payload?: { transaction?: { operations?: Array<{ type: string; node?: Record<string, unknown> }> } } }) => {
          state.commands.push(command);
          for (const operation of command.payload?.transaction?.operations ?? []) {
            if (operation.type === "addNode" && operation.node) graph = { ...graph, nodes: [...graph.nodes, operation.node] };
          }
          return { name: command.name, payload: { documentRevisionId: "document-revision-2", graphRevisions: [{ graphId: graph.id, revisionId: "graph-revision-2" }] } };
        }
      },
      artifacts: { search: async () => [], generateFake: async () => [] }, runtime: { versions: async () => ({ electron: "43", node: "24" }) }
    } });
  });

  await page.goto("/");
  const surface = page.getByTestId("ether-canvas-surface");
  await expect(surface).toBeVisible();
  await expect(surface).toHaveAttribute("data-graph-node-count", "0");
  await surface.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["image"], "moodboard.png", { type: "image/png" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: 420, clientY: 300, dataTransfer: transfer }));
  });
  await expect(surface).toHaveAttribute("data-graph-node-count", "1");
  await expect.poll(() => page.locator(".react-flow__node").count()).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __referenceDrop: { imports: unknown[] } }).__referenceDrop.imports.length)).toBe(1);
  const importState = await page.evaluate(() => (window as typeof window & { __referenceDrop: { imports: Array<{ name: string; nodeId: string }> } }).__referenceDrop.imports[0]);
  expect(importState.name).toBe("moodboard.png");
  expect(importState.nodeId).toMatch(/^[0-9a-f-]{36}$/);

  await surface.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["ether"], "saved.ether", { type: "application/octet-stream" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __referenceDrop: { opened: number } }).__referenceDrop.opened)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __referenceDrop: { imports: unknown[] } }).__referenceDrop.imports.length)).toBe(1);
});

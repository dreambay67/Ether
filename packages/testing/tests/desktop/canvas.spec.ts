import { expect, test } from "@playwright/test";

test("projects the typed graph into a nonblank canvas and sends role edits through graph transactions", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    let graph = {
      id: "graph-root", title: "Canvas fixture", kind: "root", createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z",
      nodes: [
        { id: "prompt", definitionId: "prompt.text", title: "Direction", position: { x: 100, y: 120 }, size: { width: 250, height: 150 }, config: { kind: "prompt.text", body: "Soft morning still life", assembly: "append" }, presentation: { collapsed: false, accent: "default", previewMode: "content" } },
        { id: "image", definitionId: "generation.image", title: "Image", position: { x: 480, y: 170 }, size: { width: 250, height: 150 }, config: { kind: "generation.image", providerId: "ether-fake-local", profileId: "default", aspectRatio: "1:1", resolution: { width: 512, height: 512 }, outputCount: 1 }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } }
      ], edges: [{ id: "lane", from: { kind: "node", nodeId: "prompt", channel: "data" }, to: { kind: "node", nodeId: "image", channel: "text" }, role: "general", order: 0, selector: { kind: "latest-approved" }, adapter: { kind: "auto" }, enabled: true }], groups: [{ id: "group-1", title: "Campaign", nodeIds: ["prompt", "image"], position: { x: 60, y: 70 }, size: { width: 720, height: 300 }, color: "#a889ff" }], modules: [{ id: "module-1", title: "Polish module", description: "Refines the selected direction", accent: "#37e6ea", locked: true, graphId: "graph-child", position: { x: 840, y: 140 }, size: { width: 260, height: 160 }, interface: { inputs: [{ id: "input-1", name: "Direction", channel: "text", internalNodeId: "child-prompt", internalChannel: "text", required: false }], outputs: [{ id: "output-1", name: "Result", channel: "text", internalNodeId: "child-prompt", internalChannel: "text", required: false }], parameters: [] }, collapsed: false }], viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
    };
    let childGraph = { id: "graph-child", title: "Module interior", kind: "module", createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z", nodes: [{ id: "child-prompt", definitionId: "prompt.text", title: "Polish", position: { x: 120, y: 120 }, size: { width: 250, height: 150 }, config: { kind: "prompt.text", body: "Refine the selected direction", assembly: "append" }, presentation: { collapsed: false, accent: "default", previewMode: "content" } }], edges: [], groups: [], modules: [], viewState: { viewport: { x: 12, y: 18, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null } };
    const catalog = [
      { definitionId: "prompt.text", family: "prompt", title: "Prompt", description: "Write reusable text instructions.", example: "Describe a quiet studio portrait.", synonyms: ["instruction", "text"], inputChannels: [], outputChannels: ["text"], defaultConfig: { kind: "prompt.text", body: "", assembly: "append" }, inspector: { sections: [{ id: "main", title: "Prompt", fields: ["body", "assembly"] }] }, executor: "deterministic-assembly", presentation: { width: 250, height: 150, previewMode: "content" }, setupRequirement: "none" },
      { definitionId: "generation.image", family: "generation", title: "Image Generator", description: "Generate images from text direction.", example: "Create three lighting variations.", synonyms: ["image", "render"], inputChannels: ["text", "image", "data"], outputChannels: ["image", "data"], defaultConfig: { kind: "generation.image", providerId: "ether-fake-local", profileId: "default", aspectRatio: "1:1", resolution: { width: 512, height: 512 }, outputCount: 1 }, inspector: { sections: [{ id: "main", title: "Image Generator", fields: ["providerId", "profileId"] }] }, executor: "image-provider", presentation: { width: 250, height: 150, previewMode: "summary" }, setupRequirement: "provider-capability" }
    ];
    let revision = 1; const graphRevisions: Record<string, string> = { "graph-root": "graph-revision-1", "graph-child": "child-revision-1" };
    const descriptor = () => ({ documentId: "canvas-document", displayName: "Canvas", named: true, mode: "writable", readOnlyReason: null, commands: { save: true, saveAs: true, saveCopy: true, compact: true, makePortable: true }, saveState: "saved", documentRevisionId: "revision-1", graphId: "graph-root", graphRevisionId: "graph-revision-1", simulationEnabled: false, revision: 1 });
    const update = (operations: Array<Record<string, unknown>>) => { for (const operation of operations) { const root = operation.graphId === "graph-root"; if (operation.type === "addEdge" && root) graph = { ...graph, edges: [...graph.edges, operation.edge as typeof graph.edges[number]] }; if (operation.type === "updateEdge" && root) graph = { ...graph, edges: graph.edges.map((edge) => edge.id === operation.edgeId ? operation.edge as typeof edge : edge) }; if (operation.type === "removeEdge" && root) graph = { ...graph, edges: graph.edges.filter((edge) => edge.id !== operation.edgeId) }; if (operation.type === "addNode" && root) graph = { ...graph, nodes: [...graph.nodes, operation.node as typeof graph.nodes[number]] }; if (operation.type === "removeNode" && root) graph = { ...graph, nodes: graph.nodes.filter((node) => node.id !== operation.nodeId) }; if (operation.type === "updateGraphProperties") { if (root) graph = { ...graph, viewState: operation.viewState as typeof graph.viewState }; else childGraph = { ...childGraph, viewState: operation.viewState as typeof childGraph.viewState }; } if (operation.type === "updateGroup" && root) graph = { ...graph, groups: graph.groups.map((group) => group.id === operation.groupId ? operation.group as typeof group : group) }; if (operation.type === "removeGroup" && root) graph = { ...graph, groups: graph.groups.filter((group) => group.id !== operation.groupId) }; if (operation.type === "moveNodes") { const positions = operation.positions as Array<{ nodeId: string; position: { x: number; y: number } }>; if (root) graph = { ...graph, nodes: graph.nodes.map((node) => ({ ...node, position: positions.find((item) => item.nodeId === node.id)?.position ?? node.position })) }; else childGraph = { ...childGraph, nodes: childGraph.nodes.map((node) => ({ ...node, position: positions.find((item) => item.nodeId === node.id)?.position ?? node.position })) }; } if (operation.type === "updateModule" && root) graph = { ...graph, modules: graph.modules.map((module) => module.id === operation.moduleId ? operation.module as typeof module : module) }; if (operation.type === "updateModuleInterface" && root) graph = { ...graph, modules: graph.modules.map((module) => module.id === operation.moduleId ? { ...module, interface: operation.interface as typeof module.interface } : module) }; } };
    Object.defineProperty(window, "__canvasTransactions", { value: [] });
    Object.defineProperty(window, "ether", { value: { document: { onEvent: () => () => undefined, bootstrap: async () => descriptor(), new: async () => descriptor(), open: async () => descriptor(), openDropped: async () => descriptor(), save: async () => descriptor(), saveAs: async () => descriptor(), saveCopy: async () => descriptor(), compact: async () => ({ beforeBytes: 1, afterBytes: 1 }), makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] }), close: async () => null }, graph: { snapshot: async () => ({ graph, revision: 1 }), applyTransaction: async () => ({ graph, revision: 1 }) }, application: { onEvent: () => () => undefined, command: async (command: { name: string; payload?: { transaction?: { baseGraphRevisions: Record<string, string>; operations: Array<Record<string, unknown>> } } }) => { const transaction = command.payload?.transaction; if (transaction) { for (const [graphId, base] of Object.entries(transaction.baseGraphRevisions)) if (graphRevisions[graphId] !== base) throw new Error("stale graph revision"); update(transaction.operations); revision += 1; for (const graphId of Object.keys(transaction.baseGraphRevisions)) graphRevisions[graphId] = `${graphId}-revision-${revision}`; } (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.push(command); if (command.name === "run.preview") return { payload: { plan: { id: "selected-plan", contentHash: `sha256:v1:${"a".repeat(64)}`, estimatedCalls: 1 } } }; if (command.name === "permission.grantRun") return { payload: { permitId: "selected-permit" } }; if (command.name === "run.start") return { payload: { job: { id: "selected-job" } } }; return { payload: { kind: "revision", documentRevisionId: `revision-${revision}`, graphRevisions: Object.entries(graphRevisions).map(([graphId, revisionId]) => ({ graphId, revisionId })) } }; }, query: async (query: { name: string; payload: { graphId?: string } }) => query.name === "node.catalog" ? { name: "node.catalog", payload: { nodes: catalog } } : ({ name: query.name, payload: { graph: query.payload.graphId === "graph-child" ? childGraph : graph, documentRevisionId: `revision-${revision}`, graphRevisionId: graphRevisions[query.payload.graphId ?? "graph-root"] } }) }, artifacts: { search: async () => [], generateFake: async () => [] }, references: { list: async () => [], act: async () => [] }, runtime: { versions: async () => ({ electron: "43", node: "24" }) } } });
  });
  await page.goto("/");
  await expect(page.getByTestId("ether-canvas-surface")).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog", { name: "Canvas command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  const firstLibraryCopy = page.locator(".node-library-item-copy").first();
  await expect(firstLibraryCopy.getByText("Prompt", { exact: true })).toBeVisible();
  await expect.poll(async () => (await firstLibraryCopy.boundingBox())?.width ?? 0).toBeGreaterThan(80);
  await expect(page.locator(".ether-node")).toHaveCount(2);
  await expect(page.locator(".react-flow__node-group")).toHaveCount(0);
  await expect(page.getByLabel("Legacy group repair preview")).toContainText("Campaign");
  const promptNode = page.locator('[data-testid="rf__node-prompt"]');
  const imageNode = page.locator('[data-testid="rf__node-image"]');
  const promptBox = await promptNode.boundingBox();
  const imageBox = await imageNode.boundingBox();
  expect(promptBox).not.toBeNull();
  expect(imageBox).not.toBeNull();
  const marqueeStart = { x: Math.min(promptBox!.x, imageBox!.x) - 18, y: Math.min(promptBox!.y, imageBox!.y) - 18 };
  const marqueeEnd = { x: Math.max(promptBox!.x + promptBox!.width, imageBox!.x + imageBox!.width) + 18, y: Math.max(promptBox!.y + promptBox!.height, imageBox!.y + imageBox!.height) + 18 };
  await page.mouse.move(marqueeStart.x, marqueeStart.y);
  await page.mouse.down();
  await page.mouse.move(marqueeEnd.x, marqueeEnd.y, { steps: 8 });
  await page.mouse.up();
  expect(pageErrors).toEqual([]);
  await expect(promptNode.locator(".ether-node")).toHaveClass(/is-selected/);
  await expect(imageNode.locator(".ether-node")).toHaveClass(/is-selected/);
  await promptNode.locator(".ether-node-title").click();
  await expect(promptNode.locator(".ether-node")).toHaveClass(/is-selected/);
  await expect(imageNode.locator(".ether-node")).not.toHaveClass(/is-selected/);
  await page.locator(".react-flow__pane").click({ position: { x: 12, y: 12 } });
  const addWithRealMouse = async (definitionId: string) => {
    const button = page.locator(`.node-library-item[data-node-definition='${definitionId}'] .node-library-add`);
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    if (box === null) throw new Error(`Node Library button ${definitionId} has no pointer target.`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  await addWithRealMouse("prompt.text");
  await expect(page.locator(".ether-node")).toHaveCount(3);
  await addWithRealMouse("generation.image");
  await expect(page.locator(".ether-node")).toHaveCount(4);
  await expect(page.getByTestId("channel-zone-output-data").first()).toHaveAttribute("data-connected", "true");
  await page.locator(".ether-edge-hit-target").dispatchEvent("click", { bubbles: true });
  const edgeInspector = page.getByTestId("edge-inspector");
  await expect(edgeInspector).toContainText("Adapter · local.data-to-text");
  await expect(edgeInspector).toContainText("Receiver field");
  await expect(edgeInspector.locator("details", { hasText: "Connection diagnostics" })).not.toHaveAttribute("open", "");
  await edgeInspector.getByLabel("Output selection", { exact: true }).selectOption("latest");
  await page.getByRole("button", { name: "Target channel Text" }).click();
  const targetPicker = page.getByTestId("edge-channel-picker-target");
  await expect(targetPicker).toBeVisible();
  await expect(targetPicker.getByRole("button", { name: "Image" })).toBeDisabled();
  await targetPicker.getByRole("button", { name: "Data" }).click();
  await expect(page.getByRole("button", { name: "Target channel Data" })).toBeVisible();
  await page.getByTestId("edge-role-chip").getByRole("button", { name: "General" }).click();
  await page.getByTestId("edge-role-grid").getByRole("button", { name: "Subject" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.length)).toBe(5);
  await page.getByRole("button", { name: "Add Prompt", exact: true }).click();
  await expect(page.locator(".ether-node")).toHaveCount(5);
  await promptNode.locator(".ether-node-title").click();
  await page.getByRole("button", { name: "Target channel Data" }).click({ button: "right" });
  await expect(page.getByTestId("edge-role-chip")).toHaveCount(0);
  await expect(promptNode.locator(".ether-node")).toHaveClass(/is-selected/);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.length)).toBe(7);

  const authoredPrompt = page.locator(".ether-node[data-node-definition='prompt.text']").nth(1);
  const authoredImage = page.locator(".ether-node[data-node-definition='generation.image']").nth(1);
  for (const panel of ["Reference Desk", "Build tools", "Project lens"]) {
    await page.getByRole("button", { name: `Hide ${panel}`, exact: true }).click();
  }
  await authoredPrompt.getByLabel("Text output").hover();
  await authoredPrompt.getByLabel("Text output").click();
  await expect(authoredImage.getByTestId("channel-zone-input-text")).toHaveAttribute("data-compatible", "true");
  await authoredImage.getByLabel("Text input").click();
  await expect(page.getByTestId("edge-role-chip")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.length)).toBe(8);
  for (const panel of ["Reference Desk", "Build tools", "Project lens"]) {
    await page.getByRole("button", { name: `Show ${panel}`, exact: true }).click();
  }

  await expect(page.getByLabel("Output output-1 text")).toBeVisible();
  const moduleCard = page.getByTestId("ether-module-node");
  await expect(moduleCard).toHaveAttribute("data-module-locked", "true");
  await moduleCard.locator(".ether-module-title").click();
  await expect(page.getByTestId("module-inspector")).toContainText("Locked module");
  await page.getByTestId("module-inspector").getByRole("button", { name: "Unlock module" }).click();
  await expect(moduleCard).toHaveAttribute("data-module-locked", "false");
  await page.getByLabel("Module title").fill("Polish pipeline");
  await page.getByTestId("module-inspector").getByRole("button", { name: "Save details" }).click();
  await expect(moduleCard).toContainText("Polish pipeline");
  await moduleCard.locator(".ether-module-title").click();
  await page.getByTestId("ether-canvas-surface").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("canvas-status")).toContainText("Entered Polish pipeline");
  await expect(page.getByLabel("Canvas legend").getByText("Module interior")).toBeVisible();
  await expect(page.locator(".ether-node")).toHaveCount(1);
  const childPrompt = page.locator('[data-testid="rf__node-child-prompt"]');
  await childPrompt.locator(".ether-node-main p").click();
  await page.getByRole("button", { name: "Expose selected parameter" }).click();
  await page.getByRole("button", { name: "Leave module" }).click();
  await expect(page.getByLabel("Canvas legend").getByText("Canvas fixture")).toBeVisible();
  await expect(page.getByTestId("ether-module-node")).toHaveClass(/is-selected/);
  await expect(page.getByLabel("Module title")).toHaveValue("Polish pipeline");
  await page.getByTestId("module-inspector").getByRole("button", { name: "Collapse" }).click();
  await expect(page.getByTestId("ether-module-node")).toContainText("Collapsed");
  await expect(page.getByTestId("ether-module-node").getByRole("button", { name: "Expand" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.length)).toBe(14);

  const rootImage = page.locator('[data-testid="rf__node-image"]');
  await page.locator(".react-flow__node-etherNode").nth(2).locator(".ether-node-main p").click();
  await rootImage.locator(".ether-node-main p").click({ modifiers: ["Control"] });
  await expect(page.getByLabel("Selected run prompt")).toContainText("2 nodes selected");
  await page.getByLabel("Selected run prompt").getByRole("button", { name: "Preview selected run" }).click();
  await expect(page.getByTestId("canvas-status")).toContainText("Selected plan ready");
  await page.getByLabel("Selected run prompt").getByRole("button", { name: "Start 1 call" }).click();
  await expect(page.getByTestId("canvas-status")).toContainText("Selected run started: selected-job");
  await page.getByRole("button", { name: "Undo graph transaction" }).click(); await page.getByRole("button", { name: "Redo graph transaction" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.length)).toBe(19);
  const duplicateSelection = page.getByRole("button", { name: "Duplicate", exact: true });
  await expect(duplicateSelection).toBeEnabled();
  await duplicateSelection.click();
  await expect(page.locator(".ether-node")).toHaveCount(7);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.length)).toBe(20);
});

test("keeps node creation disabled while a new document with the same graph id hydrates", async ({ page }) => {
  await page.addInitScript(() => {
    const timestamp = "2026-08-03T00:00:00.000Z";
    const blankGraph = () => ({
      id: "graph-root", title: "Canvas", kind: "root", createdAt: timestamp, updatedAt: timestamp,
      nodes: [] as unknown[], edges: [], groups: [], modules: [],
      viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
    });
    const catalog = [{
      definitionId: "prompt.text", family: "prompt", title: "Prompt", description: "Write reusable text instructions.",
      example: "Describe a quiet studio portrait.", synonyms: ["instruction", "text"], inputChannels: [], outputChannels: ["text"],
      defaultConfig: { kind: "prompt.text", body: "", assembly: "append" },
      inspector: { sections: [{ id: "main", title: "Prompt", fields: ["body", "assembly"] }] }, executor: "deterministic-assembly",
      presentation: { width: 250, height: 150, previewMode: "content" }, setupRequirement: "none"
    }];
    const descriptor = (documentId: string, revision: number) => ({
      documentId, displayName: documentId, named: false, mode: "writable", readOnlyReason: null,
      commands: { save: true, saveAs: true, saveCopy: true, compact: true, makePortable: true }, saveState: "saved",
      documentRevisionId: `document-revision-${documentId}`, graphId: "graph-root", graphRevisionId: `graph-revision-${documentId}`,
      simulationEnabled: false, revision
    });
    const first = descriptor("document-a", 1);
    const second = descriptor("document-b", 2);
    let active = first;
    let graph = blankGraph();
    let documentListener: ((event: unknown) => void) | undefined;
    let resolveSecondSnapshot: (() => void) | undefined;
    const secondSnapshotReady = new Promise<void>((resolve) => { resolveSecondSnapshot = resolve; });
    const transactions: Array<Record<string, unknown>> = [];
    Object.defineProperty(window, "__hydrationRace", {
      value: { transactions, resolveSecondSnapshot: () => resolveSecondSnapshot?.() }
    });
    Object.defineProperty(window, "ether", { value: {
      document: {
        onEvent: (listener: (event: unknown) => void) => { documentListener = listener; return () => { documentListener = undefined; }; },
        bootstrap: async () => first,
        new: async () => {
          active = second;
          graph = blankGraph();
          documentListener?.({ kind: "snapshot", documentId: second.documentId, revision: second.revision, snapshot: second });
          return second;
        },
        open: async () => active, openDropped: async () => active, save: async () => active, saveAs: async () => active,
        saveCopy: async () => active, compact: async () => ({ beforeBytes: 1, afterBytes: 1 }),
        makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] }),
        close: async () => null
      },
      graph: { snapshot: async () => ({ graph, revision: active.revision }), applyTransaction: async () => ({ graph, revision: active.revision }) },
      application: {
        onEvent: () => () => undefined,
        query: async (query: { name: string; documentId?: string }) => {
          if (query.name === "node.catalog") return { name: query.name, payload: { nodes: catalog } };
          if (query.name === "graph.snapshot") {
            if (query.documentId === second.documentId) await secondSnapshotReady;
            return { name: query.name, payload: { graph, documentRevisionId: active.documentRevisionId, graphRevisionId: active.graphRevisionId } };
          }
          if (query.name === "job.list") return { name: query.name, payload: { jobs: [] } };
          return { name: query.name, payload: {} };
        },
        command: async (command: Record<string, unknown>) => {
          transactions.push(command);
          const payload = command.payload as { transaction?: { operations?: Array<{ type: string; node?: unknown }> } } | undefined;
          for (const operation of payload?.transaction?.operations ?? []) {
            if (operation.type === "addNode" && operation.node) graph = { ...graph, nodes: [...graph.nodes, operation.node] };
          }
          return { payload: { documentRevisionId: "document-revision-b-2", graphRevisions: [{ graphId: "graph-root", revisionId: "graph-revision-b-2" }] } };
        }
      },
      artifacts: { search: async () => [], generateFake: async () => [] },
      references: { list: async () => [], act: async () => [] },
      runtime: { versions: async () => ({ electron: "43", node: "24" }) }
    } });
  });

  await page.goto("/");
  const addPrompt = page.locator(".node-library-item[data-node-definition='prompt.text'] .node-library-add");
  await expect(page.getByTestId("ether-canvas-surface")).toHaveAttribute("data-graph-node-count", "0");
  await expect(addPrompt).toBeEnabled();

  await page.getByRole("button", { name: "New document" }).click();
  await expect(page.locator(".canvas-loading")).toContainText("Loading document canvas");
  await expect(addPrompt).toBeDisabled();
  await addPrompt.evaluate((button: HTMLButtonElement) => button.click());
  expect(await page.evaluate(() => (window as typeof window & { __hydrationRace: { transactions: unknown[] } }).__hydrationRace.transactions)).toEqual([]);

  await page.evaluate(() => (window as typeof window & { __hydrationRace: { resolveSecondSnapshot(): void } }).__hydrationRace.resolveSecondSnapshot());
  await expect(page.getByTestId("ether-canvas-surface")).toHaveAttribute("data-graph-node-count", "0");
  await expect(addPrompt).toBeEnabled();
  await addPrompt.click();
  await expect(page.getByTestId("ether-canvas-surface")).toHaveAttribute("data-graph-node-count", "1");
  const applied = await page.evaluate(() => (window as typeof window & { __hydrationRace: { transactions: Array<{ documentId?: string; payload?: { transaction?: { baseGraphRevisions?: Record<string, string> } } }> } }).__hydrationRace.transactions[0]);
  expect(applied?.documentId).toBe("document-b");
  expect(applied?.payload?.transaction?.baseGraphRevisions).toEqual({ "graph-root": "graph-revision-document-b" });
});

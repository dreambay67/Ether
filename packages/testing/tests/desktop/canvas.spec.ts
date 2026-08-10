import { expect, test, type Locator } from "@playwright/test";

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
    const update = (operations: Array<Record<string, unknown>>) => { for (const operation of operations) { const root = operation.graphId === "graph-root"; if (operation.type === "addEdge" && root) { graph.edges.push(operation.edge as typeof graph.edges[number]); graph = { ...graph }; } if (operation.type === "updateEdge" && root) graph = { ...graph, edges: graph.edges.map((edge) => edge.id === operation.edgeId ? operation.edge as typeof edge : edge) }; if (operation.type === "removeEdge" && root) graph = { ...graph, edges: graph.edges.filter((edge) => edge.id !== operation.edgeId) }; if (operation.type === "addNode" && root) graph = { ...graph, nodes: [...graph.nodes, operation.node as typeof graph.nodes[number]] }; if (operation.type === "removeNode" && root) graph = { ...graph, nodes: graph.nodes.filter((node) => node.id !== operation.nodeId) }; if (operation.type === "updateNode" && !root) childGraph = { ...childGraph, nodes: childGraph.nodes.map((node) => node.id === operation.nodeId ? operation.node as typeof node : node) }; if (operation.type === "updateGraphProperties") { if (root) graph = { ...graph, viewState: operation.viewState as typeof graph.viewState }; else childGraph = { ...childGraph, viewState: operation.viewState as typeof childGraph.viewState }; } if (operation.type === "updateGroup" && root) graph = { ...graph, groups: graph.groups.map((group) => group.id === operation.groupId ? operation.group as typeof group : group) }; if (operation.type === "removeGroup" && root) graph = { ...graph, groups: graph.groups.filter((group) => group.id !== operation.groupId) }; if (operation.type === "moveNodes") { const positions = operation.positions as Array<{ nodeId: string; position: { x: number; y: number } }>; if (root) graph = { ...graph, nodes: graph.nodes.map((node) => ({ ...node, position: positions.find((item) => item.nodeId === node.id)?.position ?? node.position })) }; else childGraph = { ...childGraph, nodes: childGraph.nodes.map((node) => ({ ...node, position: positions.find((item) => item.nodeId === node.id)?.position ?? node.position })) }; } if (operation.type === "updateModule" && root) { const index = graph.modules.findIndex((module) => module.id === operation.moduleId); if (index >= 0) graph.modules[index] = operation.module as typeof graph.modules[number]; graph = { ...graph }; } if (operation.type === "updateModuleInterface" && root) graph = { ...graph, modules: graph.modules.map((module) => module.id === operation.moduleId ? { ...module, interface: operation.interface as typeof module.interface } : module) }; } };
    Object.defineProperty(window, "__canvasTransactions", { value: [] });
    Object.defineProperty(window, "ether", { value: { document: { onEvent: () => () => undefined, bootstrap: async () => descriptor(), new: async () => descriptor(), open: async () => descriptor(), openDropped: async () => descriptor(), save: async () => descriptor(), saveAs: async () => descriptor(), saveCopy: async () => descriptor(), compact: async () => ({ beforeBytes: 1, afterBytes: 1 }), makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] }), close: async () => null }, graph: { snapshot: async () => ({ graph, revision: 1 }), applyTransaction: async () => ({ graph, revision: 1 }) }, application: { onEvent: () => () => undefined, command: async (command: { name: string; payload?: { transaction?: { baseGraphRevisions: Record<string, string>; operations: Array<Record<string, unknown>> }; scope?: { kind: string; nodeIds?: string[] } } }) => { const transaction = command.payload?.transaction; if (transaction) { for (const [graphId, base] of Object.entries(transaction.baseGraphRevisions)) if (graphRevisions[graphId] !== base) throw new Error("stale graph revision"); update(transaction.operations); revision += 1; for (const graphId of Object.keys(transaction.baseGraphRevisions)) graphRevisions[graphId] = `${graphId}-revision-${revision}`; } (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.push(command); if (command.name === "run.preview") { const nodeIds = command.payload?.scope?.nodeIds ?? []; return { payload: { plan: { id: "selected-plan", contentHash: `sha256:v1:${"a".repeat(64)}`, graphId: "graph-root", scope: { kind: "selected", nodeIds }, estimatedCalls: 1, requestedParallelism: 4, effectiveParallelism: 2, workItems: [{ id: "work-selected" }], warnings: [], steps: [{ id: "step-selected", nodeId: nodeIds[0] ?? "prompt", subject: { kind: "node", nodeId: nodeIds[0] ?? "prompt" }, executor: "codex-llm", inputPayloadIds: ["payload-direction"], resolvedInputBindings: [{ name: "Subject", payloadId: "payload-direction", selector: "latest-approved" }], compiledPrompt: "Subject: selected canvas direction", provider: { providerId: "ether-fake-local", modelId: "fake-worker" } }] } } }; } if (command.name === "permission.grantRun") return { payload: { permitId: "selected-permit" } }; if (command.name === "run.start") return { payload: { job: { id: "selected-job" } } }; return { payload: { kind: "revision", documentRevisionId: `revision-${revision}`, graphRevisions: Object.entries(graphRevisions).map(([graphId, revisionId]) => ({ graphId, revisionId })) } }; }, query: async (query: { name: string; payload: { graphId?: string } }) => query.name === "node.catalog" ? { name: "node.catalog", payload: { nodes: catalog } } : ({ name: query.name, payload: { graph: query.payload.graphId === "graph-child" ? childGraph : graph, documentRevisionId: `revision-${revision}`, graphRevisionId: graphRevisions[query.payload.graphId ?? "graph-root"] } }) }, artifacts: { search: async () => [], generateFake: async () => [] }, references: { list: async () => [], act: async () => [] }, runtime: { versions: async () => ({ electron: "43", node: "24" }) } } });
  });
  await page.goto("/");
  const canvasSurface = page.getByTestId("ether-canvas-surface");
  await expect(canvasSurface).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog", { name: "Canvas command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  const firstLibraryCopy = page.locator(".node-library-item-copy").first();
  await expect(firstLibraryCopy.getByText("Prompt", { exact: true })).toBeVisible();
  await expect.poll(async () => (await firstLibraryCopy.boundingBox())?.width ?? 0).toBeGreaterThan(80);
  const librarySearch = page.getByRole("searchbox", { name: "Search node library" });
  await librarySearch.fill("render");
  await expect(page.locator(".node-library-item")).toHaveCount(1);
  await expect(page.locator(".node-library-item")).toHaveAttribute("data-node-definition", "generation.image");
  await librarySearch.clear();
  const promptFavorite = page.getByRole("button", { name: "Add Prompt to favorites", exact: true });
  await promptFavorite.click();
  await expect(page.getByRole("region", { name: "Favorites", exact: true })).toContainText("Prompt");
  await page.getByRole("button", { name: "Remove Prompt from favorites", exact: true }).click();
  await expect(page.getByRole("region", { name: "Favorites", exact: true })).toHaveCount(0);
  const quickAddPoint = await page.locator(".react-flow__pane").evaluate((pane) => {
    const bounds = pane.getBoundingClientRect();
    for (const yRatio of [0.82, 0.68, 0.54, 0.4]) {
      for (const xRatio of [0.82, 0.68, 0.54, 0.4, 0.26]) {
        const x = bounds.left + bounds.width * xRatio;
        const y = bounds.top + bounds.height * yRatio;
        if (document.elementFromPoint(x, y) === pane) return { x, y };
      }
    }
    throw new Error("The canvas has no unobstructed Quick Add point.");
  });
  await page.mouse.dblclick(quickAddPoint.x, quickAddPoint.y);
  const quickAdd = page.getByRole("dialog", { name: "Quick add node" });
  await expect(quickAdd).toBeVisible();
  await quickAdd.getByRole("textbox", { name: "Find a node" }).fill("render");
  await expect(quickAdd.getByRole("option")).toHaveCount(1);
  await expect(quickAdd.getByRole("option")).toContainText("Image Generator");
  await page.keyboard.press("Escape");
  await expect(quickAdd).toBeHidden();
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
  await expect(canvasSurface).toHaveAttribute("data-graph-node-count", "3");
  await addWithRealMouse("generation.image");
  await expect(canvasSurface).toHaveAttribute("data-graph-node-count", "4");
  await canvasSurface.focus();
  await page.keyboard.press("Home");
  await expect(promptNode.getByTestId("channel-zone-output-data")).toHaveAttribute("data-connected", "true");
  await page.locator(".ether-edge-hit-target").dispatchEvent("click", { bubbles: true });
  const edgeInspector = page.getByTestId("edge-inspector");
  await expect(edgeInspector).toContainText("Adapter · local.data-to-text");
  await expect(edgeInspector).toContainText("Receiver field");
  const connectionDiagnostics = edgeInspector.getByRole("button", { name: "Connection diagnostics", exact: true });
  await expect(connectionDiagnostics).toHaveAttribute("aria-expanded", "false");
  await connectionDiagnostics.click();
  await expect(connectionDiagnostics).toHaveAttribute("aria-expanded", "true");
  await expect(edgeInspector.getByLabel("Connection adapter", { exact: true })).toBeEnabled();
  await edgeInspector.getByLabel("Output selection", { exact: true }).selectOption("latest");
  await page.getByRole("button", { name: "Target channel Text" }).click();
  const targetPicker = page.getByTestId("edge-channel-picker-target");
  await expect(targetPicker).toBeVisible();
  await expect(targetPicker.getByRole("button", { name: "Image" })).toBeDisabled();
  await targetPicker.getByRole("button", { name: "Data" }).click();
  await expect(page.getByRole("button", { name: "Target channel Data" })).toBeVisible();
  await page.getByTestId("edge-role-chip").getByRole("button", { name: "General" }).click();
  await page.getByTestId("edge-role-grid").getByRole("button", { name: "Subject" }).click();
  await expect(page.getByTestId("edge-role-chip")).toContainText("Subject");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.length)).toBe(5);
  await page.getByRole("button", { name: "Add Prompt", exact: true }).click();
  await expect(canvasSurface).toHaveAttribute("data-graph-node-count", "5");
  await canvasSurface.focus();
  await page.keyboard.press("Home");
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
  await expect(page.getByLabel("Canvas legend").getByText("Polish pipeline")).toBeVisible();
  await expect(canvasSurface).toHaveAttribute("data-graph-node-count", "1");
  const childPrompt = page.locator('[data-testid="rf__node-child-prompt"]');
  await childPrompt.locator(".ether-node-main p").click();
  await page.getByRole("button", { name: "Expose selected parameter" }).click();
  const parameterPicker = page.getByLabel("Expose module parameter");
  await expect(parameterPicker.getByRole("option")).toHaveCount(2);
  await parameterPicker.getByRole("button", { name: "Expose parameter" }).click();
  await expect(parameterPicker).toHaveCount(0);
  await page.getByRole("button", { name: "Leave module" }).click();
  await expect(page.getByLabel("Canvas legend").getByText("Canvas fixture")).toBeVisible();
  await expect(page.getByTestId("ether-module-node")).toHaveClass(/is-selected/);
  await expect(page.getByLabel("Module title")).toHaveValue("Polish pipeline");
  await page.getByTestId("module-inspector").getByRole("button", { name: "Relock module" }).click();
  await expect(page.getByTestId("ether-module-node")).toHaveAttribute("data-module-locked", "true");
  const exposedBody = page.getByLabel("Exposed Polish Body");
  await expect(exposedBody).toHaveValue("Refine the selected direction");
  await exposedBody.fill("Refine the approved direction");
  await exposedBody.blur();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __canvasTransactions: Array<{ payload?: { transaction?: { operations?: Array<{ type?: string; graphId?: string; node?: { config?: { body?: string } } }> } } }> }).__canvasTransactions.some((command) => command.payload?.transaction?.operations?.some((operation) => operation.type === "updateNode" && operation.graphId === "graph-child" && operation.node?.config?.body === "Refine the approved direction")))).toBe(true);
  await page.getByTestId("module-inspector").getByRole("button", { name: "Collapse" }).click();
  await expect(page.getByTestId("ether-module-node")).toContainText("Collapsed");
  await expect(page.getByTestId("ether-module-node").getByRole("button", { name: "Expand" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.length)).toBe(16);

  const rootImage = page.locator('[data-testid="rf__node-image"]');
  await rootImage.locator(".ether-node-main p").click();
  await moduleCard.locator(".ether-module-title").dispatchEvent("click", { bubbles: true, shiftKey: true });
  await expect(rootImage.locator(".ether-node")).toHaveClass(/is-selected/);
  await expect(page.getByTestId("module-inspector").getByRole("button", { name: "Add selected to module" })).toBeDisabled();
  await moduleCard.locator(".ether-module-title").dispatchEvent("click", { bubbles: true });
  await expect(rootImage.locator(".ether-node")).not.toHaveClass(/is-selected/);
  await page.locator(".react-flow__node-etherNode").nth(2).locator(".ether-node-main p").click();
  await rootImage.locator(".ether-node-main p").click({ modifiers: ["Control"] });
  await expect(page.getByLabel("Selected run prompt")).toContainText("2 nodes selected");
  await page.getByLabel("Selected run prompt").getByRole("button", { name: "Preview selected run" }).click();
  await expect(page.getByTestId("canvas-status")).toContainText("Selected plan ready");
  await expect(page.getByLabel("Selected plan")).toContainText("Selected · 2 nodes");
  await expect(page.getByLabel("Selected plan")).toContainText("Concurrency 2");
  await expect(page.getByLabel("Selected plan")).toContainText("Boundary ·");
  const compiledSteps = page.getByLabel("Selected plan").getByText("Compiled steps and inputs");
  await compiledSteps.scrollIntoViewIfNeeded();
  await compiledSteps.click();
  await expect(page.getByLabel("Selected plan")).toContainText("Subject: selected canvas direction");
  await expect(page.getByLabel("Selected plan")).toContainText("Plan ID · selected-plan");
  await expect(page.getByLabel("Selected plan")).toContainText("Content hash · sha256:v1:");
  const selectedScope = await page.evaluate(() => {
    const commands = (window as typeof window & { __canvasTransactions: Array<{ name?: string; payload?: { scope?: unknown } }> }).__canvasTransactions;
    return commands.find((command) => command.name === "run.preview")?.payload?.scope;
  });
  expect(selectedScope).toMatchObject({ kind: "selected" });
  await page.getByRole("button", { name: "Add Prompt", exact: true }).click();
  await expect(page.getByLabel("Selected run prompt")).toHaveCount(0);
  await expect(page.getByLabel("Selected run prompt").getByRole("button", { name: "Start 1 call" })).toHaveCount(0);
  await page.getByRole("button", { name: "Preview selected run", exact: true }).click();
  await expect(page.getByLabel("Selected run prompt").getByRole("button", { name: "Start 1 call" })).toBeVisible();
  await page.getByLabel("Selected run prompt").getByRole("button", { name: "Start 1 call" }).click();
  await expect(page.getByTestId("canvas-status")).toContainText("Selected run started: selected-job");
  await page.getByRole("button", { name: "Undo graph transaction" }).click(); await page.getByRole("button", { name: "Redo graph transaction" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.length)).toBe(23);
  const duplicateSelection = page.getByRole("button", { name: "Duplicate", exact: true });
  await expect(duplicateSelection).toBeEnabled();
  await duplicateSelection.click();
  await expect(canvasSurface).toHaveAttribute("data-graph-node-count", "7");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.length)).toBe(24);
});

test("reveals and selects a node added after a large locked module", async ({ page }) => {
  await page.addInitScript(() => {
    let graph = {
      id: "graph-root", title: "Canvas fixture", kind: "root", createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z",
      nodes: [] as Array<Record<string, unknown>>, edges: [], groups: [], modules: [{
        id: "module-large", title: "Large locked module", description: "Occupies the working canvas", accent: "#37e6ea", locked: true, graphId: "graph-child",
        position: { x: 0, y: 0 }, size: { width: 2400, height: 1600 },
        interface: { inputs: [], outputs: [], parameters: [] }, collapsed: false
      }],
      viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
    };
    const catalog = [{
      definitionId: "prompt.text", family: "prompt", title: "Prompt", description: "Write reusable text instructions.",
      example: "Describe a quiet studio portrait.", synonyms: ["instruction", "text"], inputChannels: [], outputChannels: ["text"],
      defaultConfig: { kind: "prompt.text", body: "", assembly: "append" },
      inspector: { sections: [{ id: "main", title: "Prompt", fields: ["body", "assembly"] }] }, executor: "deterministic-assembly",
      presentation: { width: 250, height: 150, previewMode: "content" }, setupRequirement: "none"
    }];
    let revision = 1;
    const descriptor = () => ({
      documentId: "canvas-large-module", displayName: "Canvas", named: true, mode: "writable", readOnlyReason: null,
      commands: { save: true, saveAs: true, saveCopy: true, compact: true, makePortable: true }, saveState: "saved",
      documentRevisionId: "document-revision-1", graphId: "graph-root", graphRevisionId: "graph-revision-1", simulationEnabled: false, revision
    });
    Object.defineProperty(window, "ether", { value: {
      document: { onEvent: () => () => undefined, bootstrap: async () => descriptor(), new: async () => descriptor(), open: async () => descriptor(), openDropped: async () => descriptor(), save: async () => descriptor(), saveAs: async () => descriptor(), saveCopy: async () => descriptor(), compact: async () => ({ beforeBytes: 1, afterBytes: 1 }), makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] }), close: async () => null },
      graph: { snapshot: async () => ({ graph, revision }), applyTransaction: async () => ({ graph, revision }) },
      application: {
        onEvent: () => () => undefined,
        query: async (query: { name: string }) => query.name === "node.catalog"
          ? { name: query.name, payload: { nodes: catalog } }
          : query.name === "job.list"
            ? { name: query.name, payload: { jobs: [] } }
            : { name: query.name, payload: { graph, documentRevisionId: `document-revision-${revision}`, graphRevisionId: `graph-revision-${revision}` } },
        command: async (command: { payload?: { transaction?: { operations?: Array<{ type: string; node?: Record<string, unknown> }> } } }) => {
          for (const operation of command.payload?.transaction?.operations ?? []) {
            if (operation.type === "addNode" && operation.node !== undefined) graph = { ...graph, nodes: [...graph.nodes, operation.node] };
          }
          revision += 1;
          return { payload: { documentRevisionId: `document-revision-${revision}`, graphRevisions: [{ graphId: "graph-root", revisionId: `graph-revision-${revision}` }] } };
        }
      },
      artifacts: { search: async () => [], generateFake: async () => [] }, references: { list: async () => [], act: async () => [] }, runtime: { versions: async () => ({ electron: "43", node: "24" }) }
    } });
  });

  await page.goto("/");
  const surface = page.getByTestId("ether-canvas-surface");
  await expect(surface).toBeVisible();
  await expect(page.getByTestId("ether-module-node")).toHaveAttribute("data-module-locked", "true");

  const assertRevealed = async (node: Locator) => {
    await expect(node).toHaveClass(/is-selected/u);
    await expect(node).toBeVisible();
    const [surfaceBox, nodeBox] = await Promise.all([surface.boundingBox(), node.boundingBox()]);
    expect(surfaceBox).not.toBeNull();
    expect(nodeBox).not.toBeNull();
    expect(Math.abs((nodeBox!.x + nodeBox!.width / 2) - (surfaceBox!.x + surfaceBox!.width / 2))).toBeLessThan(surfaceBox!.width * 0.1);
    expect(Math.abs((nodeBox!.y + nodeBox!.height / 2) - (surfaceBox!.y + surfaceBox!.height / 2))).toBeLessThan(surfaceBox!.height * 0.1);
  };

  await page.getByRole("button", { name: "Add Prompt", exact: true }).click();
  const firstNode = page.locator(".ether-node[data-node-definition='prompt.text']").first();
  await expect(surface).toHaveAttribute("data-graph-node-count", "1");
  await assertRevealed(firstNode);

  await surface.focus();
  await page.keyboard.press("n");
  const quickAdd = page.getByRole("dialog", { name: "Quick add node" });
  await expect(quickAdd).toBeVisible();
  await quickAdd.getByRole("option").first().click();
  const secondNode = page.locator(".ether-node[data-node-definition='prompt.text']").last();
  await expect(surface).toHaveAttribute("data-graph-node-count", "2");
  await assertRevealed(secondNode);
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
  await addPrompt.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ether-canvas-surface")).toHaveAttribute("data-graph-node-count", "1");
  const applied = await page.evaluate(() => (window as typeof window & { __hydrationRace: { transactions: Array<{ documentId?: string; payload?: { transaction?: { baseGraphRevisions?: Record<string, string> } } }> } }).__hydrationRace.transactions[0]);
  expect(applied?.documentId).toBe("document-b");
  expect(applied?.payload?.transaction?.baseGraphRevisions).toEqual({ "graph-root": "graph-revision-document-b" });
});

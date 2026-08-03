import { expect, test } from "@playwright/test";

test("projects the typed graph into a nonblank canvas and sends role edits through graph transactions", async ({ page }) => {
  await page.addInitScript(() => {
    let graph = {
      id: "graph-root", title: "Canvas fixture", kind: "root", createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z",
      nodes: [
        { id: "prompt", definitionId: "prompt.text", title: "Direction", position: { x: 100, y: 120 }, size: { width: 250, height: 150 }, config: { kind: "prompt.text", body: "Soft morning still life", assembly: "append" }, presentation: { collapsed: false, accent: "default", previewMode: "content" } },
        { id: "image", definitionId: "generation.image", title: "Image", position: { x: 480, y: 170 }, size: { width: 250, height: 150 }, config: { kind: "generation.image", providerId: "ether-fake-local", profileId: "default", aspectRatio: "1:1", resolution: { width: 512, height: 512 }, outputCount: 1 }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } }
      ], edges: [{ id: "lane", from: { kind: "node", nodeId: "prompt", channel: "data" }, to: { kind: "node", nodeId: "image", channel: "text" }, role: "general", order: 0, selector: { kind: "latest-approved" }, adapter: { kind: "auto" }, enabled: true }], groups: [{ id: "group-1", title: "Campaign", nodeIds: ["prompt", "image"], position: { x: 60, y: 70 }, size: { width: 720, height: 300 }, color: "#a889ff" }], modules: [{ id: "module-1", title: "Polish module", graphId: "graph-child", position: { x: 840, y: 140 }, size: { width: 260, height: 160 }, interface: { inputs: [{ id: "input-1", name: "Direction", channel: "text", internalNodeId: "child-prompt", internalChannel: "text", required: false }], outputs: [{ id: "output-1", name: "Result", channel: "text", internalNodeId: "child-prompt", internalChannel: "text", required: false }], parameters: [] }, collapsed: false }], viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
    };
    let childGraph = { id: "graph-child", title: "Module interior", kind: "module", createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z", nodes: [{ id: "child-prompt", definitionId: "prompt.text", title: "Polish", position: { x: 120, y: 120 }, size: { width: 250, height: 150 }, config: { kind: "prompt.text", body: "Refine the selected direction", assembly: "append" }, presentation: { collapsed: false, accent: "default", previewMode: "content" } }], edges: [], groups: [], modules: [], viewState: { viewport: { x: 12, y: 18, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null } };
    const catalog = [
      { definitionId: "prompt.text", family: "prompt", title: "Prompt", description: "Write reusable text instructions.", example: "Describe a quiet studio portrait.", synonyms: ["instruction", "text"], inputChannels: [], outputChannels: ["text"], defaultConfig: { kind: "prompt.text", body: "", assembly: "append" }, inspector: { sections: [{ id: "main", title: "Prompt", fields: ["body", "assembly"] }] }, executor: "deterministic-assembly", presentation: { width: 250, height: 150, previewMode: "content" }, setupRequirement: "none" },
      { definitionId: "generation.image", family: "generation", title: "Image Generator", description: "Generate images from text direction.", example: "Create three lighting variations.", synonyms: ["image", "render"], inputChannels: ["text", "image", "data"], outputChannels: ["image", "data"], defaultConfig: { kind: "generation.image", providerId: "ether-fake-local", profileId: "default", aspectRatio: "1:1", resolution: { width: 512, height: 512 }, outputCount: 1 }, inspector: { sections: [{ id: "main", title: "Image Generator", fields: ["providerId", "profileId"] }] }, executor: "image-provider", presentation: { width: 250, height: 150, previewMode: "summary" }, setupRequirement: "provider-capability" }
    ];
    let revision = 1; const graphRevisions: Record<string, string> = { "graph-root": "graph-revision-1", "graph-child": "child-revision-1" };
    const descriptor = () => ({ documentId: "canvas-document", displayName: "Canvas", named: true, mode: "writable", readOnlyReason: null, commands: { save: true, saveAs: true, saveCopy: true, compact: true, makePortable: true }, saveState: "saved", documentRevisionId: "revision-1", graphId: "graph-root", graphRevisionId: "graph-revision-1", simulationEnabled: false, revision: 1 });
    const update = (operations: Array<Record<string, unknown>>) => { for (const operation of operations) { const root = operation.graphId === "graph-root"; if (operation.type === "updateEdge" && root) graph = { ...graph, edges: graph.edges.map((edge) => edge.id === operation.edgeId ? operation.edge as typeof edge : edge) }; if (operation.type === "removeEdge" && root) graph = { ...graph, edges: graph.edges.filter((edge) => edge.id !== operation.edgeId) }; if (operation.type === "addNode" && root) graph = { ...graph, nodes: [...graph.nodes, operation.node as typeof graph.nodes[number]] }; if (operation.type === "updateGraphProperties") { if (root) graph = { ...graph, viewState: operation.viewState as typeof graph.viewState }; else childGraph = { ...childGraph, viewState: operation.viewState as typeof childGraph.viewState }; } if (operation.type === "updateGroup" && root) graph = { ...graph, groups: graph.groups.map((group) => group.id === operation.groupId ? operation.group as typeof group : group) }; if (operation.type === "moveNodes") { const positions = operation.positions as Array<{ nodeId: string; position: { x: number; y: number } }>; if (root) graph = { ...graph, nodes: graph.nodes.map((node) => ({ ...node, position: positions.find((item) => item.nodeId === node.id)?.position ?? node.position })) }; else childGraph = { ...childGraph, nodes: childGraph.nodes.map((node) => ({ ...node, position: positions.find((item) => item.nodeId === node.id)?.position ?? node.position })) }; } if (operation.type === "updateModuleInterface" && root) graph = { ...graph, modules: graph.modules.map((module) => module.id === operation.moduleId ? { ...module, interface: operation.interface as typeof module.interface } : module) }; } };
    Object.defineProperty(window, "__canvasTransactions", { value: [] });
    Object.defineProperty(window, "ether", { value: { document: { onEvent: () => () => undefined, bootstrap: async () => descriptor(), new: async () => descriptor(), open: async () => descriptor(), openDropped: async () => descriptor(), save: async () => descriptor(), saveAs: async () => descriptor(), saveCopy: async () => descriptor(), compact: async () => ({ beforeBytes: 1, afterBytes: 1 }), makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] }), close: async () => null }, graph: { snapshot: async () => ({ graph, revision: 1 }), applyTransaction: async () => ({ graph, revision: 1 }) }, application: { onEvent: () => () => undefined, command: async (command: { name: string; payload?: { transaction?: { baseGraphRevisions: Record<string, string>; operations: Array<Record<string, unknown>> } } }) => { const transaction = command.payload?.transaction; if (transaction) { for (const [graphId, base] of Object.entries(transaction.baseGraphRevisions)) if (graphRevisions[graphId] !== base) throw new Error("stale graph revision"); update(transaction.operations); revision += 1; for (const graphId of Object.keys(transaction.baseGraphRevisions)) graphRevisions[graphId] = `${graphId}-revision-${revision}`; } (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.push(command); if (command.name === "run.preview") return { payload: { plan: { id: "selected-plan", contentHash: `sha256:v1:${"a".repeat(64)}`, estimatedCalls: 1 } } }; if (command.name === "permission.grantRun") return { payload: { permitId: "selected-permit" } }; if (command.name === "run.start") return { payload: { job: { id: "selected-job" } } }; return { payload: { kind: "revision", documentRevisionId: `revision-${revision}`, graphRevisions: Object.entries(graphRevisions).map(([graphId, revisionId]) => ({ graphId, revisionId })) } }; }, query: async (query: { name: string; payload: { graphId?: string } }) => query.name === "node.catalog" ? { name: "node.catalog", payload: { nodes: catalog } } : ({ name: query.name, payload: { graph: query.payload.graphId === "graph-child" ? childGraph : graph, documentRevisionId: `revision-${revision}`, graphRevisionId: graphRevisions[query.payload.graphId ?? "graph-root"] } }) }, artifacts: { search: async () => [], generateFake: async () => [] }, references: { list: async () => [], act: async () => [] }, runtime: { versions: async () => ({ electron: "43", node: "24" }) } } });
  });
  await page.goto("/");
  await expect(page.getByTestId("ether-canvas-surface")).toBeVisible();
  const firstLibraryCopy = page.locator(".node-library-item-copy").first();
  await expect(firstLibraryCopy.getByText("Prompt", { exact: true })).toBeVisible();
  await expect.poll(async () => (await firstLibraryCopy.boundingBox())?.width ?? 0).toBeGreaterThan(80);
  await expect(page.locator(".ether-node")).toHaveCount(2);
  const promptNode = page.locator('[data-testid="rf__node-prompt"]');
  const imageNode = page.locator('[data-testid="rf__node-image"]');
  await promptNode.locator(".ether-node-main p").click();
  const imageBox = await imageNode.boundingBox();
  const groupBeforeMarquee = await page.locator(".react-flow__node-group").boundingBox();
  expect(imageBox).not.toBeNull();
  expect(groupBeforeMarquee).not.toBeNull();
  const marqueeStart = { x: imageBox!.x - 12, y: groupBeforeMarquee!.y + groupBeforeMarquee!.height + 12 };
  const marqueeEnd = { x: imageBox!.x + imageBox!.width + 12, y: imageBox!.y - 12 };
  await page.keyboard.down("Shift");
  await page.mouse.move(marqueeStart.x, marqueeStart.y);
  await page.mouse.down();
  await page.mouse.move(marqueeEnd.x, marqueeEnd.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(promptNode.locator(".ether-node")).toHaveClass(/is-selected/);
  await expect(imageNode.locator(".ether-node")).toHaveClass(/is-selected/);
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
  await page.getByRole("button", { name: "Target channel Text" }).dispatchEvent("pointerdown", { button: 2, bubbles: true });
  const targetPicker = page.getByTestId("edge-channel-picker-target");
  await expect(targetPicker).toBeVisible();
  await expect(targetPicker.getByRole("button", { name: "Image" })).toBeDisabled();
  await targetPicker.getByRole("button", { name: "Data" }).dispatchEvent("pointerenter", { button: 2, bubbles: true });
  await targetPicker.getByRole("button", { name: "Data" }).dispatchEvent("pointerup", { button: 2, bubbles: true });
  await expect(page.getByRole("button", { name: "Target channel Data" })).toBeVisible();
  await page.getByTestId("edge-role-chip").getByRole("button", { name: "General" }).click();
  await page.getByTestId("edge-role-grid").getByRole("button", { name: "Subject" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.length)).toBe(4);
  await page.getByRole("button", { name: "Add Prompt", exact: true }).click();
  await expect(page.locator(".ether-node")).toHaveCount(5);
  await page.getByTestId("edge-role-chip").click({ button: "right" });
  await expect(page.getByTestId("edge-role-chip")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.length)).toBe(6);

  await expect(page.getByLabel("Output output-1 text")).toBeVisible();
  const group = page.locator(".react-flow__node-group"); const groupBox = await group.boundingBox();
  expect(groupBox).not.toBeNull();
  await page.mouse.move(groupBox!.x + 20, groupBox!.y + 18); await page.mouse.down(); await page.mouse.move(groupBox!.x + 58, groupBox!.y + 44, { steps: 5 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.length)).toBe(7);

  await page.getByRole("button", { name: "Polish module" }).dblclick();
  await expect(page.getByTestId("canvas-status")).toContainText("Entered Polish module");
  await expect(page.getByLabel("Canvas legend").getByText("Module interior")).toBeVisible();
  await expect(page.locator(".ether-node")).toHaveCount(1);
  const childPrompt = page.locator('[data-testid="rf__node-child-prompt"]');
  await childPrompt.locator(".ether-node-main p").click();
  await page.getByRole("button", { name: "Expose selected parameter" }).click();
  await page.getByRole("button", { name: "Leave module" }).click();
  await expect(page.getByLabel("Canvas legend").getByText("Canvas fixture")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.length)).toBe(10);

  const rootImage = page.locator('[data-testid="rf__node-image"]');
  await page.locator(".react-flow__node-etherNode").nth(2).locator(".ether-node-main p").click();
  await rootImage.locator(".ether-node-main p").click({ modifiers: ["Control"] });
  await expect(page.getByLabel("Selected run prompt")).toContainText("2 nodes selected");
  await page.getByLabel("Selected run prompt").getByRole("button", { name: "Preview selected run" }).click();
  await expect(page.getByTestId("canvas-status")).toContainText("Selected plan ready");
  await page.getByLabel("Selected run prompt").getByRole("button", { name: "Start 1 call" }).click();
  await expect(page.getByTestId("canvas-status")).toContainText("Selected run started: selected-job");
  await page.getByRole("button", { name: "Undo graph transaction" }).click(); await page.getByRole("button", { name: "Redo graph transaction" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __canvasTransactions: unknown[] }).__canvasTransactions.length)).toBe(15);
});

import { expect, test } from "@playwright/test";
import path from "node:path";

test("persists drawing gestures and exposes honest mask editing capabilities", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  page.on("pageerror", (error) => { throw error; });
  await page.route("ether-asset://**", async (route) => {
    const edited = route.request().url().includes("edited-preview");
    await route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${edited ? "#4025a5" : "#08324a"}"/><stop offset="1" stop-color="#07111b"/></linearGradient></defs><rect width="900" height="600" fill="url(#g)"/><circle cx="450" cy="285" r="150" fill="${edited ? "#8e5cff" : "#37e6ea"}" opacity=".82"/><rect x="295" y="420" width="310" height="38" rx="19" fill="#e7faff" opacity=".84"/><text x="450" y="510" text-anchor="middle" fill="#e7faff" font-family="Arial" font-size="28">${edited ? "EDIT PREVIEW" : "STUDIO SOURCE"}</text></svg>` });
  });
  await page.addInitScript(() => {
    let revision = 1;
    let graph = {
      id: "drawing-graph", title: "Drawing and edit", kind: "root", createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z",
      nodes: [
        { id: "cloud", definitionId: "canvas.note", title: "Cloud", position: { x: 40, y: 50 }, size: { width: 260, height: 170 }, config: { kind: "canvas.note", body: "Atmosphere and intent", style: "cloud" }, presentation: { collapsed: false, accent: "default", previewMode: "content" } },
        { id: "bubble", definitionId: "canvas.note", title: "Bubble", position: { x: 340, y: 50 }, size: { width: 260, height: 170 }, config: { kind: "canvas.note", body: "A concrete callout", style: "bubble" }, presentation: { collapsed: false, accent: "default", previewMode: "content" } },
        { id: "drawing", definitionId: "canvas.drawing", title: "Sketch", position: { x: 40, y: 280 }, size: { width: 300, height: 210 }, config: { kind: "canvas.drawing", width: 640, height: 420, background: "#07111b", strokes: [] }, presentation: { collapsed: false, accent: "default", previewMode: "content" } },
        { id: "edit", definitionId: "edit.image", title: "Product edit", position: { x: 420, y: 280 }, size: { width: 300, height: 190 }, config: { kind: "edit.image", providerId: "edit-guidance", profileId: "guidance", strength: .7, outputCount: 1 }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } },
        { id: "source", definitionId: "generation.image", title: "Source generator", position: { x: 780, y: 280 }, size: { width: 280, height: 190 }, config: { kind: "generation.image", providerId: "image-provider", profileId: "studio", aspectRatio: "3:2", resolution: { width: 900, height: 600 }, outputCount: 2 }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } }
      ],
      edges: [
        { id: "source-image-lane", from: { kind: "node", nodeId: "source", channel: "image" }, to: { kind: "node", nodeId: "edit", channel: "image" }, role: "product", order: 0, selector: { kind: "all" }, adapter: { kind: "auto" }, enabled: true },
        { id: "drawing-mask-lane", from: { kind: "node", nodeId: "drawing", channel: "image" }, to: { kind: "node", nodeId: "edit", channel: "mask" }, role: "general", order: 1, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true },
        { id: "cloud-text-lane", from: { kind: "node", nodeId: "cloud", channel: "text" }, to: { kind: "node", nodeId: "edit", channel: "text" }, role: "general", order: 2, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true }
      ], groups: [], modules: [], viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
    };
    const descriptor = () => ({ documentId: "drawing-document", displayName: "Drawing", named: true, mode: "writable", readOnlyReason: null, commands: { save: true, saveAs: true, saveCopy: true, compact: true, makePortable: true }, saveState: "saved", documentRevisionId: "document-revision-1", graphId: "drawing-graph", graphRevisionId: "graph-revision-1", simulationEnabled: false, revision: 1 });
    const commands: Array<{ name: string; payload?: { transaction?: { operations: Array<{ type: string; nodeId?: string; node?: typeof graph.nodes[number] }> } } }> = [];
    const queries: Array<{ name: string; payload?: Record<string, unknown> }> = [];
    const artifacts = [
      { id: "source-image", contentKey: "a".repeat(64), channel: "image", mediaType: "image/png", byteLength: 1200, source: { outputVersionId: "source-output-a", payloadId: "source-payload-a" }, createdAt: "2026-07-23T00:00:00.000Z", metadata: { title: "Studio source A", width: 900, height: 600 } },
      { id: "source-image-two", contentKey: "e".repeat(64), channel: "image", mediaType: "image/png", byteLength: 1220, source: { outputVersionId: "source-output-b", payloadId: "source-payload-b" }, createdAt: "2026-07-23T00:00:30.000Z", metadata: { title: "Studio source B", width: 900, height: 600 } },
      { id: "unconnected-image", contentKey: "f".repeat(64), channel: "image", mediaType: "image/png", byteLength: 1230, source: { outputVersionId: "unconnected-output", payloadId: "unconnected-payload" }, createdAt: "2026-07-23T00:00:45.000Z", metadata: { title: "Unconnected image", width: 900, height: 600 } },
      { id: "edited-preview", contentKey: "b".repeat(64), channel: "image", mediaType: "image/png", byteLength: 1400, source: { outputVersionId: "edit-output-v1", payloadId: "edit-payload" }, createdAt: "2026-07-23T00:01:00.000Z", metadata: { title: "Edit preview", width: 900, height: 600 } }
    ];
    const capability = (providerId: string, profileId: string, inputChannels: string[], limitations: string[]) => ({ providerId, profileId, operation: "edit-image", inputChannels, outputChannels: ["image"], aspectRatios: [], resolutions: [], maxReferences: 2, maxOutputsPerCall: 2, supportsCancellation: true, supportsSeed: false, provenance: "conformance-verified", limitations });
    const capabilities = [
      capability("edit-guidance", "guidance", ["text", "image", "mask"], []),
      capability("edit-native", "native", ["text", "image", "mask"], ["native-inpainting", "pixel-exact mask support"]),
      capability("edit-basic", "unsupported-mask", ["text", "image"], ["No mask input"])
    ];
    const update = (operations: Array<{ type: string; nodeId?: string; node?: typeof graph.nodes[number] }>) => {
      for (const operation of operations) {
        if (operation.type === "updateNode" && operation.nodeId && operation.node) graph = { ...graph, nodes: graph.nodes.map((node) => node.id === operation.nodeId ? operation.node! : node) };
      }
    };
    Object.defineProperty(window, "__drawingCommands", { value: commands });
    Object.defineProperty(window, "__drawingQueries", { value: queries });
    Object.defineProperty(window, "ether", { value: {
      document: { onEvent: () => () => undefined, bootstrap: async () => descriptor(), new: async () => descriptor(), open: async () => descriptor(), openDropped: async () => descriptor(), save: async () => descriptor(), saveAs: async () => descriptor(), saveCopy: async () => descriptor(), close: async () => null, compact: async () => ({ beforeBytes: 1, afterBytes: 1 }), makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] }) },
      graph: { snapshot: async () => ({ graph, revision }), applyTransaction: async () => ({ graph, revision }) },
      application: {
        onEvent: () => () => undefined,
        command: async (command: typeof commands[number]) => {
          commands.push(command);
          if (command.name === "editWorkspace.commit") {
            const kind = (command.payload as unknown as { kind?: string } | undefined)?.kind;
            const drawing = kind === "drawing";
            return { payload: {
              outputVersion: { id: drawing ? "drawing-output-version" : "mask-output-version", approval: { state: "unreviewed" }, outputPayloadIds: [drawing ? "drawing-payload" : "mask-payload"], createdAt: "2026-07-23T00:02:00.000Z" },
              artifact: { id: drawing ? "drawing-artifact" : "mask-artifact", contentKey: (drawing ? "d" : "c").repeat(64), channel: drawing ? "image" : "mask", mediaType: "image/svg+xml", byteLength: 2048, source: { outputVersionId: drawing ? "drawing-output-version" : "mask-output-version", payloadId: drawing ? "drawing-payload" : "mask-payload" }, createdAt: "2026-07-23T00:02:00.000Z", metadata: { title: drawing ? "Published sketch" : "Product edit mask" } }
            } };
          }
          if (command.name === "graph.applyTransaction" && command.payload?.transaction) update(command.payload.transaction.operations);
          revision += 1;
          return { payload: { documentRevisionId: `document-revision-${revision}`, graphRevisions: [{ graphId: "drawing-graph", revisionId: `graph-revision-${revision}` }] } };
        },
        query: async (query: { name: string; payload?: { nodeId?: string } }) => {
          queries.push(query as { name: string; payload?: Record<string, unknown> });
          if (query.name === "graph.snapshot") return { payload: { graph, documentRevisionId: `document-revision-${revision}`, graphRevisionId: `graph-revision-${revision}` } };
          if (query.name === "provider.capabilities") return { payload: { capabilities } };
          if (query.name === "artifact.search") return { payload: { artifacts, total: artifacts.length, nextCursor: null } };
          if (query.name === "node.outputs" && query.payload?.nodeId === "source") return { payload: { outputs: [
            { id: "source-output-a", approval: { state: "approved" }, outputPayloadIds: ["source-payload-a"], createdAt: "2026-07-23T00:00:00.000Z" },
            { id: "source-output-b", approval: { state: "unreviewed" }, outputPayloadIds: ["source-payload-b"], createdAt: "2026-07-23T00:00:30.000Z" }
          ] } };
          if (query.name === "node.outputs" && query.payload?.nodeId === "edit") return { payload: { outputs: [{ id: "edit-output-v1", approval: { state: "unreviewed" }, outputPayloadIds: ["edit-payload"], createdAt: "2026-07-23T00:01:00.000Z" }] } };
          if (query.name === "node.outputs") return { payload: { outputs: [] } };
          if (query.name === "job.list") return { payload: { jobs: [] } };
          return { payload: {} };
        }
      },
      artifacts: { search: async () => artifacts, generateFake: async () => [] }, references: { list: async () => [], act: async () => [] }, runtime: { versions: async () => ({ electron: "43", node: "24" }) }
    } });
  });

  await page.goto("/");
  await expect(page.getByTestId("note-cloud")).toBeVisible();
  await expect(page.getByTestId("note-bubble")).toBeVisible();
  await expect(page.getByTestId("drawing-presentation")).toBeVisible();

  await page.getByTestId("drawing-presentation").click();
  const drawing = page.getByTestId("node-inspector").getByTestId("stroke-canvas");
  await expect(drawing).toBeVisible();
  await drawing.scrollIntoViewIfNeeded();
  let box = await drawing.boundingBox();
  if (!box) throw new Error("Drawing canvas geometry unavailable");
  await page.mouse.move(box.x + box.width * .25, box.y + box.height * .35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .72, box.y + box.height * .68, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => graphCommandCount(page)).toBe(1);
  await expect(page.getByTestId("canvas-status")).toContainText("Drawing saved with 1 stroke");
  await expect(drawing.getByTestId("drawing-stroke")).toHaveCount(1);

  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  await page.getByLabel("Brush size").fill("96");
  await expect(drawing).toHaveAttribute("data-tool", "eraser");
  await drawing.scrollIntoViewIfNeeded();
  box = await drawing.boundingBox();
  if (!box) throw new Error("Drawing canvas geometry unavailable after tool change");
  await page.mouse.click(box.x + box.width * .485, box.y + box.height * .515);
  await expect.poll(() => graphCommandCount(page)).toBe(2);
  await expect(page.getByTestId("canvas-status")).toContainText("Drawing saved with 0 strokes");
  await expect(drawing.getByTestId("drawing-stroke")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo stroke" }).click();
  await expect.poll(() => graphCommandCount(page)).toBe(3);
  await expect(page.getByTestId("canvas-status")).toContainText("Drawing saved with 1 stroke");
  await expect(drawing.getByTestId("drawing-stroke")).toHaveCount(1);
  await page.getByRole("button", { name: "Redo stroke" }).click();
  await expect.poll(() => graphCommandCount(page)).toBe(4);
  await expect(page.getByTestId("canvas-status")).toContainText("Drawing saved with 0 strokes");

  await page.getByRole("button", { name: "Brush", exact: true }).click();
  await page.getByLabel("Brush size").fill("42");
  await page.getByLabel("Brush opacity").fill("0.5");
  await drawing.scrollIntoViewIfNeeded();
  box = await drawing.boundingBox();
  if (!box) throw new Error("Drawing canvas geometry unavailable after brush settings");
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .7);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .25, { steps: 9 });
  await page.mouse.up();
  await expect.poll(() => graphCommandCount(page)).toBe(5);
  const savedStroke = await page.evaluate(() => {
    const commands = (window as typeof window & { __drawingCommands: Array<{ payload?: { transaction?: { operations: Array<{ node?: { config?: { strokes?: Array<{ width: number; color: string }> } } }> } } }> }).__drawingCommands;
    return commands.filter((command) => command.payload?.transaction).at(-1)?.payload?.transaction?.operations[0]?.node?.config?.strokes?.at(-1);
  });
  expect(savedStroke?.width).toBe(42);
  expect(savedStroke?.color.toLowerCase()).toBe("#37e6ea80");
  await page.getByRole("button", { name: "Publish drawing" }).click();
  await expect(page.getByTestId("canvas-status")).toContainText("Drawing artifact drawing-artifact committed");
  const drawingCommit = await page.evaluate(() => {
    const commands = (window as typeof window & { __drawingCommands: Array<{ name: string; payload?: Record<string, unknown> }> }).__drawingCommands;
    return commands.find((command) => command.name === "editWorkspace.commit" && command.payload?.kind === "drawing")?.payload as {
      graphId: string; nodeId: string; kind: string; channel: string; mediaType: string; width: number; height: number; byteLength: number;
      content: { encoding: string; data: string };
      drawing: { kind: string; width: number; height: number; background: string; strokes: Array<{ width: number; color: string }> };
    };
  });
  expect(drawingCommit).toMatchObject({ graphId: "drawing-graph", nodeId: "drawing", kind: "drawing", channel: "image", mediaType: "image/svg+xml", width: 640, height: 420, content: { encoding: "utf8" }, drawing: { kind: "canvas.drawing", width: 640, height: 420, background: "#07111b" } });
  expect(drawingCommit.drawing.strokes).toHaveLength(1);
  expect(drawingCommit.drawing.strokes[0]).toMatchObject({ width: 42, color: "#37e6ea80" });
  expect(drawingCommit.content.data.startsWith("<svg")).toBeTruthy();
  expect(drawingCommit.byteLength).toBe(new TextEncoder().encode(drawingCommit.content.data).byteLength);

  await page.locator('[data-testid="rf__node-edit"] .ether-node-preview').click();
  await expect(page.getByTestId("edit-workspace")).toBeVisible();
  await expect(page.getByText("Guidance only:", { exact: false })).toBeVisible();
  await expect(page.getByTestId("edit-before-preview").locator("img")).toBeVisible();
  await expect(page.getByTestId("edit-after-preview").locator("img")).toBeVisible();
  await expect(page.getByTestId("edit-input-summary")).toContainText("1 Image");
  await expect(page.getByTestId("edit-input-summary")).toContainText("1 Mask");
  await expect(page.getByTestId("edit-input-summary")).toContainText("1 Text");
  await expect(page.getByTestId("edit-mask-precedence")).toContainText("will override the connected Mask lane");
  await expect(page.getByLabel("Edit source image").locator("option")).toHaveCount(2);
  await expect(page.getByLabel("Edit source image")).not.toContainText("Unconnected image");
  const sourceArtifactQuery = await page.evaluate(() => {
    const queries = (window as typeof window & { __drawingQueries: Array<{ name: string; payload?: { outputVersionIds?: string[] } }> }).__drawingQueries;
    return queries.find((query) => query.name === "artifact.search" && query.payload?.outputVersionIds?.includes("source-output-a"))?.payload?.outputVersionIds;
  });
  expect(sourceArtifactQuery).toEqual(["source-output-b", "source-output-a", "edit-output-v1"]);

  await page.getByLabel("Frame mode").selectOption("crop");
  await expect.poll(() => graphCommandCount(page)).toBe(6);
  await page.getByLabel("Frame X").fill("90");
  await expect.poll(() => graphCommandCount(page)).toBe(7);
  await page.getByLabel("Frame width").fill("640");
  await expect.poll(() => graphCommandCount(page)).toBe(8);
  await expect(page.getByTestId("edit-frame-box")).toContainText("crop");
  await page.getByLabel("Frame mode").selectOption("outpaint");
  await expect.poll(() => graphCommandCount(page)).toBe(9);
  await expect(page.getByTestId("edit-frame-box")).toContainText("outpaint");

  const mask = page.getByTestId("mask-canvas-overlay");
  await mask.scrollIntoViewIfNeeded();
  await page.getByLabel("Mask brush size").fill("54");
  await page.getByLabel("Mask opacity").fill("0.65");
  await mask.scrollIntoViewIfNeeded();
  const maskBox = await mask.boundingBox();
  if (!maskBox) throw new Error("Mask canvas geometry unavailable");
  await page.mouse.move(maskBox.x + maskBox.width * .3, maskBox.y + maskBox.height * .35);
  await page.mouse.down();
  await page.mouse.move(maskBox.x + maskBox.width * .65, maskBox.y + maskBox.height * .6, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => graphCommandCount(page)).toBe(10);
  await expect(page.getByText("1 mask stroke", { exact: true })).toBeVisible();

  await page.getByLabel("Edit source image").selectOption("source-image-two");
  await expect.poll(() => graphCommandCount(page)).toBe(11);
  await expect(page.getByText("0 mask strokes", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Frame mode")).toHaveValue("source");
  await page.getByLabel("Frame mode").selectOption("outpaint");
  await expect.poll(() => graphCommandCount(page)).toBe(12);
  await page.getByRole("button", { name: "Mask brush" }).click();
  await mask.scrollIntoViewIfNeeded();
  await mask.click({ position: { x: 90, y: 70 } });
  await expect.poll(() => graphCommandCount(page)).toBe(13);
  await expect(page.getByText("1 mask stroke", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo mask stroke" }).click();
  await expect.poll(() => graphCommandCount(page)).toBe(14);
  await expect(page.getByText("0 mask strokes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Redo mask stroke" }).click();
  await expect.poll(() => graphCommandCount(page)).toBe(15);
  await page.getByRole("button", { name: "Mask eraser" }).click();
  await mask.scrollIntoViewIfNeeded();
  const eraserMaskBox = await mask.boundingBox();
  if (!eraserMaskBox) throw new Error("Mask canvas geometry unavailable for erasing");
  await page.mouse.click(eraserMaskBox.x + eraserMaskBox.width * .5, eraserMaskBox.y + eraserMaskBox.height * .5);
  await expect.poll(() => graphCommandCount(page)).toBe(16);
  await expect(page.getByText("2 mask strokes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo mask stroke" }).click();
  await expect.poll(() => graphCommandCount(page)).toBe(17);
  await expect(page.getByText("1 mask stroke", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Redo mask stroke" }).click();
  await expect.poll(() => graphCommandCount(page)).toBe(18);
  await page.getByRole("button", { name: "Commit mask" }).click();
  await expect(page.getByTestId("staged-mask-summary")).toContainText("image/svg+xml");
  await expect(page.getByTestId("staged-mask-summary")).toContainText("white-selected-black-clear");
  await page.getByRole("button", { name: "Save edit setup" }).click();
  await expect.poll(() => graphCommandCount(page)).toBe(19);
  await expect(page.getByTestId("canvas-status")).toContainText("Mask artifact mask-artifact committed");
  const commitPayload = await page.evaluate(() => {
    const commands = (window as typeof window & { __drawingCommands: Array<{ name: string; payload?: Record<string, unknown> }> }).__drawingCommands;
    return commands.find((command) => command.name === "editWorkspace.commit" && command.payload?.kind === "mask")?.payload as {
      graphId: string; nodeId: string; kind: string; channel: string; mediaType: string; width: number; height: number; byteLength: number;
      content: { encoding: string; data: string };
      geometry: { width: number; height: number; strokes: unknown[] };
      editState: { sourceArtifactId: string; recipeId: string; frame: { mode: string }; maskGeometry: unknown; capability: { providerId: string; profileId: string; mode: string } };
    };
  });
  expect(commitPayload).toMatchObject({
    graphId: "drawing-graph", nodeId: "edit", kind: "mask", channel: "mask", mediaType: "image/svg+xml", width: 900, height: 600,
    content: { encoding: "utf8" },
    editState: { sourceArtifactId: "source-image-two", recipeId: "freeform", frame: { mode: "outpaint" }, capability: { providerId: "edit-guidance", profileId: "guidance", mode: "guidance-only" } }
  });
  expect(commitPayload.geometry.strokes).toHaveLength(2);
  expect(commitPayload.editState.maskGeometry).toEqual(commitPayload.geometry);
  expect(commitPayload.content.data.startsWith("<svg")).toBeTruthy();
  expect(commitPayload.byteLength).toBe(new TextEncoder().encode(commitPayload.content.data).byteLength);
  const savedWorkspace = await page.evaluate(() => {
    const commands = (window as typeof window & { __drawingCommands: Array<{ name: string; payload?: { transaction?: { operations: Array<{ node?: { config?: { workspace?: unknown } } }> } } }> }).__drawingCommands;
    return commands.filter((command) => command.name === "graph.applyTransaction").at(-1)?.payload?.transaction?.operations[0]?.node?.config?.workspace;
  });
  expect(savedWorkspace).toMatchObject({ sourceArtifactId: "source-image-two", maskArtifactId: "mask-artifact", frame: { mode: "outpaint" }, maskGeometry: { strokes: [{ tool: "brush" }, { tool: "eraser" }] } });

  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await expect(page.getByLabel("Edit source image")).toHaveValue("source-image-two");
  await expect(page.getByLabel("Frame mode")).toHaveValue("outpaint");
  await expect(page.getByText("2 mask strokes", { exact: true })).toBeVisible();
  await expect(page.getByTestId("edit-mask-precedence")).toContainText("currently overrides the connected Mask lane");
  await page.getByRole("button", { name: "Hide Reference Desk" }).click();
  const inspectorResize = page.getByRole("separator", { name: "Resize Project lens" });
  const inspectorResizeBox = await inspectorResize.boundingBox();
  if (!inspectorResizeBox) throw new Error("Project lens resize handle unavailable for visual review");
  await page.mouse.move(inspectorResizeBox.x + inspectorResizeBox.width / 2, inspectorResizeBox.y + 40);
  await page.mouse.down();
  await page.mouse.move(inspectorResizeBox.x - 300, inspectorResizeBox.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.getByTestId("edit-workspace").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.resolve(process.cwd(), "../../output/playwright/task20-drawing-edit-1440x900.png"), fullPage: true });

  await page.getByLabel("Provider profile", { exact: true }).selectOption("edit-native:native");
  await page.getByRole("button", { name: "Save provider settings" }).click();
  await expect(page.getByText("Native inpainting:", { exact: false })).toBeVisible();
  await page.getByLabel("Provider profile", { exact: true }).selectOption("edit-basic:unsupported-mask");
  await page.getByRole("button", { name: "Save provider settings" }).click();
  await expect(page.getByText("Unsupported:", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Commit mask" })).toBeDisabled();
});

async function graphCommandCount(page: import("@playwright/test").Page) {
  return page.evaluate(() => (window as typeof window & { __drawingCommands: Array<{ name: string }> }).__drawingCommands.filter((command) => command.name === "graph.applyTransaction").length);
}

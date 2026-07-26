import { expect, test } from "@playwright/test";

test("cold-starts and keeps real 1,000-node canvas pan/zoom input responsive", async ({ page }) => {
  await page.addInitScript(() => {
    const longTasks: number[] = [];
    const frameGaps: number[] = [];
    let samplingFrames = false;
    let previousFrame = 0;
    const sampleFrame = (now: number) => {
      if (!samplingFrames) return;
      if (previousFrame > 0) frameGaps.push(now - previousFrame);
      previousFrame = now;
      requestAnimationFrame(sampleFrame);
    };
    const observer = typeof PerformanceObserver === "function" ? new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    }) : null;
    const nodes = Array.from({ length: 1_000 }, (_value, index) => ({
      id: `node-${String(index).padStart(4, "0")}`,
      definitionId: "prompt.text",
      title: `Performance ${index}`,
      position: { x: (index % 40) * 260, y: Math.floor(index / 40) * 170 },
      size: { width: 220, height: 140 },
      config: { kind: "prompt.text", body: `Prompt ${index}`, assembly: "append" },
      presentation: { collapsed: false, accent: "default", previewMode: "summary" }
    }));
    const graph = { id: "graph-performance", title: "1,000 node performance", kind: "root", createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z", nodes, edges: [], groups: [], modules: [], viewState: { viewport: { x: 0, y: 0, zoom: 0.2 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null } };
    const descriptor = { documentId: "performance-document", displayName: "Performance", named: true, mode: "writable", readOnlyReason: null, commands: { save: true, saveAs: true, saveCopy: true, compact: true, makePortable: true }, saveState: "saved", documentRevisionId: "document-revision", graphId: graph.id, graphRevisionId: "graph-revision", simulationEnabled: false, revision: 1 };
    Object.defineProperty(window, "__etherPerformance", { value: {
      longTasks,
      frameGaps,
      startInteraction: () => {
        observer?.disconnect();
        observer?.takeRecords();
        longTasks.length = 0;
        frameGaps.length = 0;
        try { observer?.observe({ type: "longtask" }); } catch { /* Chromium without long-task support. */ }
        samplingFrames = true;
        previousFrame = 0;
        requestAnimationFrame(sampleFrame);
      },
      stopInteraction: () => {
        samplingFrames = false;
        for (const entry of observer?.takeRecords() ?? []) longTasks.push(entry.duration);
        observer?.disconnect();
      }
    } });
    Object.defineProperty(window, "ether", { value: {
      document: { onEvent: () => () => undefined, bootstrap: async () => descriptor, new: async () => descriptor, open: async () => descriptor, openDropped: async () => descriptor, save: async () => descriptor, saveAs: async () => descriptor, saveCopy: async () => descriptor, compact: async () => ({ beforeBytes: 1, afterBytes: 1 }), makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] }), close: async () => null },
      graph: { snapshot: async () => ({ graph, revision: 1 }), applyTransaction: async () => ({ graph, revision: 1 }) },
      artifacts: { search: async () => [], generateFake: async () => [] },
      references: { list: async () => [], act: async () => [] },
      runtime: { versions: async () => ({ electron: "43", node: "24" }) }
    } });
  });
  const coldStarted = performance.now();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const surface = page.getByTestId("ether-canvas-surface");
  await expect(surface).toBeVisible();
  await expect(surface).toHaveAttribute("data-graph-node-count", "1000");
  await expect(surface).toHaveAttribute("data-semantic-overview", "true");
  const representedNodeCount = await page.locator("[data-cluster-node-count]").evaluateAll((clusters) =>
    clusters.reduce((total, cluster) => total + Number(cluster.getAttribute("data-cluster-node-count")), 0));
  expect(representedNodeCount).toBe(1_000);
  const visibleNodeCount = await page.locator(".ether-node").count();
  expect(visibleNodeCount).toBeGreaterThan(0);
  expect(visibleNodeCount).toBeLessThan(1_000);
  expect(performance.now() - coldStarted).toBeLessThan(3_000);
  const rendererMeasures = await page.evaluate(() => Object.fromEntries(performance.getEntriesByType("measure").map((entry) => [entry.name, entry.duration])));
  expect(rendererMeasures["cold-start:interactive"]).toBeLessThan(3_000);
  expect(rendererMeasures["document-open:interactive"]).toBeLessThan(2_000);

  await page.evaluate(() => new Promise<void>((resolve) => {
    requestIdleCallback(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())), { timeout: 2_000 });
  }));
  await page.evaluate(() => {
    const tracker = (window as typeof window & { __etherPerformance: { startInteraction(): void } }).__etherPerformance;
    tracker.startInteraction();
  });
  const canvas = page.locator(".react-flow__pane");
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error("Canvas pane has no bounds.");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(bounds.x + bounds.width / 2 + 180, bounds.y + bounds.height / 2 + 80, { steps: 12 });
  await page.mouse.up({ button: "middle" });
  for (let index = 0; index < 6; index += 1) await page.mouse.wheel(0, index % 2 === 0 ? -120 : 120);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const interaction = await page.evaluate(() => {
    const tracker = (window as typeof window & { __etherPerformance: { longTasks: number[]; frameGaps: number[]; stopInteraction(): void } }).__etherPerformance;
    tracker.stopInteraction();
    return { longTasks: tracker.longTasks, frameGaps: tracker.frameGaps };
  });
  expect(interaction.frameGaps.length).toBeGreaterThan(10);
  const orderedFrameGaps = [...interaction.frameGaps].sort((left, right) => left - right);
  const medianFrameGapMs = orderedFrameGaps[Math.floor(orderedFrameGaps.length / 2)]!;
  expect(medianFrameGapMs).toBeLessThan(20);
  expect(interaction.longTasks.filter((duration) => duration > 50)).toEqual([]);
  console.info(`ETHER_PERFORMANCE_METRIC canvas-pan-zoom ${JSON.stringify({
    nodeCount: 1_000,
    sampledFrames: interaction.frameGaps.length,
    medianFrameGapMs,
    maximumFrameGapMs: orderedFrameGaps.at(-1),
    longTasksOver50Ms: interaction.longTasks.filter((duration) => duration > 50)
  })}`);

  const zoomIn = page.locator(".react-flow__controls-zoomin");
  for (let index = 0; index < 5; index += 1) await zoomIn.click();
  await expect(surface).toHaveAttribute("data-semantic-overview", "false");
  await expect(page.locator(".react-flow__handle").first()).toBeVisible();
});

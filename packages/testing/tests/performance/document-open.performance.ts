import { createEtherDocument, inspectEtherDocument } from "@ether/document";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EtherApplication } from "@ether/application";
import { FakeImageProvider } from "@ether/providers";
import type { EtherGraph } from "@ether/schema";
import { afterEach, describe, expect, it } from "vitest";

const budgetMs = 2_000;
let root = "";
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ""; });

describe("document open performance", () => {
  it(`opens a typical document under ${budgetMs}ms`, () => {
    root = mkdtempSync(path.join(tmpdir(), "ether-open-performance-"));
    const file = path.join(root, "typical.ether");
    createEtherDocument(file, { appVersion: "4.0.0", documentId: "performance-open", title: "Typical document" });
    const started = performance.now();
    const inspection = inspectEtherDocument(file);
    const inspectMs = performance.now() - started;
    expect(inspectMs).toBeLessThan(budgetMs);
    expect(inspection.quickCheck).toBe("ok");
    const database = new DatabaseSync(file);
    try {
      const autosaveStarted = performance.now();
      database.exec("BEGIN IMMEDIATE; UPDATE document SET updated_at = '2026-07-23T00:00:00.000Z' WHERE singleton = 1; COMMIT;");
      const transactionMs = performance.now() - autosaveStarted;
      expect(transactionMs).toBeLessThan(50);
      database.prepare("INSERT INTO blobs (content_key, status, byte_length, media_type, inline_data, chunk_count, created_at, updated_at) VALUES (?, 'ready', ?, 'image/png', ?, 0, ?, ?)")
        .run("a".repeat(64), 256 * 1024, Buffer.alloc(256 * 1024, 9), "2026-07-23T00:00:00.000Z", "2026-07-23T00:00:00.000Z");
      const rangeStarted = performance.now();
      const range = database.prepare("SELECT substr(inline_data, ?, ?) AS bytes FROM blobs WHERE content_key = ?").get(32_769, 65_536, "a".repeat(64)) as { bytes: Buffer };
      expect(range.bytes.byteLength).toBe(65_536);
      const rangeReadMs = performance.now() - rangeStarted;
      expect(rangeReadMs).toBeLessThan(200);
      console.info(`ETHER_PERFORMANCE_METRIC document-inspection ${JSON.stringify({ inspectMs, transactionMs, rangeReadMs })}`);
    } finally { database.close(); }
  });

  it("opens to an interactive application graph and completes a real autosave without a canvas hitch", async () => {
    root = mkdtempSync(path.join(tmpdir(), "ether-application-performance-"));
    const file = path.join(root, "application.ether");
    const appDataRoot = path.join(root, "app-data");
    const graph: EtherGraph = { id: "graph-root", title: "Performance", kind: "root", createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:00:00.000Z", nodes: [], edges: [], groups: [], modules: [], viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null } };
    const creator = new EtherApplication({ appDataRoot, appVersion: "4.0.0-test", provider: new FakeImageProvider() });
    await creator.createDocument({ path: file, title: "Application performance", initialGraph: graph });
    await creator.closeDocument();
    const application = new EtherApplication({ appDataRoot, appVersion: "4.0.0-test", provider: new FakeImageProvider() });
    try {
      const started = performance.now();
      await application.openDocument({ path: file, access: "require-write" });
      const snapshot = await application.queryDocument();
      const interactive = await application.queryGraph(graph.id);
      const openMs = performance.now() - started;
      expect(openMs).toBeLessThan(budgetMs);
      expect(snapshot.documentId).toBeTruthy();
      expect(interactive.id).toBe("graph-root");
      const autosaveStarted = performance.now();
      await application.autosaveDocument();
      const autosaveMs = performance.now() - autosaveStarted;
      expect(autosaveMs).toBeLessThan(50);
      console.info(`ETHER_PERFORMANCE_METRIC application-document-open ${JSON.stringify({ nodeCount: graph.nodes.length, openMs, autosaveMs })}`);
    } finally { await application.closeDocument(); }
  });
});

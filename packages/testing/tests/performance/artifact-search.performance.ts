import { ArtifactRepository, createEtherDocument } from "@ether/document";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

let root = "";
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ""; });

function seedArtifactSearchDocument(file: string) {
  createEtherDocument(file, { appVersion: "4.0.0", documentId: "artifact-performance", title: "Artifact performance" });
  const database = new DatabaseSync(file, { enableForeignKeyConstraints: true });
  database.exec("BEGIN");
  try {
    const now = "2026-07-23T00:00:00.000Z";
    database.prepare("INSERT INTO graphs VALUES (?, ?, 'root', ?, ?, NULL)").run("graph", "Performance", now, now);
    database.prepare("INSERT INTO nodes (node_id, graph_id, definition_id, title, position_x, position_y, width, height, config_json, presentation_json, created_at, updated_at) VALUES (?, ?, 'prompt.text', ?, 0, 0, 220, 140, '{}', '{}', ?, ?)").run("node", "graph", "Performance node", now, now);
    database.prepare("INSERT INTO graph_revisions (revision_id, graph_id, parent_revision_id, actor, title, created_at, operation_count, metadata_json) VALUES (?, ?, NULL, 'system', ?, ?, 0, '{}')").run("revision", "graph", "Genesis", now);
    database.prepare("INSERT INTO node_output_versions (output_version_id, node_id, graph_id, graph_revision_id, parent_output_version_id, producer_json, input_payload_ids_json, selected_output_version_ids_json, compiled_context_hash, timing_json, created_at) VALUES (?, ?, ?, ?, NULL, '{}', '[]', '[]', 'hash', '{}', ?)").run("output", "node", "graph", "revision", now);
    database.prepare("INSERT INTO node_output_payloads (payload_id, output_version_id, channel, role, content_text, content_json, metadata_json, created_at) VALUES (?, ?, 'image', 'general', NULL, '{}', '{}', ?)").run("payload", "output", now);
    const contentKey = "a".repeat(64);
    database.prepare("INSERT INTO blobs (content_key, status, byte_length, media_type, inline_data, chunk_count, created_at, updated_at) VALUES (?, 'ready', 0, 'image/png', X'', 0, ?, ?)").run(contentKey, now, now);
    const insert = database.prepare("INSERT INTO artifacts (artifact_id, content_key, kind, channel, media_type, byte_length, source_output_version_id, source_payload_id, title, description, metadata_json, created_at) VALUES (?, ?, 'image', 'image', 'image/png', 0, 'output', 'payload', ?, ?, ?, ?)");
    for (let index = 0; index < 10_000; index += 1) insert.run(`artifact-${String(index).padStart(5, "0")}`, contentKey, `Campaign image ${index}`, index === 6_789 ? "needle performance artifact" : "generated campaign artifact", JSON.stringify({ ordinal: index }), now);
    database.exec("COMMIT");
    return database;
  } catch (error) { database.exec("ROLLBACK"); database.close(); throw error; }
}

describe("artifact search performance", () => {
  it("uses ArtifactRepository FTS over a 10,000-artifact .ether document under 200ms", () => {
    root = mkdtempSync(path.join(tmpdir(), "ether-artifact-performance-"));
    const database = seedArtifactSearchDocument(path.join(root, "artifacts.ether"));
    try {
      const repository = new ArtifactRepository({ database } as never);
      const started = performance.now();
      const page = repository.searchPage({ text: "needle", channels: [], collectionIds: [], tags: [], minimumRating: null, providerId: null, modelId: null, runId: null, graphId: null, createdAfter: null, createdBefore: null, limit: 1 });
      const firstResultMs = performance.now() - started;
      expect(firstResultMs).toBeLessThan(200);
      expect(page.artifacts.map((artifact) => artifact.id)).toEqual(["artifact-06789"]);
      expect(page.total).toBe(1);
      console.info(`ETHER_PERFORMANCE_METRIC artifact-search ${JSON.stringify({ artifactCount: 10_000, firstResultMs })}`);
    } finally { database.close(); }
  });
});

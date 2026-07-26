import { mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEtherDocument } from "@ether/document";
import { DatabaseSync } from "node:sqlite";

const directory = path.dirname(fileURLToPath(import.meta.url));
const now = "2026-07-23T00:00:00.000Z";
mkdirSync(directory, { recursive: true });

function seedRepresentative(file, documentId, title, includeExecution = true, includeArtifacts = true) {
  const destination = path.join(directory, file);
  rmSync(destination, { force: true });
  createEtherDocument(destination, { appVersion: "4.0.0", documentId, title });
  const database = new DatabaseSync(destination, { enableForeignKeyConstraints: true });
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("UPDATE document SET created_at = ?, updated_at = ? WHERE singleton = 1").run(now, now);
    database.prepare("INSERT INTO graphs VALUES ('golden-graph', 'Golden campaign', 'root', ?, ?, NULL)").run(now, now);
    database.prepare("INSERT INTO workspace_views VALUES ('active:golden-graph', 'golden-graph', 'Active', '{\"x\":0,\"y\":0,\"zoom\":1}', '{\"selectedNodeIds\":[],\"selectedEdgeIds\":[]}', 'null', 1, ?, ?)").run(now, now);
    const node = database.prepare("INSERT INTO nodes (node_id, graph_id, definition_id, title, position_x, position_y, width, height, config_json, presentation_json, node_order, created_at, updated_at) VALUES (?, 'golden-graph', ?, ?, ?, 80, 220, 140, ?, ?, ?, ?, ?)");
    node.run("golden-prompt", "prompt.text", "Golden prompt", 40, JSON.stringify({ kind: "prompt.text", body: "A deterministic cobalt product study", assembly: "append" }), JSON.stringify({ collapsed: false, accent: "default", previewMode: "content" }), 0, now, now);
    node.run("golden-generation", "generation.image", "Golden image", 340, JSON.stringify({ kind: "generation.image", providerId: "ether-fake-local", profileId: "fake-image-default", aspectRatio: "1:1", resolution: { width: 64, height: 64 }, outputCount: 1 }), JSON.stringify({ collapsed: false, accent: "default", previewMode: "summary" }), 1, now, now);
    database.prepare("INSERT INTO edges (edge_id, graph_id, source_kind, source_node_id, source_channel, target_kind, target_node_id, target_channel, role, lane_order, selector_json, adapter_json, enabled, edge_order) VALUES ('golden-edge', 'golden-graph', 'node', 'golden-prompt', 'text', 'node', 'golden-generation', 'text', 'subject', 0, '{\"kind\":\"latest-approved\"}', '{\"kind\":\"auto\"}', 1, 0)").run();
    database.prepare("INSERT INTO graph_revisions (revision_id, graph_id, parent_revision_id, actor, title, created_at, operation_count, metadata_json, kind) VALUES ('golden-graph-revision', 'golden-graph', NULL, 'system', 'Genesis', ?, 3, '{}', 'genesis')").run(now);
    database.prepare("INSERT INTO document_revisions (document_revision_id, parent_document_revision_id, actor, title, created_at, metadata_json, kind, revision_order) VALUES ('golden-document-revision', NULL, 'system', 'Genesis', ?, '{}', 'genesis', 0)").run(now);
    database.exec("INSERT INTO graph_heads VALUES ('golden-graph', 'golden-graph-revision'); INSERT INTO document_revision_members VALUES ('golden-document-revision', 'golden-graph', 'golden-graph-revision'); INSERT INTO document_state VALUES (1, 'golden-document-revision', 0)");
    if (includeArtifacts) {
      database.prepare("INSERT INTO node_output_versions (output_version_id, node_id, graph_id, graph_revision_id, parent_output_version_id, producer_json, input_payload_ids_json, selected_output_version_ids_json, output_payload_ids_json, compiled_context_hash, timing_json, created_at) VALUES ('golden-output', 'golden-generation', 'golden-graph', 'golden-graph-revision', NULL, '{\"kind\":\"local\",\"executor\":\"image-provider\"}', '[]', '[]', '[\"golden-payload\"]', 'sha256:golden', ?, ?)").run(JSON.stringify({ startedAt: now, completedAt: now }), now);
      database.prepare("INSERT INTO node_output_payloads (payload_id, output_version_id, channel, role, content_text, content_json, source_json, metadata_json, created_at) VALUES ('golden-payload', 'golden-output', 'image', 'general', NULL, ?, ?, '{}', ?)").run(JSON.stringify({ kind: "artifact", artifactId: "golden-artifact" }), JSON.stringify({ nodeId: "golden-generation", outputVersionId: "golden-output", lineageKey: "golden-lineage" }), now);
      const originalBytes = Buffer.alloc(4096, 17);
      const thumbnailBytes = Buffer.alloc(1024, 23);
      const originalKey = createHash("sha256").update(originalBytes).digest("hex");
      const thumbnailKey = createHash("sha256").update(thumbnailBytes).digest("hex");
      database.prepare("INSERT INTO blobs (content_key, status, byte_length, media_type, inline_data, chunk_count, created_at, updated_at) VALUES (?, 'ready', ?, 'image/png', ?, 0, ?, ?)").run(originalKey, originalBytes.byteLength, originalBytes, now, now);
      database.prepare("INSERT INTO blobs (content_key, status, byte_length, media_type, inline_data, chunk_count, created_at, updated_at) VALUES (?, 'ready', ?, 'image/png', ?, 0, ?, ?)").run(thumbnailKey, thumbnailBytes.byteLength, thumbnailBytes, now, now);
      database.prepare("INSERT INTO artifacts (artifact_id, content_key, kind, channel, media_type, byte_length, source_output_version_id, source_payload_id, title, description, metadata_json, created_at) VALUES ('golden-artifact', ?, 'image', 'image', 'image/png', 4096, 'golden-output', 'golden-payload', 'Golden artifact', 'Deterministic embedded output', ?, ?)").run(originalKey, JSON.stringify({ thumbnailContentKey: thumbnailKey }), now);
    }
    if (includeExecution) {
      database.prepare("INSERT INTO recipes (recipe_id, name, version, manifest_json, installed_at) VALUES ('golden-recipe', 'Prompt to Image', '4.0.0', ?, ?)").run(JSON.stringify({ id: "golden-recipe", title: "Prompt to Image", version: "4.0.0" }), now);
      database.prepare("INSERT INTO execution_plans (plan_id, document_revision_id, graph_id, graph_revision_id, capsule_version, hash_version, content_hash, scope_json, capsule_json, status, created_at, updated_at) VALUES ('golden-plan', 'golden-document-revision', 'golden-graph', 'golden-graph-revision', 1, 'sha256-v1', ?, '{}', '{}', 'started', ?, ?)").run("3".repeat(64), now, now);
      database.exec(`INSERT INTO plan_steps (step_id, plan_id, subject_kind, node_id, step_order, dependencies_json, config_json, status) VALUES ('golden-step', 'golden-plan', 'node', 'golden-generation', 0, '[]', '{}', 'ready'); INSERT INTO execution_jobs (job_id, plan_id, plan_content_hash, start_command_id, status, created_at) VALUES ('golden-job', 'golden-plan', '${"3".repeat(64)}', 'golden-command', 'queued', '${now}')`);
      const work = database.prepare("INSERT INTO work_items (work_item_id, job_id, step_id, planned_work_item_id, item_index, input_json, status, created_at, updated_at) VALUES (?, 'golden-job', 'golden-step', ?, ?, ?, 'queued', ?, ?)");
      for (let index = 0; index < 3; index += 1) work.run(`golden-work-${index}`, `golden-planned-${index}`, index, JSON.stringify({ prompt: `Golden ${index}` }), now, now);
    }
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); database.close(); throw error; }
  database.close();
  return destination;
}

seedRepresentative("golden.ether", "ether-4.0-golden", "Ether 4.0 golden fixture");
const recoveryPath = seedRepresentative("recovery-read-only.ether", "ether-4.0-recovery", "Ether 4.0 recovery fixture", false, false);
const futurePath = seedRepresentative("future-major.ether", "ether-5.0-future", "Ether future-major fixture");

const recovery = new DatabaseSync(recoveryPath);
try { recovery.prepare("DELETE FROM prompt_output_fts WHERE source_type = 'prompt' AND source_id = 'golden-prompt'").run(); } finally { recovery.close(); }
const future = new DatabaseSync(futurePath);
try { future.prepare("UPDATE document SET format_version = '5.0.0' WHERE singleton = 1").run(); } finally { future.close(); }

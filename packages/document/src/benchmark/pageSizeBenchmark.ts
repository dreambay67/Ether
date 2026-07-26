import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  ETHER_SCHEMA_VERSION,
  ETHER_SQLITE_APPLICATION_ID,
  type Artifact
} from "@ether/schema";

import { importBlob } from "../blob/importBlob.js";
import { readBlobRange } from "../blob/readBlobRange.js";
import { DOCUMENT_STORE_INTERNAL, DocumentStore } from "../documentStore.js";
import { ArtifactRepository } from "../repositories/artifacts.js";
import { BlobRepository } from "../repositories/blobs.js";
import { createRepositoryContext } from "../repositories/graphs.js";
import { ETHER_SCHEMA_SQL } from "../validation.js";
import { ETHER_PAGE_SIZE } from "../format.js";

export const ETHER_PAGE_SIZE_CANDIDATES = [4_096, 8_192, 16_384, 32_768] as const;
export const ETHER_PAGE_SIZE_STABILITY_TOLERANCE = 0.15 as const;
export type EtherPageSize = (typeof ETHER_PAGE_SIZE_CANDIDATES)[number];

export interface PageSizeBenchmarkResult {
  pageSize: EtherPageSize;
  sampleCount: number;
  sampleCounts: {
    fileBytes: number;
    writeMs: number;
    graphReadMs: number;
    artifactFtsMs: number;
    thumbnailReadMs: number;
    rangeReadMs: number;
    recipeReadMs: number;
    workItemReadMs: number;
  };
  fileBytes: number;
  writeMs: number;
  graphReadMs: number;
  artifactFtsMs: number;
  thumbnailReadMs: number;
  rangeReadMs: number;
  recipeReadMs: number;
  workItemReadMs: number;
  elapsedMs: number;
}

export interface PageSizeProductionDecision {
  measuredWinner: EtherPageSize;
  productionPageSize: EtherPageSize;
  tolerance: number;
  productionDelta: number;
  candidateScores: Readonly<Record<EtherPageSize, number>>;
  rationale: string;
}

function elapsed(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

async function elapsedAsync(run: () => Promise<void>): Promise<number> {
  const started = performance.now();
  await run();
  return performance.now() - started;
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function measureIsolated(operation: () => void): number {
  operation();
  operation();
  return elapsed(operation);
}

async function measureIsolatedAsync(operation: () => Promise<void>): Promise<number> {
  await operation();
  await operation();
  return elapsedAsync(operation);
}

function seedRepresentativeWorkload(database: DatabaseSync): void {
  const now = "2026-07-23T00:00:00.000Z";
  database.exec(ETHER_SCHEMA_SQL);
  database.prepare("INSERT INTO document VALUES (1, ?, 'ETHERDOC', '4.0.0', 40000, ?, ?, ?, '4.0.0', '{}')")
    .run("page-size-benchmark", "Page size benchmark", now, now);
  database.prepare("INSERT INTO graphs VALUES (?, ?, 'root', ?, ?, NULL)").run("graph", "Benchmark graph", now, now);
  database.prepare("INSERT INTO workspace_views VALUES ('active:graph', 'graph', 'Active', '{\"x\":0,\"y\":0,\"zoom\":1}', '{\"selectedNodeIds\":[],\"selectedEdgeIds\":[]}', 'null', 1, ?, ?)").run(now, now);
  const node = database.prepare("INSERT INTO nodes (node_id, graph_id, definition_id, title, position_x, position_y, width, height, config_json, presentation_json, node_order, created_at, updated_at) VALUES (?, 'graph', 'prompt.text', ?, ?, ?, 220, 140, ?, '{}', ?, ?, ?)");
  for (let index = 0; index < 1_000; index += 1) node.run(`node-${index}`, `Node ${index}`, index % 40, Math.floor(index / 40), JSON.stringify({ kind: "prompt.text", body: `Prompt ${index}`, assembly: "append" }), index, now, now);
  database.prepare("INSERT INTO graph_revisions (revision_id, graph_id, parent_revision_id, actor, title, created_at, operation_count, metadata_json, kind) VALUES ('graph-revision', 'graph', NULL, 'system', 'Genesis', ?, 1000, '{}', 'genesis')").run(now);
  database.prepare("INSERT INTO document_revisions (document_revision_id, parent_document_revision_id, actor, title, created_at, metadata_json, kind, revision_order) VALUES ('document-revision', NULL, 'system', 'Genesis', ?, '{}', 'genesis', 0)").run(now);
  database.exec("INSERT INTO graph_heads VALUES ('graph', 'graph-revision'); INSERT INTO document_revision_members VALUES ('document-revision', 'graph', 'graph-revision'); INSERT INTO document_state VALUES (1, 'document-revision', 0)");
  database.prepare("INSERT INTO node_output_versions (output_version_id, node_id, graph_id, graph_revision_id, parent_output_version_id, producer_json, input_payload_ids_json, selected_output_version_ids_json, compiled_context_hash, timing_json, created_at) VALUES ('output', 'node-0', 'graph', 'graph-revision', NULL, '{}', '[]', '[]', 'sha256:benchmark', '{}', ?)").run(now);
  database.prepare("INSERT INTO node_output_payloads (payload_id, output_version_id, channel, role, content_text, content_json, source_json, metadata_json, created_at) VALUES ('payload', 'output', 'image', 'general', NULL, '{}', ?, '{}', ?)").run(
    JSON.stringify({ nodeId: "node-0", outputVersionId: "output" }),
    now
  );
  const recipe = database.prepare("INSERT INTO recipes (recipe_id, name, version, manifest_json, installed_at) VALUES (?, ?, '4.0.0', ?, ?)");
  for (let index = 0; index < 12; index += 1) recipe.run(`recipe-${index}`, `Recipe ${index}`, JSON.stringify({ id: `recipe-${index}`, version: "4.0.0", nodes: ["prompt.text", "generation.image"] }), now);
  database.prepare("INSERT INTO execution_plans (plan_id, document_revision_id, graph_id, graph_revision_id, capsule_version, hash_version, content_hash, scope_json, capsule_json, status, created_at, updated_at) VALUES ('plan', 'document-revision', 'graph', 'graph-revision', 1, 'sha256-v1', ?, '{}', '{}', 'started', ?, ?)").run("c".repeat(64), now, now);
  database.exec("INSERT INTO plan_steps (step_id, plan_id, subject_kind, node_id, step_order, dependencies_json, config_json, status) VALUES ('step', 'plan', 'node', 'node-0', 0, '[]', '{}', 'ready'); INSERT INTO execution_jobs (job_id, plan_id, plan_content_hash, start_command_id, status, created_at) VALUES ('job', 'plan', '" + "c".repeat(64) + "', 'command', 'queued', '" + now + "')");
  const work = database.prepare("INSERT INTO work_items (work_item_id, job_id, step_id, planned_work_item_id, item_index, input_json, status, created_at, updated_at) VALUES (?, 'job', 'step', ?, ?, ?, 'queued', ?, ?)");
  for (let index = 0; index < 500; index += 1) work.run(`work-${index}`, `planned-${index}`, index, JSON.stringify({ prompt: `Work ${index}` }), now, now);
}

function imageBytes(byteLength: number, fill: number): Buffer {
  const bytes = Buffer.alloc(byteLength, fill);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  return bytes;
}

function webpBytes(byteLength: number, fill: number): Buffer {
  const bytes = Buffer.alloc(byteLength, fill);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(byteLength - 8, 4);
  bytes.write("WEBP", 8, "ascii");
  return bytes;
}

async function seedProductionBlobWorkload(
  store: DocumentStore,
  sources: {
    appDataRoot: string;
    contentPath: string;
    contentLength: number;
    thumbnailPath: string;
    thumbnailLength: number;
  }
): Promise<{ contentKey: string; contentLength: number; thumbnailKey: string; thumbnailLength: number }> {
  const content = await importBlob(
    store,
    { mediaType: "image/png", sourcePath: sources.contentPath },
    { appDataRoot: sources.appDataRoot }
  );
  const thumbnail = await importBlob(
    store,
    { mediaType: "image/webp", sourcePath: sources.thumbnailPath },
    { appDataRoot: sources.appDataRoot }
  );
  if (
    content.storage !== "chunked" ||
    thumbnail.storage !== "inline" ||
    content.byteLength !== sources.contentLength ||
    thumbnail.byteLength !== sources.thumbnailLength
  ) {
    throw new Error("Page-size benchmark did not exercise production chunked and inline blob storage.");
  }
  const now = "2026-07-23T00:00:00.000Z";
  await store[DOCUMENT_STORE_INTERNAL]("write", ({ artifacts }) => {
    for (let index = 0; index < 10_000; index += 1) {
      const artifact: Artifact = {
        id: `artifact-${index}`,
        contentKey: content.contentKey,
        channel: "image",
        mediaType: content.mediaType,
        byteLength: content.byteLength,
        source: { outputVersionId: "output", payloadId: "payload" },
        createdAt: now,
        metadata: {
          description: index === 6_789 ? "needle featured artifact" : "generated campaign artifact",
          ordinal: index,
          thumbnailByteLength: thumbnail.byteLength,
          thumbnailContentKey: thumbnail.contentKey,
          thumbnailMediaType: thumbnail.mediaType,
          title: `Campaign image ${index}`
        }
      };
      artifacts.attach(artifact);
    }
  });
  return {
    contentKey: content.contentKey,
    contentLength: sources.contentLength,
    thumbnailKey: thumbnail.contentKey,
    thumbnailLength: sources.thumbnailLength
  };
}

function prepareProductionBlobSources(
  root: string,
  sampleIndex: number,
  pageSize: EtherPageSize
) {
  const contentBytes = imageBytes(2 * 1024 * 1024, 7);
  const thumbnailBytes = webpBytes(64 * 1024, 9);
  const sourcePrefix = path.join(root, `${sampleIndex}-${pageSize}`);
  const contentPath = `${sourcePrefix}.content.png`;
  const thumbnailPath = `${sourcePrefix}.thumbnail.webp`;
  writeFileSync(contentPath, contentBytes);
  writeFileSync(thumbnailPath, thumbnailBytes);
  return {
    appDataRoot: path.join(root, "app-data"),
    contentPath,
    contentLength: contentBytes.byteLength,
    thumbnailPath,
    thumbnailLength: thumbnailBytes.byteLength
  };
}

/**
 * Candidate databases intentionally cannot pass DocumentStore.open(): the production
 * store freezes one page size. Keep the benchmark on the same import/range code and
 * repositories while limiting the bypass to this benchmark-only adapter.
 */
function createCandidateStore(database: DatabaseSync, filePath: string): DocumentStore {
  const run = async <T>(
    mode: "read" | "write",
    callback: (repositories: {
      artifacts: ArtifactRepository;
      blobs: BlobRepository;
    }) => T
  ): Promise<T> => {
    if (mode === "write") database.exec("BEGIN IMMEDIATE");
    try {
      const context = createRepositoryContext(database);
      const result = callback({
        artifacts: new ArtifactRepository(context),
        blobs: new BlobRepository(context)
      });
      if (mode === "write") database.exec("COMMIT");
      return result;
    } catch (error) {
      if (mode === "write") database.exec("ROLLBACK");
      throw error;
    }
  };
  return {
    close: async () => undefined,
    documentId: "page-size-benchmark",
    path: filePath,
    read: (callback: Parameters<DocumentStore["read"]>[0]) =>
      run("read", callback as unknown as Parameters<typeof run>[1]),
    [DOCUMENT_STORE_INTERNAL]: (
      mode: "read" | "write",
      callback: Parameters<DocumentStore[typeof DOCUMENT_STORE_INTERNAL]>[1]
    ) => run(mode, callback as unknown as Parameters<typeof run>[1])
  } as unknown as DocumentStore;
}

/** Complete 4.0 workload: graph, blobs/thumbnails, FTS, ranges, recipes and 500 work items. */
export async function benchmarkPageSizes(): Promise<PageSizeBenchmarkResult[]> {
  const root = mkdtempSync(path.join(tmpdir(), "ether-page-size-"));
  try {
    const sampleCount = 7;
    const samples = new Map<EtherPageSize, Array<Omit<PageSizeBenchmarkResult, "pageSize" | "sampleCount" | "sampleCounts">>>(
      ETHER_PAGE_SIZE_CANDIDATES.map((pageSize) => [pageSize, []])
    );
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      for (const pageSize of counterbalancedOrder(sampleIndex)) {
        const filePath = path.join(root, `${sampleIndex}-${pageSize}.ether`);
        const blobSources = prepareProductionBlobSources(root, sampleIndex, pageSize);
        const database = new DatabaseSync(filePath);
        let store: DocumentStore | undefined;
        let queryDatabase: DatabaseSync | undefined;
        try {
          database.exec(`
            PRAGMA page_size = ${pageSize};
            PRAGMA auto_vacuum = INCREMENTAL;
            PRAGMA application_id = ${ETHER_SQLITE_APPLICATION_ID};
            PRAGMA user_version = ${ETHER_SCHEMA_VERSION};
            PRAGMA journal_mode = DELETE;
            PRAGMA synchronous = FULL;
            PRAGMA foreign_keys = ON;
            BEGIN IMMEDIATE;
          `);
          const writeStarted = performance.now();
          try { seedRepresentativeWorkload(database); database.exec("COMMIT"); } catch (error) { database.exec("ROLLBACK"); throw error; }
          store = createCandidateStore(database, filePath);
          const seeded = await seedProductionBlobWorkload(store, blobSources);
          const writeMs = performance.now() - writeStarted;
          queryDatabase = new DatabaseSync(filePath, { readOnly: true });
          const graphReadMs = measureIsolated(() => { queryDatabase!.prepare("SELECT node_id, position_x, position_y, config_json FROM nodes WHERE graph_id = 'graph' ORDER BY node_order").all(); });
          const artifactFtsMs = measureIsolated(() => { queryDatabase!.prepare("SELECT artifact_id FROM artifact_fts WHERE artifact_fts MATCH 'needle' LIMIT 100").all(); });
          const thumbnailReadMs = await measureIsolatedAsync(async () => {
            await readBlobRange(store!, seeded.thumbnailKey, 0, seeded.thumbnailLength);
          });
          const rangeStart = 32_768;
          const rangeEnd = Math.min(seeded.contentLength, rangeStart + 65_536);
          const rangeReadMs = await measureIsolatedAsync(async () => {
            await readBlobRange(store!, seeded.contentKey, rangeStart, rangeEnd);
          });
          const recipeReadMs = measureIsolated(() => { queryDatabase!.prepare("SELECT recipe_id, manifest_json FROM recipes ORDER BY recipe_id").all(); });
          const workItemReadMs = measureIsolated(() => { queryDatabase!.prepare("SELECT work_item_id, input_json FROM work_items WHERE job_id = 'job' ORDER BY item_index").all(); });
          queryDatabase.close();
          queryDatabase = undefined;
          store = undefined;
          database.close();
          samples.get(pageSize)!.push({
            fileBytes: statSync(filePath).size,
            writeMs,
            graphReadMs,
            artifactFtsMs,
            thumbnailReadMs,
            rangeReadMs,
            recipeReadMs,
            workItemReadMs,
            elapsedMs: graphReadMs + artifactFtsMs + thumbnailReadMs + rangeReadMs + recipeReadMs + workItemReadMs
          });
        } finally {
          queryDatabase?.close();
          await store?.close();
          try {
            database.close();
          } catch {
            // The seed connection closes before the production DocumentStore opens.
          }
        }
      }
    }
    return ETHER_PAGE_SIZE_CANDIDATES.map((pageSize) => {
      const candidateSamples = samples.get(pageSize)!;
      const metric = (name: keyof typeof candidateSamples[number]) =>
        median(candidateSamples.map((sample) => sample[name]));
      const graphReadMs = metric("graphReadMs");
      const artifactFtsMs = metric("artifactFtsMs");
      const thumbnailReadMs = metric("thumbnailReadMs");
      const rangeReadMs = metric("rangeReadMs");
      const recipeReadMs = metric("recipeReadMs");
      const workItemReadMs = metric("workItemReadMs");
      return {
        pageSize,
        sampleCount,
        sampleCounts: {
          fileBytes: candidateSamples.length,
          writeMs: candidateSamples.length,
          graphReadMs: candidateSamples.length,
          artifactFtsMs: candidateSamples.length,
          thumbnailReadMs: candidateSamples.length,
          rangeReadMs: candidateSamples.length,
          recipeReadMs: candidateSamples.length,
          workItemReadMs: candidateSamples.length
        },
        fileBytes: metric("fileBytes"),
        writeMs: metric("writeMs"),
        graphReadMs,
        artifactFtsMs,
        thumbnailReadMs,
        rangeReadMs,
        recipeReadMs,
        workItemReadMs,
        elapsedMs: graphReadMs + artifactFtsMs + thumbnailReadMs + rangeReadMs + recipeReadMs + workItemReadMs
      };
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function counterbalancedOrder(sampleIndex: number): readonly EtherPageSize[] {
  const candidates = [...ETHER_PAGE_SIZE_CANDIDATES];
  const rotation = Math.floor(sampleIndex / 2) % candidates.length;
  const rotated = [...candidates.slice(rotation), ...candidates.slice(0, rotation)];
  return sampleIndex % 2 === 0 ? rotated : [...rotated].reverse();
}

function normalized(value: number, minimum: number): number {
  return minimum === 0 ? 1 : value / minimum;
}

export function decideProductionPageSize(results: readonly PageSizeBenchmarkResult[]): PageSizeProductionDecision {
  if (results.length !== ETHER_PAGE_SIZE_CANDIDATES.length || ETHER_PAGE_SIZE_CANDIDATES.some((pageSize) => !results.some((result) => result.pageSize === pageSize))) throw new Error("All Ether page-size candidates must be benchmarked exactly once.");
  const minima = {
    elapsed: Math.min(...results.map((result) => result.elapsedMs)),
    write: Math.min(...results.map((result) => result.writeMs)),
    bytes: Math.min(...results.map((result) => result.fileBytes))
  };
  const entries = results.map((result) => [result.pageSize, 0.6 * normalized(result.elapsedMs, minima.elapsed) + 0.25 * normalized(result.writeMs, minima.write) + 0.15 * normalized(result.fileBytes, minima.bytes)] as const);
  const candidateScores = Object.fromEntries(entries) as Record<EtherPageSize, number>;
  const measuredWinner = [...entries].sort((left, right) => left[1] - right[1] || left[0] - right[0])[0]![0];
  const winnerScore = candidateScores[measuredWinner];
  const frozenCandidate = ETHER_PAGE_SIZE;
  const productionDelta = candidateScores[frozenCandidate] / winnerScore - 1;
  if (productionDelta > ETHER_PAGE_SIZE_STABILITY_TOLERANCE) {
    throw new Error(`Frozen Ether page size ${frozenCandidate} is ${(productionDelta * 100).toFixed(2)}% slower than measured winner ${measuredWinner}, outside the ${(ETHER_PAGE_SIZE_STABILITY_TOLERANCE * 100).toFixed(0)}% stability tolerance. Candidate scores: ${JSON.stringify(candidateScores)}.`);
  }
  return { measuredWinner, productionPageSize: frozenCandidate, tolerance: ETHER_PAGE_SIZE_STABILITY_TOLERANCE, productionDelta, candidateScores, rationale: `16 KiB remains the stable production format because its complete-workload composite is within ${Math.round(ETHER_PAGE_SIZE_STABILITY_TOLERANCE * 100)}% of the measured winner.` };
}

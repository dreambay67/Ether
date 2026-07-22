import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRepositoryContext } from "../../document/src/repositories/graphs.js";
import {
  LiveOutputRepository,
  type LiveOutputDirectoryGrant
} from "../../document/src/repositories/liveOutput.js";
import {
  materializeLiveOutput,
  rebuildLiveOutput
} from "../../document/src/liveOutput/materialize.js";
import {
  reconcileLiveOutput,
  removeMirrorFiles
} from "../../document/src/liveOutput/reconcile.js";

const SCHEMA_PATH = fileURLToPath(new URL("../../document/src/schema/40000.sql", import.meta.url));
const DOCUMENT_ID = "document-live-output-test";
const NOW = "2026-07-22T12:00:00.000Z";

interface Fixture {
  database: DatabaseSync;
  repository: LiveOutputRepository;
  root: string;
}

interface SeededArtifact {
  bytes: Buffer;
  contentKey: string;
  id: string;
}

function contentKey(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function grant(root: string, grantId = "grant-1", revoked = false): LiveOutputDirectoryGrant {
  return {
    documentId: DOCUMENT_ID,
    grantId,
    purpose: "live-output",
    revoked,
    root
  };
}

function seedArtifact(database: DatabaseSync, id: string, value: string): SeededArtifact {
  const bytes = Buffer.from(value, "utf8");
  const key = contentKey(bytes);
  database
    .prepare(
      `INSERT INTO blobs (
         content_key, status, byte_length, media_type, inline_data, chunk_count,
         compression, created_at, updated_at
       ) VALUES (?, 'ready', ?, 'application/octet-stream', ?, 0, 'none', ?, ?)`
    )
    .run(key, bytes.byteLength, bytes, NOW, NOW);
  database
    .prepare(
      `INSERT INTO artifacts (
         artifact_id, content_key, kind, channel, media_type, byte_length,
         source_output_version_id, source_payload_id, title, description, metadata_json, created_at
       ) VALUES (?, ?, 'generated', 'data', 'application/octet-stream', ?, '', '', ?, '', '{}', ?)`
    )
    .run(id, key, bytes.byteLength, id, NOW);
  return { bytes, contentKey: key, id };
}

function item(artifact: SeededArtifact, relativePath: string, collectionId: string | null = null) {
  return {
    artifactId: artifact.id,
    byteLength: artifact.bytes.byteLength,
    collectionId,
    contentKey: artifact.contentKey,
    expectedHash: artifact.contentKey,
    relativePath,
    bytes: artifact.bytes
  };
}

function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "ether-live-output-"));
  const database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  database.exec(readFileSync(SCHEMA_PATH, "utf8"));
  database
    .prepare(
      `INSERT INTO document (
         singleton, document_id, format_marker, format_version, schema_version, title,
         created_at, updated_at, app_version, feature_flags_json
       ) VALUES (1, ?, 'ETHERDOC', '4.0.0', 40000, 'Live Output Test', ?, ?, '4.0.0', '{}')`
    )
    .run(DOCUMENT_ID, NOW, NOW);
  return { database, repository: new LiveOutputRepository(createRepositoryContext(database)), root };
}

describe("Live Output materialization", () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = makeFixture();
  });

  afterEach(() => {
    fixture.database.close();
    rmSync(fixture.root, { recursive: true, force: true });
  });

  it("is disabled by default and performs no filesystem or journal writes", async () => {
    const artifact = seedArtifact(fixture.database, "artifact-disabled", "disabled");
    const output = await materializeLiveOutput(fixture.repository, {
      grant: grant(fixture.root),
      items: [item(artifact, "disabled.bin")]
    });

    expect(output).toEqual({ disabled: true, items: [] });
    expect(existsSync(path.join(fixture.root, "disabled.bin"))).toBe(false);
    expect(fixture.repository.listEntries()).toEqual([]);
    expect(fixture.repository.listOperations()).toEqual([]);
  });

  it("enables without creating files and materializes a verified manifest entry", async () => {
    const artifact = seedArtifact(fixture.database, "artifact-first", "first materialization");
    const liveGrant = grant(fixture.root);

    fixture.repository.enable(liveGrant);
    expect(readdirSync(fixture.root)).toEqual([]);
    const output = await materializeLiveOutput(fixture.repository, {
      grant: liveGrant,
      items: [item(artifact, "collection/first.bin")]
    });

    expect(output.items[0]).toMatchObject({ relativePath: "collection/first.bin", state: "committed" });
    expect(readFileSync(path.join(fixture.root, "collection", "first.bin"))).toEqual(artifact.bytes);
    expect(fixture.repository.listEntries()[0]).toMatchObject({
      artifactId: artifact.id,
      relativePath: "collection/first.bin",
      state: "committed"
    });
    expect(fixture.repository.listOperations()[0]).toMatchObject({
      operation: "materialize",
      state: "committed",
      relativePath: "collection/first.bin"
    });

    await expect(materializeLiveOutput(fixture.repository, {
      grant: liveGrant,
      items: [{
        ...item(artifact, "collection/tampered.bin"),
        contentKey: contentKey(Buffer.from("different source"))
      }]
    })).rejects.toMatchObject({ code: "SOURCE_VERIFY_FAILED" });
  });

  it("renames a collision without overwriting the existing file", async () => {
    const artifact = seedArtifact(fixture.database, "artifact-collision", "embedded bytes");
    const liveGrant = grant(fixture.root);
    writeFileSync(path.join(fixture.root, "output.bin"), "user file", { flag: "wx" });
    fixture.repository.enable(liveGrant);

    const output = await materializeLiveOutput(fixture.repository, {
      grant: liveGrant,
      items: [item(artifact, "output.bin")]
    });

    expect(output.items[0]?.relativePath).toBe("output (1).bin");
    expect(readFileSync(path.join(fixture.root, "output.bin"), "utf8")).toBe("user file");
    expect(readFileSync(path.join(fixture.root, "output (1).bin"))).toEqual(artifact.bytes);
  });

  it("resumes the same deterministic journal operation after an interrupted verification", async () => {
    const artifact = seedArtifact(fixture.database, "artifact-resume", "resume me");
    const liveGrant = grant(fixture.root);
    fixture.repository.enable(liveGrant);
    let interrupted = true;

    await expect(
      materializeLiveOutput(fixture.repository, {
        checkpoint: async (stage) => {
          if (stage === "verified" && interrupted) {
            interrupted = false;
            throw new Error("injected interruption");
          }
        },
        grant: liveGrant,
        items: [item(artifact, "resume.bin")]
      })
    ).rejects.toThrow("injected interruption");
    const failed = fixture.repository.listOperations()[0];
    expect(failed?.state).toBe("failed");
    expect(readdirSync(fixture.root).some((name) => name.includes("ether-live-"))).toBe(true);

    const resumed = await materializeLiveOutput(fixture.repository, {
      grant: liveGrant,
      items: [item(artifact, "resume.bin")]
    });
    expect(resumed.items[0]?.operationId).toBe(failed?.id);
    expect(resumed.items[0]?.state).toBe("committed");
    expect(readFileSync(path.join(fixture.root, "resume.bin"))).toEqual(artifact.bytes);
  });

  it("copies and verifies a moved mirror before removing only the prior owned file", async () => {
    const artifact = seedArtifact(fixture.database, "artifact-root-change", "root change");
    const firstRoot = path.join(fixture.root, "first");
    const secondRoot = path.join(fixture.root, "second");
    const firstGrant = grant(firstRoot, "grant-first");
    const secondGrant = grant(secondRoot, "grant-second");
    // The grant root is intentionally created by the test harness, never by enable().
    mkdirSync(firstRoot);
    mkdirSync(secondRoot);
    fixture.repository.enable(firstGrant, { transferPolicy: "move" });
    await materializeLiveOutput(fixture.repository, {
      grant: firstGrant,
      items: [item(artifact, "moved.bin")]
    });

    fixture.repository.enable(secondGrant, { transferPolicy: "move" });
    await materializeLiveOutput(fixture.repository, {
      grant: secondGrant,
      previousGrant: firstGrant,
      items: [item(artifact, "moved.bin")]
    });

    expect(existsSync(path.join(firstRoot, "moved.bin"))).toBe(false);
    expect(readFileSync(path.join(secondRoot, "moved.bin"))).toEqual(artifact.bytes);
  });

  it("does no work for a revoked grant", async () => {
    const artifact = seedArtifact(fixture.database, "artifact-revoked", "revoked");
    const liveGrant = grant(fixture.root);
    fixture.repository.enable(liveGrant);

    await expect(
      materializeLiveOutput(fixture.repository, {
        grant: { ...liveGrant, revoked: true },
        items: [item(artifact, "revoked.bin")]
      })
    ).rejects.toMatchObject({ code: "INVALID_GRANT" });
    expect(existsSync(path.join(fixture.root, "revoked.bin"))).toBe(false);
    expect(fixture.repository.listEntries()).toEqual([]);
    expect(fixture.repository.listOperations()).toEqual([]);
  });

  it("reconciles missing, changed, and extra files without changing the manifest membership", async () => {
    const changed = seedArtifact(fixture.database, "artifact-changed", "canonical changed");
    const missing = seedArtifact(fixture.database, "artifact-missing", "canonical missing");
    const liveGrant = grant(fixture.root);
    fixture.repository.enable(liveGrant);
    await materializeLiveOutput(fixture.repository, {
      grant: liveGrant,
      items: [item(changed, "changed.bin", "collection-a"), item(missing, "missing.bin", "collection-a")]
    });
    writeFileSync(path.join(fixture.root, "changed.bin"), "external replacement");
    rmSync(path.join(fixture.root, "missing.bin"));
    writeFileSync(path.join(fixture.root, "extra.bin"), "unmanaged");

    const before = fixture.repository.listEntries().map((entry) => [entry.artifactId, entry.collectionId]);
    const report = await reconcileLiveOutput(fixture.repository, { grant: liveGrant });

    expect(report.missingPaths).toEqual(["missing.bin"]);
    expect(report.changedPaths).toEqual(["changed.bin"]);
    expect(report.extraPaths).toContain("extra.bin");
    expect(fixture.repository.listEntries().map((entry) => [entry.artifactId, entry.collectionId])).toEqual(before);
    expect(fixture.repository.listEntries().every((entry) => entry.state === "reconciled")).toBe(true);
  });

  it("removes only manifest paths and preserves the manifest for rebuild", async () => {
    const artifact = seedArtifact(fixture.database, "artifact-remove", "remove me");
    const liveGrant = grant(fixture.root);
    fixture.repository.enable(liveGrant);
    await materializeLiveOutput(fixture.repository, {
      grant: liveGrant,
      items: [item(artifact, "owned.bin")]
    });
    writeFileSync(path.join(fixture.root, "unmanaged.bin"), "keep me");
    const outside = path.join(path.dirname(fixture.root), "outside-live-output.bin");
    writeFileSync(outside, "outside");

    try {
      const result = await removeMirrorFiles(fixture.repository, { grant: liveGrant });
      expect(result.removedPaths).toEqual(["owned.bin"]);
      expect(existsSync(path.join(fixture.root, "owned.bin"))).toBe(false);
      expect(existsSync(path.join(fixture.root, "unmanaged.bin"))).toBe(true);
      expect(existsSync(outside)).toBe(true);
      expect(fixture.repository.listEntries()).toHaveLength(1);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("rebuilds a removed mirror from the injected embedded blob reader", async () => {
    const artifact = seedArtifact(fixture.database, "artifact-rebuild", "embedded original");
    const liveGrant = grant(fixture.root);
    fixture.repository.enable(liveGrant);
    await materializeLiveOutput(fixture.repository, {
      grant: liveGrant,
      items: [item(artifact, "rebuild.bin")]
    });
    rmSync(path.join(fixture.root, "rebuild.bin"));

    const result = await rebuildLiveOutput(fixture.repository, {
      blobReader: async (key) => {
        expect(key).toBe(artifact.contentKey);
        return artifact.bytes;
      },
      grant: liveGrant
    });

    expect(result.items[0]).toMatchObject({ relativePath: "rebuild.bin", state: "committed" });
    expect(readFileSync(path.join(fixture.root, "rebuild.bin"))).toEqual(artifact.bytes);
    expect(fixture.repository.listOperations().some((operation) => operation.operation === "rebuild" && operation.state === "committed")).toBe(true);
  });
});

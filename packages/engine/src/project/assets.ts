import { randomUUID } from "node:crypto";
import { constants, renameSync, unlinkSync } from "node:fs";
import { access, mkdir, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createArtifactInDatabase } from "../artifacts/artifactStore.js";
import { initializeDatabase } from "./database.js";
import { projectPaths } from "./paths.js";
import { LinkedIndexSchema } from "./schema.js";
import { readJson, writeJson } from "./projectStore.js";
import { openDatabase, runInTransaction, type SqliteDatabase } from "./sqlite.js";

export type AssetKind = "reference" | "generated" | "collection" | "directory" | "mask";

export const PROJECT_ASSET_FILE_DIRECTORIES = [
  "assets/references",
  "assets/generated",
  "assets/masks",
  "assets/previews"
] as const;

export type AssetRecord = {
  id: string;
  kind: AssetKind;
  path: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AssetMoveRecord = {
  id: string;
  assetId: string;
  fromPath: string;
  toPath: string;
  reason: string | null;
  movedAt: string;
};

export type LinkExternalReferenceOptions = {
  filePath: string;
  role?: string;
  linkMode?: "linked";
  mimeType?: string;
  metadata?: Record<string, unknown>;
  now?: Date;
};

export type SaveGeneratedAssetOptions = {
  generationNodeId: string;
  fileName: string;
  content: string | Uint8Array;
  mimeType?: string;
  lineage?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  now?: Date;
};

export type SaveMaskAssetOptions = {
  editNodeId: string;
  sourceAssetId?: string;
  sourceAssetPath?: string;
  fileName?: string;
  content?: string | Uint8Array;
  mimeType?: string;
  instruction?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  now?: Date;
};

export type EnsureFolderOptions = {
  name: string;
  nodeId?: string;
  path?: string;
  now?: Date;
};

export type ListAssetsQuery = {
  kind?: AssetKind;
};

export type MoveAssetToCollectionOptions = {
  assetId: string;
  collectionId?: string;
  collectionName?: string;
  reason?: string;
  allowLinkedReferences?: boolean;
  now?: Date;
};

export type UpdateAssetMetadataOptions = {
  assetId: string;
  metadata: Record<string, unknown>;
  now?: Date;
};

export type ListAssetMovesQuery = {
  assetId?: string;
};

type AssetRow = {
  id: string;
  kind: AssetKind;
  path: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type AssetMoveRow = {
  id: string;
  asset_id: string;
  from_path: string;
  to_path: string;
  reason: string | null;
  moved_at: string;
};

const linkedIndexLocks = new Map<string, Promise<void>>();

export async function linkExternalReference(
  projectPath: string,
  options: LinkExternalReferenceOptions
): Promise<AssetRecord> {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);

  const referencePath = path.resolve(options.filePath);
  await assertReadableFile(referencePath, "Reference path");

  return withLinkedIndexLock(paths.linkedIndex, async () => {
    const now = toTimestamp(options.now);
    const db = openDatabase(paths.database);
    let assetWithArtifact: AssetRecord;

    try {
      runInTransaction(db, () => {
        const asset = insertAssetInDatabase(db, {
          id: randomUUID(),
          kind: "reference",
          path: referencePath,
          metadata: {
            ...options.metadata,
            role: options.role ?? "reference",
            linkMode: options.linkMode ?? "linked",
            originalName: path.basename(referencePath),
            mimeType: options.mimeType ?? inferMimeType(referencePath)
          },
          now
        });
        const artifact = createArtifactInDatabase(db, {
          kind: "reference",
          path: asset.path,
          metadata: {
            ...asset.metadata,
            assetId: asset.id
          },
          now: options.now
        });
        assetWithArtifact = updateAssetMetadataInDatabase(
          db,
          asset,
          { artifactId: artifact.id },
          now
        );
      });
    } finally {
      db.close();
    }

    await appendLinkedReference(paths.linkedIndex, {
      id: assetWithArtifact!.id,
      path: referencePath,
      linkedAt: now
    });

    return assetWithArtifact!;
  });
}

export async function saveGeneratedAsset(
  projectPath: string,
  options: SaveGeneratedAssetOptions
): Promise<AssetRecord> {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);

  const nowDate = options.now ?? new Date();
  const now = toTimestamp(nowDate);
  const year = String(nowDate.getUTCFullYear()).padStart(4, "0");
  const month = String(nowDate.getUTCMonth() + 1).padStart(2, "0");
  const safeGenerationNodeId = sanitizePathSegment(options.generationNodeId, "generationNodeId");
  const safeFileName = sanitizeFileName(options.fileName);
  const outputDirectory = path.join(
    projectPath,
    "assets",
    "generated",
    year,
    month,
    safeGenerationNodeId
  );

  await mkdir(outputDirectory, { recursive: true });
  const outputPath = await writeFileToAvailablePath(
    path.join(outputDirectory, safeFileName),
    options.content
  );

  const metadata = {
    ...options.metadata,
    generationNodeId: options.generationNodeId,
    safeGenerationNodeId,
    originalName: path.basename(options.fileName),
    mimeType: options.mimeType ?? inferMimeType(safeFileName),
    lineage: options.lineage ?? {}
  };
  const db = openDatabase(paths.database);
  let assetWithArtifact: AssetRecord;

  try {
    runInTransaction(db, () => {
      const asset = insertAssetInDatabase(db, {
        id: randomUUID(),
        kind: "generated",
        path: outputPath,
        metadata,
        now
      });
      const artifact = createArtifactInDatabase(db, {
        kind: "image",
        nodeId: options.generationNodeId,
        path: asset.path,
        metadata: {
          ...asset.metadata,
          assetId: asset.id
        },
        parentArtifactIds: extractArtifactIds(options.metadata, options.lineage),
        now: nowDate
      });

      assetWithArtifact = updateAssetMetadataInDatabase(
        db,
        asset,
        { artifactId: artifact.id },
        now
      );
    });
  } catch (error) {
    try {
      unlinkSync(outputPath);
    } catch {
      // Best-effort cleanup for a file whose database rows rolled back.
    }

    throw error;
  } finally {
    db.close();
  }

  return assetWithArtifact!;
}

export async function saveMaskAsset(
  projectPath: string,
  options: SaveMaskAssetOptions
): Promise<AssetRecord> {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);

  const nowDate = options.now ?? new Date();
  const now = toTimestamp(nowDate);
  const year = String(nowDate.getUTCFullYear()).padStart(4, "0");
  const month = String(nowDate.getUTCMonth() + 1).padStart(2, "0");
  const safeEditNodeId = sanitizePathSegment(options.editNodeId, "editNodeId");
  const safeFileName = sanitizeFileName(options.fileName ?? "mask.svg");
  const masksDirectory = path.join(projectPath, "assets", "masks");
  const outputDirectory = path.join(masksDirectory, year, month, safeEditNodeId);

  assertPathInsideDirectory(outputDirectory, masksDirectory, "Mask output directory");
  await mkdir(outputDirectory, { recursive: true });
  await assertMaskPathReallyInsideProject(projectPath, masksDirectory, outputDirectory);

  const outputPath = await writeFileToAvailablePath(
    path.join(outputDirectory, safeFileName),
    options.content ?? buildDefaultMaskSvg(options)
  );
  assertPathInsideDirectory(outputPath, masksDirectory, "Mask asset path");

  const metadata = {
    ...options.metadata,
    editNodeId: options.editNodeId,
    safeEditNodeId,
    sourceAssetId: options.sourceAssetId,
    sourceAssetPath: options.sourceAssetPath,
    instruction: options.instruction,
    notes: options.notes,
    originalName: path.basename(safeFileName),
    mimeType: options.mimeType ?? inferMimeType(safeFileName),
    role: "mask",
    lineage: {
      kind: "mask",
      editNodeId: options.editNodeId,
      sourceAssetId: options.sourceAssetId,
      sourceAssetPath: options.sourceAssetPath
    }
  };
  const db = openDatabase(paths.database);
  let assetWithArtifact: AssetRecord;

  try {
    runInTransaction(db, () => {
      const asset = insertAssetInDatabase(db, {
        id: randomUUID(),
        kind: "mask",
        path: outputPath,
        metadata,
        now
      });
      const artifact = createArtifactInDatabase(db, {
        kind: "mask",
        nodeId: options.editNodeId,
        path: asset.path,
        metadata: {
          ...asset.metadata,
          assetId: asset.id
        },
        parentArtifactIds: extractArtifactIds(options.metadata, metadata.lineage),
        now: nowDate
      });

      assetWithArtifact = updateAssetMetadataInDatabase(
        db,
        asset,
        { artifactId: artifact.id },
        now
      );
    });
  } finally {
    db.close();
  }

  return assetWithArtifact!;
}

export async function ensureCollectionFolder(
  projectPath: string,
  options: EnsureFolderOptions
): Promise<AssetRecord> {
  return ensureStoreFolder(projectPath, "collection", "collections", options);
}

export async function ensureDirectoryRoot(
  projectPath: string,
  options: EnsureFolderOptions
): Promise<AssetRecord> {
  return ensureStoreFolder(projectPath, "directory", "directories", options);
}

export async function listAssets(
  projectPath: string,
  query: ListAssetsQuery = {}
): Promise<AssetRecord[]> {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);

  const db = openDatabase(paths.database, { readonly: true });

  try {
    const rows = query.kind
      ? (db
          .prepare(
            `SELECT id, kind, path, metadata_json, created_at, updated_at
             FROM assets
             WHERE kind = ?
             ORDER BY created_at ASC, id ASC`
          )
          .all(query.kind) as AssetRow[])
      : (db
          .prepare(
            `SELECT id, kind, path, metadata_json, created_at, updated_at
             FROM assets
             ORDER BY created_at ASC, id ASC`
          )
          .all() as AssetRow[]);

    return rows.map(assetFromRow);
  } finally {
    db.close();
  }
}

export async function moveAssetToCollection(
  projectPath: string,
  options: MoveAssetToCollectionOptions
): Promise<AssetRecord> {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);

  const asset = getAssetById(paths.database, options.assetId);

  if (asset.kind === "reference" && options.allowLinkedReferences !== true) {
    throw new Error("Linked references are not moved by default.");
  }

  if (!isPathInsideDirectory(asset.path, projectPath)) {
    throw new Error("Only local project assets can be moved into collections.");
  }

  await assertReadableFile(asset.path, "Asset path");

  const collection = options.collectionId
    ? getAssetById(paths.database, options.collectionId)
    : await ensureCollectionFolder(projectPath, {
        name: options.collectionName ?? "Collection",
        now: options.now
      });

  if (collection.kind !== "collection") {
    throw new Error("collectionId must identify a collection asset.");
  }

  assertCollectionPathLexicallyInsideProject(projectPath, collection.path);
  await mkdir(collection.path, { recursive: true });
  await assertCollectionPathReallyInsideProject(projectPath, collection.path);

  const now = toTimestamp(options.now);
  const toPath = await reserveAvailablePath(path.join(collection.path, path.basename(asset.path)));
  const moveId = randomUUID();
  const db = openDatabase(paths.database);
  let physicallyMoved = false;
  let reservationStillExists = true;

  try {
    renameSync(asset.path, toPath);
    physicallyMoved = true;
    reservationStillExists = false;

    runInTransaction(db, () => {
      db.prepare(
        `UPDATE assets
         SET path = @toPath, updated_at = @movedAt
         WHERE id = @assetId`
      ).run({ assetId: asset.id, toPath, movedAt: now });
      db.prepare(
        `INSERT INTO asset_moves (id, asset_id, from_path, to_path, reason, moved_at)
         VALUES (@id, @assetId, @fromPath, @toPath, @reason, @movedAt)`
      ).run({
        id: moveId,
        assetId: asset.id,
        fromPath: asset.path,
        toPath,
        reason: options.reason ?? null,
        movedAt: now
      });

      syncArtifactForAssetMoveInDatabase(db, {
        asset,
        artifactId: artifactIdFromAsset(asset),
        collection,
        fromPath: asset.path,
        toPath,
        reason: options.reason,
        now
      });
    });
  } catch (error) {
    if (physicallyMoved) {
      try {
        renameSync(toPath, asset.path);
      } catch {
        // If recovery fails, preserve the original DB error so callers know the durable commit failed.
      }
    } else if (reservationStillExists) {
      try {
        unlinkSync(toPath);
      } catch {
        // Best-effort cleanup for an unused destination reservation.
      }
    }

    throw error;
  } finally {
    db.close();
  }

  return getAssetById(paths.database, asset.id);
}

export async function updateAssetMetadata(
  projectPath: string,
  options: UpdateAssetMetadataOptions
): Promise<AssetRecord> {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);

  const asset = getAssetById(paths.database, options.assetId);

  return updateAssetMetadataRecord(
    paths.database,
    asset,
    options.metadata,
    toTimestamp(options.now)
  );
}

export async function listAssetMoves(
  projectPath: string,
  query: ListAssetMovesQuery = {}
): Promise<AssetMoveRecord[]> {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);

  const db = openDatabase(paths.database, { readonly: true });

  try {
    const rows = query.assetId
      ? (db
          .prepare(
            `SELECT id, asset_id, from_path, to_path, reason, moved_at
             FROM asset_moves
             WHERE asset_id = ?
             ORDER BY moved_at ASC, id ASC`
          )
          .all(query.assetId) as AssetMoveRow[])
      : (db
          .prepare(
            `SELECT id, asset_id, from_path, to_path, reason, moved_at
             FROM asset_moves
             ORDER BY moved_at ASC, id ASC`
          )
          .all() as AssetMoveRow[]);

    return rows.map(assetMoveFromRow);
  } finally {
    db.close();
  }
}

async function ensureStoreFolder(
  projectPath: string,
  kind: "collection" | "directory",
  rootDirectory: "collections" | "directories",
  options: EnsureFolderOptions
) {
  const paths = projectPaths(projectPath);
  initializeDatabase(paths.database);

  const safeName = sanitizePathSegment(options.name, "name");
  const explicitPath = typeof options.path === "string" && options.path.trim()
    ? path.resolve(options.path)
    : null;
  const folderPath = explicitPath ?? path.join(projectPath, rootDirectory, safeName);
  const now = toTimestamp(options.now);

  await mkdir(folderPath, { recursive: true });

  const existing = findAssetByKindAndPath(paths.database, kind, folderPath);
  const metadata = {
    displayName: options.name.trim(),
    safeName,
    folderMode: explicitPath ? "custom" : "project",
    ...(options.nodeId ? { nodeId: options.nodeId } : {})
  };

  if (existing) {
    return updateAssetMetadataRecord(paths.database, existing, metadata, now);
  }

  return insertAsset(paths.database, {
    id: randomUUID(),
    kind,
    path: folderPath,
    metadata,
    now
  });
}

function insertAsset(
  databasePath: string,
  asset: {
    id: string;
    kind: AssetKind;
    path: string;
    metadata: Record<string, unknown>;
    now: string;
  }
) {
  const db = openDatabase(databasePath);

  try {
    return insertAssetInDatabase(db, asset);
  } finally {
    db.close();
  }
}

function updateAssetMetadataRecord(
  databasePath: string,
  asset: AssetRecord,
  metadata: Record<string, unknown>,
  now: string
) {
  const db = openDatabase(databasePath);

  try {
    return updateAssetMetadataInDatabase(db, asset, metadata, now);
  } finally {
    db.close();
  }
}

function insertAssetInDatabase(
  db: SqliteDatabase,
  asset: {
    id: string;
    kind: AssetKind;
    path: string;
    metadata: Record<string, unknown>;
    now: string;
  }
) {
  db.prepare(
    `INSERT INTO assets (id, kind, path, metadata_json, created_at, updated_at)
     VALUES (@id, @kind, @path, @metadataJson, @createdAt, @updatedAt)`
  ).run({
    id: asset.id,
    kind: asset.kind,
    path: asset.path,
    metadataJson: JSON.stringify(asset.metadata),
    createdAt: asset.now,
    updatedAt: asset.now
  });

  return getAssetByIdInDatabase(db, asset.id);
}

function updateAssetMetadataInDatabase(
  db: SqliteDatabase,
  asset: AssetRecord,
  metadata: Record<string, unknown>,
  now: string
) {
  const mergedMetadata = { ...asset.metadata, ...metadata };

  db.prepare(
    `UPDATE assets
     SET metadata_json = @metadataJson, updated_at = @updatedAt
     WHERE id = @id`
  ).run({
    id: asset.id,
    metadataJson: JSON.stringify(mergedMetadata),
    updatedAt: now
  });

  return getAssetByIdInDatabase(db, asset.id);
}

function syncArtifactForAssetMoveInDatabase(
  db: SqliteDatabase,
  input: {
    asset: AssetRecord;
    artifactId: string | null;
    collection: AssetRecord;
    fromPath: string;
    toPath: string;
    reason?: string;
    now: string;
  }
) {
  if (!input.artifactId) {
    return;
  }

  const row = db
    .prepare(
      `SELECT id, metadata_json, run_id, node_id
       FROM artifacts
       WHERE id = ?`
    )
    .get(input.artifactId) as { id: string; metadata_json: string; run_id: string | null; node_id: string | null } | undefined;

  if (!row) {
    throw new Error(`Artifact "${input.artifactId}" was not found for moved asset "${input.asset.id}".`);
  }

  const collectionName =
    typeof input.collection.metadata.displayName === "string"
      ? input.collection.metadata.displayName
      : path.basename(input.collection.path);
  const metadata = {
    ...parseMetadata(row.metadata_json),
    assetId: input.asset.id,
    assetPath: input.toPath,
    collectionId: input.collection.id,
    collectionName,
    movedFromPath: input.fromPath,
    movedReason: input.reason ?? null
  };

  db.prepare(
    `UPDATE artifacts
     SET path = @path, metadata_json = @metadataJson, updated_at = @updatedAt
     WHERE id = @id`
  ).run({
    id: input.artifactId,
    path: input.toPath,
    metadataJson: JSON.stringify(metadata),
    updatedAt: input.now
  });

  const latestVersion = db
    .prepare("SELECT MAX(version) AS version FROM artifact_versions WHERE artifact_id = ?")
    .get(input.artifactId) as { version: number | null } | undefined;
  const nextVersion = (latestVersion?.version ?? 0) + 1;

  db.prepare(
    `INSERT INTO artifact_versions (
      id, artifact_id, version, run_id, node_id, uri, metadata_json, created_at
    ) VALUES (
      @id, @artifactId, @version, @runId, @nodeId, @uri, @metadataJson, @createdAt
    )`
  ).run({
    id: randomUUID(),
    artifactId: input.artifactId,
    version: nextVersion,
    runId: row.run_id,
    nodeId: row.node_id,
    uri: input.toPath,
    metadataJson: JSON.stringify({
      movedFromPath: input.fromPath,
      collectionId: input.collection.id,
      assetId: input.asset.id
    }),
    createdAt: input.now
  });

  const existingMembership = db
    .prepare(
      `SELECT id
       FROM collection_memberships
       WHERE collection_id = ? AND (artifact_id = ? OR asset_id = ?)
       ORDER BY rowid ASC
       LIMIT 1`
    )
    .get(input.collection.id, input.artifactId, input.asset.id) as { id: string } | undefined;
  const membershipMetadata = JSON.stringify({
    reason: input.reason ?? null,
    movedFromPath: input.fromPath,
    movedToPath: input.toPath
  });

  if (existingMembership) {
    db.prepare(
      `UPDATE collection_memberships
       SET artifact_id = @artifactId,
           asset_id = @assetId,
           metadata_json = @metadataJson,
           updated_at = @updatedAt
       WHERE id = @id`
    ).run({
      id: existingMembership.id,
      artifactId: input.artifactId,
      assetId: input.asset.id,
      metadataJson: membershipMetadata,
      updatedAt: input.now
    });
    return;
  }

  db.prepare(
    `INSERT INTO collection_memberships (
      id, collection_id, artifact_id, asset_id, position, metadata_json, created_at, updated_at
    ) VALUES (
      @id, @collectionId, @artifactId, @assetId, NULL, @metadataJson, @createdAt, @updatedAt
    )`
  ).run({
    id: randomUUID(),
    collectionId: input.collection.id,
    artifactId: input.artifactId,
    assetId: input.asset.id,
    metadataJson: membershipMetadata,
    createdAt: input.now,
    updatedAt: input.now
  });
}

function artifactIdFromAsset(asset: AssetRecord) {
  return typeof asset.metadata.artifactId === "string" && asset.metadata.artifactId.trim()
    ? asset.metadata.artifactId
    : null;
}

function findAssetByKindAndPath(
  databasePath: string,
  kind: AssetKind,
  assetPath: string
): AssetRecord | null {
  const db = openDatabase(databasePath, { readonly: true });

  try {
    const row = db
      .prepare(
        `SELECT id, kind, path, metadata_json, created_at, updated_at
         FROM assets
         WHERE kind = ? AND path = ?
         ORDER BY created_at ASC, id ASC
         LIMIT 1`
      )
      .get(kind, assetPath) as AssetRow | undefined;

    return row ? assetFromRow(row) : null;
  } finally {
    db.close();
  }
}

function getAssetById(databasePath: string, assetId: string): AssetRecord {
  const db = openDatabase(databasePath, { readonly: true });

  try {
    return getAssetByIdInDatabase(db, assetId);
  } finally {
    db.close();
  }
}

function getAssetByIdInDatabase(db: SqliteDatabase, assetId: string): AssetRecord {
  const row = db
    .prepare(
      `SELECT id, kind, path, metadata_json, created_at, updated_at
       FROM assets
       WHERE id = ?`
    )
    .get(assetId) as AssetRow | undefined;

  if (!row) {
    throw new Error(`Asset "${assetId}" was not found.`);
  }

  return assetFromRow(row);
}

function assetFromRow(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    kind: row.kind,
    path: row.path,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function assetMoveFromRow(row: AssetMoveRow): AssetMoveRecord {
  return {
    id: row.id,
    assetId: row.asset_id,
    fromPath: row.from_path,
    toPath: row.to_path,
    reason: row.reason,
    movedAt: row.moved_at
  };
}

function parseMetadata(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

async function appendLinkedReference(
  linkedIndexPath: string,
  reference: { id: string; path: string; linkedAt: string }
) {
  const linkedIndex = LinkedIndexSchema.parse(await readJson(linkedIndexPath));
  const references = linkedIndex.references.filter((candidate) => candidate.id !== reference.id);
  references.push(reference);
  await writeJson(linkedIndexPath, { references });
}

async function withLinkedIndexLock<T>(linkedIndexPath: string, task: () => Promise<T>): Promise<T> {
  const key = path.resolve(linkedIndexPath);
  const previous = linkedIndexLocks.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current, () => current);

  linkedIndexLocks.set(key, queued);
  await previous.catch(() => undefined);

  try {
    return await task();
  } finally {
    release();
    if (linkedIndexLocks.get(key) === queued) {
      linkedIndexLocks.delete(key);
    }
  }
}

async function assertReadableFile(filePath: string, label: string) {
  await access(filePath, constants.R_OK);
  const stats = await stat(filePath);

  if (!stats.isFile()) {
    throw new Error(`${label} must be a file.`);
  }
}

async function writeFileToAvailablePath(basePath: string, content: string | Uint8Array) {
  const directory = path.dirname(basePath);
  const extension = path.extname(basePath);
  const name = path.basename(basePath, extension);

  for (let index = 1; index < 10000; index += 1) {
    const candidate = index === 1 ? basePath : path.join(directory, `${name}-${index}${extension}`);
    let fileHandle: Awaited<ReturnType<typeof open>> | null = null;

    try {
      fileHandle = await open(candidate, "wx");
      await fileHandle.writeFile(content);
      return candidate;
    } catch (error) {
      if (isNodeErrorWithCode(error, "EEXIST")) {
        continue;
      }

      throw error;
    } finally {
      await fileHandle?.close();
    }
  }

  throw new Error(`Could not find an available file path for ${basePath}`);
}

async function reserveAvailablePath(basePath: string) {
  const directory = path.dirname(basePath);
  const extension = path.extname(basePath);
  const name = path.basename(basePath, extension);

  for (let index = 1; index < 10000; index += 1) {
    const candidate = index === 1 ? basePath : path.join(directory, `${name}-${index}${extension}`);
    let fileHandle: Awaited<ReturnType<typeof open>> | null = null;

    try {
      fileHandle = await open(candidate, "wx");
      return candidate;
    } catch (error) {
      if (isNodeErrorWithCode(error, "EEXIST")) {
        continue;
      }

      throw error;
    } finally {
      await fileHandle?.close();
    }
  }

  throw new Error(`Could not reserve an available file path for ${basePath}`);
}

function sanitizeFileName(fileName: string) {
  return sanitizePathSegment(path.basename(fileName), "fileName");
}

function sanitizePathSegment(value: string, label: string) {
  const safeValue = [...value.trim()]
    .filter((character) => !isInvalidPathCharacter(character))
    .join("")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");

  if (!safeValue) {
    throw new Error(`${label} must contain at least one valid filename character.`);
  }

  return safeValue;
}

function isInvalidPathCharacter(character: string) {
  return character.charCodeAt(0) <= 0x1f || '<>:"/\\|?*'.includes(character);
}

function inferMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".webp": "image/webp"
  };

  return mimeTypes[extension] ?? "application/octet-stream";
}

function assertCollectionPathLexicallyInsideProject(projectPath: string, collectionPath: string) {
  if (!isPathInsideDirectory(collectionPath, path.join(projectPath, "collections"))) {
    throw new Error("Collection path must stay inside the project collections directory.");
  }
}

function assertPathInsideDirectory(filePath: string, directoryPath: string, label: string) {
  if (!isPathInsideDirectory(filePath, directoryPath)) {
    throw new Error(`${label} must stay inside ${directoryPath}.`);
  }
}

async function assertCollectionPathReallyInsideProject(projectPath: string, collectionPath: string) {
  const collectionsDirectory = path.join(projectPath, "collections");
  const [realProjectRoot, realCollectionsDirectory, realCollectionPath] = await Promise.all([
    realpath(projectPath),
    realpath(collectionsDirectory),
    realpath(collectionPath)
  ]);
  const collectionStats = await stat(realCollectionPath);

  if (
    !collectionStats.isDirectory() ||
    !isPathInsideDirectory(realCollectionsDirectory, realProjectRoot) ||
    !isPathInsideDirectory(realCollectionPath, realCollectionsDirectory)
  ) {
    throw new Error("Collection path must stay inside the project collections directory.");
  }
}

async function assertMaskPathReallyInsideProject(
  projectPath: string,
  masksDirectory: string,
  outputDirectory: string
) {
  const [realProjectRoot, realMasksDirectory, realOutputDirectory] = await Promise.all([
    realpath(projectPath),
    realpath(masksDirectory),
    realpath(outputDirectory)
  ]);
  const outputStats = await stat(realOutputDirectory);

  if (
    !outputStats.isDirectory() ||
    !isPathInsideDirectory(realMasksDirectory, realProjectRoot) ||
    !isPathInsideDirectory(realOutputDirectory, realMasksDirectory)
  ) {
    throw new Error("Mask asset path must stay inside the project masks directory.");
  }
}

function toTimestamp(now = new Date()) {
  return now.toISOString();
}

function isPathInsideDirectory(filePath: string, directoryPath: string) {
  const relativePath = path.relative(path.resolve(directoryPath), path.resolve(filePath));
  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function isNodeErrorWithCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}

function buildDefaultMaskSvg(options: SaveMaskAssetOptions) {
  const instruction = escapeXml(options.instruction?.trim() || "Mask overlay");
  const notes = escapeXml(options.notes?.trim() || "Deterministic Ether mask");
  const source = escapeXml(options.sourceAssetId ?? options.sourceAssetPath ?? "untracked-source");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="ETHER mask overlay">
  <title>ETHER_MASK_OVERLAY</title>
  <rect width="1024" height="1024" fill="transparent"/>
  <path d="M248 240 C402 152 640 176 770 336 C874 464 818 682 638 782 C482 870 264 780 200 604 C148 462 142 320 248 240 Z" fill="#37e6ea" opacity="0.38"/>
  <path d="M306 316 C442 238 622 258 716 376 C790 470 752 626 620 706 C494 782 330 718 282 594 C244 490 230 376 306 316 Z" fill="#8a5cff" opacity="0.24"/>
  <text x="72" y="924" font-size="28" font-family="Arial, sans-serif" fill="#1470db">edit=${escapeXml(
    options.editNodeId
  )}</text>
  <text x="72" y="966" font-size="22" font-family="Arial, sans-serif" fill="#0e1824">${instruction}</text>
  <desc>${notes}; source=${source}</desc>
</svg>`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractArtifactIds(...sources: Array<Record<string, unknown> | undefined>) {
  const ids: string[] = [];

  for (const source of sources) {
    collectArtifactIdsFromTree(source, ids);
  }

  return [...new Set(ids)];
}

function collectArtifactIdsFromTree(value: unknown, ids: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectArtifactIdsFromTree(item, ids);
    }

    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSingleArtifactIdKey(key) && typeof child === "string" && child.trim()) {
      ids.push(child);
      continue;
    }

    if (isArtifactIdArrayKey(key) && Array.isArray(child)) {
      for (const item of child) {
        if (typeof item === "string" && item.trim()) {
          ids.push(item);
        }
      }

      continue;
    }

    collectArtifactIdsFromTree(child, ids);
  }
}

function isSingleArtifactIdKey(key: string) {
  return key === "artifactId" || key === "parentArtifactId" || key === "sourceArtifactId";
}

function isArtifactIdArrayKey(key: string) {
  return key === "parentArtifactIds" || key === "sourceArtifactIds";
}

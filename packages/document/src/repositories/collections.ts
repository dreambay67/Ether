import {
  CollectionMembershipSchema,
  CollectionSchema,
  type Collection,
  type CollectionMembership
} from "@ether/schema";

import type { RepositoryTransactionContext } from "./graphs.js";

export type CollectionInput = Omit<Collection, "createdAt" | "updatedAt"> & {
  createdAt?: string;
  name?: string;
  updatedAt?: string;
};

export type CollectionMemberInput = Omit<CollectionMembership, "addedAt" | "collectionId"> & {
  addedAt?: string;
  collectionId?: string;
};

type CollectionRow = {
  collection_id: string;
  created_at: string;
  description: string;
  is_primary: number;
  title: string;
  updated_at: string;
};

type MembershipRow = {
  added_at: string;
  artifact_id: string;
  collection_id: string;
  position: number;
  role: CollectionMembership["role"];
  source_json: string;
};

export class CollectionRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CollectionRepositoryError";
    this.code = code;
  }
}

export class CollectionRepository {
  constructor(private readonly context: RepositoryTransactionContext) {}

  get(collectionId: string): Collection | undefined {
    const row = this.context.database
      .prepare(
        `SELECT collection_id, title, description, is_primary, created_at, updated_at
         FROM collections WHERE collection_id = ?`
      )
      .get(collectionId) as CollectionRow | undefined;
    return row === undefined ? undefined : collectionFromRow(row);
  }

  list(): Collection[] {
    const rows = this.context.database
      .prepare(
        `SELECT collection_id, title, description, is_primary, created_at, updated_at
         FROM collections ORDER BY is_primary DESC, updated_at DESC, collection_id`
      )
      .all() as unknown as CollectionRow[];
    return rows.map(collectionFromRow);
  }

  create(input: CollectionInput): Collection {
    const now = this.context.now();
    const collection = CollectionSchema.parse({
      ...input,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now
    });
    if (this.get(collection.id) !== undefined) {
      throw new CollectionRepositoryError("COLLECTION_ID_CONFLICT", `Collection ${collection.id} already exists.`);
    }
    if (collection.primary) this.clearPrimary();
    this.context.database
      .prepare(
        `INSERT INTO collections (
           collection_id, name, title, description, is_primary, metadata_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, '{}', ?, ?)`
      )
      .run(
        collection.id,
        input.name ?? (collection.title || collection.id),
        collection.title,
        collection.description,
        collection.primary ? 1 : 0,
        collection.createdAt,
        collection.updatedAt
      );
    return collection;
  }

  update(
    collectionId: string,
    input: Partial<Pick<Collection, "description" | "primary" | "title">> & { name?: string }
  ): Collection {
    const current = this.require(collectionId);
    const now = this.context.now();
    const next = CollectionSchema.parse({
      ...current,
      ...input,
      updatedAt: now
    });
    if (next.primary && !current.primary) this.clearPrimary();
    this.context.database
      .prepare(
        `UPDATE collections
         SET name = coalesce(?, name), title = ?, description = ?, is_primary = ?, updated_at = ?
         WHERE collection_id = ?`
      )
      .run(input.name ?? null, next.title, next.description, next.primary ? 1 : 0, now, collectionId);
    return this.require(collectionId);
  }

  remove(collectionId: string): boolean {
    return this.context.database
      .prepare("DELETE FROM collections WHERE collection_id = ?")
      .run(collectionId).changes === 1;
  }

  setPrimary(collectionId: string): Collection {
    this.require(collectionId);
    this.clearPrimary();
    const changed = this.context.database
      .prepare("UPDATE collections SET is_primary = 1, updated_at = ? WHERE collection_id = ?")
      .run(this.context.now(), collectionId);
    if (changed.changes !== 1) {
      throw new CollectionRepositoryError("COLLECTION_NOT_FOUND", `Unknown collection ${collectionId}.`);
    }
    return this.require(collectionId);
  }

  memberships(collectionId: string): CollectionMembership[] {
    this.require(collectionId);
    const rows = this.context.database
      .prepare(
        `SELECT collection_id, artifact_id, role, source_json, position, added_at
         FROM collection_memberships WHERE collection_id = ? ORDER BY position, artifact_id`
      )
      .all(collectionId) as unknown as MembershipRow[];
    return rows.map(membershipFromRow);
  }

  addMembers(collectionId: string, members: readonly CollectionMemberInput[]): CollectionMembership[] {
    this.require(collectionId);
    const seen = new Set<string>();
    let nextPosition = this.nextPosition(collectionId);
    const statement = this.context.database.prepare(
      `INSERT INTO collection_memberships (
         collection_id, artifact_id, role, source_json, position, added_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(collection_id, artifact_id) DO UPDATE SET
         role = excluded.role, source_json = excluded.source_json, position = excluded.position, added_at = excluded.added_at`
    );
    const persisted: CollectionMembership[] = [];
    for (const input of members) {
      if (input.collectionId !== undefined && input.collectionId !== collectionId) {
        throw new CollectionRepositoryError("COLLECTION_MEMBERSHIP_MISMATCH", "Member belongs to a different collection.");
      }
      if (seen.has(input.artifactId)) {
        throw new CollectionRepositoryError("COLLECTION_MEMBER_DUPLICATE", `Artifact ${input.artifactId} is repeated.`);
      }
      seen.add(input.artifactId);
      this.requireArtifact(input.artifactId);
      const position = input.position ?? nextPosition;
      nextPosition = Math.max(nextPosition, position + 1);
      const member = CollectionMembershipSchema.parse({
        collectionId,
        artifactId: input.artifactId,
        role: input.role,
        ...(input.source === undefined ? {} : { source: input.source }),
        position,
        addedAt: input.addedAt ?? this.context.now()
      });
      statement.run(
        member.collectionId,
        member.artifactId,
        member.role,
        JSON.stringify(member.source ?? {}),
        member.position ?? position,
        member.addedAt ?? this.context.now()
      );
      persisted.push(member);
    }
    return persisted;
  }

  removeMembers(collectionId: string, artifactIds: readonly string[]): number {
    this.require(collectionId);
    let removed = 0;
    const statement = this.context.database.prepare(
      "DELETE FROM collection_memberships WHERE collection_id = ? AND artifact_id = ?"
    );
    for (const artifactId of new Set(artifactIds)) {
      removed += Number(statement.run(collectionId, artifactId).changes);
    }
    return removed;
  }

  private clearPrimary(): void {
    this.context.database
      .prepare("UPDATE collections SET is_primary = 0, updated_at = ? WHERE is_primary = 1")
      .run(this.context.now());
  }

  private nextPosition(collectionId: string): number {
    const row = this.context.database
      .prepare("SELECT coalesce(max(position), -1) + 1 AS next_position FROM collection_memberships WHERE collection_id = ?")
      .get(collectionId) as { next_position: number };
    return row.next_position;
  }

  private require(collectionId: string): Collection {
    const collection = this.get(collectionId);
    if (collection === undefined) {
      throw new CollectionRepositoryError("COLLECTION_NOT_FOUND", `Unknown collection ${collectionId}.`);
    }
    return collection;
  }

  private requireArtifact(artifactId: string): void {
    const exists = this.context.database
      .prepare("SELECT 1 AS found FROM artifacts WHERE artifact_id = ?")
      .get(artifactId);
    if (exists === undefined) {
      throw new CollectionRepositoryError("ARTIFACT_NOT_FOUND", `Unknown artifact ${artifactId}.`);
    }
  }
}

function collectionFromRow(row: CollectionRow): Collection {
  return CollectionSchema.parse({
    id: row.collection_id,
    title: row.title,
    description: row.description,
    primary: row.is_primary === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function membershipFromRow(row: MembershipRow): CollectionMembership {
  const source = JSON.parse(row.source_json) as Record<string, unknown>;
  return CollectionMembershipSchema.parse({
    collectionId: row.collection_id,
    artifactId: row.artifact_id,
    role: row.role,
    ...(Object.keys(source).length === 0 ? {} : { source }),
    position: row.position,
    addedAt: row.added_at
  });
}

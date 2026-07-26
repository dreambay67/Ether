import { ETHER_FORMAT_VERSION, ETHER_SCHEMA_VERSION } from "@ether/schema";
import type { DatabaseSync } from "node:sqlite";

export interface Ether4xMigrationResult {
  fromFormatVersion: string;
  fromSchemaVersion: number;
  migrated: boolean;
  toFormatVersion: typeof ETHER_FORMAT_VERSION;
  toSchemaVersion: typeof ETHER_SCHEMA_VERSION;
}

/**
 * Stable entry point for post-4.0 minor migrations.  4.0.0 needs no SQL
 * change, but deliberately validates the singleton first so callers cannot
 * accidentally treat a future major document as a compatible minor release.
 */
export function migrate4x(database: DatabaseSync): Ether4xMigrationResult {
  const row = database.prepare(
    "SELECT format_version, schema_version FROM document WHERE singleton = 1"
  ).get() as { format_version?: unknown; schema_version?: unknown } | undefined;
  if (!row || typeof row.format_version !== "string" || typeof row.schema_version !== "number") {
    throw new Error("Ether 4.x migration requires a valid document singleton.");
  }
  if (!/^4\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(row.format_version)) {
    throw new Error(`Ether 4.x migration refuses incompatible format ${row.format_version}.`);
  }
  if (row.format_version !== ETHER_FORMAT_VERSION || row.schema_version !== ETHER_SCHEMA_VERSION) {
    throw new Error(
      `No registered Ether 4.x migration exists for ${row.format_version}/${row.schema_version}.`
    );
  }
  return {
    fromFormatVersion: row.format_version,
    fromSchemaVersion: row.schema_version,
    migrated: false,
    toFormatVersion: ETHER_FORMAT_VERSION,
    toSchemaVersion: ETHER_SCHEMA_VERSION
  };
}

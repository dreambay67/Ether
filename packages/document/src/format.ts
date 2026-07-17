import {
  ETHER_FILE_EXTENSION,
  ETHER_FORMAT_MARKER,
  ETHER_FORMAT_VERSION,
  ETHER_SCHEMA_VERSION,
  ETHER_SQLITE_APPLICATION_ID
} from "@ether/schema";

export const ETHER_PROVISIONAL_PAGE_SIZE = 16_384 as const;
export const ETHER_REQUIRED_FEATURE_PREFIX = "required." as const;
export const ETHER_SUPPORTED_REQUIRED_FEATURES = [] as const;

export const ETHER_FTS_TABLES = [
  "artifact_fts",
  "metadata_fts",
  "prompt_output_fts",
  "run_fts",
  "tag_fts"
] as const;

export const ETHER_SCHEMA_TABLES = [
  "approvals",
  "artifact_fts",
  "artifact_lineage",
  "artifact_ratings",
  "artifact_tags",
  "artifacts",
  "attempts",
  "batches",
  "blob_chunks",
  "blob_imports",
  "blobs",
  "collection_memberships",
  "collections",
  "document",
  "document_revision_members",
  "document_revisions",
  "edges",
  "execution_plans",
  "export_records",
  "graph_operations",
  "graph_revisions",
  "graphs",
  "groups",
  "linked_references",
  "live_output_entries",
  "live_output_operations",
  "live_output_settings",
  "metadata_fts",
  "module_interfaces",
  "modules",
  "node_output_payloads",
  "node_output_versions",
  "nodes",
  "plan_steps",
  "prompt_output_fts",
  "provider_capability_snapshots",
  "provider_runs",
  "recipe_instances",
  "recipes",
  "run_fts",
  "tag_fts",
  "work_items",
  "workspace_views"
] as const;

// The page size and schema are development candidates until Phase 5 benchmark and format freeze.
export const ETHER_DOCUMENT_FORMAT = Object.freeze({
  extension: ETHER_FILE_EXTENSION,
  formatFrozen: false,
  formatMarker: ETHER_FORMAT_MARKER,
  formatVersion: ETHER_FORMAT_VERSION,
  freezePhase: 5,
  pageSize: ETHER_PROVISIONAL_PAGE_SIZE,
  pageSizeProvisional: true,
  schemaProvisional: true,
  schemaVersion: ETHER_SCHEMA_VERSION,
  sqliteApplicationId: ETHER_SQLITE_APPLICATION_ID
});

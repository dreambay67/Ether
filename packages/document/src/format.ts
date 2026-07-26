import {
  ETHER_FILE_EXTENSION,
  ETHER_FORMAT_MARKER,
  ETHER_FORMAT_VERSION,
  ETHER_SCHEMA_VERSION,
  ETHER_SQLITE_APPLICATION_ID
} from "@ether/schema";

/**
 * Production SQLite page size selected by the Phase 5 representative workload
 * benchmark (4/8/16/32 KiB).  This is part of the on-disk 4.0 contract.
 */
export const ETHER_PAGE_SIZE = 16_384 as const;
/** @deprecated Kept as an internal source compatibility alias for 4.0. */
export const ETHER_PROVISIONAL_PAGE_SIZE = ETHER_PAGE_SIZE;
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
  "command_receipts",
  "document",
  "document_revision_members",
  "document_revisions",
  "document_state",
  "edges",
  "event_outbox",
  "execution_jobs",
  "execution_plans",
  "execution_timeline",
  "export_records",
  "graph_heads",
  "graph_operations",
  "graph_revisions",
  "graphs",
  "groups",
  "history_entries",
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
  "provider_completion_intents",
  "provider_runs",
  "recipe_instances",
  "recipes",
  "revision_milestone_members",
  "revision_milestones",
  "run_fts",
  "run_permits",
  "tag_fts",
  "work_items",
  "workspace_views"
] as const;

// Ether 4.0's on-disk identity. Any later 4.x change must use migrate4x.
export const ETHER_DOCUMENT_FORMAT = Object.freeze({
  extension: ETHER_FILE_EXTENSION,
  formatFrozen: true,
  formatMarker: ETHER_FORMAT_MARKER,
  formatVersion: ETHER_FORMAT_VERSION,
  freezePhase: 5,
  pageSize: ETHER_PAGE_SIZE,
  pageSizeProvisional: false,
  schemaProvisional: false,
  schemaVersion: ETHER_SCHEMA_VERSION,
  sqliteApplicationId: ETHER_SQLITE_APPLICATION_ID
});

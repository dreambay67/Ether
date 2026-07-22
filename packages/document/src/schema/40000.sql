CREATE TABLE document (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  document_id TEXT NOT NULL UNIQUE,
  format_marker TEXT NOT NULL CHECK (format_marker = 'ETHERDOC'),
  format_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  app_version TEXT NOT NULL,
  feature_flags_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(feature_flags_json))
) STRICT;

CREATE TABLE document_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  current_document_revision_id TEXT NOT NULL REFERENCES document_revisions(document_revision_id) ON DELETE RESTRICT,
  dirty INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0, 1))
) STRICT;

CREATE TABLE graphs (
  graph_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('root', 'module')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

CREATE TABLE nodes (
  node_id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL,
  title TEXT NOT NULL,
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  width REAL NOT NULL CHECK (width > 0),
  height REAL NOT NULL CHECK (height > 0),
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  presentation_json TEXT NOT NULL CHECK (json_valid(presentation_json)),
  node_order INTEGER NOT NULL DEFAULT 0 CHECK (node_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (graph_id, node_id)
) STRICT;

CREATE TABLE edges (
  edge_id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('node', 'module')),
  source_node_id TEXT,
  source_module_id TEXT,
  source_port_id TEXT,
  source_channel TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('node', 'module')),
  target_node_id TEXT,
  target_module_id TEXT,
  target_port_id TEXT,
  target_channel TEXT NOT NULL,
  role TEXT NOT NULL,
  lane_order INTEGER NOT NULL,
  selector_json TEXT NOT NULL CHECK (json_valid(selector_json)),
  adapter_json TEXT NOT NULL CHECK (json_valid(adapter_json)),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  edge_order INTEGER NOT NULL DEFAULT 0 CHECK (edge_order >= 0),
  deleted_at TEXT,
  CHECK (
    (source_kind = 'node' AND source_node_id IS NOT NULL AND source_module_id IS NULL AND source_port_id IS NULL) OR
    (source_kind = 'module' AND source_node_id IS NULL AND source_module_id IS NOT NULL AND source_port_id IS NOT NULL)
  ),
  CHECK (
    (target_kind = 'node' AND target_node_id IS NOT NULL AND target_module_id IS NULL AND target_port_id IS NULL) OR
    (target_kind = 'module' AND target_node_id IS NULL AND target_module_id IS NOT NULL AND target_port_id IS NOT NULL)
  ),
  FOREIGN KEY (graph_id, source_node_id) REFERENCES nodes(graph_id, node_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (graph_id, target_node_id) REFERENCES nodes(graph_id, node_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (graph_id, source_module_id) REFERENCES modules(parent_graph_id, module_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (graph_id, target_module_id) REFERENCES modules(parent_graph_id, module_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE graph_revisions (
  revision_id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE CASCADE,
  parent_revision_id TEXT,
  actor TEXT NOT NULL CHECK (actor IN ('user', 'codex', 'recipe', 'system')),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  operation_count INTEGER NOT NULL CHECK (operation_count >= 0),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  kind TEXT NOT NULL DEFAULT 'edit' CHECK (kind IN ('genesis', 'edit', 'undo', 'redo')),
  transaction_id TEXT,
  snapshot_json TEXT CHECK (snapshot_json IS NULL OR json_valid(snapshot_json)),
  previous_snapshot_json TEXT CHECK (previous_snapshot_json IS NULL OR json_valid(previous_snapshot_json)),
  UNIQUE (graph_id, revision_id),
  FOREIGN KEY (graph_id, parent_revision_id)
    REFERENCES graph_revisions(graph_id, revision_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE document_revisions (
  document_revision_id TEXT PRIMARY KEY,
  parent_document_revision_id TEXT REFERENCES document_revisions(document_revision_id),
  actor TEXT NOT NULL CHECK (actor IN ('user', 'codex', 'recipe', 'system')),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  kind TEXT NOT NULL DEFAULT 'edit' CHECK (kind IN ('genesis', 'edit', 'undo', 'redo')),
  transaction_id TEXT,
  target_document_revision_id TEXT REFERENCES document_revisions(document_revision_id) ON DELETE RESTRICT,
  revision_order INTEGER NOT NULL DEFAULT 0 CHECK (revision_order >= 0)
) STRICT;

CREATE TABLE graph_heads (
  graph_id TEXT PRIMARY KEY REFERENCES graphs(graph_id) ON DELETE RESTRICT,
  graph_revision_id TEXT NOT NULL,
  FOREIGN KEY (graph_id, graph_revision_id)
    REFERENCES graph_revisions(graph_id, revision_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE document_revision_members (
  document_revision_id TEXT NOT NULL REFERENCES document_revisions(document_revision_id) ON DELETE CASCADE,
  graph_id TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE CASCADE,
  graph_revision_id TEXT NOT NULL,
  PRIMARY KEY (document_revision_id, graph_id),
  FOREIGN KEY (graph_id, graph_revision_id)
    REFERENCES graph_revisions(graph_id, revision_id) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE graph_operations (
  revision_id TEXT NOT NULL REFERENCES graph_revisions(revision_id) ON DELETE CASCADE,
  operation_index INTEGER NOT NULL CHECK (operation_index >= 0),
  operation_json TEXT NOT NULL CHECK (json_valid(operation_json)),
  inverse_json TEXT NOT NULL CHECK (json_valid(inverse_json)),
  document_revision_id TEXT REFERENCES document_revisions(document_revision_id) ON DELETE CASCADE,
  graph_id TEXT REFERENCES graphs(graph_id) ON DELETE RESTRICT,
  global_order INTEGER NOT NULL DEFAULT 0 CHECK (global_order >= 0),
  PRIMARY KEY (revision_id, operation_index)
) STRICT, WITHOUT ROWID;

CREATE TABLE history_entries (
  history_order INTEGER PRIMARY KEY CHECK (history_order >= 0),
  document_revision_id TEXT NOT NULL UNIQUE REFERENCES document_revisions(document_revision_id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN ('applied', 'undone', 'cleared')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE revision_milestones (
  milestone_id TEXT PRIMARY KEY,
  document_revision_id TEXT NOT NULL REFERENCES document_revisions(document_revision_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('autosave', 'manual')),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE revision_milestone_members (
  milestone_id TEXT NOT NULL REFERENCES revision_milestones(milestone_id) ON DELETE CASCADE,
  graph_id TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE RESTRICT,
  graph_revision_id TEXT NOT NULL,
  PRIMARY KEY (milestone_id, graph_id),
  FOREIGN KEY (graph_id, graph_revision_id)
    REFERENCES graph_revisions(graph_id, revision_id) ON DELETE RESTRICT
) STRICT, WITHOUT ROWID;

CREATE TABLE groups (
  group_id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  node_ids_json TEXT NOT NULL CHECK (json_valid(node_ids_json)),
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  width REAL NOT NULL CHECK (width > 0),
  height REAL NOT NULL CHECK (height > 0),
  color TEXT NOT NULL,
  group_order INTEGER NOT NULL DEFAULT 0 CHECK (group_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

CREATE TABLE modules (
  module_id TEXT PRIMARY KEY,
  parent_graph_id TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE CASCADE,
  internal_graph_id TEXT NOT NULL UNIQUE REFERENCES graphs(graph_id) ON DELETE CASCADE,
  node_id TEXT UNIQUE,
  title TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 1 CHECK (width > 0),
  height REAL NOT NULL DEFAULT 1 CHECK (height > 0),
  interface_json TEXT NOT NULL DEFAULT '{"inputs":[],"outputs":[],"parameters":[]}' CHECK (json_valid(interface_json)),
  collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
  module_order INTEGER NOT NULL DEFAULT 0 CHECK (module_order >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (parent_graph_id <> internal_graph_id),
  UNIQUE (parent_graph_id, module_id),
  FOREIGN KEY (parent_graph_id, node_id)
    REFERENCES nodes(graph_id, node_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE module_interfaces (
  module_id TEXT NOT NULL REFERENCES modules(module_id) ON DELETE CASCADE,
  interface_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('input', 'output')),
  channel TEXT NOT NULL,
  role TEXT NOT NULL,
  lane_order INTEGER NOT NULL,
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  PRIMARY KEY (module_id, interface_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE workspace_views (
  workspace_view_id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  viewport_json TEXT NOT NULL CHECK (json_valid(viewport_json)),
  selection_json TEXT NOT NULL CHECK (json_valid(selection_json)),
  inspector_json TEXT NOT NULL CHECK (json_valid(inspector_json)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active = 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (graph_id)
) STRICT;

CREATE TABLE node_output_versions (
  output_version_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  graph_id TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE CASCADE,
  graph_revision_id TEXT NOT NULL,
  parent_output_version_id TEXT,
  producer_json TEXT NOT NULL CHECK (json_valid(producer_json)),
  input_payload_ids_json TEXT NOT NULL CHECK (json_valid(input_payload_ids_json)),
  selected_output_version_ids_json TEXT NOT NULL CHECK (json_valid(selected_output_version_ids_json)),
  output_payload_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(output_payload_ids_json)),
  compiled_context_hash TEXT NOT NULL,
  approval_json TEXT NOT NULL DEFAULT '{"state":"unreviewed"}' CHECK (json_valid(approval_json)),
  run_id TEXT,
  step_id TEXT,
  work_item_id TEXT,
  attempt_id TEXT,
  timing_json TEXT NOT NULL CHECK (json_valid(timing_json)),
  failure_json TEXT CHECK (failure_json IS NULL OR json_valid(failure_json)),
  created_at TEXT NOT NULL,
  CHECK (
    (run_id IS NULL AND step_id IS NULL AND work_item_id IS NULL AND attempt_id IS NULL) OR
    (run_id IS NOT NULL AND step_id IS NOT NULL AND work_item_id IS NOT NULL AND attempt_id IS NOT NULL)
  ),
  UNIQUE (graph_id, node_id, output_version_id),
  FOREIGN KEY (graph_id, node_id) REFERENCES nodes(graph_id, node_id) ON DELETE CASCADE,
  FOREIGN KEY (graph_id, graph_revision_id) REFERENCES graph_revisions(graph_id, revision_id),
  FOREIGN KEY (graph_id, node_id, parent_output_version_id)
    REFERENCES node_output_versions(graph_id, node_id, output_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (run_id) REFERENCES execution_jobs(job_id) ON DELETE RESTRICT,
  FOREIGN KEY (work_item_id) REFERENCES work_items(work_item_id) ON DELETE RESTRICT,
  FOREIGN KEY (attempt_id) REFERENCES attempts(attempt_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE node_output_payloads (
  payload_id TEXT PRIMARY KEY,
  output_version_id TEXT NOT NULL REFERENCES node_output_versions(output_version_id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('text', 'image', 'mask', 'data', 'video', 'audio')),
  role TEXT NOT NULL,
  content_text TEXT,
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  source_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_json)),
  artifact_id TEXT REFERENCES artifacts(artifact_id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  UNIQUE (output_version_id, payload_id)
) STRICT;

CREATE TABLE approvals (
  approval_id TEXT PRIMARY KEY,
  output_version_id TEXT NOT NULL REFERENCES node_output_versions(output_version_id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('unreviewed', 'approved', 'rejected')),
  actor TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE approval_history (
  approval_history_id TEXT PRIMARY KEY,
  output_version_id TEXT NOT NULL REFERENCES node_output_versions(output_version_id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('approved', 'rejected')),
  actor TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE execution_plans (
  plan_id TEXT PRIMARY KEY,
  document_revision_id TEXT NOT NULL REFERENCES document_revisions(document_revision_id),
  graph_id TEXT NOT NULL REFERENCES graphs(graph_id),
  graph_revision_id TEXT NOT NULL,
  capsule_version INTEGER NOT NULL CHECK (capsule_version = 1),
  hash_version TEXT NOT NULL CHECK (hash_version = 'sha256-v1'),
  content_hash TEXT NOT NULL UNIQUE,
  scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
  capsule_json TEXT NOT NULL CHECK (json_valid(capsule_json)),
  status TEXT NOT NULL CHECK (status IN ('previewed', 'started', 'completed', 'failed', 'cancelled', 'invalidated', 'waiting-review', 'needs-attention')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (graph_id, graph_revision_id)
    REFERENCES graph_revisions(graph_id, revision_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE plan_steps (
  step_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES execution_plans(plan_id) ON DELETE CASCADE,
  subject_kind TEXT NOT NULL DEFAULT 'node' CHECK (subject_kind IN ('node', 'adapter')),
  node_id TEXT REFERENCES nodes(node_id) ON DELETE CASCADE,
  adapter_id TEXT,
  step_order INTEGER NOT NULL CHECK (step_order >= 0),
  dependencies_json TEXT NOT NULL CHECK (json_valid(dependencies_json)),
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  executor_config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(executor_config_json)),
  provider_binding_json TEXT CHECK (provider_binding_json IS NULL OR json_valid(provider_binding_json)),
  status TEXT NOT NULL CHECK (status IN ('planned', 'ready', 'running', 'completed', 'failed', 'cancelled', 'waiting-review', 'needs-attention')),
  CHECK ((subject_kind = 'node' AND node_id IS NOT NULL AND adapter_id IS NULL) OR (subject_kind = 'adapter' AND node_id IS NULL AND adapter_id IS NOT NULL)),
  UNIQUE (plan_id, step_order),
  UNIQUE (plan_id, step_id)
) STRICT;

CREATE TABLE batches (
  batch_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES execution_plans(plan_id) ON DELETE CASCADE,
  step_id TEXT,
  dimensions_json TEXT NOT NULL CHECK (json_valid(dimensions_json)),
  exclusions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(exclusions_json)),
  requested_parallelism INTEGER NOT NULL DEFAULT 1 CHECK (requested_parallelism > 0),
  effective_parallelism INTEGER NOT NULL DEFAULT 1 CHECK (effective_parallelism > 0),
  status TEXT NOT NULL CHECK (status IN ('planned', 'running', 'completed', 'failed', 'cancelled', 'needs-attention')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (batch_id, step_id),
  FOREIGN KEY (plan_id, step_id) REFERENCES plan_steps(plan_id, step_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE work_item_dependencies (
  work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
  dependency_work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
  PRIMARY KEY (work_item_id, dependency_work_item_id),
  CHECK (work_item_id <> dependency_work_item_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE review_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES execution_plans(plan_id) ON DELETE CASCADE,
  step_id TEXT NOT NULL REFERENCES plan_steps(step_id) ON DELETE RESTRICT,
  work_item_id TEXT REFERENCES work_items(work_item_id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('waiting-review', 'completed', 'rejected', 'needs-attention', 'cancelled')),
  selected_output_version_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(selected_output_version_ids_json)),
  completion_json TEXT CHECK (completion_json IS NULL OR json_valid(completion_json)),
  created_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE TABLE adapter_intermediates (
  intermediate_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES execution_plans(plan_id) ON DELETE CASCADE,
  step_id TEXT NOT NULL REFERENCES plan_steps(step_id) ON DELETE CASCADE,
  work_item_id TEXT REFERENCES work_items(work_item_id) ON DELETE CASCADE,
  adapter_id TEXT NOT NULL,
  input_payload_ids_json TEXT NOT NULL CHECK (json_valid(input_payload_ids_json)),
  output_payload_ids_json TEXT NOT NULL CHECK (json_valid(output_payload_ids_json)),
  status TEXT NOT NULL CHECK (status IN ('planned', 'running', 'completed', 'failed', 'cancelled')),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE TABLE run_permits (
  permit_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES execution_plans(plan_id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('granted', 'consumed', 'revoked')),
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  UNIQUE (plan_id, content_hash, permit_id)
) STRICT;

CREATE TABLE execution_jobs (
  job_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL UNIQUE REFERENCES execution_plans(plan_id) ON DELETE RESTRICT,
  plan_content_hash TEXT NOT NULL,
  start_command_id TEXT NOT NULL UNIQUE,
  requested_parallelism INTEGER NOT NULL DEFAULT 1 CHECK (requested_parallelism > 0),
  effective_parallelism INTEGER NOT NULL DEFAULT 1 CHECK (effective_parallelism > 0),
  status TEXT NOT NULL CHECK (status IN ('planned', 'queued', 'running', 'completed', 'failed', 'cancelled', 'waiting-review', 'needs-attention')),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  cancellation_requested_at TEXT
) STRICT;

CREATE TABLE work_items (
  work_item_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES execution_jobs(job_id) ON DELETE CASCADE,
  step_id TEXT NOT NULL REFERENCES plan_steps(step_id) ON DELETE RESTRICT,
  planned_work_item_id TEXT NOT NULL,
  item_index INTEGER NOT NULL CHECK (item_index >= 0),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'accepted', 'failed', 'cancelled', 'waiting-review', 'needs-attention')),
  accepted_attempt_id TEXT,
  claim_token TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (job_id, planned_work_item_id),
  UNIQUE (job_id, step_id, item_index)
) STRICT;

CREATE TABLE attempts (
  attempt_id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  provider_attempt_id TEXT UNIQUE,
  provider_run_id TEXT REFERENCES provider_runs(provider_run_id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'accepted', 'failed', 'cancelled', 'needs-attention')),
  output_version_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(output_version_ids_json)),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE (work_item_id, attempt_number)
) STRICT;

CREATE TABLE provider_completion_intents (
  attempt_id TEXT PRIMARY KEY REFERENCES attempts(attempt_id) ON DELETE CASCADE,
  provider_attempt_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'staged', 'accepted')),
  expected_output_count INTEGER NOT NULL CHECK (expected_output_count > 0),
  identifiers_json TEXT NOT NULL CHECK (json_valid(identifiers_json)),
  completion_json TEXT CHECK (completion_json IS NULL OR json_valid(completion_json)),
  staging_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  accepted_at TEXT
) STRICT;

CREATE TABLE command_receipts (
  command_id TEXT PRIMARY KEY,
  command_name TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE execution_timeline (
  event_id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES execution_jobs(job_id) ON DELETE CASCADE,
  work_item_id TEXT REFERENCES work_items(work_item_id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(attempt_id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  state TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  occurred_at TEXT NOT NULL
) STRICT;

CREATE TABLE event_outbox (
  event_id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  occurred_at TEXT NOT NULL,
  delivered_at TEXT
) STRICT;

CREATE TABLE blobs (
  content_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('importing', 'ready', 'failed')),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  media_type TEXT NOT NULL,
  inline_data BLOB,
  chunk_count INTEGER NOT NULL CHECK (chunk_count >= 0),
  compression TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((inline_data IS NULL) OR chunk_count = 0)
) STRICT;

CREATE TABLE blob_chunks (
  content_key TEXT NOT NULL REFERENCES blobs(content_key) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  sha256 TEXT NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (content_key, chunk_index)
) STRICT, WITHOUT ROWID;

CREATE TABLE blob_imports (
  import_id TEXT PRIMARY KEY,
  content_key TEXT REFERENCES blobs(content_key) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('staged', 'streaming', 'validated', 'committed', 'failed')),
  source_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  expected_byte_length INTEGER,
  expected_sha256 TEXT,
  bytes_received INTEGER NOT NULL DEFAULT 0 CHECK (bytes_received >= 0),
  chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE linked_references (
  reference_id TEXT PRIMARY KEY,
  content_key TEXT REFERENCES blobs(content_key) ON DELETE SET NULL,
  preview_content_key TEXT REFERENCES blobs(content_key) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  original_path TEXT,
  path_grant_id TEXT,
  expected_hash TEXT,
  media_type TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('linked', 'embedded', 'missing', 'relinking')),
  identity_json TEXT CHECK (identity_json IS NULL OR json_valid(identity_json)),
  fingerprint_json TEXT NOT NULL CHECK (json_valid(fingerprint_json)),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  content_key TEXT REFERENCES blobs(content_key) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'data',
  media_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL DEFAULT 0 CHECK (byte_length >= 0),
  source_output_version_id TEXT NOT NULL DEFAULT '',
  source_payload_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_output_version_id, source_payload_id)
    REFERENCES node_output_payloads(output_version_id, payload_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE artifact_lineage (
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
  parent_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE RESTRICT,
  relation TEXT NOT NULL,
  source_output_version_id TEXT REFERENCES node_output_versions(output_version_id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  PRIMARY KEY (artifact_id, parent_artifact_id, relation)
) STRICT, WITHOUT ROWID;

CREATE TABLE artifact_tags (
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, tag)
) STRICT, WITHOUT ROWID;

CREATE TABLE artifact_ratings (
  rating_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 5),
  actor TEXT NOT NULL,
  rubric_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE collections (
  collection_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE collection_memberships (
  collection_id TEXT NOT NULL REFERENCES collections(collection_id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'other',
  source_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_json)),
  position INTEGER NOT NULL CHECK (position >= 0),
  added_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, artifact_id),
  UNIQUE (collection_id, position)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER collections_legacy_name_title_insert
AFTER INSERT ON collections
WHEN NEW.title = ''
BEGIN
  UPDATE collections SET title = NEW.name WHERE collection_id = NEW.collection_id;
END;

CREATE TABLE export_records (
  export_id TEXT PRIMARY KEY,
  collection_id TEXT REFERENCES collections(collection_id) ON DELETE SET NULL,
  artifact_id TEXT REFERENCES artifacts(artifact_id) ON DELETE SET NULL,
  path_grant_id TEXT,
  relative_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'staged', 'written', 'verified', 'committed', 'skipped', 'failed', 'cancelled')),
  options_json TEXT NOT NULL CHECK (json_valid(options_json)),
  created_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE TABLE recipes (
  recipe_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  installed_at TEXT NOT NULL,
  UNIQUE (name, version)
) STRICT;

CREATE TABLE recipe_instances (
  recipe_instance_id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(recipe_id) ON DELETE RESTRICT,
  graph_id TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE CASCADE,
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE provider_capability_snapshots (
  capability_snapshot_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  capability_json TEXT NOT NULL CHECK (json_valid(capability_json)),
  captured_at TEXT NOT NULL
) STRICT;

CREATE TABLE provider_runs (
  provider_run_id TEXT PRIMARY KEY,
  capability_snapshot_id TEXT REFERENCES provider_capability_snapshots(capability_snapshot_id) ON DELETE SET NULL,
  plan_id TEXT REFERENCES execution_plans(plan_id) ON DELETE RESTRICT,
  step_id TEXT,
  work_item_id TEXT,
  attempt_id TEXT,
  provider_attempt_id TEXT UNIQUE,
  provider_id TEXT,
  model_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'completed', 'failed', 'cancelled', 'needs-attention')),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (
    (step_id IS NULL AND work_item_id IS NULL AND attempt_id IS NULL) OR
    (step_id IS NOT NULL AND work_item_id IS NOT NULL AND attempt_id IS NOT NULL)
  ),
  CHECK (step_id IS NULL OR plan_id IS NOT NULL),
  CHECK (step_id IS NULL OR provider_attempt_id IS NOT NULL),
  UNIQUE (work_item_id, attempt_id),
  UNIQUE (provider_run_id, step_id, work_item_id, attempt_id),
  FOREIGN KEY (plan_id, step_id) REFERENCES plan_steps(plan_id, step_id) ON DELETE RESTRICT,
  FOREIGN KEY (work_item_id) REFERENCES work_items(work_item_id) ON DELETE RESTRICT,
  FOREIGN KEY (attempt_id) REFERENCES attempts(attempt_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE live_output_settings (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  path_grant_id TEXT,
  naming_policy_json TEXT NOT NULL DEFAULT '{"template":"{node}-{version}"}' CHECK (json_valid(naming_policy_json)),
  collision_policy TEXT NOT NULL DEFAULT 'rename' CHECK (collision_policy IN ('rename', 'skip', 'error')),
  transfer_policy TEXT NOT NULL DEFAULT 'copy' CHECK (transfer_policy IN ('copy', 'move')),
  last_reconciled_at TEXT
) STRICT;

INSERT INTO live_output_settings (
  singleton, enabled, path_grant_id, naming_policy_json,
  collision_policy, transfer_policy, last_reconciled_at
) VALUES (
  1, 0, NULL, '{"template":"{node}-{version}"}', 'rename', 'copy', NULL
);

CREATE TABLE live_output_entries (
  entry_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id) ON DELETE CASCADE,
  collection_id TEXT REFERENCES collections(collection_id) ON DELETE SET NULL,
  relative_path TEXT NOT NULL UNIQUE CHECK (relative_path NOT LIKE '/%' AND relative_path NOT LIKE '\\%' AND instr(relative_path, ':') = 0 AND relative_path NOT LIKE '%..%'),
  expected_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('planned', 'staged', 'verified', 'committed', 'failed', 'reconciled')),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE live_output_operations (
  operation_id TEXT PRIMARY KEY,
  entry_id TEXT REFERENCES live_output_entries(entry_id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('planned', 'staged', 'verified', 'committed', 'failed', 'reconciled')),
  source_path TEXT,
  destination_path TEXT NOT NULL CHECK (destination_path NOT LIKE '/%' AND destination_path NOT LIKE '\\%' AND instr(destination_path, ':') = 0 AND destination_path NOT LIKE '%..%'),
  expected_hash TEXT NOT NULL,
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER modules_internal_graph_kind_insert
BEFORE INSERT ON modules
WHEN coalesce((SELECT kind FROM graphs WHERE graph_id = NEW.internal_graph_id), '') <> 'module'
BEGIN
  SELECT RAISE(ABORT, 'module internal graph kind constraint failed');
END;

CREATE TRIGGER modules_internal_graph_kind_update
BEFORE UPDATE ON modules
WHEN coalesce((SELECT kind FROM graphs WHERE graph_id = NEW.internal_graph_id), '') <> 'module'
BEGIN
  SELECT RAISE(ABORT, 'module internal graph kind constraint failed');
END;

CREATE TRIGGER graphs_module_kind_update
BEFORE UPDATE OF kind ON graphs
WHEN NEW.kind <> 'module'
  AND EXISTS (SELECT 1 FROM modules WHERE internal_graph_id = OLD.graph_id)
BEGIN
  SELECT RAISE(ABORT, 'module internal graph kind constraint failed');
END;

CREATE TRIGGER work_items_plan_step_insert
BEFORE INSERT ON work_items
WHEN coalesce((SELECT plan_id FROM execution_jobs WHERE job_id = NEW.job_id), '') <>
     coalesce((SELECT plan_id FROM plan_steps WHERE step_id = NEW.step_id), '')
BEGIN
  SELECT RAISE(ABORT, 'work item plan step ownership constraint failed');
END;
CREATE TRIGGER work_items_plan_step_update
BEFORE UPDATE OF job_id, step_id ON work_items
WHEN coalesce((SELECT plan_id FROM execution_jobs WHERE job_id = NEW.job_id), '') <>
     coalesce((SELECT plan_id FROM plan_steps WHERE step_id = NEW.step_id), '')
BEGIN
  SELECT RAISE(ABORT, 'work item plan step ownership constraint failed');
END;
CREATE TRIGGER provider_runs_scope_insert
BEFORE INSERT ON provider_runs
WHEN NEW.step_id IS NOT NULL AND (
  coalesce((SELECT plan_id FROM plan_steps WHERE step_id = NEW.step_id), '') <> NEW.plan_id OR
  coalesce((SELECT j.plan_id FROM work_items w JOIN execution_jobs j ON j.job_id = w.job_id
            WHERE w.work_item_id = NEW.work_item_id), '') <> NEW.plan_id OR
  coalesce((SELECT work_item_id FROM attempts WHERE attempt_id = NEW.attempt_id), '') <> NEW.work_item_id
)
BEGIN
  SELECT RAISE(ABORT, 'provider run execution ownership constraint failed');
END;
CREATE TRIGGER attempts_provider_run_update
BEFORE UPDATE OF provider_run_id ON attempts
WHEN NEW.provider_run_id IS NOT NULL AND (
  coalesce((SELECT attempt_id FROM provider_runs WHERE provider_run_id = NEW.provider_run_id), '') <> NEW.attempt_id OR
  coalesce((SELECT work_item_id FROM provider_runs WHERE provider_run_id = NEW.provider_run_id), '') <> NEW.work_item_id
)
BEGIN
  SELECT RAISE(ABORT, 'attempt provider run ownership constraint failed');
END;
CREATE TRIGGER node_output_execution_provenance_insert
BEFORE INSERT ON node_output_versions
WHEN NEW.run_id IS NOT NULL AND (
  coalesce((SELECT job_id FROM work_items WHERE work_item_id = NEW.work_item_id), '') <> NEW.run_id OR
  coalesce((SELECT step_id FROM work_items WHERE work_item_id = NEW.work_item_id), '') <> NEW.step_id OR
  coalesce((SELECT work_item_id FROM attempts WHERE attempt_id = NEW.attempt_id), '') <> NEW.work_item_id
)
BEGIN
  SELECT RAISE(ABORT, 'output execution provenance constraint failed');
END;

CREATE TRIGGER node_output_versions_immutable_update
BEFORE UPDATE ON node_output_versions BEGIN
  SELECT RAISE(ABORT, 'immutable output version');
END;
CREATE TRIGGER node_output_versions_immutable_delete
BEFORE DELETE ON node_output_versions BEGIN
  SELECT RAISE(ABORT, 'immutable output version');
END;
CREATE TRIGGER node_output_payloads_immutable_update
BEFORE UPDATE ON node_output_payloads BEGIN
  SELECT RAISE(ABORT, 'immutable output payload');
END;
CREATE TRIGGER node_output_payloads_immutable_delete
BEFORE DELETE ON node_output_payloads BEGIN
  SELECT RAISE(ABORT, 'immutable output payload');
END;
CREATE TRIGGER approvals_immutable_update
BEFORE UPDATE ON approvals BEGIN
  SELECT RAISE(ABORT, 'immutable approval');
END;
CREATE TRIGGER approvals_immutable_delete
BEFORE DELETE ON approvals BEGIN
  SELECT RAISE(ABORT, 'immutable approval');
END;
CREATE TRIGGER execution_plan_capsule_immutable_update
BEFORE UPDATE ON execution_plans
WHEN NEW.document_revision_id <> OLD.document_revision_id
  OR NEW.graph_id <> OLD.graph_id
  OR NEW.graph_revision_id <> OLD.graph_revision_id
  OR NEW.capsule_version <> OLD.capsule_version
  OR NEW.hash_version <> OLD.hash_version
  OR NEW.content_hash <> OLD.content_hash
  OR NEW.scope_json <> OLD.scope_json
  OR NEW.capsule_json <> OLD.capsule_json
BEGIN
  SELECT RAISE(ABORT, 'immutable plan capsule');
END;
CREATE TRIGGER execution_plan_delete_guard
BEFORE DELETE ON execution_plans BEGIN
  SELECT RAISE(ABORT, 'immutable plan capsule');
END;
CREATE TRIGGER plan_steps_immutable_update
BEFORE UPDATE ON plan_steps BEGIN
  SELECT RAISE(ABORT, 'immutable plan step');
END;
CREATE TRIGGER plan_steps_immutable_delete
BEFORE DELETE ON plan_steps BEGIN
  SELECT RAISE(ABORT, 'immutable plan step');
END;

CREATE INDEX nodes_graph_id_idx ON nodes(graph_id);
CREATE INDEX edges_graph_id_idx ON edges(graph_id);
CREATE INDEX edges_graph_source_idx ON edges(graph_id, source_node_id);
CREATE INDEX edges_graph_target_idx ON edges(graph_id, target_node_id);
CREATE INDEX edges_graph_source_module_idx ON edges(graph_id, source_module_id);
CREATE INDEX edges_graph_target_module_idx ON edges(graph_id, target_module_id);
CREATE UNIQUE INDEX edges_lane_identity_idx ON edges(
  graph_id,
  source_kind, ifnull(source_node_id, ''), ifnull(source_module_id, ''), ifnull(source_port_id, ''), source_channel,
  target_kind, ifnull(target_node_id, ''), ifnull(target_module_id, ''), ifnull(target_port_id, ''), target_channel,
  role, selector_json
) WHERE deleted_at IS NULL;
CREATE INDEX graph_revisions_graph_id_idx ON graph_revisions(graph_id);
CREATE INDEX graph_revisions_parent_idx ON graph_revisions(graph_id, parent_revision_id);
CREATE INDEX document_revisions_parent_idx ON document_revisions(parent_document_revision_id);
CREATE INDEX document_revisions_target_idx ON document_revisions(target_document_revision_id);
CREATE INDEX document_state_revision_idx ON document_state(current_document_revision_id);
CREATE INDEX graph_heads_revision_idx ON graph_heads(graph_id, graph_revision_id);
CREATE INDEX document_revision_members_graph_idx ON document_revision_members(graph_id);
CREATE INDEX document_revision_members_graph_revision_idx
  ON document_revision_members(graph_id, graph_revision_id);
CREATE INDEX graph_operations_document_idx ON graph_operations(document_revision_id, global_order);
CREATE UNIQUE INDEX graph_operations_global_order_idx
  ON graph_operations(document_revision_id, global_order)
  WHERE document_revision_id IS NOT NULL;
CREATE INDEX graph_operations_graph_idx ON graph_operations(graph_id);
CREATE INDEX history_entries_revision_idx ON history_entries(document_revision_id);
CREATE INDEX revision_milestones_revision_idx ON revision_milestones(document_revision_id);
CREATE INDEX revision_milestone_members_graph_idx
  ON revision_milestone_members(graph_id, graph_revision_id);
CREATE INDEX groups_graph_id_idx ON groups(graph_id);
CREATE INDEX modules_parent_graph_node_idx ON modules(parent_graph_id, node_id);
CREATE INDEX workspace_views_graph_id_idx ON workspace_views(graph_id);
CREATE INDEX node_output_versions_graph_node_parent_idx
  ON node_output_versions(graph_id, node_id, parent_output_version_id);
CREATE INDEX node_output_versions_graph_revision_idx
  ON node_output_versions(graph_id, graph_revision_id);
CREATE INDEX node_output_versions_run_provenance_idx
  ON node_output_versions(run_id, step_id, work_item_id, attempt_id);
CREATE INDEX node_output_versions_attempt_idx
  ON node_output_versions(attempt_id);
CREATE INDEX node_output_versions_work_item_idx
  ON node_output_versions(work_item_id);
CREATE INDEX node_output_payloads_output_version_idx ON node_output_payloads(output_version_id);
CREATE INDEX node_output_payloads_artifact_idx ON node_output_payloads(artifact_id);
CREATE INDEX approvals_output_version_idx ON approvals(output_version_id);
CREATE INDEX approval_history_output_version_idx ON approval_history(output_version_id, created_at);
CREATE INDEX execution_plans_document_revision_idx ON execution_plans(document_revision_id);
CREATE INDEX execution_plans_graph_revision_idx ON execution_plans(graph_id, graph_revision_id);
CREATE INDEX plan_steps_plan_id_idx ON plan_steps(plan_id);
CREATE INDEX plan_steps_node_id_idx ON plan_steps(node_id);
CREATE INDEX plan_steps_adapter_id_idx ON plan_steps(adapter_id) WHERE adapter_id IS NOT NULL;
CREATE INDEX batches_plan_id_idx ON batches(plan_id);
CREATE INDEX batches_plan_step_idx ON batches(plan_id, step_id);
CREATE INDEX work_items_job_step_idx ON work_items(job_id, step_id);
CREATE INDEX work_items_step_idx ON work_items(step_id);
CREATE INDEX work_items_scheduler_idx ON work_items(job_id, status, claim_token, item_index);
CREATE INDEX work_item_dependencies_dependency_idx ON work_item_dependencies(dependency_work_item_id);
CREATE INDEX review_checkpoints_work_item_idx ON review_checkpoints(work_item_id, state);
CREATE INDEX adapter_intermediates_step_idx ON adapter_intermediates(plan_id, step_id, work_item_id);
CREATE INDEX attempts_work_item_id_idx ON attempts(work_item_id);
CREATE INDEX attempts_provider_run_idx ON attempts(provider_run_id);
CREATE INDEX execution_timeline_job_idx ON execution_timeline(job_id);
CREATE INDEX execution_timeline_work_idx ON execution_timeline(work_item_id);
CREATE INDEX execution_timeline_attempt_idx ON execution_timeline(attempt_id);
CREATE INDEX blob_imports_content_key_idx ON blob_imports(content_key);
CREATE INDEX linked_references_content_key_idx ON linked_references(content_key);
CREATE INDEX linked_references_preview_content_key_idx ON linked_references(preview_content_key);
CREATE INDEX artifacts_content_key_idx ON artifacts(content_key);
CREATE INDEX artifact_lineage_parent_idx ON artifact_lineage(parent_artifact_id);
CREATE INDEX artifact_lineage_output_version_idx ON artifact_lineage(source_output_version_id);
CREATE INDEX artifacts_source_payload_idx ON artifacts(source_output_version_id, source_payload_id);
CREATE INDEX artifact_ratings_artifact_id_idx ON artifact_ratings(artifact_id);
CREATE INDEX collection_memberships_artifact_id_idx ON collection_memberships(artifact_id);
CREATE UNIQUE INDEX collections_one_primary_idx ON collections(is_primary) WHERE is_primary = 1;
CREATE INDEX export_records_collection_id_idx ON export_records(collection_id);
CREATE INDEX export_records_artifact_id_idx ON export_records(artifact_id);
CREATE INDEX recipe_instances_recipe_id_idx ON recipe_instances(recipe_id);
CREATE INDEX recipe_instances_graph_id_idx ON recipe_instances(graph_id);
CREATE INDEX provider_runs_capability_snapshot_idx ON provider_runs(capability_snapshot_id);
CREATE INDEX provider_runs_plan_step_idx ON provider_runs(plan_id, step_id);
CREATE INDEX provider_runs_step_work_item_idx ON provider_runs(step_id, work_item_id);
CREATE INDEX provider_runs_work_item_attempt_idx ON provider_runs(work_item_id, attempt_id);
CREATE INDEX provider_runs_attempt_idx ON provider_runs(attempt_id);
CREATE INDEX live_output_entries_artifact_id_idx ON live_output_entries(artifact_id);
CREATE INDEX live_output_entries_collection_id_idx ON live_output_entries(collection_id);
CREATE INDEX live_output_operations_entry_id_idx ON live_output_operations(entry_id);

CREATE VIRTUAL TABLE prompt_output_fts USING fts5(
  source_type UNINDEXED,
  source_id UNINDEXED,
  title,
  body,
  metadata,
  tokenize = 'unicode61'
);

CREATE VIRTUAL TABLE artifact_fts USING fts5(
  artifact_id UNINDEXED,
  title,
  description,
  metadata,
  tokenize = 'unicode61'
);

CREATE VIRTUAL TABLE tag_fts USING fts5(
  artifact_id UNINDEXED,
  tag,
  tokenize = 'unicode61'
);

CREATE VIRTUAL TABLE run_fts USING fts5(
  provider_run_id UNINDEXED,
  provider_id,
  model_id,
  request,
  response,
  metadata,
  tokenize = 'unicode61'
);

CREATE VIRTUAL TABLE metadata_fts USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  metadata,
  tokenize = 'unicode61'
);

CREATE TRIGGER nodes_fts_insert AFTER INSERT ON nodes BEGIN
  INSERT INTO prompt_output_fts (source_type, source_id, title, body, metadata)
  VALUES ('prompt', NEW.node_id, NEW.title, NEW.config_json, NEW.presentation_json);
END;
CREATE TRIGGER nodes_fts_update AFTER UPDATE ON nodes BEGIN
  DELETE FROM prompt_output_fts WHERE source_type = 'prompt' AND source_id = OLD.node_id;
  INSERT INTO prompt_output_fts (source_type, source_id, title, body, metadata)
  VALUES ('prompt', NEW.node_id, NEW.title, NEW.config_json, NEW.presentation_json);
END;
CREATE TRIGGER nodes_fts_delete AFTER DELETE ON nodes BEGIN
  DELETE FROM prompt_output_fts WHERE source_type = 'prompt' AND source_id = OLD.node_id;
END;

CREATE TRIGGER output_payloads_fts_insert AFTER INSERT ON node_output_payloads BEGIN
  INSERT INTO prompt_output_fts (source_type, source_id, title, body, metadata)
  VALUES ('output', NEW.payload_id, NEW.channel || ':' || NEW.role, coalesce(NEW.content_text, NEW.content_json), NEW.metadata_json);
END;
CREATE TRIGGER output_payloads_fts_update AFTER UPDATE ON node_output_payloads BEGIN
  DELETE FROM prompt_output_fts WHERE source_type = 'output' AND source_id = OLD.payload_id;
  INSERT INTO prompt_output_fts (source_type, source_id, title, body, metadata)
  VALUES ('output', NEW.payload_id, NEW.channel || ':' || NEW.role, coalesce(NEW.content_text, NEW.content_json), NEW.metadata_json);
END;
CREATE TRIGGER output_payloads_fts_delete AFTER DELETE ON node_output_payloads BEGIN
  DELETE FROM prompt_output_fts WHERE source_type = 'output' AND source_id = OLD.payload_id;
END;

CREATE TRIGGER artifacts_fts_insert AFTER INSERT ON artifacts BEGIN
  INSERT INTO artifact_fts (artifact_id, title, description, metadata)
  VALUES (NEW.artifact_id, NEW.title, NEW.description, NEW.metadata_json);
  INSERT INTO metadata_fts (entity_type, entity_id, metadata)
  VALUES ('artifact', NEW.artifact_id, NEW.metadata_json);
END;
CREATE TRIGGER artifacts_fts_update AFTER UPDATE ON artifacts BEGIN
  DELETE FROM artifact_fts WHERE artifact_id = OLD.artifact_id;
  DELETE FROM metadata_fts WHERE entity_type = 'artifact' AND entity_id = OLD.artifact_id;
  INSERT INTO artifact_fts (artifact_id, title, description, metadata)
  VALUES (NEW.artifact_id, NEW.title, NEW.description, NEW.metadata_json);
  INSERT INTO metadata_fts (entity_type, entity_id, metadata)
  VALUES ('artifact', NEW.artifact_id, NEW.metadata_json);
END;
CREATE TRIGGER artifacts_fts_delete AFTER DELETE ON artifacts BEGIN
  DELETE FROM artifact_fts WHERE artifact_id = OLD.artifact_id;
  DELETE FROM metadata_fts WHERE entity_type = 'artifact' AND entity_id = OLD.artifact_id;
END;

CREATE TRIGGER artifact_tags_fts_insert AFTER INSERT ON artifact_tags BEGIN
  INSERT INTO tag_fts (artifact_id, tag) VALUES (NEW.artifact_id, NEW.tag);
END;
CREATE TRIGGER artifact_tags_fts_update AFTER UPDATE ON artifact_tags BEGIN
  DELETE FROM tag_fts WHERE artifact_id = OLD.artifact_id AND tag = OLD.tag;
  INSERT INTO tag_fts (artifact_id, tag) VALUES (NEW.artifact_id, NEW.tag);
END;
CREATE TRIGGER artifact_tags_fts_delete AFTER DELETE ON artifact_tags BEGIN
  DELETE FROM tag_fts WHERE artifact_id = OLD.artifact_id AND tag = OLD.tag;
END;

CREATE TRIGGER provider_runs_fts_insert AFTER INSERT ON provider_runs BEGIN
  INSERT INTO run_fts (provider_run_id, provider_id, model_id, request, response, metadata)
  VALUES (NEW.provider_run_id, NEW.provider_id, NEW.model_id, NEW.request_json, coalesce(NEW.response_json, ''), NEW.metadata_json);
END;
CREATE TRIGGER provider_runs_fts_update AFTER UPDATE ON provider_runs BEGIN
  DELETE FROM run_fts WHERE provider_run_id = OLD.provider_run_id;
  INSERT INTO run_fts (provider_run_id, provider_id, model_id, request, response, metadata)
  VALUES (NEW.provider_run_id, NEW.provider_id, NEW.model_id, NEW.request_json, coalesce(NEW.response_json, ''), NEW.metadata_json);
END;
CREATE TRIGGER provider_runs_fts_delete AFTER DELETE ON provider_runs BEGIN
  DELETE FROM run_fts WHERE provider_run_id = OLD.provider_run_id;
END;

CREATE TRIGGER document_metadata_fts_insert AFTER INSERT ON document BEGIN
  INSERT INTO metadata_fts (entity_type, entity_id, metadata)
  VALUES ('document', NEW.document_id, NEW.title || ' ' || NEW.feature_flags_json);
END;
CREATE TRIGGER document_metadata_fts_update AFTER UPDATE ON document BEGIN
  DELETE FROM metadata_fts WHERE entity_type = 'document' AND entity_id = OLD.document_id;
  INSERT INTO metadata_fts (entity_type, entity_id, metadata)
  VALUES ('document', NEW.document_id, NEW.title || ' ' || NEW.feature_flags_json);
END;
CREATE TRIGGER document_metadata_fts_delete AFTER DELETE ON document BEGIN
  DELETE FROM metadata_fts WHERE entity_type = 'document' AND entity_id = OLD.document_id;
END;

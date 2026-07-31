# Ether 4.0 Technical Architecture Specification

**Status:** Planning baseline for approval
**Date:** 2026-07-16
**Normative product reference:** `ether-4.0-design-spec.md`
**Normative acceptance reference:** `ether-4.0-acceptance.md`

---

## 1. Architecture Decision

Ether 4.0 renews the existing TypeScript/Electron product in place while replacing its project, graph, execution, provider, and application-service contracts. The React, Electron, React Flow, Vite, Vitest, and Playwright foundations remain. The directory-based project store and flat `CanvasNodeData` model do not.

The dependency direction is:

```text
schema
  -> document
  -> graph-kernel
  -> intelligence / providers / recipes
  -> execution
  -> application
  -> desktop / mcp-server / codex-plugin
```

Presentation clients never call persistence or provider implementations directly. The `application` package is the sole command/query boundary.

---

## 2. Package Boundaries

### 2.1 `@ether/schema`

Pure TypeScript and Zod contracts:

- Document identifiers and versions
- Node definitions and discriminated configurations
- Graphs, edges, groups, modules, and view state
- Channels, roles, payloads, adapters, and provider capabilities
- Graph commands, transactions, events, and validation errors
- Recipes, execution plans, jobs, outputs, artifacts, and collections
- Application commands, queries, and event envelopes

It has no Electron, Node filesystem, SQLite, process, or provider dependency.

### 2.2 `@ether/document`

Owns `.ether` documents:

- SQLite driver and migrations within the 4.x format family
- Transaction and locking policy
- Repositories for graphs, revisions, objects, artifacts, runs, and settings
- Content-addressed blob ingestion and range reads
- Save As, Save a Copy, compact, integrity, and recovery
- Linked-reference identity and relinking
- AppData recovery and provider-staging reconciliation

It does not know React Flow or provider command syntax.

### 2.3 `@ether/graph-kernel`

Owns graph meaning:

- Node catalog and subtype configuration schemas
- Connection validation
- Role interpretation
- Adapter selection
- Prompt/data assembly
- Output selectors
- Groups and modules
- Graph transactions, inverse operations, and validation
- Deterministic layout policies used by recipes and the plugin

### 2.4 `@ether/intelligence`

Owns Codex LLM-worker behavior:

- Worker profiles and behavior presets
- Context compilation
- Downstream-model awareness
- Structured-output validation
- Memory policies
- Immutable output-version acceptance
- Transformation-discipline system instructions

### 2.5 `@ether/providers`

Owns provider adapters and process supervision:

- Codex App Server client
- `codex exec` fallback
- Antigravity CLI image adapter
- Fake provider
- Future API adapter interfaces, disabled until configured
- Provider discovery and capability conformance
- Staging directories, cancellation, timeout, and error normalization

### 2.6 `@ether/recipes`

Owns recipe manifests, validation, parameter substitution, capability checks, and graph/module instantiation.

### 2.7 `@ether/execution`

Owns immutable plans and durable work:

- Scope resolution
- Dependency ordering
- Batch expansion
- Work-item scheduling
- Sequential default and bounded parallel mode
- Cancellation, retry, resume, and deduplication
- Adapter, worker, provider, local-transform, review-checkpoint, and export steps

### 2.8 `@ether/application`

The single use-case layer:

- Document lifecycle commands
- Graph editing and inspection
- Artifact and reference queries
- Run preview and execution
- Provider health
- Recipe insertion
- Plugin permissions and graph transactions
- Typed events for every client

Electron IPC, MCP, and tests call this package rather than reconstructing use cases.

### 2.9 Clients

- `@ether/desktop`: Electron main/preload and React presentation
- `@ether/mcp-server`: JSON-RPC/MCP adapter over `@ether/application`
- Ether Codex plugin: skills and MCP configuration
- `@ether/testing`: unit, integration, contract, smoke, packaged, performance, and recovery suites

---

## 3. Ether Document Format

### 3.1 Identity

```text
Extension:       .ether
SQLite app id:   0x45544852 (ETHR)
Format marker:   ETHERDOC
Format version:  4.0.0
Schema version:  40000
Journal mode:    DELETE
Synchronous:     FULL
Auto vacuum:     INCREMENTAL
```

Page size is selected by a Windows benchmark of 4, 8, 16, and 32 KiB before format freeze; 16 KiB is the initial candidate. Once the release candidate writes production documents, page size and schema 40000 are immutable.

WAL is not used because persistent `-wal` and `-shm` files violate the clean one-document experience. A temporary rollback journal may exist while a write is active or after a crash.

### 3.2 Header Validation

Open performs these checks before normal repositories are created:

1. File exists and is not a directory.
2. SQLite header is valid.
3. `application_id` equals `0x45544852`.
4. `document.format_marker` equals `ETHERDOC`.
5. Major format version is supported.
6. Required feature flags are understood.
7. `quick_check` succeeds.
8. A concurrent writer lock is not held.

An invalid or future-major document never enters writable mode.

### 3.3 Core Tables

The initial normalized schema contains:

```sql
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
  feature_flags_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE graphs (
  graph_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('root', 'module')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE nodes (
  node_id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL,
  title TEXT NOT NULL,
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  config_json TEXT NOT NULL,
  presentation_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE edges (
  edge_id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE CASCADE,
  source_node_id TEXT NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
  source_channel TEXT NOT NULL,
  target_node_id TEXT NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE,
  target_channel TEXT NOT NULL,
  role TEXT NOT NULL,
  lane_order INTEGER NOT NULL,
  selector_json TEXT NOT NULL,
  adapter_json TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  UNIQUE (source_node_id, source_channel, target_node_id, target_channel, role, selector_json)
);

CREATE TABLE graph_revisions (
  revision_id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE CASCADE,
  parent_revision_id TEXT REFERENCES graph_revisions(revision_id),
  actor TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  operation_count INTEGER NOT NULL,
  metadata_json TEXT NOT NULL
);

CREATE TABLE document_revisions (
  document_revision_id TEXT PRIMARY KEY,
  parent_document_revision_id TEXT REFERENCES document_revisions(document_revision_id),
  actor TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL
);

CREATE TABLE document_revision_members (
  document_revision_id TEXT NOT NULL REFERENCES document_revisions(document_revision_id) ON DELETE CASCADE,
  graph_id TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE CASCADE,
  graph_revision_id TEXT NOT NULL REFERENCES graph_revisions(revision_id) ON DELETE CASCADE,
  PRIMARY KEY (document_revision_id, graph_id)
);

CREATE TABLE graph_operations (
  revision_id TEXT NOT NULL REFERENCES graph_revisions(revision_id) ON DELETE CASCADE,
  operation_index INTEGER NOT NULL,
  operation_json TEXT NOT NULL,
  inverse_json TEXT NOT NULL,
  PRIMARY KEY (revision_id, operation_index)
);
```

Additional table groups are mandatory:

- `groups`, `modules`, `module_interfaces`, `workspace_views`
- `node_output_versions`, `node_output_payloads`, `approvals`
- `execution_plans`, `plan_steps`, `batches`, `work_items`, `attempts`
- `artifacts`, `artifact_lineage`, `artifact_tags`, `artifact_ratings`
- `collections`, `collection_memberships`, `export_records`
- `blobs`, `blob_chunks`, `blob_imports`, `linked_references`
- `recipes`, `recipe_instances`
- `provider_runs`, `provider_capability_snapshots`
- FTS5 indexes for prompt/output text, artifacts, tags, runs, and metadata
- `live_output_settings`, `live_output_entries`, `live_output_operations`

Every JSON column is validated against `@ether/schema` at repository boundaries. Schema-invalid data is a document error, not an `as` cast.

### 3.4 Blob Storage

- Content key: SHA-256 of the complete original bytes.
- Objects at or below 256 KiB may be stored inline.
- Larger objects are split into ordered 4 MiB chunks.
- Each chunk stores byte length and SHA-256.
- Already-compressed image, audio, and video bytes are not recompressed.
- Duplicate content shares one blob record.
- Artifact and reference records point to content keys rather than file paths.

Import is two-stage:

1. Create invisible `blob_imports` state.
2. Stream and hash chunks without loading the full file.
3. Validate total length, media signature, whole-file hash, and chunk count.
4. In one transaction, mark the blob ready and attach its artifact/reference.
5. Interrupted imports resume or are reclaimed without exposing partial objects.

### 3.5 Document Operations

- **Autosave:** one transaction containing pending graph operations and presentation state.
- **Manual Save:** flush plus named graph/document milestone.
- **Save As:** SQLite backup to a temporary destination, assign new document ID, validate, then atomically replace destination.
- **Save a Copy:** consistent backup without changing document ID of active source; copied document receives a new ID.
- **Compact:** `VACUUM INTO` temporary file, validate, atomically replace.
- **Recovery:** preserve original, recover into a new file, validate recoverable blob hashes, emit report.

### 3.6 Locking

Ether acquires a document writer lease containing process ID, machine identity, app instance ID, canonical path hash, document ID, and heartbeat. Leases live under `%LOCALAPPDATA%\DreamBay\Ether\leases`, never beside the document. Save As releases the source-path lease only after the destination is validated and acquires a destination lease before switching. A valid competing writer forces read-only open. Stale leases require SQLite lock confirmation before reclamation. Native Windows location classification remains fail-closed and hard-bounded: a cold fixed-volume probe may run for at most 12 seconds before writable admission is refused. Network shares and cloud placeholders are blocked from writable mode unless tests prove safe semantics. A rollback journal may remain beside a document only after an interrupted SQLite transaction; successful recovery or clean close removes it, and it is never treated as project content.

### 3.7 Live Output Mirror

Live Output is a document-scoped optional mirror and is disabled in every new document. `live_output_settings` stores enabled state, a document-scoped path-grant ID, naming/collision policy, move/copy policy, and last reconciliation time. `live_output_entries` maps artifact and primary collection IDs to relative materialized paths, expected hashes, and state. `live_output_operations` journals planned, staged, verified, committed, failed, and reconciled filesystem operations.

Enabling requires an explicit folder grant and creates no files until the first materialization or explicit rebuild. Materialization writes a temporary sibling, verifies length and SHA-256, then renames atomically on the same volume. Cross-volume changes copy, verify, rename, and only then remove an obsolete mirror. Collisions use the document naming policy and never overwrite silently. Disabling stops future writes without deleting existing mirror files. Rebuild recreates the mirror from embedded authoritative artifacts. Startup reconciliation compares the operation journal, manifest, and filesystem and never changes collection membership to match external drift.

Application commands are `liveOutput.enable`, `liveOutput.disable`, `liveOutput.rebuild`, `liveOutput.reconcile`, and `liveOutput.removeMirrorFiles`. Events report operation progress and attention states. Path grants are revocable and are not stored as unrestricted renderer paths.

---

## 4. Graph Schema

### 4.1 Core Types

```ts
export type PayloadChannel =
  | "text"
  | "image"
  | "mask"
  | "data"
  | "video"
  | "audio";

export type ConnectionRole =
  | "general"
  | "negative"
  | "subject"
  | "product"
  | "face"
  | "clothing"
  | "pose"
  | "setting"
  | "composition"
  | "style"
  | "lighting"
  | "colourPalette"
  | "typography"
  | "motion"
  | "timing";

export type OutputSelector =
  | { kind: "latest-approved" }
  | { kind: "latest" }
  | { kind: "all" }
  | { kind: "pinned"; outputVersionId: string };

export type EtherEdge = {
  id: string;
  from: { nodeId: string; channel: PayloadChannel };
  to: { nodeId: string; channel: PayloadChannel };
  role: ConnectionRole;
  order: number;
  selector: OutputSelector;
  adapter: { kind: "auto" } | { kind: "explicit"; adapterId: string };
  enabled: boolean;
};

export type EtherNode<TConfig extends NodeConfig = NodeConfig> = {
  id: string;
  definitionId: NodeDefinitionId;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  config: TConfig;
  presentation: NodePresentation;
};
```

Runtime status, selected output, provider response, and artifacts are not properties of `EtherNode.config`.

### 4.2 Node Registry

Every canonical node is registered through one definition:

```ts
export type NodeDefinition<TConfig extends NodeConfig> = {
  id: NodeDefinitionId;
  family: NodeFamily;
  title: string;
  description: string;
  configSchema: z.ZodType<TConfig>;
  defaultConfig: () => TConfig;
  contract: NodeContract;
  inspector: InspectorDefinition;
  executor: NodeExecutorKind;
  presentation: NodePresentationDefaults;
};
```

The registry is the source of truth for Node Library, contracts, default ports, Inspector sections, validation, recipes, MCP catalog inspection, and execution dispatch.

`NodeContract` is machine-readable and contains `inputs`, `outputs`, and a `consequences` table keyed by target channel and role. Each consequence names the executor input field, assembly strategy, preservation rule, required adapter capability, and failure reason. The build generates an exhaustive connection fixture from all source definitions, target definitions, channel pairs, roles, and registered adapters; every enabled tuple must resolve to a non-empty consequence and an execution assertion.

### 4.3 Canonical Node Definitions

| ID | Family | Inputs | Outputs | Executor |
|---|---|---|---|---|
| `prompt.text` | Prompt | Text, Data | Text, Data | deterministic assembly |
| `prompt.worker` | Prompt | all six | Text, Data | Codex LLM |
| `reference.set` | Reference | all six | present channels, Data | asset resolution |
| `generation.image` | Generation | Text, Image, Data | Image, Text, Data | image provider |
| `edit.image` | Edit | Text, Image, Mask, Data | Image, Mask, Data | edit provider |
| `edit.mask` | Edit | Image, Text, Data, Mask | Mask, Image, Data | local/manual/provider |
| `edit.transform` | Edit | Image, Data | Image, Data | local/provider transform |
| `review.compare` | Review | Text, Image, Video, Audio, Data | selected inputs, Data | human checkpoint |
| `review.evaluate` | Review | all six | Text, Data, media passthrough | Codex evaluation |
| `review.filter` | Review | Data and associated media | routed media, Data | deterministic rules |
| `flow.variables` | Flow | Text, Data | Text, Data | deterministic |
| `flow.batch` | Flow | all six | channel work-item pools, Data | batch expansion |
| `flow.join` | Flow | channel work-item pools | consolidated channels, Data | deterministic fan-in |
| `output.collection` | Output | all six | same channels, Data | membership operation |
| `output.export` | Output | all six | Data manifest | filesystem export |
| `canvas.note` | Canvas | none | Text, Data | non-runnable |
| `canvas.drawing` | Canvas | Image, Data | Image, Mask, Data | local drawing surface |

Grid, Character Sheet, Infographic, Product Shoot, Brainstormer, Mutator, Moodboard, Palette Board, Cloud, and Bubble are not additional schema definitions.

### 4.4 Connection Validation

Connection validation returns a structured result:

```ts
type ConnectionDecision =
  | { allowed: true; adapter: ResolvedAdapter | null; consequences: InputConsequence[] }
  | { allowed: false; code: ConnectionErrorCode; message: string; remedies: Remedy[] };
```

The validator checks:

1. Node definitions exist.
2. Source contract produces source channel.
3. Target contract accepts target channel.
4. Same-channel pass or explicit adapter exists.
5. Provider capability required by adapter is available.
6. Target applies or preserves the role.
7. Exact lane identity is unique.
8. No graph cycle violates executor constraints.

Allowed generic adapters are intentionally bounded:

| From | To | Adapter |
|---|---|---|
| Image | Text | Codex vision description/interpretation |
| Audio | Text | Codex/native transcription when available |
| Video | Text | transcription plus visual caption/interpretation |
| Video | Image | local keyframe/poster extraction |
| Video | Audio | local audio-stream extraction |
| Media | Data | technical metadata; semantic metadata requires Codex |
| Text | Data | schema parse or Codex structured extraction |
| Data | Text | deterministic template/serialization |
| Mask | Data | deterministic geometry serialization |
| Data | Mask | deterministic geometry rasterization when schema matches |

Text-to-Image is a Generation node function. Image-to-Mask is a Mask node function. They are not hidden edge adapters.

### 4.5 Role Consequences

Every receiving executor declares role behavior. Examples:

- Prompt and Generation assemble Text under role captions.
- Negative Text enters negative constraints, never the positive prompt body.
- Image Generator packages Image inputs as role-labeled references.
- Image Edit interprets Image by role as source, subject, composition, palette, style, or other guidance according to provider support.
- Evaluate applies its instruction to inputs and retains role in criterion context.
- Filter reads Data fields independent of role but preserves role in route provenance.
- Collection records role on membership provenance.

If a provider cannot express a role distinctly, Run Preview shows how Ether folds it into textual guidance or blocks the operation.

### 4.6 Repeated Roles And Chains

Role numbering is based on independent direct lanes entering the receiving node. A linear replacement chain retains one logical lineage key. `Prompt -> Worker -> Worker -> Generation` with Subject role produces one `Subject:` section. Two independent Subject lanes produce `Subject:` and `Subject 2:`.

### 4.7 Graph Transactions

```ts
export type GraphTransaction = {
  id: string;
  baseDocumentRevisionId: string;
  baseGraphRevisions: Record<string, string>;
  title: string;
  actor: "user" | "codex" | "recipe" | "system";
  operations: GraphOperation[];
  layoutPolicy: "preserve" | "tidy-affected" | "layout-branch";
};
```

Operations include add/update/remove node, add/update/remove edge, move/resize nodes, create/update/remove group, create/update/remove module, update module interface, and update graph properties. Application validates the complete multi-graph result before applying it. Apply creates one document revision containing one graph revision per affected graph, all committed in the same SQLite transaction with inverse operations for undo. Module creation can therefore change the parent graph, internal graph, and declared interface atomically.

---

## 5. Payloads And Outputs

### 5.1 Payload Envelope

```ts
export type PayloadEnvelope = {
  id: string;
  channel: PayloadChannel;
  role: ConnectionRole;
  content:
    | { kind: "text"; value: string }
    | { kind: "object"; value: JsonValue; schemaId?: string }
    | { kind: "artifact"; artifactId: string }
    | { kind: "pool"; workItemIds: string[] };
  source: {
    nodeId: string;
    outputVersionId: string;
    edgeId?: string;
    lineageKey: string;
  };
  metadata: Record<string, JsonValue>;
};
```

### 5.2 Node Output Versions

Executable nodes write immutable output versions. A version records:

- Node and graph revision
- Input payload IDs and selected versions
- Compiled instruction/context hash
- Provider/model/capability snapshot
- Output payload IDs
- Manual edit ancestry
- Approval state
- Run, step, work item, and attempt IDs
- Timing and failure data

Manual edits create descendants. They never mutate provider output in place.

---

## 6. Intelligence Runtime

### 6.1 Codex Runtime

Primary transport is Codex App Server. The adapter owns one supervised server process per Ether application session and supports:

- Dynamic model and reasoning-effort listing
- Thread creation and reuse according to memory policy
- Structured output schemas
- Image/media inputs supported by the chosen model
- Incremental status events
- Interrupt and timeout
- Version-pinned tool/event output capture where image generation conformance proves it

`codex exec` remains an explicit fallback path for environments where App Server cannot initialize. Fallback is visible in Provider Health and run provenance.

`model/list` is authoritative for Codex LLM model and reasoning-effort choices only. Image aspect ratio, resolution, reference count, edit support, output discovery, and cancellation are sourced from an Ether conformance manifest keyed by Codex version and tested image-generation protocol. Ether 4.0 initially targets the locally verified Codex CLI 0.144.2 surface; a changed version invalidates the cached image capability until its probe passes.

### 6.2 Worker Request

```ts
type WorkerRequest = {
  behavior: "brainstorm" | "rewrite" | "mutate" | "expand" | "reinforce" | "extract" | "critique" | "custom";
  instruction: string;
  profile: "fast" | "balanced" | "deep" | "custom";
  model: string;
  reasoningEffort: string;
  variation: number;
  contextPolicy: ContextPolicy;
  memoryPolicy: MemoryPolicy;
  outputContract: WorkerOutputContract;
  inputs: PayloadEnvelope[];
  downstream: DownstreamCapabilitySummary | null;
};
```

The compiler returns a request plus an inspectable manifest. The ordinary UI shows a concise summary; Advanced displays the full role map, selected versions, downstream constraints, excluded context, and token/media budget decisions.

### 6.3 Transformation Guard

Rewrite-like behaviors include a strict output instruction:

- Return transformed content only.
- Do not describe the prior content.
- Do not use contrastive phrases unless requested.
- Preserve unaffected details.
- Match the requested output schema exactly.

Acceptance rejects empty, conversationally prefaced, schema-invalid, or obvious change-narration output and performs a bounded corrective retry.

---

## 7. Provider Kernel

### 7.1 Capability Model

```ts
type ProviderCapability = {
  providerId: string;
  profileId: string;
  operation: "generate-image" | "edit-image" | "upscale-image" | "llm" | "interpret" | "transcribe";
  inputChannels: PayloadChannel[];
  outputChannels: PayloadChannel[];
  aspectRatios: string[];
  resolutions: ResolutionOption[];
  maxReferences: number;
  maxOutputsPerCall: number;
  supportsCancellation: boolean;
  supportsSeed: boolean;
  provenance: "runtime-discovered" | "conformance-verified" | "static-constraint";
  limitations: string[];
};
```

Provider controls bind to this profile. No hardcoded UI list may advertise values absent from the active capability.

### 7.2 Codex Adapter

- Resolve the real installed executable from local configuration, not WindowsApps shims.
- Start and retain App Server when possible.
- Separate dispatch latency from generation latency.
- Pass prompts through stdin or structured RPC, never command interpolation.
- Import all reported output files that pass validation.
- Categorize authentication, capability, invalid-input, timeout, cancellation, process, and malformed-output failures.
- Record the exact Codex version, transport, image instruction/tool contract revision, and conformance-manifest hash.

### 7.3 Antigravity Adapter

This is an explicit legacy fallback section. It is not the default Nano Banana launch gate and no Gemini API failure may route here automatically.

- Discover `agy.exe` and authenticated status.
- Use only official CLI behavior.
- Isolate each attempt in a unique staging directory.
- Request Nano Banana 2, Pro, or Lite through the verified instruction contract.
- Record requested profile separately from provider-reported identity.
- Validate Lite output against 1K constraints.
- Run a conformance probe when installation/version changes.
- Disable profiles whose probe fails; Nano Banana 2 is the minimum launch gate. The 4.0 release evidence enables Nano Banana 2, Pro, and Lite. CLI 1.1.7 exposes `AspectRatio` but no structural resolution parameter: 2K and 4K probes on Nano Banana 2 and Pro returned 1K dimensions, so every 4.0 Antigravity resolution choice is restricted to the exact 1K size recorded for its conformed ratio. Lite remains explicitly 1K-only.
- The 4.0 release evidence targets Antigravity CLI 1.1.7 noninteractive `--print`, `--model`, `--add-dir`, and `--print-timeout` behavior while reusing the host's persisted Antigravity session without launching authentication UI. A changed detected version or executable hash requires new evidence rather than an assumed compatibility claim.
- Treat Nano Banana image-profile selection as a versioned textual instruction contract until the CLI reports a separate image model identifier.
- Parse completion from process exit plus validated staged artifacts; printed prose alone never constitutes generation success.

### 7.4 API Infrastructure

### 7.5 Gemini Developer API image adapter

The primary Nano Banana adapter calls `POST /v1beta/interactions` with an `x-goog-api-key`, `store: false`, image/text input blocks, and a single image `response_format`. No `tools` field is sent, which keeps Google Search and Image Search grounding off. The output request uses `image/jpeg`: the canonical `ImageResponseFormat` schema and paid service expose only JPEG even though separate generic image-content schemas and some guide examples mention PNG. Ether performs no conversion or MIME relabelling. The adapter accepts only the profile-owned model, validates requested ratio/size against Google’s pixel table, combines cancellation with a bounded five-minute timeout for slow high-resolution calls, validates base64/MIME/pixel dimensions, SHA-256 stages the output, and asks the durable importer to accept it only after validation.

The credential store lives under Electron main only. It requires `safeStorage.isEncryptionAvailable()`, encrypts before persistent write, and never supplies plaintext to settings JSON, renderer/preload getters, document data, logs, evidence, package contents, child environments, or crash records. The public IPC state has no credential member. The `--connect-gemini` process option is a mode selector only: it opens a bounded credential surface, starts no document workspace or provider background discovery, accepts no credential argument, and reuses the same main-process IPC/store lifecycle as Settings. 401/403, 402/billing/prepay, 429 quota, safety, network, 5xx, timeout, cancellation, malformed output, and ambiguous completion are separate redacted errors. A single bounded `Retry-After` retry is allowed only after an unambiguous 429; all completed/ambiguous calls are manual-retry only.

The provider interface supports future API adapters for generation and LLM operations. API adapters are disabled until the user deliberately configures credentials and selects the route. Ether 4.0 exposes no non-Codex LLM route in the production UI: LLM Worker, Evaluate, and semantic adapters remain Codex-powered. The dormant interface can be activated only by a later approved product change. There is no hidden fallback from subscription CLI to paid API.

---

## 8. Execution

### 8.1 Immutable Plan

Run Preview and execution consume the same immutable plan:

```ts
type ExecutionPlan = {
  id: string;
  documentId: string;
  graphId: string;
  graphRevisionId: string;
  scope: ExecutionScope;
  steps: PlanStep[];
  workItems: PlannedWorkItem[];
  providerCapabilitySnapshots: ProviderCapability[];
  estimatedCalls: number;
  warnings: PlanWarning[];
  contentHash: string;
};
```

Execution refuses a modified plan hash. The user previews exactly what runs.

### 8.2 Policies

- **Generate Output:** execute one LLM Worker from selected/cached upstream versions.
- **Generate / Apply Edit:** execute one provider node from selected/cached inputs.
- **Run Selected:** execute only selected runnable nodes in dependency order; dependencies outside selection remain pinned inputs unless Preview says otherwise.
- **Run Branch:** execute downstream scope from a selected node/module.
- **Refresh Upstream:** explicitly re-execute stale runnable dependencies before target.
- **Run Recipe:** execute the recipe-defined scope and checkpoints.

The UI does not show a generic Run Node button on non-runnable nodes.

### 8.3 Scheduler

- Sequential is default.
- Batch size and concurrency are independent. `ExecutionConcurrencyDomains` is owned by the desktop application service and injected into every document scheduler. It enforces one application-wide global gate of 8, one Codex-family gate of 4 across App Server and explicit executable fallback work, one Gemini Developer API image-family gate of 4 across every document/job/batch, an explicit Antigravity fallback-family gate of 4, and a fail-closed gate of 1 for each unknown provider. Provider-family capacity is acquired before global capacity so a saturated family cannot reserve all global slots while waiting.
- A fifth Codex or Antigravity call and a ninth global call remain claimed but undispatched until the shared permit is released. Scheduler detach, cancellation, failure, retry, and recovery release permits idempotently; no job or reopened document creates another capacity domain.
- Usable Codex and Antigravity capability profiles report `maxParallelism: 4`. A route that cannot sustain four active calls is diagnosed unavailable and is not selected as a serial fallback. Exact provider/profile/model bindings never fall back to an unrelated registered provider.
- Provider-family gates are shared across simultaneous jobs. A saturated provider cannot consume capacity reserved for an unrelated provider.
- A planned work item may override its step provider/profile/model. Stable exact-count allocation lanes assign the first `N` remaining ordinals without changing the batch dimensions.
- Each work item's dimension names and values are appended to the effective provider prompt and persisted in compiled context; parameters already present in the step configuration are not duplicated.
- Jobs and attempts persist before process dispatch.
- Provider acceptance and artifact import occur transactionally.
- Cancellation marks queued items cancelled and interrupts active providers when supported.
- Process-loss recovery schedules unfinished queued items automatically when the document reopens.
- Retry creates a new attempt under the same work item.
- Terminal jobs expose no cosmetic Resume action. Failed items use explicit Retry and retain their immutable plan and provider allocation.

---

## 9. Recipes

A recipe manifest is validated against:

```ts
type RecipeManifest = {
  id: string;
  version: string;
  title: string;
  description: string;
  parameters: RecipeParameter[];
  graph: GraphBlueprint;
  capabilityRequirements: CapabilityRequirement[];
  substitutions: ProviderSubstitution[];
  layout: RecipeLayoutPolicy;
  checkpoints: ReviewCheckpoint[];
  expectedWork: ExpectedWorkRange;
  acceptanceScenario: FakeProviderScenario;
};
```

Instantiation resolves parameters, validates capabilities, builds one GraphTransaction, previews changes, and applies atomically. A recipe may create a module rather than exposing its complete internal graph at the parent level.

---

## 10. Application Service

### 10.1 Commands

Command families:

- `document.new`, `document.open`, `document.save`, `document.saveAs`, `document.saveCopy`, `document.close`, `document.compact`, `document.recover`
- `graph.applyTransaction`, `graph.undo`, `graph.redo`, `graph.validate`, `graph.layout`
- `reference.link`, `reference.embed`, `reference.relink`, `reference.remove`
- `recipe.preview`, `recipe.instantiate`
- `run.preview`, `run.start`, `run.cancel`, `run.retry`, `run.resume`
- `review.approve`, `review.rate`, `review.tag`, `review.route`
- `artifact.export`, `artifact.dragExport`, `artifact.deleteDerivative`
- `provider.probe`, `provider.refresh`
- `permission.grantEdit`, `permission.grantRun`, `permission.revoke`

Commands return typed results and publish events. Clients do not mutate cached domain objects as a substitute for commands.

### 10.2 Queries

- Document summary and dirty state
- Graph snapshot, catalog, selection details, and validation
- Node outputs and compiled-input preview
- Provider capabilities and health
- Job summary, timeline, work items, and attempts
- Artifact search, collection membership, and lineage
- Recipe catalog and setup schema
- Recovery and storage status

Artifact search treats empty search text as no text filter.

### 10.3 Events

Events include document state, graph revision, selection-relevant domain changes, provider health, plan state, job/work-item/attempt state, artifact accepted, reference missing/relinked, recipe installed, permission changed, and recovery attention.

Electron IPC and MCP use generated or shared schemas for these messages.

---

## 11. Desktop Security And Media Delivery

- Electron uses `contextIsolation: true`, `nodeIntegration: false`, sandboxing where compatible, and restrictive navigation/window-open handlers.
- Preload exposes a narrow typed `window.ether` bridge.
- Every IPC command validates sender, document scope, payload schema, and path grants.
- Media URLs use `ether-asset://document-id/artifact-id/variant`.
- The protocol supports byte ranges, cache headers, thumbnail variants, and authorization.
- Arbitrary local paths are never rendered as URLs.
- Drag export materializes manifest-tracked temporary files with a 24-hour default lifetime.

---

## 12. Plugin And MCP Contract

MCP uses the official TypeScript SDK and `StdioServerTransport`; Ether does not maintain custom `Content-Length` framing or a second JSON-RPC parser. MCP exposes application-service semantics, not direct JSON graph replacement. Required tools include:

- Active-document inspect and health; document create/open/save-copy remain desktop-owned lifecycle actions
- Node catalog and provider capability inspection
- Graph snapshot and validation
- Graph transaction preview/apply/reject
- Recipe list/preview/instantiate
- Artifact/reference/run inspection
- Immutable run-plan preview
- Explicit run start/cancel/retry
- Project doctor and recovery inspection

Graph transactions use temporary operation references so a plugin can add nodes and connect them atomically. Every apply names a base revision and fails on conflict with a rebaseable diagnostic.

The plugin cannot execute under Edit Permit. `run.start` requires a Run Permit bound to the exact plan ID and content hash.

---

## 13. Error Model

All domain-facing failures use:

```ts
type EtherError = {
  code: string;
  category: "document" | "graph" | "provider" | "execution" | "reference" | "security" | "validation";
  message: string;
  userAction?: string;
  retryable: boolean;
  details?: Record<string, JsonValue>;
  causeId?: string;
};
```

UI messages are concise. Run Detail and diagnostics retain bounded technical evidence. Raw process output is size-limited and secrets are redacted.

---

## 14. Observability

- Structured local logs rotate by age and size.
- Correlation IDs link command, plan, job, work item, attempt, provider run, output version, and artifact.
- Provider runs record command identity and arguments after redaction, input/output IDs, exit state, timing phases, and validation outcome.
- Performance marks cover document open, graph hydration, search, plan compilation, provider dispatch, first provider event, artifact import, and thumbnail decode.
- No telemetry leaves the machine in 4.0 unless a future opt-in feature is separately approved.

---

## 15. Testing Architecture

### 15.1 Unit

- Zod contracts and schema invariants
- Connection and role consequences
- Graph transaction inverse operations
- Prompt/context assembly and transformation guard
- Batch expansion and plan hashing
- Capability resolution
- Recipe validation
- Path grants and MIME validation

### 15.2 Integration

- Real SQLite document repositories
- Crash-safe import and recovery
- Application command/query/event flow
- Fake provider execution and durable retry
- Codex App Server protocol fixture
- Antigravity CLI protocol fixture and opt-in live conformance
- MCP transaction and permission flow

### 15.3 UI And Packaged

- React component interaction tests for Inspector, channel rails, role grid, Reference Desk, Batch Matrix, and Job Center
- Playwright primary journeys against fake provider
- Packaged Electron file association, protocol, Save/Open, drag export, and security tests
- ASAR inventory audit rejects benchmark, fixture, specification, source-map, credential, cache, and development-configuration material; required dependency license files and `THIRD-PARTY-NOTICES.txt` are retained and hashed
- Screenshot checks across 1920x1080, 1440x900, 1280x720, and high-DPI scaling
- Canvas pixel/nonblank checks and overlap assertions

### 15.4 Performance And Recovery

- 1,000-node graph fixture
- 10,000-artifact document fixture
- 500-work-item batch fixture
- 4 GB sparse/import fixture where the test environment permits
- Kill during graph transaction, blob import, provider import, Save As, compact, and optional Live Output move
- Deliberate metadata, index, and chunk corruption fixtures

---

## 16. Clean-Break Removal

Before 4.0 release, remove:

- Directory-project creation/opening and path helpers
- `graph.json`, project-local SQLite, assets, logs, and collection-folder assumptions
- Legacy migrations and graph aliases
- `CanvasNodeData` flat optional-property model
- Legacy artifact-kind port semantics
- Assistant node family
- Prompt-section node types
- Directory store node
- Placeholder generation node types now represented by recipes
- Direct renderer filesystem paths
- Duplicate execution paths that do not share immutable plans
- Legacy MCP tools that replace arbitrary graph JSON

Removal occurs only after the replacement vertical slice opens, saves, and executes a fake-provider document. Old user project folders may be deleted separately under the user’s authorization, but deletion is not an application migration feature.

---

## 17. Format Freeze And Compatibility

During development, 4.0 schema changes may reset test documents. Before release candidate:

1. Freeze application ID, page size, format version 4.0.0, and schema 40000.
2. Freeze channel, role, canonical node, graph transaction, and recipe contracts.
3. Create golden `.ether` fixtures.
4. Require all later 4.x changes to migrate within the single-file format.

Ether 4.0 makes no compatibility promise for 1.x, 2.x, or 2.5 project directories. It does promise forward-safe refusal of unsupported future major documents and non-destructive read-only recovery behavior.

---

## 18. Primary Technical References

- [SQLite application-defined file identifiers](https://sqlite.org/pragma.html#pragma_application_id)
- [SQLite online backup API](https://sqlite.org/backup.html)
- [SQLite `VACUUM INTO`](https://sqlite.org/lang_vacuum.html#vacuuminto)
- [SQLite write-ahead logging and companion files](https://sqlite.org/wal.html)
- [SQLite incremental BLOB I/O](https://sqlite.org/c3ref/blob_open.html)
- [Model Context Protocol stdio transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [Codex App Server](https://developers.openai.com/codex/app-server/)
- [Antigravity CLI overview](https://antigravity.google/docs/cli-overview)
- [Antigravity model documentation](https://antigravity.google/docs/models)

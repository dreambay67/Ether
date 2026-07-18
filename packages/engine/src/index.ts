export {
  __setProjectStoreTestHooks,
  createProject,
  loadGraph,
  openProject,
  saveGraph,
  saveGraphWithRevision
} from "./project/projectStore.js";
export type { SaveGraphOptions, SaveGraphWithRevisionResult } from "./project/projectStore.js";
export {
  addArtifactToCollection,
  createArtifact,
  createLineageEdge,
  getArtifactById,
  listArtifacts,
  listArtifactsByCollection,
  listLineageChildren,
  listLineageParents,
  rateArtifact,
  tagArtifact,
  updateArtifactMetadata
} from "./artifacts/artifactStore.js";
export {
  addJobDependencies,
  addJobItems,
  appendJobEvent,
  cancelJobItem,
  enqueueJob,
  getJobById,
  getJobItemById,
  listJobDependencies,
  listJobEvents,
  listJobItems,
  listJobs,
  listReadyJobItems,
  recordJobItemFailure,
  retryJobItem,
  transitionJobItemStatus,
  transitionJobStatus
} from "./jobs/jobStore.js";
export {
  cancelRunJob,
  enqueueRun,
  executeQueuedRun,
  previewRun,
  previewRunPlan,
  retryRunItem
} from "./jobs/runCoordinator.js";
export {
  createInitialGraphRevision,
  getGraphRevision,
  getLatestGraphRevision,
  saveGraphRevision
} from "./revisions/revisionStore.js";
export { createSnapshot, restoreSnapshot } from "./project/snapshots.js";
export { clearProviderLogs, clearRunArtifacts, runHealthCheck } from "./project/health.js";
export {
  completeProviderRun,
  createProviderRun,
  failProviderRun,
  listProviderRuns
} from "./project/providerRuns.js";
export { REQUIRED_DATABASE_TABLES } from "./project/database.js";
export {
  ensureCollectionFolder,
  ensureDirectoryRoot,
  linkExternalReference,
  listAssetMoves,
  listAssets,
  moveAssetToCollection,
  saveGeneratedAsset,
  saveMaskAsset,
  updateAssetMetadata
} from "./project/assets.js";
export {
  CONNECTION_ROLES,
  DEFAULT_CONNECTION_ROLE,
  PAYLOAD_CHANNELS,
  channelLabel,
  isConnectionRole,
  isPayloadChannel,
  normalizeConnectionRole,
  normalizePayloadChannel,
  roleLabel
} from "./graph/channels.js";
export {
  EDGE_GRAPH_VERSION,
  canonicalChannel,
  canonicalRole,
  resolveEdgeSemantics
} from "./graph/edgeSemantics.js";
export {
  NODE_CATEGORIES,
  NODE_CATEGORY_LABELS,
  NODE_DEFINITIONS,
  coerceCanvasNodeData,
  createGraphNodeData,
  getNodeDefinition,
  referenceAssetsFromNodeData
} from "./graph/nodeCatalog.js";
export { canConnectNodeKinds } from "./graph/connectionRules.js";
export { distanceFromPointToSegment, findEdgeInsertionTarget } from "./graph/canvasGeometry.js";
export { decorateEdgeForNodes, defaultHandlesForConnection } from "./graph/edgeDecoration.js";
export { applyGraphPatch, previewGraphPatch } from "./graph/graphPatch.js";
export { getNodeContract, getOptionalNodeContract, NODE_CONTRACTS } from "./graph/contracts.js";
export {
  CANVAS_TEMPLATE_CATALOG,
  createCanvasTemplate,
  createReviewRouterTemplate
} from "./graph/reviewRouterTemplate.js";
export {
  assembleGenerationInputs,
  assemblePromptForNode,
  freezePromptNode,
  getUpstreamNodes,
  resolveReferenceRole
} from "./graph/promptAssembly.js";
export {
  executeGraphRun,
  executePlannedJobItem,
  executionDependenciesForPlan,
  getGenerationProviderDiagnostics,
  listRunRecords,
  planExecution,
  runExecutionQueue
} from "./run/execution.js";
export { markDownstreamStale } from "./run/rerunState.js";
export {
  MUTATION_PRESETS,
  createTextMutationArtifact,
  normalizeMutationSettings,
  shouldApplyMutation,
  textForNode
} from "./graph/textMutation.js";
export type {
  ConnectionRole,
  PayloadChannel
} from "./graph/channels.js";
export type {
  CanvasNodeData,
  EtherNodeCategory,
  EtherNodeDefinition,
  EtherNodeKind,
  ReferenceAssetEntry
} from "./graph/nodeCatalog.js";
export type { ConnectionRuleContext, ConnectionRuleResult } from "./graph/connectionRules.js";
export type { GeometryEdge, GeometryNode, GraphPoint } from "./graph/canvasGeometry.js";
export type { EdgeDecorationEdge, EdgeDecorationNode } from "./graph/edgeDecoration.js";
export type {
  CanonicalEdgeData,
  EdgeAdapter,
  EdgeAdapterOperation,
  EdgeAdapterStatus,
  EdgeSemanticsResult
} from "./graph/edgeSemantics.js";
export type {
  GraphPatch as CoPilotGraphPatch,
  GraphPatchDiffSummary,
  GraphPatchEdgeDiff,
  GraphPatchEntityChange,
  GraphPatchNodeDiff,
  GraphPatchOperation,
  GraphPatchPreview
} from "./graph/graphPatch.js";
export type {
  ContractArtifactKind,
  NodeContractHelp,
  ContractPort,
  ContractPortDirection,
  NodeContract
} from "./graph/contracts.js";
export type {
  CanvasTemplate,
  CanvasTemplateId,
  CanvasTemplateOptions,
  CanvasTemplateSummary,
  ReviewRouterTemplate,
  ReviewRouterTemplateOptions
} from "./graph/reviewRouterTemplate.js";
export type {
  EdgeRoleArtifact,
  GenerationInputAssembly,
  PromptAssembly,
  PromptSectionArtifact,
  ReferenceArtifact
} from "./graph/artifacts.js";
export type {
  MutationPreset,
  MutationSettings,
  TextMutationArtifact,
  TextMutationKind
} from "./graph/textMutation.js";
export {
  DEFAULT_REFERENCE_ROLE,
  REFERENCE_ROLE_OPTIONS,
  normalizeReferenceRole
} from "./graph/referenceRoles.js";
export type { ReferenceRole } from "./graph/referenceRoles.js";
export type {
  ExecutionProviderFacets,
  ExecutionNodeResult,
  ExecutionPlan,
  ExecutionPolicy,
  ExecutionQueueItem,
  ExecutionRequest,
  ExecutionResultStatus,
  ExecutionRunResult,
  ExecutionWorkerState,
  RunRecord
} from "./run/execution.js";
export type { RerunState } from "./run/rerunState.js";
export type {
  CreateProjectOptions,
  EtherGraph,
  EtherGraphInput,
  HealthCheckResult,
  HealthIssue,
  NormalizedEtherGraph,
  ProjectDatabaseStatus,
  ProjectMetadata,
  ProjectOpenResult,
  RestoreSnapshotResult,
  SnapshotRecord,
  SnapshotSlot
} from "./project/schema.js";
export type {
  CreateProviderRunInput,
  ListProviderRunsQuery,
  ProviderRunRecord,
  ProviderRunStatus
} from "./project/providerRuns.js";
export type {
  AddArtifactToCollectionInput,
  ArtifactKind,
  ArtifactRecord,
  CreateArtifactInput,
  CreateLineageEdgeInput,
  LineageEdgeRecord,
  ListArtifactsQuery,
  RateArtifactInput,
  TagArtifactInput,
  UpdateArtifactMetadataInput
} from "./artifacts/types.js";
export type {
  AddJobDependenciesInput,
  AddJobItemsInput,
  AppendJobEventInput,
  CancelJobItemInput,
  EnqueueJobInput,
  EtherJob,
  EtherJobDependency,
  EtherJobEvent,
  EtherJobItem,
  JobItemStatus,
  JobStatus,
  ListJobsQuery,
  RecordJobItemFailureInput,
  RetryJobItemInput,
  TransitionJobItemStatusInput,
  TransitionJobStatusInput
} from "./jobs/types.js";
export type {
  EnqueuedRun,
  ExecutedQueuedRun,
  ExecuteQueuedRunOptions,
  GraphPatch,
  RunCoordinatorRunner,
  RunPreview,
  RunPreviewItem
} from "./jobs/runCoordinator.js";
export type {
  CreateGraphRevisionInput,
  GraphRevision,
  SaveGraphRevisionInput
} from "./revisions/types.js";
export { GraphRevisionConflict } from "./revisions/types.js";
export { LATEST_GRAPH_VERSION, normalizeEtherGraph } from "./project/schema.js";
export type {
  AssetKind,
  AssetMoveRecord,
  AssetRecord,
  EnsureFolderOptions,
  LinkExternalReferenceOptions,
  ListAssetMovesQuery,
  ListAssetsQuery,
  MoveAssetToCollectionOptions,
  SaveGeneratedAssetOptions,
  SaveMaskAssetOptions,
  UpdateAssetMetadataOptions
} from "./project/assets.js";
export type { ProviderLogCleanupResult, RunArtifactCleanupResult } from "./project/health.js";

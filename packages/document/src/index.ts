export {
  assertEtherDocumentWritable,
  createEtherDocument,
  type CreateEtherDocumentOptions
} from "./database.js";
export * from "./format.js";
export {
  DocumentStore,
  DocumentStoreError,
  type CompactStage,
  type CreateStage,
  type CreateDocumentStoreOptions,
  type DocumentAccessMode,
  type DocumentRepositories,
  type ReadDocumentRepositories,
  type DocumentStoreEnvironment,
  type DocumentStoreMode,
  type OpenDocumentStoreOptions,
  type ReadOnlyReason,
  type ReferenceGrantAuthority,
  type ReferenceGrantFingerprintRequest,
  type ReferenceGrantPathRequest,
  type ReferenceGrantRequest,
  type WritableLocationCapabilityAdapter,
  type WritableLocationKind
} from "./documentStore.js";
export {
  EtherDocumentError,
  inspectEtherDocument,
  type EtherDocumentErrorCode,
  type EtherDocumentInspection,
  type EtherDocumentPragmas
} from "./validation.js";
export {
  BlobImportError,
  importBlob,
  mediaSignatureMatches,
  type ImportBlobInput,
  type ImportBlobOptions,
  type ImportBlobResult
} from "./blob/importBlob.js";
export {
  BlobReadError,
  MAX_BUFFERED_BLOB_RANGE,
  readBlobRange,
  streamBlobRange
} from "./blob/readBlobRange.js";
export {
  embedReference,
  embedReferences,
  linkReference,
  ReferenceError,
  relinkReference,
  resolveReference,
  revokeReferenceGrant
} from "./repositories/references.js";
export {
  assertAppDataOwnedPath,
  ensureOwnedRecoveryDirectory,
  listRecoveryJournalPaths,
  quarantineRecoveryPath,
  readRecoveryJournal,
  removeOwnedStagingPath,
  removeRecoveryJournal,
  resolveRecoveryRoots,
  writeRecoveryJournal,
  type RecoveryRoots
} from "./recovery/recoveryJournal.js";
export {
  reconcileStaging,
  type ReconcileStagingResult
} from "./recovery/reconcileStaging.js";
export {
  repairDocument,
  RepairDocumentError,
  type RepairLoss,
  type RepairReport
} from "./recovery/repairDocument.js";
export {
  BLOB_CHUNK_SIZE,
  BlobRepositoryError,
  INLINE_BLOB_LIMIT,
  type BlobRecord,
  type StagedBlobChunk,
  type StoredBlobPart
} from "./repositories/blobs.js";
export {
  ExecutionRepository,
  ExecutionRepositoryError,
  type AdapterIntermediateCompletion,
  type ArtifactLineageSnapshot,
  type ClaimedExecution,
  type CompletionAcceptance,
  type CompletionOutput,
  type ExecutionJobSummary,
  type ExecutionRepositorySnapshot,
  type ExecutionTimelineEvent,
  type ProviderRunSnapshot
} from "./repositories/execution.js";
export {
  CollectionRepository,
  CollectionRepositoryError,
  type CollectionInput,
  type CollectionMemberInput
} from "./repositories/collections.js";
export {
  ExportRepository,
  ExportRepositoryError
} from "./repositories/exports.js";
export {
  ArtifactRepository,
  type ArtifactDetail,
  type ArtifactLineageRecord
} from "./repositories/artifacts.js";
export { OutputRepository } from "./repositories/outputs.js";
export { ReferenceRepository } from "./repositories/references.js";

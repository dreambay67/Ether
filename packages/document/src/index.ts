export {
  assertEtherDocumentWritable,
  createEtherDocument,
  type CreateEtherDocumentOptions
} from "./database.js";
export * from "./format.js";
export {
  DocumentStore,
  DocumentStoreError,
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
  linkReference,
  ReferenceError,
  relinkReference,
  resolveReference,
  revokeReferenceGrant
} from "./repositories/references.js";
export {
  assertAppDataOwnedPath,
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

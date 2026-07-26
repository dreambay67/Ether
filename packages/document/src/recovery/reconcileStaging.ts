import path from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { ProviderCapabilitySchema } from "@ether/schema";

import { importBlob } from "../blob/importBlob.js";
import { openEtherDocumentConnection } from "../database.js";
import { DOCUMENT_STORE_INTERNAL, type DocumentStore } from "../documentStore.js";
import {
  assertAppDataOwnedPath,
  assertDestructiveRecoveryPath,
  ensureOwnedRecoveryDirectory,
  listRecoveryJournalPaths,
  quarantineRecoveryPath,
  readRecoveryJournal,
  readRecoveryJournalOwner,
  removeOwnedStagingPath,
  removeRecoveryJournal,
  resolveRecoveryRoots,
  writeRecoveryJournal
} from "./recoveryJournal.js";

export interface ReconcileStagingResult {
  attention: string[];
  quarantined: string[];
  recovered: string[];
  removed: string[];
}

function sameDocumentPath(left: string, right: string): boolean {
  const first = path.resolve(left);
  const second = path.resolve(right);
  return process.platform === "win32" ? first.toLowerCase() === second.toLowerCase() : first === second;
}

export async function reconcileStaging(
  store: DocumentStore,
  options: { appDataRoot?: string } = {}
): Promise<ReconcileStagingResult> {
  const roots = resolveRecoveryRoots(options.appDataRoot);
  ensureOwnedRecoveryDirectory(roots.stagingRoot, roots.appDataRoot);
  const result: ReconcileStagingResult = {
    attention: [],
    quarantined: [],
    recovered: [],
    removed: []
  };
  for (const journalPath of listRecoveryJournalPaths(roots.appDataRoot)) {
    let entry;
    try {
      const owner = readRecoveryJournalOwner(journalPath);
      if (
        owner !== undefined &&
        (owner.documentId !== store.documentId || !sameDocumentPath(owner.documentPath, store.path))
      ) {
        continue;
      }
      entry = readRecoveryJournal(journalPath);
      assertAppDataOwnedPath(entry.stagedPath, roots.stagingRoot);
    } catch {
      quarantineRecoveryPath(journalPath, roots.appDataRoot);
      result.quarantined.push(path.basename(journalPath));
      continue;
    }
    if (
      entry.documentId !== store.documentId ||
      !sameDocumentPath(entry.documentPath, store.path)
    ) {
      continue;
    }

    try {
      assertDestructiveRecoveryPath(
        entry.stagedPath,
        roots.stagingRoot,
        roots.appDataRoot
      );
    } catch {
      result.attention.push(entry.id);
      continue;
    }

    if (entry.kind === "blob-import") {
      if (entry.contentKey !== undefined) {
        await store[DOCUMENT_STORE_INTERNAL]("write", ({ blobs }) =>
          blobs.removeIncomplete(entry.id, entry.contentKey)
        );
      }
      try {
        removeOwnedStagingPath(entry.stagedPath, roots.appDataRoot);
        removeRecoveryJournal(journalPath, roots.appDataRoot);
        result.removed.push(entry.id);
      } catch {
        writeRecoveryJournal({
          appDataRoot: roots.appDataRoot,
          entry: { ...entry, state: "failed", updatedAt: new Date().toISOString() }
        });
        result.attention.push(entry.id);
      }
      continue;
    }

    if (entry.kind === "document-repair") {
      try {
        if (
          entry.destinationPath !== undefined &&
          existsSync(entry.destinationPath)
        ) {
          const published = openEtherDocumentConnection(entry.destinationPath, true);
          try {
            if (
              entry.expectedDocumentId === undefined ||
              published.inspection.document.documentId !== entry.expectedDocumentId
            ) {
              throw new Error("Published repair document identity does not match its journal.");
            }
          } finally {
            published.database.close();
          }
          if (existsSync(entry.stagedPath)) {
            removeOwnedStagingPath(entry.stagedPath, roots.appDataRoot);
          }
          result.recovered.push(entry.id);
        } else if (existsSync(entry.stagedPath)) {
          removeOwnedStagingPath(entry.stagedPath, roots.appDataRoot);
          result.removed.push(entry.id);
        } else {
          result.removed.push(entry.id);
        }
        removeRecoveryJournal(journalPath, roots.appDataRoot);
      } catch {
        writeRecoveryJournal({
          appDataRoot: roots.appDataRoot,
          entry: { ...entry, state: "failed", updatedAt: new Date().toISOString() }
        });
        result.attention.push(entry.id);
      }
      continue;
    }

    if (entry.execution !== undefined) {
      const completion = entry.execution;
      try {
        const snapshot = await store[DOCUMENT_STORE_INTERNAL]("read", ({ execution }) => ({
          claim: execution.getClaimForAttempt(completion.attemptId),
          intent: execution.getProviderCompletion(completion.attemptId)
        }));
        if (snapshot.claim === undefined || snapshot.claim.providerAttemptId !== completion.providerAttemptId) {
          throw new Error("Provider completion does not match a persisted execution attempt.");
        }
        if (snapshot.claim.attempt.status === "accepted" || snapshot.intent?.state === "accepted") {
          removeOwnedStagingPath(entry.stagedPath, roots.appDataRoot);
          removeRecoveryJournal(journalPath, roots.appDataRoot);
          result.removed.push(entry.id);
          continue;
        }
        if (entry.state === "prepared" || completion.outputs.length === 0) {
          const containsOutput = existsSync(entry.stagedPath) && readdirSync(entry.stagedPath).length > 0;
          if (containsOutput) {
            await store[DOCUMENT_STORE_INTERNAL]("write", ({ execution }) =>
              execution.failAttempt(
                completion.attemptId,
                "PROCESS_LOST_PARTIAL_OUTPUT",
                "Provider output was interrupted before durable provenance was complete.",
                false
              )
            );
            result.attention.push(entry.id);
          } else {
            result.removed.push(entry.id);
          }
          removeOwnedStagingPath(entry.stagedPath, roots.appDataRoot);
          removeRecoveryJournal(journalPath, roots.appDataRoot);
          continue;
        }
        const recoveredOutputs = completion.outputs.map((output) => {
          assertDestructiveRecoveryPath(output.stagedPath, entry.stagedPath, roots.appDataRoot);
          if (output.thumbnailStagedPath !== undefined) {
            assertDestructiveRecoveryPath(output.thumbnailStagedPath, entry.stagedPath, roots.appDataRoot);
            if (output.thumbnailMediaType === undefined) {
              throw new Error("Provider thumbnail recovery metadata is incomplete.");
            }
          }
          return {
            ...output,
            bytes: readFileSync(output.stagedPath),
            ...(output.thumbnailStagedPath === undefined ? {} : {
              thumbnailBytes: readFileSync(output.thumbnailStagedPath),
              thumbnailMediaType: output.thumbnailMediaType!
            })
          };
        });
        await store[DOCUMENT_STORE_INTERNAL]("write", ({ execution }) => {
          execution.stageProviderCompletion(completion);
          execution.acceptProviderOutput({
            claim: snapshot.claim!,
            identifiers: {
              providerRunId: completion.providerRunId,
              capabilitySnapshotId: completion.capabilitySnapshotId,
              acceptedAt: completion.acceptedAt
            },
            outputs: recoveredOutputs,
            providerId: completion.providerId,
            modelId: completion.modelId,
            capabilitySnapshot: ProviderCapabilitySchema.parse(completion.capabilitySnapshot),
            request: completion.request,
            response: completion.response ?? {},
            metadata: completion.metadata ?? {}
          });
        });
        removeOwnedStagingPath(entry.stagedPath, roots.appDataRoot);
        removeRecoveryJournal(journalPath, roots.appDataRoot);
        result.recovered.push(entry.id);
      } catch {
        writeRecoveryJournal({
          appDataRoot: roots.appDataRoot,
          entry: { ...entry, state: "failed", updatedAt: new Date().toISOString() }
        });
        result.attention.push(entry.id);
      }
      continue;
    }

    if (entry.artifact === undefined) {
      quarantineRecoveryPath(journalPath, roots.appDataRoot);
      result.quarantined.push(entry.id);
      result.attention.push(entry.id);
      continue;
    }

    try {
      const artifact = {
        ...entry.artifact,
        metadata: {
          ...entry.artifact.metadata,
          recovery: {
            journalId: entry.id,
            recoveredAt: entry.updatedAt,
            reviewRequired: true,
            status: "recovered"
          }
        }
      };
      await importBlob(
        store,
        {
          sourcePath: entry.stagedPath,
          mediaType: entry.mediaType,
          artifact
        },
        { appDataRoot: roots.appDataRoot }
      );
      await store[DOCUMENT_STORE_INTERNAL]("write", ({ revisions }) => revisions.markDirty());
      removeOwnedStagingPath(entry.stagedPath, roots.appDataRoot);
      removeRecoveryJournal(journalPath, roots.appDataRoot);
      result.recovered.push(entry.id);
    } catch {
      writeRecoveryJournal({
        appDataRoot: roots.appDataRoot,
        entry: { ...entry, state: "failed", updatedAt: new Date().toISOString() }
      });
      result.attention.push(entry.id);
    }
  }
  return result;
}

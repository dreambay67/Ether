import path from "node:path";

import { importBlob } from "../blob/importBlob.js";
import { DOCUMENT_STORE_INTERNAL, type DocumentStore } from "../documentStore.js";
import {
  assertAppDataOwnedPath,
  assertDestructiveRecoveryPath,
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
      assertDestructiveRecoveryPath(entry.stagedPath, roots.stagingRoot);
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

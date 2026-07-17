import path from "node:path";

import { importBlob } from "../blob/importBlob.js";
import type { DocumentStore } from "../documentStore.js";
import {
  assertAppDataOwnedPath,
  listRecoveryJournalPaths,
  quarantineRecoveryPath,
  readRecoveryJournal,
  removeOwnedStagingPath,
  removeRecoveryJournal,
  resolveRecoveryRoots
} from "./recoveryJournal.js";

export interface ReconcileStagingResult {
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
  const result: ReconcileStagingResult = { quarantined: [], recovered: [], removed: [] };
  for (const journalPath of listRecoveryJournalPaths(roots.appDataRoot)) {
    let entry;
    try {
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
      try {
        quarantineRecoveryPath(entry.stagedPath, roots.appDataRoot);
      } catch {
        // The journal itself remains the durable evidence when staging is already absent.
      }
      removeRecoveryJournal(journalPath, roots.appDataRoot);
      result.quarantined.push(entry.id);
      continue;
    }

    if (entry.kind === "blob-import") {
      if (entry.contentKey !== undefined) {
        await store.transaction(({ blobs }) => blobs.removeIncomplete(entry.contentKey!));
      }
      try {
        removeOwnedStagingPath(entry.stagedPath, roots.appDataRoot);
      } catch {
        // Reclaim is idempotent when a prior startup already removed the staging directory.
      }
      removeRecoveryJournal(journalPath, roots.appDataRoot);
      result.removed.push(entry.id);
      continue;
    }

    try {
      await importBlob(
        store,
        {
          sourcePath: entry.stagedPath,
          mediaType: entry.mediaType,
          ...(entry.artifact === undefined ? {} : { artifact: entry.artifact })
        },
        { appDataRoot: roots.appDataRoot }
      );
      removeOwnedStagingPath(entry.stagedPath, roots.appDataRoot);
      removeRecoveryJournal(journalPath, roots.appDataRoot);
      result.recovered.push(entry.id);
    } catch {
      try {
        quarantineRecoveryPath(entry.stagedPath, roots.appDataRoot);
      } catch {
        // Missing staging is represented by the quarantined/reclaimed journal outcome.
      }
      removeRecoveryJournal(journalPath, roots.appDataRoot);
      result.quarantined.push(entry.id);
    }
  }
  return result;
}

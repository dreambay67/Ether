import { DatabaseSync } from "node:sqlite";

export type SqliteDatabase = DatabaseSync;

export function openDatabase(databasePath: string, options: { readonly?: boolean } = {}) {
  return new DatabaseSync(databasePath, options.readonly ? { readOnly: true } : {});
}

export function runInTransaction<T>(db: SqliteDatabase, task: () => T): T {
  db.exec("BEGIN IMMEDIATE");

  try {
    const result = task();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original transaction error.
    }

    throw error;
  }
}

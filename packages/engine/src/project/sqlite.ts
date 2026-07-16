import { DatabaseSync } from "node:sqlite";

export type SqliteDatabase = DatabaseSync;

export function openDatabase(databasePath: string, options: { readonly?: boolean } = {}) {
  const db = new DatabaseSync(databasePath, options.readonly ? { readOnly: true } : {});
  db.exec("PRAGMA foreign_keys = ON");
  return db;
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

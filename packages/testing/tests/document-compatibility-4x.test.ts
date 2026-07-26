import { inspectEtherDocument, migrate4x, repairDocument } from "@ether/document";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

let root = "";
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ""; });

describe("Ether 4.x compatibility", () => {
  it("opens the representative golden 4.0 document and runs the explicit no-op migration harness", () => {
    const fixture = path.resolve(import.meta.dirname, "../fixtures/documents/4.0/golden.ether");
    expect(inspectEtherDocument(fixture).quickCheck).toBe("ok");
    const database = new DatabaseSync(fixture, { readOnly: true });
    try {
      expect(migrate4x(database)).toMatchObject({ migrated: false, fromFormatVersion: "4.0.0", fromSchemaVersion: 40000 });
      expect(database.prepare("SELECT count(*) AS count FROM nodes").get()).toEqual({ count: 2 });
      expect(database.prepare("SELECT count(*) AS count FROM blobs").get()).toEqual({ count: 2 });
      expect(database.prepare("SELECT count(*) AS count FROM artifacts").get()).toEqual({ count: 1 });
      expect(database.prepare("SELECT count(*) AS count FROM recipes").get()).toEqual({ count: 1 });
      expect(database.prepare("SELECT count(*) AS count FROM work_items").get()).toEqual({ count: 3 });
    }
    finally { database.close(); }
  });

  it("refuses a future major before it can be opened for normal use", () => {
    const fixture = path.resolve(import.meta.dirname, "../fixtures/documents/4.0/future-major.ether");
    expect(() => inspectEtherDocument(fixture)).toThrow(/future major/i);
  });

  it("repairs supported derived-index corruption through read-only recovery without mutating the source", async () => {
    root = mkdtempSync(path.join(tmpdir(), "ether-compatibility-"));
    const fixture = path.resolve(import.meta.dirname, "../fixtures/documents/4.0/recovery-read-only.ether");
    const copy = path.join(root, "recovery.ether");
    copyFileSync(fixture, copy);
    const before = readFileSync(copy);
    expect(() => inspectEtherDocument(copy)).toThrow(/FTS index/i);
    const recovery = new DatabaseSync(copy, { readOnly: true });
    try {
      expect(recovery.prepare("SELECT title FROM document WHERE singleton = 1").get()).toEqual({ title: "Ether 4.0 recovery fixture" });
    } finally { recovery.close(); }
    expect(readFileSync(copy).equals(before)).toBe(true);
    const repaired = path.join(root, "repaired.ether");
    await expect(repairDocument(copy, repaired, { appDataRoot: root })).resolves.toMatchObject({ losses: [] });
    expect(inspectEtherDocument(repaired).quickCheck).toBe("ok");
    expect(readFileSync(copy).equals(before)).toBe(true);
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAntigravityConformance, writeAntigravityConformance } from "@ether/providers";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Antigravity capability conformance evidence", () => {
  it("accepts only a bounded, matching CLI version and binary hash record", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-antigravity-evidence-"));
    roots.push(root);
    await writeAntigravityConformance(root, {
      schemaVersion: 1, cli: { version: "1.1.4", sha256: "hash-a" }, createdAt: new Date().toISOString(),
      profiles: [{ requestedProfile: "nano-banana-2", result: "pass", artifacts: [{ sha256: "image-hash", width: 1, height: 1, mimeType: "image/png" }] }]
    });
    await expect(readAntigravityConformance(root, { version: "1.1.4", sha256: "hash-a" })).resolves.toMatchObject({ profiles: [{ result: "pass" }] });
    await expect(readAntigravityConformance(root, { version: "1.1.5", sha256: "hash-a" })).resolves.toBeNull();
    await expect(readAntigravityConformance(root, { version: "1.1.4", sha256: "hash-b" })).resolves.toBeNull();
  });
});

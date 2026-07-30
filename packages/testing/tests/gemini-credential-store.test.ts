import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createGeminiCredentialStore } from "../../../apps/desktop/src/main/services/geminiCredentialStore.js";

const roots: string[] = [];
async function credentialPath() { const root = await mkdtemp(path.join(os.tmpdir(), "ether-gemini-credential-")); roots.push(root); return path.join(root, "credential.json"); }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function storage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from(`dpapi:${value}`, "utf8"),
    decryptString: (value: Buffer) => {
      const encoded = value.toString("utf8");
      if (!encoded.startsWith("dpapi:")) throw new Error("not protected");
      return encoded.slice("dpapi:".length);
    }
  };
}

describe("Gemini credential store", () => {
  it("persists only protected ciphertext and exposes state without a credential getter", async () => {
    const filePath = await credentialPath();
    const store = createGeminiCredentialStore({ credentialPath: () => filePath, safeStorage: storage() });
    await expect(store.status()).resolves.toEqual({ state: "not-configured", verifiedAt: null });
    await expect(store.connect("test-key-not-a-real-secret")).resolves.toEqual({ state: "configured", verifiedAt: null });
    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain("test-key-not-a-real-secret");
    expect(await store.readApiKey()).toBe("test-key-not-a-real-secret");
    const verified = await store.markVerified();
    expect(verified.state).toBe("verified");
    await expect(store.remove()).resolves.toEqual({ state: "not-configured", verifiedAt: null });
    await expect(store.readApiKey()).resolves.toBeNull();
  });

  it("fails closed when Windows encryption is unavailable or the protected record is corrupt", async () => {
    const unavailable = createGeminiCredentialStore({ credentialPath: () => "C:\\unused\\credential.json", safeStorage: storage(false) });
    await expect(unavailable.status()).resolves.toEqual({ state: "encryption-unavailable", verifiedAt: null });
    await expect(unavailable.connect("anything")).rejects.toMatchObject({ code: "GEMINI_CREDENTIAL_ENCRYPTION_UNAVAILABLE" });
    const filePath = await credentialPath();
    await writeFile(filePath, "{bad", "utf8");
    const corrupt = createGeminiCredentialStore({ credentialPath: () => filePath, safeStorage: storage() });
    await expect(corrupt.status()).resolves.toEqual({ state: "error", verifiedAt: null });
    await expect(corrupt.readApiKey()).rejects.toMatchObject({ code: "GEMINI_CREDENTIAL_CORRUPT" });
  });
});

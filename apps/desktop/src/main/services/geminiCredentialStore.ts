import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { GeminiCredentialState } from "@ether/providers";

export type GeminiCredentialStatus = {
  state: GeminiCredentialState;
  verifiedAt: string | null;
};

export type WindowsSafeStorage = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

type StoredCredential = {
  version: 1;
  ciphertext: string;
  verifiedAt: string | null;
};

export class GeminiCredentialStoreError extends Error {
  readonly code: "GEMINI_CREDENTIAL_ENCRYPTION_UNAVAILABLE" | "GEMINI_CREDENTIAL_INVALID" | "GEMINI_CREDENTIAL_CORRUPT";
  readonly category = "provider" as const;

  constructor(code: GeminiCredentialStoreError["code"], message: string) {
    super(message);
    this.name = "GeminiCredentialStoreError";
    this.code = code;
  }
}

/**
 * The only persistent home for the Gemini key. The JSON envelope contains
 * DPAPI/safeStorage ciphertext and verification metadata, never the plaintext.
 */
export function createGeminiCredentialStore(options: {
  credentialPath: () => string;
  safeStorage: WindowsSafeStorage;
}) {
  const target = () => options.credentialPath();
  let writes: Promise<void> = Promise.resolve();

  const encryptionAvailable = () => {
    try { return options.safeStorage.isEncryptionAvailable(); } catch { return false; }
  };
  const readStored = async (): Promise<StoredCredential | null> => {
    try {
      const parsed = JSON.parse(await readFile(target(), "utf8")) as unknown;
      if (!isStoredCredential(parsed)) throw new GeminiCredentialStoreError("GEMINI_CREDENTIAL_CORRUPT", "The protected Gemini credential cannot be read. Replace or remove it in Settings.");
      return parsed;
    } catch (error) {
      if (isFileMissing(error)) return null;
      if (error instanceof GeminiCredentialStoreError) throw error;
      throw new GeminiCredentialStoreError("GEMINI_CREDENTIAL_CORRUPT", "The protected Gemini credential cannot be read. Replace or remove it in Settings.");
    }
  };
  const serializeWrite = <T>(operation: () => Promise<T>) => {
    const result = writes.then(operation);
    writes = result.then(() => undefined, () => undefined);
    return result;
  };
  const store = async (credential: StoredCredential) => {
    const filePath = target();
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(filePath), { recursive: true });
    try {
      await writeFile(temporary, `${JSON.stringify(credential)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, filePath);
    } finally {
      // A failed replacement must not leave an orphaned encrypted credential envelope.
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  };

  return {
    async status(): Promise<GeminiCredentialStatus> {
      if (!encryptionAvailable()) return { state: "encryption-unavailable", verifiedAt: null };
      try {
        const stored = await readStored();
        if (stored === null) return { state: "not-configured", verifiedAt: null };
        // Validate that the encrypted blob belongs to this Windows user, without returning it.
        const value = options.safeStorage.decryptString(Buffer.from(stored.ciphertext, "base64"));
        if (!value.trim()) throw new Error("Empty protected value.");
        return { state: stored.verifiedAt === null ? "configured" : "verified", verifiedAt: stored.verifiedAt };
      } catch {
        return { state: "error", verifiedAt: null };
      }
    },
    async readApiKey(): Promise<string | null> {
      if (!encryptionAvailable()) {
        throw new GeminiCredentialStoreError("GEMINI_CREDENTIAL_ENCRYPTION_UNAVAILABLE", "Windows protected storage is unavailable. Gemini API use is fail-closed.");
      }
      const stored = await readStored();
      if (stored === null) return null;
      try {
        const key = options.safeStorage.decryptString(Buffer.from(stored.ciphertext, "base64")).trim();
        if (!key) throw new Error("Empty protected value.");
        return key;
      } catch {
        throw new GeminiCredentialStoreError("GEMINI_CREDENTIAL_CORRUPT", "The protected Gemini credential cannot be decrypted. Replace or remove it in Settings.");
      }
    },
    connect(apiKey: string) {
      return serializeWrite(async () => {
        if (!encryptionAvailable()) {
          throw new GeminiCredentialStoreError("GEMINI_CREDENTIAL_ENCRYPTION_UNAVAILABLE", "Windows protected storage is unavailable. Gemini API use is fail-closed.");
        }
        const normalized = apiKey.trim();
        if (!normalized || normalized.length > 4_096 || /[\r\n\0]/u.test(normalized)) {
          throw new GeminiCredentialStoreError("GEMINI_CREDENTIAL_INVALID", "Enter a valid Gemini API key in the protected field.");
        }
        const ciphertext = options.safeStorage.encryptString(normalized).toString("base64");
        await store({ version: 1, ciphertext, verifiedAt: null });
        return { state: "configured" as const, verifiedAt: null };
      });
    },
    markVerified() {
      return serializeWrite(async () => {
        if (!encryptionAvailable()) {
          throw new GeminiCredentialStoreError("GEMINI_CREDENTIAL_ENCRYPTION_UNAVAILABLE", "Windows protected storage is unavailable. Gemini API use is fail-closed.");
        }
        const stored = await readStored();
        if (stored === null) throw new GeminiCredentialStoreError("GEMINI_CREDENTIAL_INVALID", "Connect a Gemini API key before testing it.");
        const verifiedAt = new Date().toISOString();
        await store({ ...stored, verifiedAt });
        return { state: "verified" as const, verifiedAt };
      });
    },
    remove() {
      return serializeWrite(async () => {
        await rm(target(), { force: true });
        return { state: encryptionAvailable() ? "not-configured" as const : "encryption-unavailable" as const, verifiedAt: null };
      });
    }
  };
}

function isStoredCredential(value: unknown): value is StoredCredential {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1
    && typeof candidate.ciphertext === "string"
    && candidate.ciphertext.length > 0
    && (candidate.verifiedAt === null || typeof candidate.verifiedAt === "string");
}
function isFileMissing(error: unknown) {
  return error !== null
    && typeof error === "object"
    && "code" in error
    && (error as Record<string, unknown>).code === "ENOENT";
}

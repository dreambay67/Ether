import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type RecentDocument = {
  id: string;
  documentId: string;
  displayName: string;
  canonicalPath: string;
};

export type DesktopSettings = { recentDocuments: RecentDocument[] };
export const defaultDesktopSettings: DesktopSettings = { recentDocuments: [] };

export function createDesktopSettingsStore(settingsPathProvider: () => string) {
  const settingsPath = () => settingsPathProvider();

  const load = async (): Promise<DesktopSettings> => {
    try {
      return sanitizeSettings(JSON.parse(await readFile(settingsPath(), "utf8")) as unknown);
    } catch (error) {
      if (isFileMissing(error)) return { recentDocuments: [] };
      await quarantineCorruptedSettings(settingsPath()).catch(() => undefined);
      return { recentDocuments: [] };
    }
  };

  const save = async (settings: DesktopSettings): Promise<DesktopSettings> => {
    const next = sanitizeSettings(settings);
    const target = settingsPath();
    const temporary = `${target}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temporary, target);
    return next;
  };

  return {
    load,
    save,
    async remember(document: Omit<RecentDocument, "id">): Promise<DesktopSettings> {
      const current = await load();
      const identityKey = document.canonicalPath.toLocaleLowerCase();
      const recent: RecentDocument = {
        ...document,
        id: createHash("sha256").update(identityKey).digest("hex").slice(0, 32)
      };
      return save({
        recentDocuments: [
          recent,
          ...current.recentDocuments.filter(
            (candidate) => candidate.canonicalPath.toLocaleLowerCase() !== identityKey
          )
        ].slice(0, 12)
      });
    }
  };
}

function sanitizeSettings(value: unknown): DesktopSettings {
  const source = isRecord(value) && Array.isArray(value.recentDocuments) ? value.recentDocuments : [];
  const seen = new Set<string>();
  const recentDocuments: RecentDocument[] = [];
  for (const candidate of source) {
    if (!isRecord(candidate)) continue;
    const documentId = stringValue(candidate.documentId);
    const displayName = stringValue(candidate.displayName);
    const canonicalPath = stringValue(candidate.canonicalPath);
    if (!documentId || !displayName || !canonicalPath) continue;
    const key = canonicalPath.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recentDocuments.push({
      id: stringValue(candidate.id) || createHash("sha256").update(key).digest("hex").slice(0, 32),
      documentId,
      displayName,
      canonicalPath
    });
  }
  return { recentDocuments: recentDocuments.slice(0, 12) };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFileMissing(error: unknown) {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

async function quarantineCorruptedSettings(filePath: string) {
  const raw = await readFile(filePath, "utf8");
  await writeFile(`${filePath}.corrupt`, raw, "utf8");
  await rm(filePath, { force: true });
}

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type DesktopSettings = {
  parentDirectory: string;
  projectName: string;
  projectPath: string;
  recentProjects: string[];
};

export type DesktopSettingsPatch = Partial<DesktopSettings>;

export const defaultDesktopSettings: DesktopSettings = {
  parentDirectory: "",
  projectName: "Untitled Ether Project",
  projectPath: "",
  recentProjects: []
};

export function createDesktopSettingsStore(settingsPathProvider: () => string) {
  const settingsPath = () => settingsPathProvider();

  return {
    async load(): Promise<DesktopSettings> {
      try {
        const raw = await readFile(settingsPath(), "utf8");
        const parsed = JSON.parse(raw) as unknown;

        return sanitizeSettings(parsed);
      } catch (error) {
        if (isFileMissing(error)) {
          return defaultDesktopSettings;
        }

        await quarantineCorruptedSettings(settingsPath()).catch(() => undefined);
        return defaultDesktopSettings;
      }
    },

    async save(patch: DesktopSettingsPatch): Promise<DesktopSettings> {
      const next = sanitizeSettings(patch);
      const target = settingsPath();

      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(next, null, 2)}\n`, "utf8");

      return next;
    }
  };
}

function sanitizeSettings(value: unknown): DesktopSettings {
  const source = isRecord(value) ? value : {};

  return {
    parentDirectory: stringValue(source.parentDirectory),
    projectName: stringValue(source.projectName) || defaultDesktopSettings.projectName,
    projectPath: stringValue(source.projectPath),
    recentProjects: uniqueStrings(source.recentProjects).slice(0, 12)
  };
}

function uniqueStrings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of value) {
    const text = stringValue(entry);
    const key = text.toLowerCase();

    if (!text || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(text);
  }

  return result;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFileMissing(error: unknown) {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

async function quarantineCorruptedSettings(filePath: string) {
  const raw = await readFile(filePath, "utf8");

  await writeFile(`${filePath}.corrupt`, raw, "utf8");
  await rm(filePath, { force: true });
}

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDesktopSettingsStore,
  defaultDesktopSettings
} from "../../../apps/desktop/src/main/settingsStore";

async function tempSettingsPath() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-settings-"));

  return path.join(root, "settings.json");
}

describe("desktop settings store", () => {
  it("loads defaults before any settings file exists", async () => {
    const settingsPath = await tempSettingsPath();
    const store = createDesktopSettingsStore(() => settingsPath);

    await expect(store.load()).resolves.toEqual(defaultDesktopSettings);
  });

  it("persists sanitized project convenience fields", async () => {
    const settingsPath = await tempSettingsPath();
    const store = createDesktopSettingsStore(() => settingsPath);

    const saved = await store.save({
      parentDirectory: " C:\\Ether ",
      projectName: " Campaign ",
      projectPath: " C:\\Ether\\Campaign.ether ",
      recentProjects: [
        " C:\\Ether\\Campaign.ether ",
        "C:\\Ether\\Campaign.ether",
        "C:\\Ether\\Second.ether",
        ""
      ]
    });

    expect(saved).toEqual({
      parentDirectory: "C:\\Ether",
      projectName: "Campaign",
      projectPath: "C:\\Ether\\Campaign.ether",
      recentProjects: ["C:\\Ether\\Campaign.ether", "C:\\Ether\\Second.ether"]
    });
    await expect(store.load()).resolves.toEqual(saved);
  });

  it("recovers from corrupted settings without throwing", async () => {
    const settingsPath = await tempSettingsPath();
    const store = createDesktopSettingsStore(() => settingsPath);

    await writeFile(settingsPath, "{not-json", "utf8");

    await expect(store.load()).resolves.toEqual(defaultDesktopSettings);
    await expect(readFile(`${settingsPath}.corrupt`, "utf8")).resolves.toBe("{not-json");
  });
});

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createDesktopSettingsStore, defaultDesktopSettings } from "../../../apps/desktop/src/main/settingsStore";

async function tempSettingsPath() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-settings-"));
  return path.join(root, "settings.json");
}

describe("desktop settings store", () => {
  it("contains no folder-era defaults", async () => {
    const store = createDesktopSettingsStore(() => awaitPath);
    const awaitPath = await tempSettingsPath();
    await expect(store.load()).resolves.toEqual(defaultDesktopSettings);
    expect(defaultDesktopSettings).toEqual({ recentDocuments: [] });
  });

  it("persists canonical document identities and deduplicates paths", async () => {
    const settingsPath = await tempSettingsPath();
    const store = createDesktopSettingsStore(() => settingsPath);
    await store.remember({
      documentId: "document-1",
      displayName: "Campaign.ether",
      canonicalPath: "C:\\Ether\\Campaign.ether"
    });
    await store.remember({
      documentId: "document-1",
      displayName: "Campaign renamed.ether",
      canonicalPath: "c:\\ether\\campaign.ether"
    });

    const settings = await store.load();
    expect(settings.recentDocuments).toHaveLength(1);
    expect(settings.recentDocuments[0]).toMatchObject({
      documentId: "document-1",
      displayName: "Campaign renamed.ether",
      canonicalPath: "c:\\ether\\campaign.ether"
    });
    expect(settings.recentDocuments[0]?.id).toMatch(/^[a-f0-9]{32}$/);
  });

  it("serializes concurrent recent-document updates without losing identities", async () => {
    const settingsPath = await tempSettingsPath();
    const store = createDesktopSettingsStore(() => settingsPath);

    await Promise.all([
      store.remember({
        documentId: "document-1",
        displayName: "First.ether",
        canonicalPath: "C:\\Ether\\First.ether"
      }),
      store.remember({
        documentId: "document-2",
        displayName: "Second.ether",
        canonicalPath: "C:\\Ether\\Second.ether"
      })
    ]);

    const settings = await store.load();
    expect(settings.recentDocuments.map(({ documentId }) => documentId).sort()).toEqual([
      "document-1",
      "document-2"
    ]);
  });

  it("recovers corrupted settings without reviving legacy project fields", async () => {
    const settingsPath = await tempSettingsPath();
    const store = createDesktopSettingsStore(() => settingsPath);
    await writeFile(settingsPath, "{not-json", "utf8");
    await expect(store.load()).resolves.toEqual(defaultDesktopSettings);
    await expect(readFile(`${settingsPath}.corrupt`, "utf8")).resolves.toBe("{not-json");
  });
});

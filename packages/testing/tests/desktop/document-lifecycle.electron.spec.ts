import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, expect, test } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixtureMain = path.join(root, "packages", "testing", "fixtures", "desktop-main.mjs");

test("Electron opens an untitled canvas and completes the real single-file lifecycle", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ether-electron-lifecycle-"));
  const electronApp = await electron.launch({
    executablePath: path.join(root, "node_modules", "electron", "dist", "electron.exe"),
    args: [fixtureMain, `--fixture-root=${fixtureRoot}`]
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByTestId("document-canvas")).toBeVisible();
    await expect(page.getByTestId("project-header")).toContainText("Untitled");
    await expect(page.getByTestId("start-screen")).toHaveCount(0);

    const versions = await page.evaluate(() => window.ether.runtime.versions());
    expect(versions.electron).toMatch(/^43\./);
    expect(versionAtLeast(versions.node, "24.16.0")).toBe(true);

    await page.getByRole("button", { name: "Prompt" }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(1);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(async () => fileExists(path.join(fixtureRoot, "documents", "Campaign with spaces.ether"))).toBe(true);

    await page.getByRole("button", { name: "Generate" }).click();
    await expect(page.getByTestId("embedded-artifact")).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByTestId("embedded-artifact").locator("img")).toHaveJSProperty("naturalWidth", 64);

    await page.getByRole("button", { name: "Save as" }).click();
    await expect(page.getByTestId("project-header")).toContainText("Kampaň Ω.ether");
    await page.getByRole("button", { name: "Save a copy" }).click();
    await expect.poll(async () => fileExists(path.join(fixtureRoot, "documents", "Campaign copy.ether"))).toBe(true);

    await page.getByRole("button", { name: "New document" }).click();
    await expect(page.getByTestId("project-header")).toContainText("Untitled");
    await page.getByRole("button", { name: "Open document" }).click();
    await expect(page.getByTestId("project-header")).toContainText("Kampaň Ω.ether");
    await expect.poll(async () => page.evaluate(async () => {
      const snapshot = await window.ether.document.bootstrap();
      return window.ether.artifacts.search(snapshot.documentId, "").then((artifacts) => artifacts.length);
    })).toBe(1);
    await expect(page.getByTestId("embedded-artifact")).toHaveCount(1);
    await expect(page.getByTestId("embedded-artifact").locator("img")).toHaveJSProperty("naturalWidth", 64);
  } finally {
    await electronApp.close();
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

async function fileExists(filePath: string) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function versionAtLeast(actual: string, minimum: string) {
  const left = actual.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { FakeImageProvider } from "@ether/providers";
import type { GraphTransaction } from "@ether/schema";

import { DesktopApplicationService } from "../../../../apps/desktop/src/main/services/applicationService.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixtureMain = path.join(root, "packages", "testing", "fixtures", "desktop-main.mjs");
const electronPath = path.join(root, "node_modules", "electron", "dist", "electron.exe");

test("real Electron persists canvas edits and serves embedded artifacts through the secure protocol", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ether-electron-lifecycle-"));
  const electronApp = await launchFixture(fixtureRoot, ["--force-device-scale-factor=2"]);

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByTestId("document-canvas")).toBeVisible();
    await expect(page.getByTestId("project-header")).toContainText("Untitled");
    await expect(page.getByTestId("start-screen")).toHaveCount(0);

    const versions = await page.evaluate(() => window.ether.runtime.versions());
    expect(versions.electron).toMatch(/^43\./);
    expect(versionAtLeast(versions.node, "24.16.0")).toBe(true);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => Object.keys(window.ether).sort())).toEqual([
      "artifacts", "document", "graph", "references", "runtime"
    ]);
    expect(await bridgeAvailableInSubframe(page)).toBe(false);

    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1280, height: 800 },
      { width: 820, height: 720 }
    ]) {
      await page.setViewportSize(viewport);
      await expectWorkspaceBounds(page, viewport);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await startSaveStateObserver(page);

    await page.getByRole("button", { name: "Prompt", exact: true }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(1);
    const beforeDrag = await graphNodes(page);
    const node = page.locator(".react-flow__node").first();
    const bounds = await node.boundingBox();
    if (bounds === null) throw new Error("Prompt node has no bounds.");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 90, bounds.y + bounds.height / 2 + 55, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await graphNodes(page))[0]?.position).not.toEqual(beforeDrag[0]?.position);
    const persistedPosition = (await graphNodes(page))[0]!.position;
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => observedSaveStates(page)).toEqual(expect.arrayContaining(["Saving", "Saved"]));

    await page.getByRole("button", { name: "Save", exact: true }).click();
    const campaignPath = path.join(fixtureRoot, "documents", "Campaign with spaces.ether");
    await expect.poll(async () => fileExists(campaignPath)).toBe(true);

    await expect(page.getByRole("button", { name: "Generate", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Simulation output", exact: true }).click();
    await expect(page.getByTestId("embedded-artifact")).toHaveCount(1, { timeout: 20_000 });
    const image = page.getByTestId("embedded-artifact").locator("img");
    await expect(image).toHaveJSProperty("naturalWidth", 64);
    await expect(image).toHaveAttribute("src", /^ether-asset:\/\//);
    expect(await protocolProbe(electronApp, await image.getAttribute("src") ?? "")).toEqual({
      get: 200,
      head: 200,
      headBytes: 0,
      range: 206,
      rangeBytes: 8,
      suffix: 206,
      suffixBytes: 4,
      notModified: 304,
      invalid: 416,
      unknown: 404
    });

    await page.getByRole("button", { name: "Compact document" }).click();
    await expect(page.getByText(/Compacted document and reclaimed/)).toBeVisible();
    await page.getByRole("button", { name: "Make document portable" }).click();
    await expect(page.getByText(/Made portable: embedded 0 references; 0 unavailable/)).toBeVisible();

    await page.getByRole("button", { name: "Save as" }).click();
    const renamedPath = path.join(fixtureRoot, "documents", "Kampa\u0148 \u03a9.ether");
    await expect(page.getByTestId("project-header")).toContainText("Kampa\u0148 \u03a9.ether");
    await page.getByRole("button", { name: "Save a copy" }).click();
    await expect.poll(async () => fileExists(path.join(fixtureRoot, "documents", "Campaign copy.ether"))).toBe(true);

    await page.getByRole("button", { name: "New document" }).click();
    await expect(page.getByTestId("project-header")).toContainText("Untitled");
    await page.getByRole("button", { name: "Open document" }).click();
    await expect(page.getByTestId("project-header")).toContainText("Kampa\u0148 \u03a9.ether");
    expect((await graphNodes(page))[0]?.position).toEqual(persistedPosition);
    const active = await page.evaluate(() => window.ether.document.bootstrap());
    const countBeforeReopen = await page.locator(".react-flow__node").count();
    await page.getByRole("button", { name: "Open document" }).click();
    expect((await page.evaluate(() => window.ether.document.bootstrap())).documentId).toBe(active.documentId);
    await openDroppedFile(page, renamedPath);
    expect((await page.evaluate(() => window.ether.document.bootstrap())).documentId).toBe(active.documentId);
    await expect(page.locator(".react-flow__node")).toHaveCount(countBeforeReopen);
    await expect(page.getByTestId("embedded-artifact")).toHaveCount(1);
  } finally {
    await electronApp.close();
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("real Electron delivers autosave failure details and ignores a stale snapshot", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ether-electron-autosave-"));
  const electronApp = await launchFixture(fixtureRoot, ["--autosave-failure", "--stale-event"]);
  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByTestId("document-canvas")).toBeVisible();
    await startSaveStateObserver(page);
    await page.getByRole("button", { name: "Prompt", exact: true }).click();
    await expect(page.getByText("Needs attention", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Fixture autosave failure", { exact: true })).toBeVisible();
    await expect.poll(() => observedSaveStates(page)).toEqual(
      expect.arrayContaining(["Saving", "Needs attention"])
    );
    await page.waitForTimeout(2_000);
    await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
    await expect(page.getByText("Fixture autosave failure", { exact: true })).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("real Electron disables read-only canvas controls before invocation", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ether-electron-readonly-"));
  const documentPath = path.join(fixtureRoot, "Read only campaign.ether");
  await createDocumentFixture(fixtureRoot, documentPath);
  const electronApp = await launchFixture(fixtureRoot, [
    "--read-only-location",
    "--production-controls",
    `--open-document=${documentPath}`
  ]);
  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByTestId("project-header")).toContainText(
      "Read-only: this location cannot guarantee safe writes"
    );
    for (const name of ["Prompt", "Image", "Save", "Save as", "Compact document", "Make document portable"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
    }
    await expect(page.getByRole("button", { name: "Generate", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Simulation output", exact: true })).toHaveCount(0);
    await expect(page.locator(".react-flow__node")).toHaveCount(1);
    await expect(page.locator(".react-flow__node.draggable")).toHaveCount(0);
  } finally {
    await electronApp.close();
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("real Electron renders only reference actions authorized by service capabilities", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "ether-electron-references-"));
  const electronApp = await launchFixture(fixtureRoot, ["--reference-capabilities", "--portable-cancel"]);
  try {
    const page = await electronApp.firstWindow();
    const limited = page.getByText("limited.png", { exact: true }).locator("..");
    await expect(limited.getByRole("button", { name: "Locate", exact: true })).toBeVisible();
    await expect(limited.getByRole("button", { name: "Use Embedded Preview", exact: true })).toHaveCount(0);
    await expect(limited.getByRole("button", { name: "Embed Available Copy", exact: true })).toHaveCount(0);
    const full = page.getByText("full.png", { exact: true }).locator("..");
    await expect(full.getByRole("button", { name: "Use Embedded Preview", exact: true })).toBeVisible();
    await expect(full.getByRole("button", { name: "Embed Available Copy", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Make document portable" }).click();
    await expect(page.getByText("Make Portable cancelled; the document was not changed", { exact: true })).toBeVisible();
  } finally {
    await electronApp.close();
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

async function launchFixture(fixtureRoot: string, extraArgs: string[] = []): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: electronPath,
    args: [fixtureMain, `--fixture-root=${fixtureRoot}`, ...extraArgs]
  });
}

async function expectWorkspaceBounds(page: Page, viewport: { width: number; height: number }) {
  const bounds = await page.evaluate(() => {
    const rectangle = (selector: string) => {
      const value = document.querySelector(selector)?.getBoundingClientRect();
      if (value === undefined) throw new Error(`Missing ${selector}`);
      return { top: value.top, right: value.right, bottom: value.bottom, left: value.left, height: value.height };
    };
    return {
      header: rectangle("[data-testid=project-header]"),
      canvas: rectangle("[data-testid=document-canvas]"),
      footer: rectangle(".document-status"),
      rail: rectangle(".document-tool-rail")
    };
  });
  expect(bounds.header.top).toBeGreaterThanOrEqual(0);
  expect(bounds.header.height).toBeLessThanOrEqual(80);
  expect(bounds.canvas.top).toBeGreaterThanOrEqual(bounds.header.bottom - 1);
  expect(bounds.footer.top).toBeGreaterThanOrEqual(bounds.canvas.bottom - 1);
  expect(bounds.footer.bottom).toBeLessThanOrEqual(viewport.height + 1);
  expect(bounds.rail.right).toBeLessThanOrEqual(bounds.canvas.right);
  expect(bounds.canvas.height).toBeGreaterThan(400);
}

async function graphNodes(page: Page) {
  return page.evaluate(async () => {
    const snapshot = await window.ether.document.bootstrap();
    return (await window.ether.graph.snapshot(snapshot.documentId)).graph.nodes;
  });
}

async function startSaveStateObserver(page: Page) {
  await page.locator(".document-save-state span").waitFor({ state: "attached" });
  await page.evaluate(() => {
    const states: string[] = [];
    const target = document.querySelector(".document-save-state span");
    if (target === null) throw new Error("Save state label is missing.");
    const record = () => {
      const value = target.textContent?.trim();
      if (value !== undefined && value !== "" && states.at(-1) !== value) states.push(value);
    };
    record();
    new MutationObserver(record).observe(target, { childList: true, characterData: true, subtree: true });
    Object.defineProperty(window, "__etherObservedSaveStates", { value: states });
  });
}

async function observedSaveStates(page: Page): Promise<string[]> {
  return page.evaluate(() => (
    window as typeof window & { __etherObservedSaveStates: string[] }
  ).__etherObservedSaveStates);
}

async function bridgeAvailableInSubframe(page: Page) {
  return page.evaluate(async () => {
    const frame = document.createElement("iframe");
    frame.src = location.href;
    document.body.append(frame);
    await new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
    return "ether" in (frame.contentWindow as Window & { ether?: unknown });
  });
}

async function protocolProbe(electronApp: ElectronApplication, source: string) {
  return electronApp.evaluate(async ({ net }, url) => {
    const get = await net.fetch(url);
    const etag = get.headers.get("ETag") ?? "";
    const head = await net.fetch(url, { method: "HEAD" });
    const range = await net.fetch(url, { headers: { Range: "bytes=0-7" } });
    const suffix = await net.fetch(url, { headers: { Range: "bytes=-4" } });
    const notModified = await net.fetch(url, { headers: { "If-None-Match": etag } });
    const invalid = await net.fetch(url, { headers: { Range: "bytes=1-2,4-5" } });
    const parsed = new URL(url);
    const unknown = await net.fetch(`${parsed.protocol}//${parsed.hostname}/unknown/original`);
    return {
      get: get.status,
      head: head.status,
      headBytes: (await head.arrayBuffer()).byteLength,
      range: range.status,
      rangeBytes: (await range.arrayBuffer()).byteLength,
      suffix: suffix.status,
      suffixBytes: (await suffix.arrayBuffer()).byteLength,
      notModified: notModified.status,
      invalid: invalid.status,
      unknown: unknown.status
    };
  }, source);
}

async function openDroppedFile(page: Page, filePath: string) {
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.id = "drop-fixture";
    document.body.append(input);
  });
  await page.locator("#drop-fixture").setInputFiles(filePath);
  await page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>("#drop-fixture");
    const file = input?.files?.[0];
    if (file === undefined) throw new Error("Drop fixture has no file.");
    await window.ether.document.openDropped(file);
  });
}

async function createDocumentFixture(tempRoot: string, documentPath: string) {
  const service = new DesktopApplicationService({
    appDataRoot: path.join(tempRoot, "source-appdata"),
    appVersion: "4.0.0-electron-test",
    dialogs: {
      openDocument: async () => null,
      saveDocument: async () => documentPath,
      locateReference: async () => null,
      searchReferenceFolder: async () => null,
      confirmPortable: async () => true
    },
    provider: new FakeImageProvider()
  });
  const snapshot = await service.bootstrap();
  const transaction: GraphTransaction = {
    id: crypto.randomUUID(),
    baseDocumentRevisionId: snapshot.documentRevisionId,
    baseGraphRevisions: { [snapshot.graphId]: snapshot.graphRevisionId },
    title: "Add read-only fixture node",
    actor: "user",
    layoutPolicy: "preserve",
    operations: [{
      type: "addNode",
      graphId: snapshot.graphId,
      node: {
        id: "readonly-prompt",
        definitionId: "prompt.text",
        title: "Read-only prompt",
        position: { x: 160, y: 140 },
        size: { width: 240, height: 132 },
        config: { kind: "prompt.text", body: "Read-only fixture", assembly: "append" },
        presentation: { collapsed: false, accent: "default", previewMode: "content" }
      }
    }]
  };
  await service.applyGraphTransaction(snapshot.documentId, transaction);
  await service.saveAs(snapshot.documentId);
  await service.close();
}

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

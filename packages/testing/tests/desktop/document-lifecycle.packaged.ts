import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect, test, type Browser } from "@playwright/test";
import { FakeImageProvider } from "@ether/providers";

import { DesktopApplicationService } from "../../../../apps/desktop/src/main/services/applicationService.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const executablePath = path.join(root, "release", "ether-windows-unpacked", "Ether.exe");

test.skip(process.platform !== "win32", "The packaged Ether lifecycle is Windows-only.");

test("real Ether.exe opens, saves, and renders a portable document on Node 24", async () => {
  await requirePackagedApp();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ether-packaged-lifecycle-"));
  const appData = path.join(tempRoot, "AppData", "Roaming");
  const localAppData = path.join(tempRoot, "AppData", "Local");
  const documentPath = path.join(tempRoot, "Packaged Kampa\u0148 \u03a9.ether");
  const debugPort = 49_000 + Math.floor(Math.random() * 1_000);
  let appProcess: ChildProcessWithoutNullStreams | null = null;
  let browser: Browser | null = null;

  await mkdir(appData, { recursive: true });
  await mkdir(localAppData, { recursive: true });
  await createPortableFixture(tempRoot, documentPath);

  const environment: NodeJS.ProcessEnv = { ...process.env, APPDATA: appData, LOCALAPPDATA: localAppData };
  delete environment.ETHER_RENDERER_URL;

  try {
    appProcess = spawn(
      executablePath,
      [`--remote-debugging-port=${debugPort}`, "--disable-gpu", documentPath],
      { env: environment, stdio: "pipe", windowsHide: true }
    );
    browser = await connectToPackagedApp(debugPort, appProcess);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.waitForEvent("page", { timeout: 30_000 });
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("project-header")).toContainText("Packaged Kampa\u0148 \u03a9.ether");
    const versions = await page.evaluate(() => window.ether.runtime.versions());
    expect(versions.electron).toMatch(/^43\./);
    expect(versionAtLeast(versions.node, "24.16.0")).toBe(true);

    await page.getByRole("button", { name: "Artifacts", exact: true }).click();
    const image = page.getByTestId("embedded-artifact").locator("img");
    await expect(image).toHaveJSProperty("naturalWidth", 64);
    await expect(image).toHaveAttribute("src", /^ether-asset:\/\//);

    await page.keyboard.press("Control+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.close();
    await waitForExit(appProcess, 15_000);
    expect(await fileExists(`${documentPath}-wal`)).toBe(false);
  } finally {
    await browser?.close();
    await stopProcess(appProcess);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function createPortableFixture(tempRoot: string, documentPath: string) {
  const service = new DesktopApplicationService({
    appDataRoot: path.join(tempRoot, "fixture-appdata"),
    appVersion: "4.0.0-packaged-test",
    dialogs: {
      openDocument: async () => null,
      saveDocument: async () => documentPath,
      locateReference: async () => null,
      searchReferenceFolder: async () => null
    },
    provider: new FakeImageProvider()
  });
  const untitled = await service.bootstrap();
  await service.generateFakeArtifact(untitled.documentId);
  await service.saveAs(untitled.documentId);
  await service.close();
}

async function connectToPackagedApp(port: number, appProcess: ChildProcessWithoutNullStreams) {
  const endpoint = `http://127.0.0.1:${port}`;
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < 30_000) {
    if (appProcess.exitCode !== null) {
      throw new Error(`Ether.exe exited early (${appProcess.exitCode}): ${await processOutput(appProcess)}`);
    }
    try {
      return await chromium.connectOverCDP(endpoint);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`Timed out connecting to Ether.exe: ${String(lastError)}`);
}

async function requirePackagedApp() {
  if (!await fileExists(executablePath)) {
    throw new Error(`Packaged lifecycle requires ${executablePath}. Run pnpm desktop:package:win first.`);
  }
}

async function fileExists(filePath: string) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function waitForExit(appProcess: ChildProcessWithoutNullStreams, timeoutMs: number) {
  if (appProcess.exitCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => appProcess.once("exit", () => resolve())),
    new Promise<never>((_resolve, reject) => setTimeout(
      () => reject(new Error("Ether.exe did not close its document cleanly.")),
      timeoutMs
    ))
  ]);
}

async function stopProcess(appProcess: ChildProcessWithoutNullStreams | null) {
  if (appProcess === null || appProcess.exitCode !== null) return;
  appProcess.kill();
  await Promise.race([
    new Promise<void>((resolve) => appProcess.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000))
  ]);
}

async function processOutput(appProcess: ChildProcessWithoutNullStreams) {
  const chunks: Buffer[] = [];
  appProcess.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
  await new Promise((resolve) => setTimeout(resolve, 20));
  return Buffer.concat(chunks).toString("utf8");
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

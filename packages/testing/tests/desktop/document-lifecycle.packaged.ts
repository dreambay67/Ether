import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { chromium, expect, test, type Browser } from "@playwright/test";
import { FakeImageProvider } from "@ether/providers";

import { DesktopApplicationService } from "../../../../apps/desktop/src/main/services/applicationService.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const executablePath = path.join(root, "release", "windows", "win-unpacked", "Ether.exe");
const execFileAsync = promisify(execFile);

test.skip(process.platform !== "win32", "The packaged Ether lifecycle is Windows-only.");

test("real Ether.exe opens, saves, and renders a portable document on Node 24", async () => {
  await requirePackagedApp();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ether-packaged-lifecycle-"));
  const appData = path.join(tempRoot, "AppData", "Roaming");
  const localAppData = path.join(tempRoot, "AppData", "Local");
  const userDataDirectory = path.join(localAppData, "Ether-Test-Profile");
  const documentPath = path.join(tempRoot, "Packaged Kampa\u0148 \u03a9.ether");
  let browser: Browser | null = null;
  const existingProcessIds = await packagedProcessIds();

  await mkdir(appData, { recursive: true });
  await mkdir(localAppData, { recursive: true });
  await mkdir(userDataDirectory, { recursive: true });
  await createPortableFixture(tempRoot, documentPath);

  const environment: NodeJS.ProcessEnv = { ...process.env, APPDATA: appData, LOCALAPPDATA: localAppData };
  delete environment.ETHER_RENDERER_URL;

  try {
    const appProcess = spawn(
      executablePath,
      [
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDirectory}`,
        "--disable-gpu",
        documentPath
      ],
      { env: environment, stdio: "pipe", windowsHide: true }
    );
    const processOutput = captureProcessOutput(appProcess);
    browser = await connectToPackagedApp(userDataDirectory, appProcess, processOutput);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.waitForEvent("page", { timeout: 30_000 });
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("project-header")).toContainText("Packaged Kampa\u0148 \u03a9.ether");
    const versions = await page.evaluate(() => window.ether.runtime.versions());
    expect(versions.electron).toMatch(/^43\./);
    expect(versionAtLeast(versions.node, "24.16.0")).toBe(true);
    await expect(page.getByRole("button", { name: "Generate", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Simulation output", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Artifacts", exact: true }).click();
    await expect(page.getByRole("region", { name: "Reference Desk" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Review", exact: true }).click();
    // The Phase 4 Artifact Observatory replaces the legacy inline artifact
    // panel, while preserving the same document-scoped ether-asset delivery.
    await expect(page.getByTestId("artifact-observatory")).toBeVisible({ timeout: 30_000 });
    const image = page.locator(".artifact-embedded-preview");
    await expect(image).toHaveCount(1, { timeout: 30_000 });
    await expect(image).toHaveJSProperty("naturalWidth", 64, { timeout: 30_000 });
    await expect(image).toHaveAttribute("src", /^ether-asset:\/\/.*\/thumbnail$/);

    await page.keyboard.press("Control+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.close();
    await waitForPackagedExit(existingProcessIds, 15_000);
    expect(await fileExists(`${documentPath}-wal`)).toBe(false);
  } finally {
    await browser?.close();
    await stopPackagedProcesses(existingProcessIds);
    // Electron may release SQLite's document handle a few scheduling turns
    // after its visible window closes. Keep cleanup scoped to this disposable
    // profile, but tolerate Windows' short-lived EBUSY state.
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
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
      searchReferenceFolder: async () => null,
      confirmPortable: async () => true
    },
    provider: new FakeImageProvider(),
    simulationMode: true
  });
  const untitled = await service.bootstrap();
  await service.generateFakeArtifact(untitled.documentId);
  await service.saveAs(untitled.documentId);
  await service.close();
}

async function connectToPackagedApp(
  userDataDirectory: string,
  appProcess: ChildProcessWithoutNullStreams,
  processOutput: () => string
) {
  const activePortPath = path.join(userDataDirectory, "DevToolsActivePort");
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < 30_000) {
    if (appProcess.exitCode !== null && appProcess.exitCode !== 0) {
      throw new Error(`Ether.exe launcher failed (${appProcess.exitCode}): ${processOutput()}`);
    }
    try {
      const [portLine] = (await readFile(activePortPath, "utf8")).split(/\r?\n/u);
      const port = Number(portLine);
      if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
        throw new Error(`Invalid DevToolsActivePort value ${String(portLine)}.`);
      }
      const endpoint = `http://127.0.0.1:${port}`;
      return await chromium.connectOverCDP(endpoint);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`Timed out connecting to Ether.exe: ${String(lastError)}\n${processOutput()}`);
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

async function waitForPackagedExit(existingProcessIds: ReadonlySet<number>, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const active = [...await packagedProcessIds()].filter((processId) => !existingProcessIds.has(processId));
    if (active.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Ether.exe did not close its document cleanly.");
}

async function stopPackagedProcesses(existingProcessIds: ReadonlySet<number>) {
  const processIds = [...await packagedProcessIds()].filter((processId) => !existingProcessIds.has(processId));
  if (processIds.length === 0) return;
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Stop-Process -Id ${processIds.join(",")} -Force -ErrorAction SilentlyContinue`
  ]);
}

function captureProcessOutput(appProcess: ChildProcessWithoutNullStreams): () => string {
  const chunks: Buffer[] = [];
  appProcess.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  appProcess.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
  return () => Buffer.concat(chunks).toString("utf8");
}

async function packagedProcessIds(): Promise<Set<number>> {
  const escapedPath = executablePath.replaceAll("'", "''");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Get-CimInstance Win32_Process | Where-Object { ` +
      `[string]::Equals($_.ExecutablePath, '${escapedPath}', [System.StringComparison]::OrdinalIgnoreCase) ` +
      `} | ForEach-Object { $_.ProcessId }`
  ]);
  return new Set(stdout.split(/\r?\n/u).map((value) => Number(value.trim())).filter(Number.isInteger));
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

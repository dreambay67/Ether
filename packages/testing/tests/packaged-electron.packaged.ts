import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Browser } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const executablePath = path.join(root, "release", "ether-windows-unpacked", "Ether.exe");

test.skip(process.platform !== "win32", "Packaged Electron smoke is Windows-only.");

test("packaged Electron app renders and creates a project through preload IPC", async () => {
  await requirePackagedApp();

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ether-packaged-ui-"));
  const appData = path.join(tempRoot, "AppData", "Roaming");
  const localAppData = path.join(tempRoot, "AppData", "Local");
  const projectName = `Packaged Smoke ${Date.now()}`;
  const debugPort = 49_000 + Math.floor(Math.random() * 1_000);
  let appProcess: ChildProcessWithoutNullStreams | null = null;
  let browser: Browser | null = null;
  let createdProjectPath: string | null = null;

  await mkdir(appData, { recursive: true });
  await mkdir(localAppData, { recursive: true });

  try {
    appProcess = spawn(executablePath, [`--remote-debugging-port=${debugPort}`, "--disable-gpu"], {
      env: {
        ...process.env,
        APPDATA: appData,
        LOCALAPPDATA: localAppData,
        ETHER_RENDERER_URL: ""
      },
      stdio: "pipe",
      windowsHide: true
    });

    browser = await connectToPackagedApp(debugPort, appProcess);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.waitForEvent("page", { timeout: 30_000 }));
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByTestId("start-screen")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "ETHER" })).toBeVisible();

    await page.getByRole("button", { name: "New Project" }).click();
    await page.getByLabel("Project name").fill(projectName);
    await page.getByRole("button", { name: "Create Project" }).click();

    const projectHeading = page.getByRole("heading", { name: projectName });
    await expect(page.getByTestId("project-header")).toContainText(projectName, { timeout: 30_000 });
    await expect(page.locator(".react-flow")).toBeVisible();

    createdProjectPath = await projectHeading.getAttribute("title");
    expect(createdProjectPath).toContain(`${projectName}.ether`);
  } finally {
    await browser?.close();
    await stopProcess(appProcess);

    if (createdProjectPath?.endsWith(".ether") && createdProjectPath.includes(projectName)) {
      await rm(createdProjectPath, { recursive: true, force: true });
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function connectToPackagedApp(port: number, appProcess: ChildProcessWithoutNullStreams) {
  const endpoint = `http://127.0.0.1:${port}`;
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < 30_000) {
    if (appProcess.exitCode !== null) {
      throw new Error(`Packaged app exited before opening a debuggable window. Exit code: ${appProcess.exitCode}`);
    }

    try {
      return await chromium.connectOverCDP(endpoint);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(`Timed out connecting to packaged app at ${endpoint}: ${String(lastError)}`);
}

async function requirePackagedApp() {
  try {
    await stat(executablePath);
  } catch {
    throw new Error(
      `Packaged Electron smoke requires ${executablePath}. Run pnpm desktop:package:win first.`
    );
  }
}

async function stopProcess(appProcess: ChildProcessWithoutNullStreams | null) {
  if (!appProcess || appProcess.exitCode !== null) {
    return;
  }

  appProcess.kill();

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    appProcess.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

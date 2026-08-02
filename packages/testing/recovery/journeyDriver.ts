import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  _electron as electron,
  chromium,
  type Browser,
  type ElectronApplication,
  type Locator,
  type Page
} from "@playwright/test";

const execFileAsync = promisify(execFile);
const PROFILE_PREFIX = "ether-recovery-journey-";
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

export type JourneyMode = "source-electron" | "packaged";
export type EvidenceMode = "ephemeral" | "committed";
export type JourneyOutcome = "passed" | "failed" | "inconclusive" | "baseline-defects-reproduced";
export type JourneyPoint = { x: number; y: number };
export type JourneyInputKind =
  | "left-click"
  | "left-drag"
  | "left-marquee"
  | "shift-marquee"
  | "right-drag-pan"
  | "keyboard-command"
  | "inline-text-edit"
  | "screenshot"
  | "observation";

export type AuthoringJourneyDeclaration = {
  journeyId: string;
  startState: "blank-document";
  graphSource: "ordinary-ui-bootstrap";
  mutationPath: "real-pointer-keyboard-events";
  storagePath: "application-ipc";
  providerAdapter: "none" | "fake" | "approved-real";
};

export type JourneyProfile = {
  root: string;
  appData: string;
  localAppData: string;
  userData: string;
  kind: "fresh-isolated";
};

export type BuildArtifactIdentity = {
  path: string;
  sha256: string | null;
};

export type JourneyBuildIdentity = {
  gitCommit: string;
  mode: JourneyMode;
  artifacts: BuildArtifactIdentity[];
};

export type JourneyAction = {
  sequence: number;
  kind: JourneyInputKind;
  label: string;
  expected: string;
  actual: string;
  durationMs: number;
  screenshotPath?: string;
};

export type JourneyError = {
  source: "console" | "page" | "main-process";
  message: string;
};

export type JourneyLog = {
  schemaVersion: 1;
  journeyId: string;
  mode: JourneyMode;
  startedAt: string;
  finishedAt: string | null;
  outcome: JourneyOutcome | null;
  profile: { kind: "fresh-isolated"; appData: "isolated"; localAppData: "isolated"; userData: "isolated" };
  viewport: { width: number; height: number; deviceScaleFactor: number | null };
  identity: JourneyBuildIdentity;
  actions: JourneyAction[];
  errors: JourneyError[];
};

export type JourneyEvidencePaths = {
  root: string;
  actionLog: string;
  result: string;
  screenshots: string;
};

export type SourceElectronJourneyConfig = {
  mode: "source-electron";
  workspaceRoot: string;
  journeyId: string;
  declaration: AuthoringJourneyDeclaration;
  evidenceMode?: EvidenceMode;
  committedEvidencePath?: readonly string[];
  sourceEntrypoint?: string;
  sourceArgs?: (profile: JourneyProfile) => readonly string[];
  electronExecutable?: string;
  viewport?: { width: number; height: number };
};

export type PackagedJourneyConfig = {
  mode: "packaged";
  workspaceRoot: string;
  journeyId: string;
  declaration: AuthoringJourneyDeclaration;
  evidenceMode?: EvidenceMode;
  committedEvidencePath?: readonly string[];
  executablePath?: string;
  viewport?: { width: number; height: number };
};

export type RecoveryJourneyConfig = SourceElectronJourneyConfig | PackagedJourneyConfig;

export function blankAuthoringJourney(journeyId: string, providerAdapter: AuthoringJourneyDeclaration["providerAdapter"] = "none"): AuthoringJourneyDeclaration {
  return {
    journeyId,
    startState: "blank-document",
    graphSource: "ordinary-ui-bootstrap",
    mutationPath: "real-pointer-keyboard-events",
    storagePath: "application-ipc",
    providerAdapter
  };
}

export function sourceElectronJourneyConfig(workspaceRoot: string, journeyId: string): SourceElectronJourneyConfig {
  return {
    mode: "source-electron",
    workspaceRoot,
    journeyId,
    declaration: blankAuthoringJourney(journeyId)
  };
}

export function packagedJourneyConfig(workspaceRoot: string, journeyId: string): PackagedJourneyConfig {
  return {
    mode: "packaged",
    workspaceRoot,
    journeyId,
    declaration: blankAuthoringJourney(journeyId)
  };
}

/**
 * Authoring proof may use a fake provider, but never a seeded graph, renderer
 * bridge mutation, database write, or init-script state injection.
 */
export function assertAuthoringJourneyDeclaration(declaration: AuthoringJourneyDeclaration): void {
  if (declaration.startState !== "blank-document") {
    throw new Error(`Authoring journey ${declaration.journeyId} must begin with a blank document.`);
  }
  if (declaration.graphSource !== "ordinary-ui-bootstrap") {
    throw new Error(`Authoring journey ${declaration.journeyId} cannot use a pre-seeded graph.`);
  }
  if (declaration.mutationPath !== "real-pointer-keyboard-events") {
    throw new Error(`Authoring journey ${declaration.journeyId} cannot use direct bridge mutation.`);
  }
  if (declaration.storagePath !== "application-ipc") {
    throw new Error(`Authoring journey ${declaration.journeyId} cannot edit database or state fixtures.`);
  }
}

/** Static companion for journey specs. Keep this narrow so fake provider adapters remain valid. */
export function assertAuthoringJourneySourceSafety(source: string, label: string): void {
  const prohibited: Array<[string, RegExp]> = [
    ["pre-seeded graph", /\b(?:initialGraph|pre[- ]?seed(?:ed)?Graph|graphFixture)\b/iu],
    ["fixture injection", /(?:page\.)?addInitScript\s*\(/u],
    ["direct bridge graph mutation", /window\s*\.\s*ether\s*\.\s*graph\s*\.\s*(?:apply|applyTransaction)\s*\(/u],
    ["direct bridge application command", /window\s*\.\s*ether\s*\.\s*application\s*\.\s*command\s*\(/u],
    ["database edit", /\b(?:sqlite|database)\s*\.(?:exec|run|prepare|write)\s*\(/iu],
    ["service fixture creation", /(?:createDocumentFixture|DesktopApplicationService)\s*\(/u]
  ];
  for (const [reason, expression] of prohibited) {
    if (expression.test(source)) throw new Error(`${label} violates the authoring journey guard: ${reason}.`);
  }
}

export async function createIsolatedJourneyProfile(): Promise<JourneyProfile> {
  const root = await mkdtemp(path.join(os.tmpdir(), PROFILE_PREFIX));
  const appData = path.join(root, "AppData", "Roaming");
  const localAppData = path.join(root, "AppData", "Local");
  const userData = path.join(localAppData, "Ether-Recovery-Profile");
  await Promise.all([mkdir(appData, { recursive: true }), mkdir(userData, { recursive: true })]);
  return { root, appData, localAppData, userData, kind: "fresh-isolated" };
}

/** Refuse cleanup unless this is one of the disposable roots we allocated under the OS temp directory. */
export async function cleanupIsolatedJourneyProfile(profile: JourneyProfile): Promise<void> {
  const [tempRoot, profileRoot] = await Promise.all([realpath(os.tmpdir()), realpath(profile.root)]);
  const relative = path.relative(tempRoot, profileRoot);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(profileRoot).startsWith(PROFILE_PREFIX)) {
    throw new Error(`Refusing to remove a journey profile outside the scoped temp root: ${profile.root}`);
  }
  await rm(profileRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}

export async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

export async function collectJourneyBuildIdentity(
  workspaceRoot: string,
  mode: JourneyMode,
  artifactPaths: string[] = defaultArtifactPaths(workspaceRoot, mode)
): Promise<JourneyBuildIdentity> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, windowsHide: true });
  const gitCommit = stdout.trim();
  if (!/^[a-f0-9]{40}$/u.test(gitCommit)) throw new Error(`Could not determine an exact Git commit for ${workspaceRoot}.`);
  const artifacts = await Promise.all(artifactPaths.map(async (artifactPath) => ({
    path: relativeArtifactPath(workspaceRoot, artifactPath),
    sha256: await hashIfFile(artifactPath)
  })));
  return { gitCommit, mode, artifacts };
}

function defaultArtifactPaths(workspaceRoot: string, mode: JourneyMode): string[] {
  if (mode === "source-electron") {
    return [
      path.join(workspaceRoot, "apps", "desktop", "dist", "index.html"),
      path.join(workspaceRoot, "apps", "desktop", "dist-electron", "main", "bootstrap.js"),
      path.join(workspaceRoot, "apps", "desktop", "dist-electron", "preload", "preload.cjs"),
      path.join(workspaceRoot, "node_modules", "electron", "dist", "electron.exe")
    ];
  }
  return [
    path.join(workspaceRoot, "release", "windows", "win-unpacked", "Ether.exe"),
    path.join(workspaceRoot, "release", "windows", "win-unpacked", "resources", "app.asar")
  ];
}

async function hashIfFile(filePath: string): Promise<string | null> {
  try {
    if (!(await stat(filePath)).isFile()) return null;
    return await sha256File(filePath);
  } catch {
    return null;
  }
}

function relativeArtifactPath(workspaceRoot: string, artifactPath: string): string {
  const relative = path.relative(workspaceRoot, artifactPath);
  return (relative.startsWith("..") || path.isAbsolute(relative) ? path.basename(artifactPath) : relative).replaceAll("\\", "/");
}

export class JourneyActionRecorder {
  private readonly log: JourneyLog;

  constructor(options: {
    journeyId: string;
    mode: JourneyMode;
    identity: JourneyBuildIdentity;
    viewport?: { width: number; height: number; deviceScaleFactor?: number | null };
  }) {
    this.log = {
      schemaVersion: 1,
      journeyId: options.journeyId,
      mode: options.mode,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      outcome: null,
      profile: { kind: "fresh-isolated", appData: "isolated", localAppData: "isolated", userData: "isolated" },
      viewport: {
        width: options.viewport?.width ?? DEFAULT_VIEWPORT.width,
        height: options.viewport?.height ?? DEFAULT_VIEWPORT.height,
        deviceScaleFactor: options.viewport?.deviceScaleFactor ?? null
      },
      identity: options.identity,
      actions: [],
      errors: []
    };
  }

  record(input: Omit<JourneyAction, "sequence">): void {
    this.log.actions.push({ sequence: this.log.actions.length + 1, ...input });
  }

  setViewportDeviceScale(deviceScaleFactor: number | null): void {
    this.log.viewport.deviceScaleFactor = deviceScaleFactor;
  }

  captureConsoleError(message: string): void {
    this.log.errors.push({ source: "console", message });
  }

  capturePageError(error: unknown): void {
    this.log.errors.push({ source: "page", message: error instanceof Error ? error.message : String(error) });
  }

  captureMainProcessOutput(output: string): void {
    for (const line of output.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)) {
      if (/\b(?:error|exception|fatal)\b/iu.test(line)) this.log.errors.push({ source: "main-process", message: line });
    }
  }

  finish(outcome: JourneyOutcome): void {
    this.log.finishedAt = new Date().toISOString();
    this.log.outcome = outcome;
  }

  snapshot(): JourneyLog {
    return structuredClone(this.log);
  }

  toMarkdown(): string {
    const log = this.log;
    const artifactLines = log.identity.artifacts.map((artifact) =>
      `- ${artifact.path}: ${artifact.sha256 ?? "MISSING"}`).join("\n") || "- No build artifacts recorded.";
    const actionRows = log.actions.map((action) =>
      `| ${action.sequence} | ${action.kind} | ${markdownCell(action.label)} | ${markdownCell(action.expected)} | ${markdownCell(action.actual)} | ${action.durationMs} | ${action.screenshotPath ?? ""} |`).join("\n") ||
      "| - | No actions recorded | | | | | |";
    const errorRows = log.errors.map((error) => `| ${error.source} | ${markdownCell(error.message)} |`).join("\n") || "| none | No captured errors |";
    return `# ${log.journeyId} action log\n\n` +
      `- Mode: ${log.mode}\n- Outcome: ${log.outcome ?? "not finalized"}\n- Git commit: ${log.identity.gitCommit}\n` +
      `- Profile: ${log.profile.kind}; APPDATA, LOCALAPPDATA, and userData isolated\n` +
      `- Viewport: ${log.viewport.width}×${log.viewport.height}; scale ${log.viewport.deviceScaleFactor ?? "reported by application"}\n` +
      `- Started: ${log.startedAt}\n- Finished: ${log.finishedAt ?? "not finalized"}\n\n` +
      `## Build identity\n\n${artifactLines}\n\n## Actions\n\n` +
      "| # | Input | Action | Expected | Actual | ms | Screenshot |\n| --- | --- | --- | --- | --- | ---: | --- |\n" +
      `${actionRows}\n\n## Captured errors\n\n| Source | Message |\n| --- | --- |\n${errorRows}\n`;
  }

  async write(evidence: JourneyEvidencePaths): Promise<void> {
    await mkdir(evidence.screenshots, { recursive: true });
    await Promise.all([
      writeFile(evidence.actionLog, this.toMarkdown(), "utf8"),
      writeFile(evidence.result, `${JSON.stringify(this.snapshot(), null, 2)}\n`, "utf8")
    ]);
  }
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

export function journeyEvidencePaths(
  workspaceRoot: string,
  journeyId: string,
  mode: JourneyMode,
  evidenceMode: EvidenceMode,
  committedEvidencePath?: readonly string[]
): JourneyEvidencePaths {
  if (!/^[a-z0-9][a-z0-9-]*$/iu.test(journeyId)) throw new Error(`Unsafe journey identifier ${journeyId}.`);
  const safeCommittedPath = committedEvidencePath === undefined
    ? [journeyId]
    : committedEvidencePath.map((segment) => {
      if (!/^[a-z0-9][a-z0-9-]*$/iu.test(segment)) throw new Error(`Unsafe committed evidence path segment ${segment}.`);
      return segment;
    });
  if (safeCommittedPath.length === 0) throw new Error("Committed evidence requires at least one path segment.");
  const root = evidenceMode === "committed"
    ? path.join(workspaceRoot, "docs", "evidence", "ether-4.0-recovery", ...safeCommittedPath, mode)
    : path.join(workspaceRoot, "test-results", "recovery", journeyId, mode, `${Date.now()}-${process.pid}`);
  return {
    root,
    actionLog: path.join(root, "action-log.md"),
    result: path.join(root, "result.json"),
    screenshots: path.join(root, "screenshots")
  };
}

export class RealPageInput {
  constructor(private readonly page: Page, private readonly recorder: JourneyActionRecorder) {}

  async leftClick(target: Locator | JourneyPoint, label: string, expected: string): Promise<void> {
    await this.recordMouse("left-click", label, expected, async () => {
      const point = await this.point(target);
      await this.page.mouse.click(point.x, point.y, { button: "left" });
      return `Left click at ${formatPoint(point)}.`;
    });
  }

  async leftDrag(start: JourneyPoint, end: JourneyPoint, label: string, expected: string): Promise<void> {
    await this.drag("left-drag", start, end, undefined, label, expected);
  }

  async leftMarquee(start: JourneyPoint, end: JourneyPoint, label: string, expected: string): Promise<void> {
    await this.drag("left-marquee", start, end, undefined, label, expected);
  }

  async shiftMarquee(start: JourneyPoint, end: JourneyPoint, label: string, expected: string): Promise<void> {
    await this.drag("shift-marquee", start, end, "Shift", label, expected);
  }

  async rightDragPan(start: JourneyPoint, end: JourneyPoint, label: string, expected: string): Promise<void> {
    await this.recordMouse("right-drag-pan", label, expected, async () => {
      await this.page.mouse.move(start.x, start.y);
      await this.page.mouse.down({ button: "right" });
      await this.page.mouse.move(end.x, end.y, { steps: 8 });
      await this.page.mouse.up({ button: "right" });
      return `Right drag ${formatPoint(start)} to ${formatPoint(end)}.`;
    });
  }

  async pressKey(key: string, label: string, expected: string): Promise<void> {
    await this.recordMouse("keyboard-command", label, expected, async () => {
      await this.page.keyboard.press(key);
      return `Pressed ${key}.`;
    });
  }

  async inlineText(target: Locator, scope: Locator, text: string, label: string, expected: string): Promise<boolean> {
    const startedAt = Date.now();
    try {
      const point = await this.point(target);
      await this.page.mouse.dblclick(point.x, point.y, { button: "left" });
      const editor = await firstVisible(scope.locator("input:not([type=hidden]), textarea, [contenteditable=true]"));
      if (editor === null) {
        this.recorder.record({ kind: "inline-text-edit", label, expected, actual: "No inline editor appeared after a real double click.", durationMs: Date.now() - startedAt });
        return false;
      }
      await editor.focus();
      await this.page.keyboard.press("Control+A");
      await this.page.keyboard.type(text);
      await this.page.keyboard.press("Enter");
      this.recorder.record({ kind: "inline-text-edit", label, expected, actual: `Typed ${text.length} characters through the keyboard.`, durationMs: Date.now() - startedAt });
      return true;
    } catch (error) {
      this.recorder.record({ kind: "inline-text-edit", label, expected, actual: `ERROR: ${messageFor(error)}`, durationMs: Date.now() - startedAt });
      throw error;
    }
  }

  async screenshot(fileName: string, evidence: JourneyEvidencePaths, label: string, expected: string): Promise<string> {
    if (!/^[a-z0-9][a-z0-9._-]*\.png$/iu.test(fileName)) throw new Error(`Unsafe screenshot file name ${fileName}.`);
    const startedAt = Date.now();
    const target = path.join(evidence.screenshots, fileName);
    await mkdir(evidence.screenshots, { recursive: true });
    await this.page.screenshot({ path: target });
    this.recorder.record({
      kind: "screenshot",
      label,
      expected,
      actual: "Captured after the documented preceding action.",
      durationMs: Date.now() - startedAt,
      screenshotPath: path.relative(evidence.root, target).replaceAll("\\", "/")
    });
    return target;
  }

  observe(label: string, expected: string, actual: string): void {
    this.recorder.record({ kind: "observation", label, expected, actual, durationMs: 0 });
  }

  private async drag(
    kind: "left-drag" | "left-marquee" | "shift-marquee",
    start: JourneyPoint,
    end: JourneyPoint,
    modifier: "Shift" | undefined,
    label: string,
    expected: string
  ): Promise<void> {
    await this.recordMouse(kind, label, expected, async () => {
      if (modifier !== undefined) await this.page.keyboard.down(modifier);
      try {
        await this.page.mouse.move(start.x, start.y);
        await this.page.mouse.down({ button: "left" });
        await this.page.mouse.move(end.x, end.y, { steps: 8 });
        await this.page.mouse.up({ button: "left" });
      } finally {
        if (modifier !== undefined) await this.page.keyboard.up(modifier);
      }
      return `${modifier === undefined ? "Left" : `${modifier}+left`} drag ${formatPoint(start)} to ${formatPoint(end)}.`;
    });
  }

  private async recordMouse(kind: JourneyInputKind, label: string, expected: string, action: () => Promise<string>): Promise<void> {
    const startedAt = Date.now();
    try {
      this.recorder.record({ kind, label, expected, actual: await action(), durationMs: Date.now() - startedAt });
    } catch (error) {
      this.recorder.record({ kind, label, expected, actual: `ERROR: ${messageFor(error)}`, durationMs: Date.now() - startedAt });
      throw error;
    }
  }

  private async point(target: Locator | JourneyPoint): Promise<JourneyPoint> {
    if ("x" in target) return target;
    const bounds = await target.boundingBox();
    if (bounds === null) throw new Error("The requested real-page interaction target has no bounding box.");
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }
}

function formatPoint(point: JourneyPoint): string {
  return `(${Math.round(point.x)}, ${Math.round(point.y)})`;
}

async function firstVisible(locator: Locator): Promise<Locator | null> {
  for (let index = 0; index < await locator.count(); index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) return candidate;
  }
  return null;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type RecoveryJourneySession = {
  page: Page;
  profile: JourneyProfile;
  identity: JourneyBuildIdentity;
  evidence: JourneyEvidencePaths;
  recorder: JourneyActionRecorder;
  input: RealPageInput;
  close(outcome: JourneyOutcome): Promise<JourneyEvidencePaths>;
};

/**
 * Launches ordinary source Electron or Ether.exe. The API deliberately has no
 * graph/service/database handle: authoring journeys can only mutate through the
 * real Page mouse and keyboard helpers above.
 */
export async function launchRecoveryJourney(config: RecoveryJourneyConfig): Promise<RecoveryJourneySession> {
  assertAuthoringJourneyDeclaration(config.declaration);
  const workspaceRoot = path.resolve(config.workspaceRoot);
  const profile = await createIsolatedJourneyProfile();
  const evidence = journeyEvidencePaths(
    workspaceRoot,
    config.journeyId,
    config.mode,
    config.evidenceMode ?? "ephemeral",
    config.committedEvidencePath
  );
  const viewport = config.viewport ?? DEFAULT_VIEWPORT;
  let sourceApp: ElectronApplication | null = null;
  let packagedBrowser: Browser | null = null;
  let packagedProcess: ChildProcess | null = null;
  let packagedExecutablePath = "";
  let existingPackagedProcesses = new Set<number>();
  let processOutput: () => string = () => "";

  try {
    const identity = await collectJourneyBuildIdentity(workspaceRoot, config.mode);
    const recorder = new JourneyActionRecorder({ journeyId: config.journeyId, mode: config.mode, identity, viewport });
    const environment = Object.fromEntries(Object.entries({
      ...process.env,
      APPDATA: profile.appData,
      LOCALAPPDATA: profile.localAppData
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    delete environment.ETHER_RENDERER_URL;

    let page: Page;
    if (config.mode === "source-electron") {
      const sourceEntrypoint = config.sourceEntrypoint ?? path.join(workspaceRoot, "apps", "desktop", "dist-electron", "main", "bootstrap.js");
      const electronExecutable = config.electronExecutable ?? path.join(workspaceRoot, "node_modules", "electron", "dist", "electron.exe");
      await requireFile(sourceEntrypoint, "Source Electron entrypoint");
      await requireFile(electronExecutable, "Electron executable");
      sourceApp = await electron.launch({
        executablePath: electronExecutable,
        args: [sourceEntrypoint, ...(config.sourceArgs?.(profile) ?? [])],
        env: environment
      });
      processOutput = captureProcessOutput(sourceApp.process());
      page = await sourceApp.firstWindow();
    } else {
      packagedExecutablePath = config.executablePath ?? path.join(workspaceRoot, "release", "windows", "win-unpacked", "Ether.exe");
      await requireFile(packagedExecutablePath, "Packaged Ether.exe");
      existingPackagedProcesses = await packagedProcessIds(packagedExecutablePath);
      packagedProcess = spawn(packagedExecutablePath, [
        "--remote-debugging-port=0",
        `--user-data-dir=${profile.userData}`,
        "--disable-gpu"
      ], { env: environment, stdio: "pipe", windowsHide: true });
      processOutput = captureProcessOutput(packagedProcess);
      packagedBrowser = await connectToPackagedApp(profile.userData, packagedProcess, processOutput);
      const context = packagedBrowser.contexts()[0];
      if (context === undefined) throw new Error("Ether.exe did not expose a browser context.");
      page = context.pages()[0] ?? await context.waitForEvent("page", { timeout: 30_000 });
    }

    await page.setViewportSize(viewport);
    recorder.setViewportDeviceScale(await page.evaluate(() => window.devicePixelRatio).catch(() => null));
    page.on("console", (message) => {
      if (message.type() === "error") recorder.captureConsoleError(message.text());
    });
    page.on("pageerror", (error) => recorder.capturePageError(error));
    const input = new RealPageInput(page, recorder);
    let closed = false;
    return {
      page,
      profile,
      identity,
      evidence,
      recorder,
      input,
      close: async (outcome) => {
        if (closed) return evidence;
        closed = true;
        try {
          if (sourceApp !== null) await closeSourceElectron(sourceApp);
          if (packagedBrowser !== null) await packagedBrowser.close();
          if (packagedProcess !== null && packagedProcess.exitCode === null) {
            await stopNewPackagedProcesses(packagedExecutablePath, existingPackagedProcesses);
          }
        } finally {
          recorder.captureMainProcessOutput(processOutput());
          recorder.finish(outcome);
          await recorder.write(evidence);
          await cleanupIsolatedJourneyProfile(profile);
        }
        return evidence;
      }
    };
  } catch (error) {
    if (sourceApp !== null) await closeSourceElectron(sourceApp).catch(() => undefined);
    await packagedBrowser?.close().catch(() => undefined);
    if (packagedProcess !== null && packagedProcess.exitCode === null) {
      await stopNewPackagedProcesses(packagedExecutablePath, existingPackagedProcesses).catch(() => undefined);
      if (packagedProcess.exitCode === null) packagedProcess.kill();
    }
    await cleanupIsolatedJourneyProfile(profile).catch(() => undefined);
    throw error;
  }
}

async function requireFile(filePath: string, label: string): Promise<void> {
  if (!await hashIfFile(filePath)) throw new Error(`${label} is missing at ${filePath}.`);
}

async function closeSourceElectron(sourceApp: ElectronApplication): Promise<void> {
  const process = sourceApp.process();
  if (process.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => process.once("exit", () => resolve()));
  await Promise.race([sourceApp.close().catch(() => undefined), delay(5_000)]);
  if (process.exitCode === null) {
    await sourceApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await Promise.race([exited, delay(5_000)]);
  }
  if (process.exitCode === null) {
    process.kill();
    await Promise.race([exited, delay(5_000)]);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function captureProcessOutput(process: ChildProcess): () => string {
  const chunks: Buffer[] = [];
  process.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
  process.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));
  return () => Buffer.concat(chunks).toString("utf8");
}

async function connectToPackagedApp(userDataDirectory: string, process: ChildProcess, output: () => string): Promise<Browser> {
  const activePortPath = path.join(userDataDirectory, "DevToolsActivePort");
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < 30_000) {
    if (process.exitCode !== null && process.exitCode !== 0) {
      throw new Error(`Ether.exe launcher failed (${process.exitCode}): ${output()}`);
    }
    try {
      const [portLine] = (await readFile(activePortPath, "utf8")).split(/\r?\n/u);
      const port = Number(portLine);
      if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error(`Invalid DevToolsActivePort value ${String(portLine)}.`);
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`Timed out connecting to Ether.exe: ${messageFor(lastError)}\n${output()}`);
}

async function packagedProcessIds(executablePath: string): Promise<Set<number>> {
  const escapedPath = executablePath.replaceAll("'", "''");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Get-CimInstance Win32_Process | Where-Object { [string]::Equals($_.ExecutablePath, '${escapedPath}', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.ProcessId }`
  ]);
  return new Set(stdout.split(/\r?\n/u).map((value) => Number(value.trim())).filter(Number.isInteger));
}

async function stopNewPackagedProcesses(executablePath: string, existing: ReadonlySet<number>): Promise<void> {
  if (!executablePath) return;
  const processIds = [...await packagedProcessIds(executablePath)].filter((processId) => !existing.has(processId));
  if (processIds.length === 0) return;
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Stop-Process -Id ${processIds.join(",")} -Force -ErrorAction SilentlyContinue`
  ]);
}

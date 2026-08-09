import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractFile } from "@electron/asar";
import { EtherApplication } from "@ether/application";
import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import { FakeImageProvider } from "@ether/providers";
import type { EtherGraph } from "@ether/schema";

import {
  assertPackagedInventoryMatches,
  cleanupReleaseStaging,
  createStagedInventory,
  inventoryAsarPayload,
  inventoryUnpackedFiles,
  prepareProductionRuntime,
  prepareReleaseProject
} from "../../../../scripts/package-windows.mjs";
import {
  assertExactPackagedBuildIdentity,
  collectJourneyBuildIdentity,
  type JourneyBuildIdentity
} from "../../recovery/journeyDriver.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const packagedExecutable = path.join(repositoryRoot, "release", "windows", "win-unpacked", "Ether.exe");
const packagedAsar = path.join(repositoryRoot, "release", "windows", "win-unpacked", "resources", "app.asar");
const packagedInventoryPath = "release-inventory.json";
const requiredProductionInventoryPaths = [
  "dist/index.html",
  "dist-electron/main/bootstrap.js",
  "dist-electron/preload/preload.cjs",
  "node_modules/@ether/application/dist/index.js",
  "node_modules/@ether/document/dist/schema/40000.sql",
  "node_modules/@ether/execution/dist/index.js",
  "node_modules/@ether/mcp-server/dist/index.js",
  "node_modules/@ether/providers/dist/index.js"
] as const;
const trialCount = Number(process.env.ETHER_PERFORMANCE_TRIALS ?? 3);
const timestamp = "2026-07-23T00:00:00.000Z";
let currentProductionInventory: Promise<ReleaseInventoryEntry[]> | null = null;

test.skip(process.platform !== "win32", "Production Electron performance evidence is Windows-only.");
test.describe.configure({ mode: "serial", timeout: 120_000 });

test("required packaged performance rejects a stale build-output inventory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-stale-performance-candidate-"));
  try {
    const rendererRoot = path.join(root, "dist");
    const electronRoot = path.join(root, "dist-electron");
    await Promise.all([
      mkdir(rendererRoot, { recursive: true }),
      mkdir(path.join(electronRoot, "main"), { recursive: true }),
      mkdir(path.join(electronRoot, "preload"), { recursive: true })
    ]);
    await writeFile(path.join(rendererRoot, "index.html"), "current renderer");
    await writeFile(path.join(electronRoot, "main", "bootstrap.js"), "current main");
    await writeFile(path.join(electronRoot, "preload", "preload.cjs"), "current preload");
    const current = await readCurrentOutputEntries([
      { directory: rendererRoot, prefix: "dist" },
      { directory: electronRoot, prefix: "dist-electron" }
    ]);
    for (const requiredPath of requiredProductionInventoryPaths.filter((entry) => entry.startsWith("node_modules/"))) {
      current.push(inventoryEntry(requiredPath, `current ${requiredPath}`));
    }
    current.sort((left, right) => left.path.localeCompare(right.path));
    const stale = current.map((entry) => entry.path === "dist/index.html"
      ? { ...entry, sha256: createHash("sha256").update("stale renderer").digest("hex") }
      : entry);
    expect(() => assertCurrentOutputInventory(stale, current)).toThrow(/stale.*dist\/index\.html/i);
    await expect(requirePackagedCandidate(async () => {
      assertCurrentOutputInventory(stale, current);
    })).rejects.toThrow(/Packaged performance refused.*stale/i);
    const staleDependency = current.map((entry) => entry.path === "node_modules/@ether/application/dist/index.js"
      ? { ...entry, sha256: createHash("sha256").update("stale application").digest("hex") }
      : entry);
    await expect(requirePackagedCandidate(async () => {
      assertCurrentOutputInventory(staleDependency, current);
    })).rejects.toThrow(/stale.*node_modules\/@ether\/application\/dist\/index\.js/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("clean-profile production Electron reaches its usable Start surface under three seconds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-production-cold-start-"));
  const measurements: number[] = [];
  let warmupMs = 0;
  let runtime = "";
  let identity: JourneyBuildIdentity | null = null;
  try {
    for (let trial = -1; trial < trialCount; trial += 1) {
      const launched = await launchProductionElectron(path.join(root, `profile-${trial}`));
      runtime = launched.runtime;
      if (identity === null) identity = launched.identity;
      else expect(launched.identity).toEqual(identity);
      try {
        const page = await firstPage(launched.browser);
        await page.locator('[data-testid="start-screen"], [data-testid="document-canvas"]').first()
          .waitFor({ state: "visible", timeout: 15_000 });
        await expect(page.getByRole("button", { name: "New document" })).toBeEnabled();
        await expect(page.getByRole("button", { name: "Open document" })).toBeEnabled();
        const elapsed = performance.now() - launched.startedAt;
        if (trial < 0) warmupMs = elapsed;
        else measurements.push(elapsed);
      } finally {
        await closeProductionElectron(launched);
      }
    }
    const summary = summarize(measurements);
    expect(identity).not.toBeNull();
    reportMetric("production-electron-cold-start", { identity, runtime, warmupMs, trialsMs: measurements, ...summary });
    expect(summary.medianMs).toBeLessThan(3_000);
    expect(summary.maxMs).toBeLessThan(3_000);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});

test("production Electron opens and hydrates a real 1,000-node document and autosaves through desktop IPC", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-production-thousand-node-"));
  const documentPath = path.join(root, "Representative 1000 nodes.ether");
  const fixtureAppData = path.join(root, "fixture-app-data");
  const graph = thousandNodeGraph();
  const creator = new EtherApplication({
    appDataRoot: fixtureAppData,
    appVersion: "4.0.0-performance",
    provider: new FakeImageProvider()
  });
  await creator.createDocument({
    path: documentPath,
    title: "Representative 1,000-node document",
    initialGraph: graph
  });
  await creator.closeDocument();

  const wallHydrationMs: number[] = [];
  const documentOpenMs: number[] = [];
  const graphHydrationMs: number[] = [];
  const autosaveMs: number[] = [];
  const autosaveMaxFrameGapMs: number[] = [];
  const autosaveMaxLongTaskMs: number[] = [];
  let warmup: {
    wallHydrationMs: number;
    documentOpenMs: number;
    graphHydrationMs: number;
    autosave: AutosaveUiTiming;
  } | null = null;
  let runtime = "";
  let identity: JourneyBuildIdentity | null = null;
  try {
    for (let trial = -1; trial < trialCount; trial += 1) {
      const launched = await launchProductionElectron(path.join(root, `profile-${trial}`), documentPath);
      runtime = launched.runtime;
      if (identity === null) identity = launched.identity;
      else expect(launched.identity).toEqual(identity);
      try {
        const page = await firstPage(launched.browser);
        const surface = page.getByTestId("ether-canvas-surface");
        await expect(surface).toBeVisible({ timeout: 15_000 });
        await expect(surface).toHaveAttribute("data-graph-node-count", "1000");
        const wallHydration = performance.now() - launched.startedAt;

        const rendererMeasures = await page.evaluate(() =>
          Object.fromEntries(performance.getEntriesByType("measure").map((entry) => [entry.name, entry.duration])));
        const open = rendererMeasures["document-open:interactive"];
        expect(typeof open).toBe("number");
        const hydration = rendererMeasures["graph-hydration:interactive"];
        expect(typeof hydration).toBe("number");
        const autosave = await measureAutosave(page, Math.max(0, trial));
        expect(autosave.over50MsFrameGaps).toBe(0);
        expect(autosave.maxFrameGapMs).toBeLessThan(50);
        expect(autosave.maxLongTaskMs).toBeLessThan(50);
        if (trial < 0) {
          warmup = {
            wallHydrationMs: wallHydration,
            documentOpenMs: open!,
            graphHydrationMs: hydration!,
            autosave
          };
        } else {
          wallHydrationMs.push(wallHydration);
          documentOpenMs.push(open!);
          graphHydrationMs.push(hydration!);
          autosaveMs.push(autosave.durabilityMs);
          autosaveMaxFrameGapMs.push(autosave.maxFrameGapMs);
          autosaveMaxLongTaskMs.push(autosave.maxLongTaskMs);
        }
      } finally {
        await closeProductionElectron(launched);
      }
    }
    expect(identity).not.toBeNull();
    const metrics = {
      identity,
      runtime,
      warmup,
      trials: {
        wallHydrationMs,
        documentOpenMs,
        graphHydrationMs,
        autosaveMs,
        autosaveMaxFrameGapMs,
        autosaveMaxLongTaskMs
      },
      summaries: {
        wallHydration: summarize(wallHydrationMs),
        documentOpen: summarize(documentOpenMs),
        graphHydration: summarize(graphHydrationMs),
        autosave: summarize(autosaveMs)
      }
    };
    reportMetric("production-electron-1000-node-document", metrics);
    expect(metrics.summaries.wallHydration.medianMs).toBeLessThan(2_000);
    expect(metrics.summaries.wallHydration.maxMs).toBeLessThan(2_000);
    expect(metrics.summaries.documentOpen.maxMs).toBeLessThan(2_000);
    expect(metrics.summaries.graphHydration.maxMs).toBeLessThan(2_000);
    expect(metrics.summaries.autosave.maxMs).toBeLessThan(2_000);
    expect(Math.max(...autosaveMaxFrameGapMs)).toBeLessThan(50);
    expect(Math.max(...autosaveMaxLongTaskMs)).toBeLessThan(50);
  } finally {
    await creator.closeDocument().catch(() => undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});

async function launchProductionElectron(profileRoot: string, documentPath?: string) {
  await candidateIsCurrent();
  const identity = await collectJourneyBuildIdentity(repositoryRoot, "packaged");
  assertExactPackagedBuildIdentity(identity);
  const executable = packagedExecutable;
  if (!await isFile(executable)) {
    throw new Error(`Production Electron executable is unavailable: ${executable}`);
  }
  const appData = path.join(profileRoot, "AppData", "Roaming");
  const localAppData = path.join(profileRoot, "AppData", "Local");
  const userData = path.join(profileRoot, "User Data");
  await Promise.all([
    mkdir(appData, { recursive: true }),
    mkdir(localAppData, { recursive: true }),
    mkdir(userData, { recursive: true })
  ]);
  const port = await freePort();
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    APPDATA: appData,
    LOCALAPPDATA: localAppData
  };
  delete environment.ETHER_RENDERER_URL;
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    "--disable-gpu",
    ...(documentPath === undefined ? [] : [documentPath])
  ];
  const startedAt = performance.now();
  const child = spawn(executable, args, {
    cwd: profileRoot,
    env: environment,
    stdio: "pipe",
    windowsHide: true
  });
  const output = captureOutput(child);
  const browser = await connectToElectron(port, child, output);
  return {
    browser,
    process: child,
    output,
    identity,
    runtime: "release/windows/win-unpacked/Ether.exe",
    startedAt
  };
}

async function firstPage(browser: Browser): Promise<Page> {
  const context = browser.contexts()[0];
  if (context === undefined) throw new Error("Production Electron did not expose a browser context.");
  return context.pages()[0] ?? context.waitForEvent("page", { timeout: 15_000 });
}

async function closeProductionElectron(launched: Awaited<ReturnType<typeof launchProductionElectron>>) {
  const context = launched.browser.contexts()[0];
  for (const page of context?.pages() ?? []) await page.close().catch(() => undefined);
  await launched.browser.close().catch(() => undefined);
  if (launched.process.exitCode === null) {
    await Promise.race([
      new Promise<void>((resolve) => launched.process.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 8_000))
    ]);
  }
  if (launched.process.exitCode === null) launched.process.kill();
}

async function connectToElectron(
  port: number,
  process: ChildProcessWithoutNullStreams,
  output: () => string
): Promise<Browser> {
  const endpoint = `http://127.0.0.1:${port}`;
  const startedAt = performance.now();
  let lastError: unknown = null;
  while (performance.now() - startedAt < 15_000) {
    if (process.exitCode !== null) {
      throw new Error(`Production Electron exited before its Start surface (${process.exitCode}): ${output()}`);
    }
    try {
      return await chromium.connectOverCDP(endpoint);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`Timed out connecting to production Electron: ${String(lastError)}\n${output()}`);
}

type AutosaveUiTiming = {
  durabilityMs: number;
  frameGapCount: number;
  maxFrameGapMs: number;
  maxLongTaskMs: number;
  over50MsFrameGaps: number;
  observedLongTasks: number;
};

async function measureAutosave(page: Page, trial: number): Promise<AutosaveUiTiming> {
  return page.evaluate(async (ordinal) => {
    const descriptor = await window.ether.document.bootstrap();
    const graph = await window.ether.graph.snapshot(descriptor.documentId);
    const node = graph.graph.nodes[ordinal]!;
    return new Promise<AutosaveUiTiming>((resolve, reject) => {
      let sawSaving = false;
      let settled = false;
      let savingAt = 0;
      let savedAt = 0;
      let previousFrameAt = performance.now();
      let animationFrame = 0;
      const observed: string[] = [];
      const frameGaps: number[] = [];
      const longTasks: Array<{ duration: number; startTime: number }> = [];
      const startedAt = performance.now();
      const observer = typeof PerformanceObserver === "undefined"
        ? null
        : new PerformanceObserver((entries) => {
          for (const entry of entries.getEntries()) {
            longTasks.push({ duration: entry.duration, startTime: entry.startTime });
          }
        });
      try {
        observer?.observe({ type: "longtask", buffered: false });
      } catch {
        // requestAnimationFrame gaps remain the required cross-runtime hitch signal.
      }
      const sampleFrame = (at: number) => {
        if (sawSaving) frameGaps.push(Math.max(0, at - previousFrameAt));
        previousFrameAt = at;
        animationFrame = requestAnimationFrame(sampleFrame);
      };
      animationFrame = requestAnimationFrame(sampleFrame);
      const finish = () => {
        cancelAnimationFrame(animationFrame);
        observer?.disconnect();
        const overlappingLongTasks = longTasks.filter((entry) =>
          entry.startTime <= savedAt && entry.startTime + entry.duration >= savingAt);
        const maxFrameGapMs = frameGaps.length === 0 ? 0 : Math.max(...frameGaps);
        resolve({
          durabilityMs: savedAt - startedAt,
          frameGapCount: frameGaps.length,
          maxFrameGapMs,
          maxLongTaskMs: overlappingLongTasks.length === 0
            ? 0
            : Math.max(...overlappingLongTasks.map((entry) => entry.duration)),
          over50MsFrameGaps: frameGaps.filter((gap) => gap >= 50).length,
          observedLongTasks: overlappingLongTasks.length
        });
      };
      const unsubscribe = window.ether.document.onEvent((event) => {
        if (event.documentId !== descriptor.documentId) return;
        const state = event.saveState ?? event.snapshot?.saveState;
        observed.push(`${event.kind}:${state ?? "unchanged"}`);
        if (state === "saving" && !sawSaving) {
          sawSaving = true;
          savingAt = performance.now();
          frameGaps.length = 0;
        }
        if (sawSaving && state === "saved" && !settled) {
          settled = true;
          savedAt = performance.now();
          clearTimeout(timeout);
          unsubscribe();
          requestAnimationFrame(finish);
        }
      });
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cancelAnimationFrame(animationFrame);
        observer?.disconnect();
        unsubscribe();
        reject(new Error(`The real desktop autosave did not reach Saved (${observed.join(", ")}).`));
      }, 12_000);
      void window.ether.graph.applyTransaction(descriptor.documentId, {
        id: crypto.randomUUID(),
        baseDocumentRevisionId: descriptor.documentRevisionId,
        baseGraphRevisions: { [descriptor.graphId]: descriptor.graphRevisionId },
        title: "Performance autosave move",
        actor: "user",
        layoutPolicy: "preserve",
        operations: [{
          type: "moveNodes",
          graphId: descriptor.graphId,
          positions: [{
            nodeId: node.id,
            position: { x: node.position.x + 1, y: node.position.y + 1 }
          }]
        }]
      }).catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        reject(error);
      });
    });
  }, trial);
}

function thousandNodeGraph(): EtherGraph {
  return {
    id: "performance-thousand-node-graph",
    title: "Representative 1,000-node graph",
    kind: "root",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: Array.from({ length: 1_000 }, (_value, index) => ({
      id: `node-${String(index).padStart(4, "0")}`,
      definitionId: "prompt.text",
      title: `Campaign prompt ${index}`,
      position: { x: (index % 40) * 280, y: Math.floor(index / 40) * 180 },
      size: { width: 220, height: 140 },
      config: {
        kind: "prompt.text",
        body: `Representative campaign prompt ${index}`,
        assembly: "append"
      },
      presentation: { collapsed: false, accent: "default", previewMode: "summary" }
    })),
    edges: [],
    groups: [],
    modules: [],
    viewState: {
      viewport: { x: 0, y: 0, zoom: 0.2 },
      selectedNodeIds: [],
      selectedEdgeIds: [],
      inspectorTarget: null
    }
  };
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)]!;
}

function summarize(values: readonly number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  return {
    medianMs: median(ordered),
    p95Ms: ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)]!,
    maxMs: ordered.at(-1)!
  };
}

function reportMetric(name: string, value: unknown) {
  console.info(`ETHER_PERFORMANCE_METRIC ${name} ${JSON.stringify(value)}`);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Could not reserve an Electron debugging port.");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function isFile(filePath: string) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function candidateIsCurrent() {
  return requirePackagedCandidate(async () => {
    if (!(await isFile(packagedExecutable)) || !(await isFile(packagedAsar))) {
      throw new Error(`The packaged executable or ASAR is unavailable at ${packagedExecutable}.`);
    }
    const inventory = await readPackagedInventory(packagedAsar);
    const current = await currentReleaseInventory();
    assertCurrentOutputInventory(inventory.sourceEntries, current);
  });
}

function currentReleaseInventory(): Promise<ReleaseInventoryEntry[]> {
  currentProductionInventory ??= (async () => {
    try {
      await prepareProductionRuntime(repositoryRoot);
      const releaseProject = await prepareReleaseProject(repositoryRoot);
      return (await createStagedInventory(releaseProject)).entries;
    } finally {
      await cleanupReleaseStaging(repositoryRoot);
    }
  })();
  return currentProductionInventory;
}

async function requirePackagedCandidate(
  inspect: () => Promise<void>
): Promise<void> {
  try {
    await inspect();
  } catch (error) {
    throw new Error(
      `Packaged performance refused a missing or stale packaged candidate: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
}

type ReleaseInventoryEntry = {
  path: string;
  bytes: number;
  sha256: string;
};

async function readPackagedInventory(asarPath: string): Promise<{ sourceEntries: ReleaseInventoryEntry[] }> {
  const candidate = JSON.parse(extractFile(asarPath, packagedInventoryPath).toString("utf8")) as {
    algorithm?: unknown;
    entries?: unknown;
    hash?: unknown;
    repeatHash?: unknown;
    sourceEntries?: unknown;
    sourceHash?: unknown;
    sourceRepeatHash?: unknown;
    unpackedEntries?: unknown;
    unpackedHash?: unknown;
    unpackedRepeatHash?: unknown;
    version?: unknown;
  };
  if (
    candidate.algorithm !== "sha256" ||
    candidate.version !== "4.0.0" ||
    typeof candidate.hash !== "string" ||
    candidate.hash !== candidate.repeatHash ||
    typeof candidate.sourceHash !== "string" ||
    candidate.sourceHash !== candidate.sourceRepeatHash ||
    typeof candidate.unpackedHash !== "string" ||
    candidate.unpackedHash !== candidate.unpackedRepeatHash ||
    !Array.isArray(candidate.entries) ||
    !Array.isArray(candidate.sourceEntries) ||
    !Array.isArray(candidate.unpackedEntries)
  ) {
    throw new Error("The packaged release inventory is invalid or non-deterministic.");
  }
  candidate.sourceEntries.map((entry) => {
    if (
      typeof entry !== "object" || entry === null ||
      typeof (entry as ReleaseInventoryEntry).path !== "string" ||
      typeof (entry as ReleaseInventoryEntry).bytes !== "number" ||
      typeof (entry as ReleaseInventoryEntry).sha256 !== "string"
    ) {
      throw new Error("The packaged release inventory contains an invalid entry.");
    }
    return entry as ReleaseInventoryEntry;
  });
  const actualPayload = inventoryAsarPayload(asarPath);
  return assertPackagedInventoryMatches(candidate, actualPayload.entries, {
    actualUnpackedEntries: await inventoryUnpackedFiles(asarPath),
    actualUnpackedPaths: actualPayload.unpackedPaths
  }) as { sourceEntries: ReleaseInventoryEntry[] };
}

async function readCurrentOutputEntries(
  roots: readonly { directory: string; prefix: string }[]
): Promise<ReleaseInventoryEntry[]> {
  const entries: ReleaseInventoryEntry[] = [];
  for (const root of roots) {
    if (!(await stat(root.directory)).isDirectory()) {
      throw new Error(`The current production output directory is unavailable: ${root.directory}.`);
    }
    await visitCurrentOutput(root.directory, root.directory, root.prefix, entries);
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function visitCurrentOutput(
  root: string,
  directory: string,
  prefix: string,
  entries: ReleaseInventoryEntry[]
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await visitCurrentOutput(root, absolute, prefix, entries);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Production output contains a non-file entry: ${absolute}.`);
    const bytes = await readFile(absolute);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    entries.push({
      path: `${prefix}/${relative}`,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex")
    });
  }
}

function assertCurrentOutputInventory(
  packagedEntries: readonly ReleaseInventoryEntry[],
  currentEntries: readonly ReleaseInventoryEntry[]
): void {
  const packaged = new Map(packagedEntries.map((entry) => [entry.path, entry]));
  const current = new Map(currentEntries.map((entry) => [entry.path, entry]));
  for (const requiredPath of requiredProductionInventoryPaths) {
    if (!current.has(requiredPath)) throw new Error(`Current production output is missing ${requiredPath}.`);
  }
  for (const [entryPath, entry] of current) {
    const packagedEntry = packaged.get(entryPath);
    if (
      packagedEntry === undefined ||
      packagedEntry.bytes !== entry.bytes ||
      packagedEntry.sha256 !== entry.sha256
    ) {
      throw new Error(`The packaged candidate is stale at ${entryPath}.`);
    }
  }
  for (const entryPath of packaged.keys()) {
    if (!current.has(entryPath)) {
      throw new Error(`The packaged candidate contains obsolete production runtime output ${entryPath}.`);
    }
  }
}

function inventoryEntry(entryPath: string, content: string): ReleaseInventoryEntry {
  const bytes = Buffer.from(content);
  return {
    path: entryPath,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

function captureOutput(process: ChildProcessWithoutNullStreams): () => string {
  const chunks: Buffer[] = [];
  process.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  process.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
  return () => Buffer.concat(chunks).toString("utf8");
}

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  assertAuthoringJourneySourceSafety,
  blankAuthoringJourney,
  cleanupIsolatedJourneyProfile,
  launchRecoveryJourney,
  packagedJourneyConfig,
  sourceElectronJourneyConfig,
  type JourneyMode,
  type RecoveryJourneySession,
  type RealPageInput
} from "../../recovery/journeyDriver.js";
import { completeNativeFileDialogWithUia, findExactPackagedProcessId } from "../../recovery/windowsIntegration.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const thisSource = fileURLToPath(import.meta.url);
const journeyId = "j02-node-catalog";

const canonicalDefinitions = [
  "prompt.text", "prompt.worker", "reference.set", "generation.image", "edit.image", "edit.mask",
  "edit.transform", "review.compare", "review.evaluate", "review.filter", "flow.variables", "flow.batch",
  "flow.join", "output.collection", "output.export", "canvas.note", "canvas.drawing"
] as const;

type DefinitionId = typeof canonicalDefinitions[number];
type EditRoute =
  | { kind: "title"; value: string }
  | { kind: "text"; field: string; value: string; save: string }
  | { kind: "select"; field: string; value: string; save: string }
  | { kind: "variables"; name: string; value: string }
  | { kind: "drawing-background"; value: string };

// Provider-backed image nodes intentionally use their durable title here. A
// blank, provider-safe journey must not require capability discovery or a
// provider launch just to prove ordinary Inspector persistence.
const editRoutes: Record<DefinitionId, EditRoute> = {
  "prompt.text": { kind: "text", field: "Authored text", value: "J02 coastal campaign direction", save: "Save prompt" },
  "prompt.worker": { kind: "text", field: "Worker instruction", value: "J02 turn the direction into three faithful variants", save: "Save worker" },
  "reference.set": { kind: "select", field: "Ordering", value: "name", save: "Save reference set" },
  "generation.image": { kind: "title", value: "J02 Image Generator" },
  "edit.image": { kind: "title", value: "J02 Image Edit" },
  "edit.mask": { kind: "select", field: "Mode", value: "local", save: "Save mask" },
  "edit.transform": { kind: "select", field: "Operation", value: "crop", save: "Save transform" },
  "review.compare": { kind: "select", field: "Selection mode", value: "many", save: "Save compare" },
  "review.evaluate": { kind: "text", field: "Instruction", value: "J02 check legibility and product fidelity", save: "Save evaluate" },
  "review.filter": { kind: "select", field: "Match", value: "any", save: "Save filter" },
  "flow.variables": { kind: "variables", name: "subject", value: "coastal campaign" },
  "flow.batch": { kind: "text", field: "Parallelism", value: "2", save: "Save batch" },
  "flow.join": { kind: "select", field: "Strategy", value: "zip", save: "Save join" },
  "output.collection": { kind: "select", field: "Membership mode", value: "replace", save: "Save collection" },
  "output.export": { kind: "select", field: "Format", value: "png", save: "Save export" },
  "canvas.note": { kind: "text", field: "Body", value: "J02 review note", save: "Save note" },
  "canvas.drawing": { kind: "drawing-background", value: "white" }
};

test.skip(process.platform !== "win32", "J02 recovery acceptance operates Windows Electron only.");

test("J02 creates, edits, saves, reopens, and verifies the 17-node catalog", async () => {
  test.setTimeout(8 * 60_000);
  await assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "J02 node catalog spec");
  const mode = journeyMode();
  const journeyRoot = await mkdtemp(path.join(os.tmpdir(), "ether-j02-node-catalog-"));
  const documentPath = path.join(journeyRoot, "J02 node catalog.ether");
  let authored: RecoveryJourneySession | null = null;
  let reopened: RecoveryJourneySession | null = null;
  let profile: RecoveryJourneySession["profile"] | undefined;

  try {
    authored = await launch(mode, `${journeyId}-author`, journeyRoot);
    profile = authored.profile;
    await expect(authored.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(authored.page.getByTestId("ether-canvas-surface")).toHaveAttribute("data-graph-node-count", "0");

    await assertBlankLibrary(authored.page, authored.input);
    await addAllCanonicalNodes(authored.page, authored.input);
    await fitAuthoredCatalog(authored.page, authored.input);
    await editAllCanonicalNodes(authored.page, authored.input);

    await focusBlankCanvas(authored.page, authored.input);
    await expect(authored.page.locator(".document-save-state span")).toHaveText("Saved", { timeout: 30_000 });
    await authored.input.pressKey(
      "Control+s",
      "Save the edited J02 document",
      "The existing recovery-safe document Save route writes the graph to one portable .ether file."
    );
    await completeNativeSaveIfNeeded(mode, authored, documentPath);
    await expect.poll(() => isFile(documentPath), { timeout: 15_000 }).toBe(true);
    await expect(authored.page.getByTestId("project-header")).toContainText("J02 node catalog.ether");
    authored.input.observe(
      "J02 document saved",
      "All 17 UI-authored nodes and their ordinary Inspector edits are saved before close.",
      `Saved ${path.basename(documentPath)} through Ctrl+S and observed the destination file.`
    );

    await authored.close("passed");
    authored = null;

    reopened = await launch(mode, `${journeyId}-reopen`, journeyRoot, documentPath, profile);
    await expect(reopened.page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(reopened.page.getByTestId("project-header")).toContainText("J02 node catalog.ether");
    await expect(reopened.page.getByTestId("ether-canvas-surface")).toHaveAttribute("data-graph-node-count", "17");
    await expectAllCanonicalNodes(reopened.page);
    await fitAuthoredCatalog(reopened.page, reopened.input);
    await verifyRepresentativeEdits(reopened.page, reopened.input);
    await expect(reopened.page.locator(".document-save-state span")).toHaveText("Saved", { timeout: 30_000 });
    reopened.input.observe(
      "J02 document reopened",
      "The saved document reopens with all 17 canonical definitions and representative edited values intact.",
      "The exact .ether destination reopened writable with 17 node cards and persisted Inspector values."
    );
    await reopened.close("passed");
    reopened = null;
  } finally {
    if (authored !== null) await authored.close("failed");
    if (reopened !== null) await reopened.close("failed");
    if (profile !== undefined) await cleanupIsolatedJourneyProfile(profile).catch(() => undefined);
    await rm(journeyRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});

async function assertBlankLibrary(page: Page, input: RealPageInput): Promise<void> {
  const library = page.getByTestId("node-library");
  await expect(library.locator(".node-library-item")).toHaveCount(canonicalDefinitions.length);
  const definitions = await library.locator(".node-library-item").evaluateAll((items) => items
    .map((item) => item.getAttribute("data-node-definition"))
    .filter((value): value is string => value !== null));
  expect(definitions).toEqual(canonicalDefinitions);
  input.observe(
    "J02 blank Node Library",
    "A blank document exposes all 17 canonical node types from the registry-backed Library.",
    `Found ${definitions.length} canonical Library rows before graph mutation.`
  );
}

async function addAllCanonicalNodes(page: Page, input: RealPageInput): Promise<void> {
  for (const [index, definition] of canonicalDefinitions.entries()) {
    const row = page.locator(`.node-library-item[data-node-definition='${definition}']`);
    await row.scrollIntoViewIfNeeded();
    await input.leftClick(
      row.locator(".node-library-add"),
      `Add ${definition} from Node Library`,
      `The canonical ${definition} default is created through the ordinary blank-document Library.`
    );
    await expect(page.getByTestId("ether-canvas-surface")).toHaveAttribute("data-graph-node-count", String(index + 1));
  }
}

async function fitAuthoredCatalog(page: Page, input: RealPageInput): Promise<void> {
  for (const label of ["Reference Desk", "Build tools"] as const) {
    const hide = page.getByRole("button", { name: `Hide ${label}`, exact: true });
    if (await hide.isVisible().catch(() => false)) {
      await input.leftClick(hide, `Collapse ${label} for J02 catalog editing`, `${label} collapses to give the authored catalog enough canvas room.`);
    }
  }
  const canvas = page.getByTestId("ether-canvas-surface");
  const bounds = await requiredBox(canvas, "J02 canvas");
  await input.leftClick(
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 24 },
    "Focus the J02 canvas",
    "The canvas owns focus before the graph-fit command is issued."
  );
  await input.pressKey("Home", "Fit the 17-node J02 catalog", "All authored node cards fit inside the visible canvas for Inspector access.");
  await page.waitForTimeout(400);
  for (const definition of canonicalDefinitions) {
    await expect(page.locator(`.ether-node[data-node-definition='${definition}']`).first()).toBeVisible();
  }
  const occluded = await page.evaluate((definitions) => {
    const surface = document.querySelector<HTMLElement>("[data-testid='ether-canvas-surface']");
    const surfaceBounds = surface?.getBoundingClientRect();
    return definitions.flatMap((definition) => {
      const node = document.querySelector<HTMLElement>(`.ether-node[data-node-definition='${definition}']`);
      const title = node?.querySelector<HTMLElement>(".ether-node-title");
      if (node === null || title === null || title === undefined) return [{ definition, hit: "missing" }];
      const bounds = title.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return hit !== null && node.contains(hit) ? [] : [{
        definition,
        hit: hit instanceof HTMLElement ? `${hit.tagName}.${hit.className}` : "none",
        pane: hit instanceof HTMLElement ? hit.closest<HTMLElement>(".resizable-pane")?.className ?? null : null,
        title: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
        surface: surfaceBounds === undefined ? null : {
          left: surfaceBounds.left,
          top: surfaceBounds.top,
          right: surfaceBounds.right,
          bottom: surfaceBounds.bottom
        }
      }];
    });
  }, canonicalDefinitions);
  if (occluded.length > 0) throw new Error(`J02 fitted node titles are occluded: ${JSON.stringify(occluded)}`);
}

async function focusBlankCanvas(page: Page, input: RealPageInput): Promise<void> {
  const pane = page.locator(".react-flow__pane");
  const point = await pane.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    for (const yRatio of [0.92, 0.78, 0.64, 0.5, 0.36, 0.22, 0.08]) {
      for (const xRatio of [0.92, 0.78, 0.64, 0.5, 0.36, 0.22, 0.08]) {
        const x = bounds.left + bounds.width * xRatio;
        const y = bounds.top + bounds.height * yRatio;
        if (document.elementFromPoint(x, y) === element) return { x, y };
      }
    }
    throw new Error("The fitted J02 catalog has no unobstructed canvas focus point.");
  });
  await input.leftClick(
    point,
    "Return focus to the J02 canvas before saving",
    "Ctrl+S is issued from ordinary canvas focus rather than stealing the shortcut from an editable Inspector control."
  );
  await expect(page.locator(".ether-node.is-selected")).toHaveCount(0);
}

async function editAllCanonicalNodes(page: Page, input: RealPageInput): Promise<void> {
  for (const definition of canonicalDefinitions) {
    const route = editRoutes[definition];
    const node = await openNodeInspector(page, input, definition);
    const inspector = page.getByTestId("node-inspector");
    if (route.kind === "title") {
      const title = inspector.getByLabel("Title", { exact: true });
      await title.fill(route.value);
      await input.leftClick(
        inspector.getByRole("button", { name: "Save title", exact: true }),
        `Save ${definition} title`,
        "The provider-independent node title is saved through the ordinary Inspector Setup section."
      );
    } else if (route.kind === "text") {
      const field = inspector.getByLabel(route.field, { exact: true });
      await field.fill(route.value);
      await input.leftClick(
        inspector.getByRole("button", { name: route.save, exact: true }),
        `Save ${definition} setting`,
        `The ${route.field} setting is committed through the ordinary ${definition} Inspector.`
      );
    } else if (route.kind === "select") {
      const field = inspector.getByLabel(route.field, { exact: true });
      await input.leftClick(field, `Open ${definition} ${route.field} control`, `The ordinary Inspector exposes ${route.field} for ${definition}.`);
      await field.selectOption(route.value);
      await input.leftClick(
        inspector.getByRole("button", { name: route.save, exact: true }),
        `Save ${definition} setting`,
        `The ${route.field} setting is committed through the ordinary ${definition} Inspector.`
      );
    } else if (route.kind === "variables") {
      await input.leftClick(
        inspector.getByRole("button", { name: "Add variable", exact: true }),
        "Add the J02 variable",
        "The Variables Inspector exposes one durable variable row for ordinary editing."
      );
      await inspector.getByLabel("Variable 1 name", { exact: true }).fill(route.name);
      await inspector.getByLabel("Variable 1 value", { exact: true }).fill(route.value);
      await input.leftClick(
        inspector.getByRole("button", { name: "Save variables", exact: true }),
        "Save the J02 variable",
        "The edited variable definition is committed through the ordinary Variables Inspector."
      );
    } else {
      const field = inspector.getByLabel("Drawing background", { exact: true });
      await field.fill(route.value);
      await field.press("Tab");
      await expect(field).toHaveValue(route.value);
      await page.waitForTimeout(250);
    }
    await expect(node).toHaveCount(1);
    input.observe(
      `Edit ${definition} in ordinary Inspector`,
      "Each canonical node is opened in an ordinary Inspector or direct editor and receives one meaningful user-facing setting.",
      `Committed the ${route.kind === "title" ? "title" : route.kind === "drawing-background" ? "drawing background" : route.kind === "variables" ? "variable definition" : route.field} setting for ${definition}.`
    );
  }
}

async function openNodeInspector(page: Page, input: RealPageInput, definition: DefinitionId): Promise<Locator> {
  const dismissRunPrompt = page.getByRole("button", { name: "Dismiss", exact: true });
  if (await dismissRunPrompt.isVisible().catch(() => false)) {
    await input.leftClick(
      dismissRunPrompt,
      "Dismiss the prior selected-node prompt",
      "The transient selected-run prompt is dismissed before the next canonical node is selected."
    );
    await expect(dismissRunPrompt).not.toBeVisible();
  }
  const node = page.locator(`.ether-node[data-node-definition='${definition}']`).first();
  await node.scrollIntoViewIfNeeded();
  await input.leftClick(
    node.locator(".ether-node-title"),
    `Open ${definition} ordinary Inspector`,
    `Selecting the visible ${definition} card surface reveals its task-specific Inspector without raw configuration editing.`
  );
  await expect(node).toHaveClass(/is-selected/);
  await expect(page.locator(".ether-node.is-selected")).toHaveAttribute("data-node-definition", definition);
  await expect(page.getByTestId("node-inspector")).toBeVisible({ timeout: 15_000 });
  return node;
}

async function expectAllCanonicalNodes(page: Page): Promise<void> {
  const definitions = await page.getByTestId("ether-node").evaluateAll((nodes) => nodes
    .map((node) => node.getAttribute("data-node-definition"))
    .filter((value): value is string => value !== null));
  expect(definitions).toHaveLength(canonicalDefinitions.length);
  expect([...new Set(definitions)].sort()).toEqual([...canonicalDefinitions].sort());
  for (const definition of canonicalDefinitions) {
    await expect(page.locator(`.ether-node[data-node-definition='${definition}']`)).toHaveCount(1);
  }
}

async function verifyRepresentativeEdits(page: Page, input: RealPageInput): Promise<void> {
  const checks: Array<
    | { definition: DefinitionId; kind: "field"; field: string; value: string }
    | { definition: DefinitionId; kind: "title"; value: string }
    | { definition: "flow.variables"; kind: "variables"; name: string; value: string }
  > = [
    { definition: "prompt.text", kind: "field", field: "Authored text", value: editRoutes["prompt.text"].value },
    { definition: "prompt.worker", kind: "field", field: "Worker instruction", value: editRoutes["prompt.worker"].value },
    { definition: "reference.set", kind: "field", field: "Ordering", value: editRoutes["reference.set"].value },
    { definition: "generation.image", kind: "title", value: editRoutes["generation.image"].value },
    { definition: "edit.image", kind: "title", value: editRoutes["edit.image"].value },
    { definition: "edit.mask", kind: "field", field: "Mode", value: editRoutes["edit.mask"].value },
    { definition: "edit.transform", kind: "field", field: "Operation", value: editRoutes["edit.transform"].value },
    { definition: "review.compare", kind: "field", field: "Selection mode", value: editRoutes["review.compare"].value },
    { definition: "review.evaluate", kind: "field", field: "Instruction", value: editRoutes["review.evaluate"].value },
    { definition: "review.filter", kind: "field", field: "Match", value: editRoutes["review.filter"].value },
    { definition: "flow.variables", kind: "variables", name: "subject", value: "coastal campaign" },
    { definition: "flow.batch", kind: "field", field: "Parallelism", value: editRoutes["flow.batch"].value },
    { definition: "flow.join", kind: "field", field: "Strategy", value: editRoutes["flow.join"].value },
    { definition: "output.collection", kind: "field", field: "Membership mode", value: editRoutes["output.collection"].value },
    { definition: "output.export", kind: "field", field: "Format", value: editRoutes["output.export"].value },
    { definition: "canvas.note", kind: "field", field: "Body", value: editRoutes["canvas.note"].value },
    { definition: "canvas.drawing", kind: "field", field: "Drawing background", value: editRoutes["canvas.drawing"].value }
  ];
  for (const check of checks) {
    const node = await openNodeInspector(page, input, check.definition);
    const inspector = page.getByTestId("node-inspector");
    if (check.kind === "title") {
      await expect(inspector.getByLabel("Title", { exact: true })).toHaveValue(check.value);
    } else if (check.kind === "variables") {
      await expect(inspector.getByLabel("Variable 1 name", { exact: true })).toHaveValue(check.name);
      await expect(inspector.getByLabel("Variable 1 value", { exact: true })).toHaveValue(check.value);
    } else {
      await expect(inspector.getByLabel(check.field, { exact: true })).toHaveValue(check.value);
    }
    input.observe(
      `Verify persisted ${check.definition} setting`,
      "A representative edited value is visible in the reopened ordinary Inspector.",
      `Reopened ${check.definition} and observed the saved value ${check.kind === "variables" ? `${check.name}=${check.value}` : check.value}.`
    );
    await expect(node).toHaveCount(1);
  }
}

async function launch(
  mode: JourneyMode,
  id: string,
  fixtureRoot: string,
  reopenPath?: string,
  profile?: RecoveryJourneySession["profile"]
): Promise<RecoveryJourneySession> {
  const base = mode === "source-electron"
    ? sourceElectronJourneyConfig(workspaceRoot, id)
    : packagedJourneyConfig(workspaceRoot, id);
  return launchRecoveryJourney({
    ...base,
    evidenceMode: "ephemeral",
    declaration: blankAuthoringJourney(id),
    ...(profile === undefined ? { cleanupProfile: false } : { profile, cleanupProfile: false }),
    ...(mode === "source-electron"
      ? {
          sourceEntrypoint: path.join(workspaceRoot, "packages", "testing", "fixtures", "desktop-main.mjs"),
          sourceArgs: () => [
            `--fixture-root=${fixtureRoot}`,
            `--save-path=${path.join(fixtureRoot, "J02 node catalog.ether")}`,
            ...(reopenPath === undefined ? [] : [`--open-document=${reopenPath}`])
          ]
        }
      : { packagedArgs: () => reopenPath === undefined ? [] : [reopenPath] })
  });
}

function journeyMode(): JourneyMode {
  const mode = process.env.ETHER_J02_NODE_CATALOG_MODE;
  if (mode === "source-electron" || mode === "packaged") return mode;
  throw new Error("Set ETHER_J02_NODE_CATALOG_MODE to source-electron or packaged.");
}

async function completeNativeSaveIfNeeded(mode: JourneyMode, session: RecoveryJourneySession, destination: string): Promise<void> {
  if (mode === "source-electron") return;
  await completeNativeFileDialogWithUia(await packagedProcessId(session), destination);
}

async function packagedProcessId(session: RecoveryJourneySession): Promise<number> {
  return findExactPackagedProcessId(
    path.join(workspaceRoot, "release", "windows", "win-unpacked", "Ether.exe"),
    session.profile.userData
  );
}

async function requiredBox(locator: Locator, label: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`${label} has no visible bounding box.`);
  return box;
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

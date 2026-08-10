import { expect, test, type Page } from "@playwright/test";
import { nodeLibraryItems } from "@ether/graph-kernel";

test("shows an immediate untitled canvas and subscribes before the initial snapshot", async ({ page }) => {
  await openEther(page);

  await expect(page.getByTestId("document-canvas")).toBeVisible();
  await expect(page.getByTestId("project-header")).toContainText("Untitled");
  await expect(page.getByTestId("start-screen")).toHaveCount(0);
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect.poll(() => calls(page)).toEqual(expect.arrayContaining(["subscribe", "bootstrap"]));
  expect((await calls(page)).slice(0, 2)).toEqual(["subscribe", "bootstrap"]);
});

test("keeps header, graph, tools, and status bounded across presentation widths", async ({ page }) => {
  await openEther(page);

  // Task 9 evidence covers the lifecycle canvas only. Task 15 owns Build/Focus/Run/Review
  // workspaces, adaptive pane transitions, pane resizing/collapse, and the full shell screenshot suite.
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 }
  ]) {
    await page.setViewportSize(viewport);
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
    expect(bounds.canvas.height).toBeGreaterThan(300);
  }

  await page.screenshot({ path: "../../test-results/task9-browser-smoke.png", fullPage: true });
});

test("presents graph edits and ordinary document commands without a production fake generator", async ({ page }) => {
  await openEther(page);

  await expect(page.getByTestId("node-library").locator(".node-library-item")).toHaveCount(17);
  await page.getByRole("button", { name: "Add Prompt", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect.poll(() => calls(page)).toEqual(expect.arrayContaining(["graph.apply", "document.save"]));

  for (const name of ["New document", "Open document", "Save as", "Save a copy", "Compact document", "Make document portable"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Generate", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Simulation output", exact: true })).toHaveCount(0);
});

test("explains honest read-only mode and disables canvas mutation before invocation", async ({ page }) => {
  await openEther(page, {
    mode: "read-only",
    readOnlyReason: "location-unsupported",
    initialNode: true,
    simulationMode: true
  });

  await expect(page.getByTestId("project-header")).toContainText(
    "Read-only: this location cannot guarantee safe writes; save a copy to a local fixed drive"
  );
  for (const name of ["Save", "Save as", "Compact document", "Make document portable"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await expect(page.getByRole("button", { name: "Add Image Generator", exact: true })).toBeVisible();
  for (const name of ["Add Prompt", "Add Image Generator", "Simulation output"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await expect(page.getByTestId("node-library").locator(".node-library-item")).toHaveCount(17);
  await expect(page.locator(".react-flow__node.draggable")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save a copy", exact: true })).toBeEnabled();
  expect(await calls(page)).not.toContain("graph.apply");
});

for (const [reason, guidance] of [
  ["requested", "this document was explicitly opened read-only; reopen it with write access"],
  ["writer-active", "another Ether window is editing this document; close it there, then reopen"],
  ["sqlite-busy", "the document database is busy; close the app using it, then reopen"],
  ["heartbeat-failed", "Ether lost safe write access; save a copy, then reopen"]
] as const) {
  test(`surfaces ${reason} with precise recovery guidance`, async ({ page }) => {
    await openEther(page, { mode: "read-only", readOnlyReason: reason });
    await expect(page.getByTestId("project-header")).toContainText(`Read-only: ${guidance}`);
  });
}

test("shows only capability-backed missing-reference actions", async ({ page }) => {
  await openEther(page, { missingReference: "limited" });

  const enabled = [
    ["Locate", "locate"],
    ["Search Folder", "search-folder"],
    ["Relink All", "relink-all"],
    ["Remove", "remove"]
  ] as const;
  for (const [label, action] of enabled) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect.poll(() => calls(page)).toContain(`reference.${action}`);
  }
  await expect(page.getByRole("button", { name: "Use Embedded Preview", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Embed Available Copy", exact: true })).toHaveCount(0);
});

test("presents simulation, compact, portable, and exact save-state feedback", async ({ page }) => {
  await openEther(page, { simulationMode: true, missingReference: "full" });

  await expect(page.getByRole("button", { name: "Simulation output", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Use Embedded Preview", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Embed Available Copy", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Compact document" }).click();
  await expect(page.getByText("Compacted document: 10 B before, 9 B after; reclaimed 1 B", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Make document portable" }).click();
  await expect(page.getByText(
    "Made portable: embedded 2 references (4.0 KB); missing source-image.png",
    { exact: true }
  )).toBeVisible();

  await emitState(page, 5, "saving", null);
  await expect(page.getByText("Saving", { exact: true })).toBeVisible();
  await emitState(page, 6, "needs-attention", "The disk is full.");
  await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
  await expect(page.getByText("The disk is full.", { exact: true })).toBeVisible();
  await emitState(page, 5, "saved", null);
  await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
  await emitState(page, 7, "saved", null);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByText("The disk is full.", { exact: true })).toHaveCount(0);
});

type SmokeFixture = {
  mode?: "writable" | "read-only";
  readOnlyReason?: "requested" | "writer-active" | "location-unsupported" | "sqlite-busy" | "heartbeat-failed" | null;
  initialNode?: boolean;
  missingReference?: "limited" | "full";
  simulationMode?: boolean;
  catalog: readonly unknown[];
};

async function openEther(
  page: Page,
  options: {
    mode?: "writable" | "read-only";
    readOnlyReason?: "requested" | "writer-active" | "location-unsupported" | "sqlite-busy" | "heartbeat-failed" | null;
    initialNode?: boolean;
    missingReference?: "limited" | "full";
    simulationMode?: boolean;
  } = {}
) {
  const initFixture: SmokeFixture = { ...options, catalog: nodeLibraryItems as readonly unknown[] };
  await page.addInitScript((fixture: SmokeFixture) => {
    const calls: string[] = [];
    const listeners: Array<(event: unknown) => void> = [];
    let revision = 1;
    let graphRevision = "graph-revision-1";
    let saveState: "saving" | "saved" | "needs-attention" = "saved";
    let eventError: string | null = null;
    let nodes: Array<Record<string, unknown>> = fixture.initialNode ? [{
      id: "node-initial",
      definitionId: "prompt.text",
      title: "Initial Prompt",
      position: { x: 120, y: 120 },
      size: { width: 240, height: 132 },
      config: { kind: "prompt.text", body: "Fixture", assembly: "append" },
      presentation: { collapsed: false, accent: "default", previewMode: "content" }
    }] : [];
    const snapshot = () => ({
      documentId: "document-browser-smoke",
      displayName: "Untitled",
      named: false,
      mode: fixture.mode ?? "writable",
      readOnlyReason: fixture.readOnlyReason ?? null,
      commands: {
        save: (fixture.mode ?? "writable") === "writable",
        saveAs: (fixture.mode ?? "writable") === "writable",
        saveCopy: true,
        compact: (fixture.mode ?? "writable") === "writable",
        makePortable: (fixture.mode ?? "writable") === "writable"
      },
      saveState,
      documentRevisionId: `document-revision-${revision}`,
      graphId: "graph-root",
      graphRevisionId: graphRevision,
      simulationEnabled: fixture.simulationMode ?? false,
      revision
    });
    const graph = () => ({
      id: "graph-root",
      title: "Untitled Graph",
      kind: "root",
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
      nodes,
      edges: [],
      groups: [],
      modules: [],
      viewState: {
        viewport: { x: 0, y: 0, zoom: 1 },
        selectedNodeIds: [],
        selectedEdgeIds: [],
        inspectorTarget: null
      }
    });
    const emit = () => listeners.forEach((listener) => listener({
      kind: "snapshot",
      documentId: snapshot().documentId,
      revision,
      saveState,
      snapshot: snapshot(),
      ...(eventError === null ? {} : { error: {
        code: "AUTOSAVE_FAILED",
        category: "document",
        message: eventError,
        retryable: true
      } })
    }));
    const command = async (name: string) => {
      calls.push(name);
      revision += 1;
      emit();
      return snapshot();
    };
    const applyGraphTransaction = (operations: Array<Record<string, unknown>>) => {
      calls.push("graph.apply");
      for (const operation of operations) {
        if (operation.type === "addNode") nodes = [...nodes, operation.node as Record<string, unknown>];
      }
      revision += 1;
      graphRevision = `graph-revision-${revision}`;
      emit();
      return { graph: graph(), revision };
    };

    Object.defineProperty(window, "__etherSmokeCalls", { value: calls });
    Object.defineProperty(window, "__etherEmitState", { value: (
      nextRevision: number,
      nextSaveState: "saving" | "saved" | "needs-attention",
      nextError: string | null
    ) => {
      revision = nextRevision;
      saveState = nextSaveState;
      eventError = nextError;
      emit();
    } });
    Object.defineProperty(window, "ether", { value: {
      document: {
        onEvent: (listener: (event: unknown) => void) => {
          calls.push("subscribe");
          listeners.push(listener);
          return () => undefined;
        },
        bootstrap: async () => {
          calls.push("bootstrap");
          return snapshot();
        },
        new: () => command("document.new"),
        open: () => command("document.open"),
        openDropped: () => command("document.open-dropped"),
        save: () => command("document.save"),
        saveAs: () => command("document.save-as"),
        saveCopy: () => command("document.save-copy"),
        compact: async () => ({ beforeBytes: 10, afterBytes: 9 }),
        makePortable: async () => ({
          cancelled: false,
          embeddedCount: 2,
          embeddedBytes: 4096,
          expectedBytes: 4096,
          expectedCount: 2,
          missingReferences: [{ id: "reference-missing", displayName: "source-image.png" }]
        }),
        close: async () => null
      },
      graph: {
        snapshot: async () => ({ graph: graph(), revision }),
        applyTransaction: async (_documentId: string, transaction: { operations: Array<Record<string, unknown>> }) => applyGraphTransaction(transaction.operations)
      },
      application: {
        onEvent: () => () => undefined,
        query: async (query: { name: string }) => {
          if (query.name === "node.catalog") return { name: query.name, payload: { nodes: fixture.catalog } };
          if (query.name === "graph.snapshot") {
            const active = snapshot();
            return { name: query.name, payload: { graph: graph(), documentRevisionId: active.documentRevisionId, graphRevisionId: graphRevision } };
          }
          if (query.name === "reference.list") return { name: query.name, payload: { references: [] } };
          if (query.name === "job.list") return { name: query.name, payload: { jobs: [] } };
          if (query.name === "provider.capabilities") return { name: query.name, payload: { capabilities: [] } };
          return { name: query.name, payload: {} };
        },
        command: async (request: { name: string; payload?: { transaction?: { operations?: Array<Record<string, unknown>> } } }) => {
          if (request.name === "graph.applyTransaction") {
            applyGraphTransaction(request.payload?.transaction?.operations ?? []);
            const active = snapshot();
            return { name: request.name, payload: { documentRevisionId: active.documentRevisionId, graphRevisions: [{ graphId: "graph-root", revisionId: graphRevision }] } };
          }
          return { name: request.name, payload: {} };
        }
      },
      artifacts: {
        search: async () => [],
        generateFake: async () => []
      },
      references: {
        list: async () => fixture.missingReference ? [{
          id: "reference-missing",
          displayName: "source-image.png",
          mediaType: "image/png",
          originalPath: "source-image.png",
          state: "missing",
          policy: "linked",
          byteLength: 128,
          modifiedAtMs: 1,
          sampleSha256: "a".repeat(64),
          embeddedPreviewContentKey: null,
          embeddedContentKey: null,
          createdAt: "2026-07-18T00:00:00.000Z",
          updatedAt: "2026-07-18T00:00:00.000Z",
          actions: fixture.missingReference === "full"
            ? ["locate", "search-folder", "relink-all", "use-embedded-preview", "embed-available-copy", "remove"]
            : ["locate", "search-folder", "relink-all", "remove"]
        }] : [],
        act: async (_documentId: string, _referenceId: string, action: string) => {
          calls.push(`reference.${action}`);
          return fixture.missingReference ? [{
            id: "reference-missing",
            displayName: "source-image.png",
            state: "missing",
            actions: fixture.missingReference === "full"
              ? ["locate", "search-folder", "relink-all", "use-embedded-preview", "embed-available-copy", "remove"]
              : ["locate", "search-folder", "relink-all", "remove"]
          }] : [];
        }
      },
      runtime: { versions: async () => ({ electron: "43.1.1", node: "24.17.0" }) }
    }});
  }, initFixture);
  await page.goto("/");
  await expect(page.getByTestId("document-canvas")).toBeVisible();
}

async function calls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as typeof window & { __etherSmokeCalls: string[] }).__etherSmokeCalls);
}

async function emitState(
  page: Page,
  revision: number,
  saveState: "saving" | "saved" | "needs-attention",
  error: string | null
) {
  await page.evaluate(({ revision: nextRevision, saveState: nextState, error: nextError }) => {
    (window as typeof window & {
      __etherEmitState(revision: number, state: string, error: string | null): void;
    }).__etherEmitState(nextRevision, nextState, nextError);
  }, { revision, saveState, error });
}

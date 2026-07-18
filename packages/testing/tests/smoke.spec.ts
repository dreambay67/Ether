import { expect, test, type Page } from "@playwright/test";

test("shows an immediate untitled canvas and subscribes before the initial snapshot", async ({ page }) => {
  await openEther(page);

  await expect(page.getByTestId("document-canvas")).toBeVisible();
  await expect(page.getByTestId("project-header")).toContainText("Untitled");
  await expect(page.getByTestId("start-screen")).toHaveCount(0);
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect.poll(() => calls(page)).toEqual(expect.arrayContaining(["subscribe", "bootstrap"]));
  expect((await calls(page)).slice(0, 2)).toEqual(["subscribe", "bootstrap"]);
});

test("keeps header, graph, tools, and status bounded at desktop and narrow widths", async ({ page }) => {
  await openEther(page);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 820, height: 720 }]) {
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
    expect(bounds.canvas.height).toBeGreaterThan(400);
  }

  await page.screenshot({ path: "../../test-results/task9-browser-smoke.png", fullPage: true });
});

test("applies graph edits and keeps ordinary save commands understandable", async ({ page }) => {
  await openEther(page);

  await page.getByRole("button", { name: "Prompt", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect.poll(() => calls(page)).toEqual(expect.arrayContaining(["graph.apply", "document.save"]));

  for (const name of ["New document", "Open document", "Save as", "Save a copy", "Compact document", "Make document portable"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
});

test("explains honest read-only mode and disables mutating document commands", async ({ page }) => {
  await openEther(page, { mode: "read-only", readOnlyReason: "location-unsupported" });

  await expect(page.getByTestId("project-header")).toContainText(
    "Read-only: this location cannot guarantee safe writes"
  );
  for (const name of ["Save", "Save as", "Compact document", "Make document portable"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await expect(page.getByRole("button", { name: "Save a copy", exact: true })).toBeEnabled();
});

test("offers every real missing-reference recovery action", async ({ page }) => {
  await openEther(page, { missingReference: true });

  const expected = [
    ["Locate", "locate"],
    ["Search Folder", "search-folder"],
    ["Relink All", "relink-all"],
    ["Use Embedded Preview", "use-embedded-preview"],
    ["Embed Available Copy", "embed-available-copy"],
    ["Remove", "remove"]
  ] as const;
  for (const [label, action] of expected) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect.poll(() => calls(page)).toContain(`reference.${action}`);
  }
});

async function openEther(
  page: Page,
  options: {
    mode?: "writable" | "read-only";
    readOnlyReason?: "location-unsupported" | null;
    missingReference?: boolean;
  } = {}
) {
  await page.addInitScript((fixture) => {
    const calls: string[] = [];
    const listeners: Array<(event: unknown) => void> = [];
    let revision = 1;
    let graphRevision = "graph-revision-1";
    let nodes: Array<Record<string, unknown>> = [];
    const snapshot = () => ({
      documentId: "document-browser-smoke",
      displayName: "Untitled",
      named: false,
      mode: fixture.mode ?? "writable",
      readOnlyReason: fixture.readOnlyReason ?? null,
      saveState: "saved",
      documentRevisionId: `document-revision-${revision}`,
      graphId: "graph-root",
      graphRevisionId: graphRevision,
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
      snapshot: snapshot()
    }));
    const command = async (name: string) => {
      calls.push(name);
      revision += 1;
      emit();
      return snapshot();
    };

    Object.defineProperty(window, "__etherSmokeCalls", { value: calls });
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
        makePortable: async () => ({ embeddedCount: 0, missingReferenceIds: [] }),
        close: async () => null
      },
      graph: {
        snapshot: async () => ({ graph: graph(), revision }),
        applyTransaction: async (_documentId: string, transaction: { operations: Array<Record<string, unknown>> }) => {
          calls.push("graph.apply");
          for (const operation of transaction.operations) {
            if (operation.type === "addNode") nodes = [...nodes, operation.node as Record<string, unknown>];
          }
          revision += 1;
          graphRevision = `graph-revision-${revision}`;
          emit();
          return { graph: graph(), revision };
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
          updatedAt: "2026-07-18T00:00:00.000Z"
        }] : [],
        act: async (_documentId: string, _referenceId: string, action: string) => {
          calls.push(`reference.${action}`);
          return fixture.missingReference ? [{
            id: "reference-missing",
            displayName: "source-image.png",
            state: "missing"
          }] : [];
        }
      },
      runtime: { versions: async () => ({ electron: "43.1.1", node: "24.17.0" }) }
    }});
  }, options);
  await page.goto("/");
  await expect(page.getByTestId("document-canvas")).toBeVisible();
}

async function calls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as typeof window & { __etherSmokeCalls: string[] }).__etherSmokeCalls);
}

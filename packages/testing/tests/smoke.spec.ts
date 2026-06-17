import { expect, test } from "@playwright/test";

test("renders the React Flow canvas, library, inspector, run panel, and minimap", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("ETHER")).toBeVisible();
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect(page.locator(".react-flow__minimap")).toBeVisible();
  await expect(page.getByTestId("panel-node-library")).toBeVisible();
  await expect(page.getByTestId("panel-inspector")).toBeVisible();
  await expect(page.getByTestId("panel-run-trace")).toBeVisible();
  await expect(page.getByText(/Fake ready.*Nano unavailable/)).toBeVisible();
});

test("creates a node from the library and selects it", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();

  await expect(page.getByTestId("ether-node")).toHaveCount(1);
  await expect(page.getByTestId("ether-node").getByRole("heading", { name: "General Prompt" })).toBeVisible();
  await expect(page.getByTestId("canvas-status")).toContainText("Selected General Prompt");
});

test("disables reference upload until a project is open", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Link reference image" })).toBeDisabled();
  await expect(page.getByTestId("canvas-status")).toContainText("Open a project to link references");
});

test("inspector edits selected node title and label", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();
  await page.getByTestId("inspector-node-title").fill("Campaign spine");
  await page.getByTestId("inspector-node-label").fill("Launch prompt");

  await expect(page.getByTestId("ether-node").getByRole("heading", { name: "Campaign spine" })).toBeVisible();
  await expect(page.getByTestId("ether-node").getByText("Launch prompt")).toBeVisible();
});

test("selected prompt node shows contract summary and assembled preview", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();

  await expect(page.getByTestId("inspector-contract")).toContainText("Assemble Prompt");
  await expect(page.getByTestId("inspector-contract")).toContainText("Outputs");
  await expect(page.getByTestId("inspector-assembly-preview")).toContainText(
    "General prompt placeholder"
  );
});

test("assembling a prompt node freezes a local prompt artifact", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();
  await page.getByLabel("Instruction").fill("hero bottle on reflective glass");
  await page.getByTestId("inspector-run-node").click();

  await expect(page.getByTestId("canvas-status")).toContainText("Assembled General Prompt");
  await expect(page.getByTestId("panel-run-trace")).toContainText("Assembled General Prompt");
  await expect(page.getByTestId("inspector-assembly-preview")).toContainText("Frozen");
});

test("editing a frozen prompt marks it stale and clears the old frozen preview", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();
  await page.getByLabel("Instruction").fill("hero bottle on reflective glass");
  await page.getByTestId("inspector-run-node").click();

  await expect(page.getByTestId("inspector-assembly-preview")).toContainText("Frozen");

  await page.getByLabel("Instruction").fill("revised reflective bottle");

  await expect(page.getByTestId("ether-node")).toContainText("stale");
  await expect(page.getByTestId("inspector-assembly-preview")).not.toContainText("Frozen");
  await expect(page.getByTestId("inspector-assembly-preview")).toContainText("revised reflective bottle");
});

test("inspector exposes execution controls and lock disables node edits", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();

  await expect(page.getByTestId("inspector-execution-controls")).toBeVisible();
  await expect(page.getByLabel("Run policy")).toHaveValue("cached-inputs");
  await expect(page.getByLabel("Run count cap")).toHaveValue("1");
  await expect(page.getByLabel("Parallel execution")).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Run Node" })).toBeVisible();
  await expect(page.getByTestId("inspector-run-node")).toBeEnabled();

  await page.getByRole("button", { name: "Lock node" }).click();

  await expect(page.getByTestId("inspector-node-title")).toBeDisabled();
  await expect(page.getByTestId("inspector-run-node")).toBeDisabled();
  await expect(page.getByTestId("ether-node")).toContainText("locked");
});

test("connect first valid pair refuses locked endpoints", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();
  await page.getByRole("button", { name: "Lock node" }).click();
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();

  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect(page.getByTestId("canvas-status")).toContainText(
    "Unlock connected nodes before changing relationships"
  );
});

test("locked edge endpoints disable edge label edits and deletion", async ({ page }) => {
  await page.addInitScript(() => {
    const graph = {
      nodes: [
        {
          id: "locked-prompt",
          type: "etherNode",
          position: { x: 160, y: 180 },
          width: 224,
          height: 138,
          data: {
            definitionId: "prompt-general",
            kind: "Prompt",
            subtype: "General",
            title: "Locked Prompt",
            label: "Locked Prompt",
            notes: "",
            instruction: "protected prompt",
            status: "complete",
            locked: true
          }
        },
        {
          id: "generation",
          type: "etherNode",
          position: { x: 520, y: 180 },
          width: 224,
          height: 138,
          data: {
            definitionId: "generation-image",
            kind: "Generation",
            subtype: "Image",
            title: "Image",
            label: "Image",
            notes: "",
            instruction: "",
            status: "idle"
          }
        }
      ],
      edges: [
        {
          id: "edge-locked-prompt-generation",
          source: "locked-prompt",
          target: "generation",
          label: "prompt",
          selected: true,
          data: { label: "prompt" }
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\LockedRelations.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Locked Relations",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\LockedRelations.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(window, {
      ether: {
        shell: "desktop",
        file: {
          getDroppedFilePath: () => null
        },
        project: {
          create: async () => project,
          open: async () => project,
          saveGraph: async () => graph,
          loadGraph: async () => graph,
          health: async () => ({ issues: [] })
        },
        asset: {
          selectReferenceImage: async () => null,
          linkDroppedReference: async () => {
            throw new Error("not used");
          },
          ensureCollection: async () => {
            throw new Error("not used");
          },
          ensureDirectory: async () => {
            throw new Error("not used");
          },
          list: async () => [],
          saveFakeGenerated: async () => {
            throw new Error("not used");
          },
          moveToCollection: async () => {
            throw new Error("not used");
          },
          listMoves: async () => []
        },
        execution: {
          run: async () => {
            throw new Error("not used");
          }
        }
      }
    });
  });
  await page.goto("/");

  await page.getByLabel("Parent directory").fill("C:\\Fake");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByTestId("inspector-edge-label")).toBeDisabled();
  await page.keyboard.press("Delete");

  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.getByText("prompt", { exact: true })).toBeVisible();
  await expect(page.getByTestId("canvas-status")).toContainText(
    "Unlock connected nodes before changing relationships"
  );
});

test("deleting an unlocked node is blocked when it would remove a locked relationship", async ({ page }) => {
  await page.addInitScript(() => {
    const graph = {
      nodes: [
        {
          id: "locked-prompt",
          type: "etherNode",
          position: { x: 160, y: 180 },
          width: 224,
          height: 138,
          data: {
            definitionId: "prompt-general",
            kind: "Prompt",
            subtype: "General",
            title: "Locked Prompt",
            label: "Locked Prompt",
            notes: "",
            instruction: "protected prompt",
            status: "complete",
            locked: true
          }
        },
        {
          id: "generation",
          type: "etherNode",
          position: { x: 520, y: 180 },
          width: 224,
          height: 138,
          selected: true,
          data: {
            definitionId: "generation-image",
            kind: "Generation",
            subtype: "Image",
            title: "Image",
            label: "Image",
            notes: "",
            instruction: "",
            status: "idle"
          }
        }
      ],
      edges: [
        {
          id: "edge-locked-prompt-generation",
          source: "locked-prompt",
          target: "generation",
          label: "prompt",
          data: { label: "prompt" }
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\LockedImplicitDelete.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Locked Implicit Delete",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: {
        path: "C:\\Fake\\LockedImplicitDelete.ether\\ether.db",
        tables: [],
        healthIssueCount: 0
      }
    };

    Object.assign(window, {
      ether: {
        shell: "desktop",
        file: {
          getDroppedFilePath: () => null
        },
        project: {
          create: async () => project,
          open: async () => project,
          saveGraph: async () => graph,
          loadGraph: async () => graph,
          health: async () => ({ issues: [] })
        },
        asset: {
          selectReferenceImage: async () => null,
          linkDroppedReference: async () => {
            throw new Error("not used");
          },
          ensureCollection: async () => {
            throw new Error("not used");
          },
          ensureDirectory: async () => {
            throw new Error("not used");
          },
          list: async () => [],
          saveFakeGenerated: async () => {
            throw new Error("not used");
          },
          moveToCollection: async () => {
            throw new Error("not used");
          },
          listMoves: async () => []
        },
        execution: {
          run: async () => {
            throw new Error("not used");
          }
        }
      }
    });
  });
  await page.goto("/");

  await page.getByLabel("Parent directory").fill("C:\\Fake");
  await page.getByRole("button", { name: "Create" }).click();
  await page.keyboard.press("Delete");

  await expect(page.getByTestId("ether-node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.getByTestId("canvas-status")).toContainText(
    "Unlock connected nodes before changing relationships"
  );
});

test("generation node previews prompt inputs from a connected prompt", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();
  await page.getByLabel("Instruction").fill("cinematic skincare campaign");
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();
  await page.getByTestId("ether-node").getByRole("heading", { name: "Image" }).click();

  await expect(page.getByTestId("inspector-assembly-preview")).toContainText(
    "Prepared Generation Inputs"
  );
  await expect(page.getByTestId("inspector-assembly-preview")).toContainText(
    "cinematic skincare campaign"
  );
});

test("shows disabled manual asset validation controls until a project is open", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-generation-image").click();
  await expect(page.getByRole("button", { name: "Save fake output" })).toBeDisabled();

  await page.locator("summary").filter({ hasText: "Store" }).click();
  await page.getByTestId("library-node-store-collection").click();
  await expect(page.getByRole("button", { name: "Mirror" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Move pending generated" })).toBeDisabled();
});

test("manual generated move consumes the pending generated asset once", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & { __moveCalls: number };
    const graph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Manual.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Manual",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Manual.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(testWindow, {
      __moveCalls: 0,
      ether: {
        shell: "desktop",
        file: {
          getDroppedFilePath: () => null
        },
        project: {
          create: async () => project,
          open: async () => project,
          saveGraph: async () => graph,
          loadGraph: async () => graph,
          health: async () => ({ issues: [] })
        },
        asset: {
          selectReferenceImage: async () => null,
          linkDroppedReference: async () => {
            throw new Error("not used");
          },
          ensureCollection: async () => ({
            id: "collection-asset-1",
            kind: "collection",
            path: "C:\\Fake\\Manual.ether\\collections\\Collection",
            metadata: {},
            createdAt: "2026-06-17T12:00:00.000Z",
            updatedAt: "2026-06-17T12:00:00.000Z"
          }),
          ensureDirectory: async () => {
            throw new Error("not used");
          },
          list: async () => [],
          saveFakeGenerated: async () => ({
            id: "generated-asset-1",
            kind: "generated",
            path: "C:\\Fake\\Manual.ether\\assets\\generated\\fake.png",
            metadata: {},
            createdAt: "2026-06-17T12:00:00.000Z",
            updatedAt: "2026-06-17T12:00:00.000Z"
          }),
          moveToCollection: async () => {
            testWindow.__moveCalls += 1;
            return {
              id: "generated-asset-1",
              kind: "generated",
              path: `C:\\Fake\\Manual.ether\\collections\\Collection\\fake-${testWindow.__moveCalls}.png`,
              metadata: {},
              createdAt: "2026-06-17T12:00:00.000Z",
              updatedAt: `2026-06-17T12:00:0${testWindow.__moveCalls}.000Z`
            };
          },
          listMoves: async () => []
        }
      }
    });
  });
  await page.goto("/");

  await page.getByLabel("Parent directory").fill("C:\\Fake");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Save fake output" }).click();
  await page.locator("summary").filter({ hasText: "Store" }).click();
  await page.getByTestId("library-node-store-collection").click();
  await page.getByRole("button", { name: "Move pending generated" }).click();
  await page.getByRole("button", { name: "Move pending generated" }).click();

  await expect(page.getByTestId("canvas-status")).toContainText("No pending generated output to move");
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __moveCalls: number }).__moveCalls))
    .toBe(1);
});

test("creates an edge and edits the visible edge label", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();

  await expect(page.getByText("prompt", { exact: true })).toBeVisible();
  await page.getByTestId("inspector-edge-label").fill("brief");
  await expect(page.getByText("brief", { exact: true })).toBeVisible();
});

test("Delete key removes the selected node", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();
  await expect(page.getByTestId("ether-node")).toHaveCount(1);

  await page.keyboard.press("Delete");

  await expect(page.getByTestId("ether-node")).toHaveCount(0);
});

test("undo and redo restore and remove a node", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("library-node-prompt-general").click();
  await expect(page.getByTestId("ether-node")).toHaveCount(1);

  await page.getByTestId("canvas-undo").click();
  await expect(page.getByTestId("ether-node")).toHaveCount(0);

  await page.getByTestId("canvas-redo").click();
  await expect(page.getByTestId("ether-node")).toHaveCount(1);
});

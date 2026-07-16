import { expect, type Page, test } from "@playwright/test";

async function installDefaultProjectBridge(page: Page) {
  await page.addInitScript(() => {
    const makeProject = (name = "Smoke Project", projectPath = `C:\\Fake\\${name}.ether`) => {
      const graph = {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        selectedSnapshotId: null,
        updatedAt: "2026-06-17T12:00:00.000Z"
      };

      return {
        projectId: "11111111-1111-4111-8111-111111111111",
        path: projectPath,
        metadata: {
          id: "22222222-2222-4222-8222-222222222222",
          displayName: name,
          appVersion: "0.1.0",
          createdAt: "2026-06-17T12:00:00.000Z",
          updatedAt: "2026-06-17T12:00:00.000Z",
          brandLockup: "ETHER by DreamBay",
          autosave: { enabled: true, intervalMs: 60000 },
          providerPreferences: {},
          activeSnapshotId: null
        },
        graph,
        database: { path: `${projectPath}\\ether.db`, tables: [], healthIssueCount: 0 }
      };
    };

    Object.assign(window, {
      __lastSavedGraph: null,
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        project: {
          selectParentDirectory: async () => "C:\\Fake",
          selectProjectBundle: async () => "C:\\Fake\\Smoke Project.ether",
          create: async (options: { name: string; parentDirectory: string }) =>
            makeProject(options.name, `${options.parentDirectory}\\${options.name}.ether`),
          open: async (projectPath: string) => makeProject("Smoke Project", projectPath),
          saveGraph: async (_projectId: string, graph: unknown) => {
            (window as any).__lastSavedGraph = graph;
            return graph;
          },
          loadGraph: async () => ({
            nodes: [],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
            selectedSnapshotId: null,
            updatedAt: "2026-06-17T12:00:00.000Z"
          }),
          health: async () => ({ issues: [] })
        },
        settings: {
          load: async () => ({
            parentDirectory: "C:\\Fake",
            projectName: "Smoke Project",
            projectPath: "",
            recentProjects: []
          }),
          save: async (settings: unknown) => settings
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
          saveFakeGenerated: async () => ({
            id: "generated-asset-1",
            kind: "generated",
            path: "C:\\Fake\\Smoke Project.ether\\assets\\generated\\fake.png",
            metadata: {},
            createdAt: "2026-06-17T12:00:00.000Z",
            updatedAt: "2026-06-17T12:00:00.000Z"
          }),
          saveMask: async () => {
            throw new Error("not used");
          },
          moveToCollection: async () => {
            throw new Error("not used");
          },
          listMoves: async () => []
        },
        execution: {
          preview: async () => ({
            plan: {
              policy: "cached-inputs",
              targetNodeIds: ["generation"],
              nodeIds: ["generation"],
              items: [{ nodeId: "generation", iteration: 1 }],
              parallel: true,
              runCountCap: 2
            },
            dirtyNodeIds: ["generation"],
            providerCallCandidates: ["generation"],
            expectedOutputCount: 2,
            blockedReasons: [],
            items: [
              { nodeId: "generation", iteration: 1, kind: "Generation", willCallProvider: true },
              { nodeId: "generation", iteration: 2, kind: "Generation", willCallProvider: true }
            ]
          }),
          run: async () => {
            throw new Error("not used");
          }
        }
      }
    });
  });
}

async function createProjectFromStart(page: Page, name = "Smoke Project") {
  await expect(page.getByTestId("start-screen")).toBeVisible();
  await page.evaluate(() => {
    const projectBridge = (window as any).ether?.project;

    if (projectBridge && !projectBridge.defaultParentDirectory) {
      projectBridge.defaultParentDirectory = async () => "C:\\Fake";
    }
  });
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Create Project" }).click();
  await expect(page.getByTestId("project-header")).toBeVisible();
}

async function openEmptyProject(page: Page, name = "Smoke Project") {
  await installDefaultProjectBridge(page);
  await page.goto("/");
  await createProjectFromStart(page, name);
}

async function openProjectWithGraph(page: Page, graph: any, name = "Smoke Project") {
  await page.addInitScript(({ initialGraph, projectName }) => {
    const testWindow = window as typeof window & { __lastSavedGraph: any };
    const projectPath = `C:\\Fake\\${projectName}.ether`;
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: projectPath,
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: projectName,
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph: initialGraph,
      database: { path: `${projectPath}\\ether.db`, tables: [], healthIssueCount: 0 }
    };

    Object.assign(window, {
      __lastSavedGraph: null,
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        project: {
          selectParentDirectory: async () => "C:\\Fake",
          selectProjectBundle: async () => projectPath,
          create: async () => ({ ...project, graph: testWindow.__lastSavedGraph ?? initialGraph }),
          open: async () => ({ ...project, graph: testWindow.__lastSavedGraph ?? initialGraph }),
          saveGraph: async (_projectId: string, nextGraph: unknown) => {
            testWindow.__lastSavedGraph = nextGraph;
            return nextGraph;
          },
          loadGraph: async () => testWindow.__lastSavedGraph ?? initialGraph,
          health: async () => ({ issues: [] })
        },
        settings: {
          load: async () => ({
            parentDirectory: "C:\\Fake",
            projectName,
            projectPath: "",
            recentProjects: []
          }),
          save: async (settings: unknown) => settings
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
          saveMask: async () => {
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
  }, { initialGraph: graph, projectName: name });

  await page.goto("/");
  await createProjectFromStart(page, name);
}

async function dragElementBy(page: Page, testId: string, deltaX: number, deltaY: number) {
  const box = await page.getByTestId(testId).boundingBox();

  if (!box) {
    throw new Error(`${testId} was not measurable.`);
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2 + deltaY, {
    steps: 6
  });
  await page.mouse.up();
}

async function setRangeInput(page: Page, label: string, value: string) {
  await page.getByLabel(label).evaluate((input, nextValue) => {
    const element = input as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

    valueSetter?.call(element, String(nextValue));
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await expect(page.getByLabel(label)).toHaveValue(value);
}

async function drawMaskStroke(page: Page) {
  const overlay = page.getByTestId("mask-canvas-overlay");
  const box = await overlay.boundingBox();

  if (!box) {
    throw new Error("Mask overlay surface was not measurable.");
  }

  await overlay.click({ position: { x: box.width * 0.42, y: box.height * 0.48 } });
}

async function drawMaskStrokePastSecondaryPointer(page: Page) {
  const overlay = page.getByTestId("mask-canvas-overlay");
  const box = await overlay.boundingBox();

  if (!box) {
    throw new Error("Mask overlay surface was not measurable.");
  }

  await overlay.evaluate(
    (element, points) => {
      const dispatchPointer = (
        type: string,
        pointerId: number,
        isPrimary: boolean,
        x: number,
        y: number,
        buttons: number
      ) => {
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId,
            isPrimary,
            pointerType: "pen",
            button: type === "pointermove" ? -1 : 0,
            buttons,
            clientX: x,
            clientY: y
          })
        );
      };

      dispatchPointer("pointerdown", 1, true, points.startX, points.startY, 1);
      dispatchPointer("pointerdown", 2, false, points.startX + 10, points.startY + 10, 1);
      dispatchPointer("pointerup", 2, false, points.startX + 10, points.startY + 10, 0);
      dispatchPointer("pointermove", 1, true, points.endX, points.endY, 1);
      dispatchPointer("pointerup", 1, true, points.endX, points.endY, 0);
    },
    {
      startX: box.x + box.width * 0.3,
      startY: box.y + box.height * 0.42,
      endX: box.x + box.width * 0.56,
      endY: box.y + box.height * 0.58
    }
  );
}

async function drawNoteStroke(page: Page) {
  const surface = page.getByTestId("note-stroke-surface");
  const box = await surface.boundingBox();

  if (!box) {
    throw new Error("Note drawing surface was not measurable.");
  }

  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.58, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.38, { steps: 4 });
  await page.mouse.up();
}

test("shows the start screen actions, provider status, and no canvas before a project opens", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "ETHER" })).toBeVisible();
  await expect(page.getByTestId("start-screen")).toBeVisible();
  await expect(page.getByRole("button", { name: "New Project" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Project" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try Sample" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check Providers" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recover Project" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent Projects" })).toBeVisible();
  await expect(page.getByTestId("provider-status-panel")).toBeVisible();
  await expect(page.getByTestId("provider-status-row-ether-fake-local")).toContainText("Simulation Mode");
  await expect(page.getByTestId("provider-status-row-api-image-generation")).toContainText(
    "Optional API generation"
  );
  await expect(page.getByTestId("provider-status-row-google-nano-banana-pro")).toContainText(
    "Experimental / unavailable"
  );
  await expect(page.locator(".react-flow")).toHaveCount(0);
});

test("creates and opens a project through the native-backed start screen flow", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __selectedParent: number;
      __createdOptions: unknown;
      __savedSettings: unknown[];
    };

    const graph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };

    Object.assign(testWindow, {
      __selectedParent: 0,
      __createdOptions: null,
      __savedSettings: [],
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        settings: {
          load: async () => ({
            parentDirectory: "",
            projectName: "Untitled Ether Project",
            projectPath: "",
            recentProjects: []
          }),
          save: async (settings: unknown) => {
            testWindow.__savedSettings.push(settings);
            return settings;
          }
        },
        project: {
          selectParentDirectory: async () => {
            testWindow.__selectedParent += 1;
            return "C:\\Picked";
          },
          selectProjectBundle: async () => null,
          create: async (options: { parentDirectory: string; name: string }) => {
            testWindow.__createdOptions = options;

            return {
              projectId: "11111111-1111-4111-8111-111111111111",
              path: `${options.parentDirectory}\\${options.name}.ether`,
              metadata: {
                id: "22222222-2222-4222-8222-222222222222",
                displayName: options.name,
                appVersion: "0.1.0",
                createdAt: "2026-06-17T12:00:00.000Z",
                updatedAt: "2026-06-17T12:00:00.000Z",
                brandLockup: "ETHER by DreamBay",
                autosave: { enabled: true, intervalMs: 60000 },
                providerPreferences: {},
                activeSnapshotId: null
              },
              graph,
              database: { path: `${options.parentDirectory}\\${options.name}.ether\\ether.db`, tables: [], healthIssueCount: 0 }
            };
          },
          open: async () => {
            throw new Error("not used");
          },
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
          saveMask: async () => {
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
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByRole("button", { name: "Choose Parent Folder" }).click();
  await page.getByLabel("Project name").fill("Native Campaign");
  await page.getByRole("button", { name: "Create Project" }).click();

  await expect(page.getByTestId("project-header")).toContainText("Native Campaign");
  await expect(page.getByTestId("project-header")).toContainText("Project created");
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __selectedParent: number }).__selectedParent))
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __createdOptions: unknown }).__createdOptions))
    .toMatchObject({ parentDirectory: "C:\\Picked", name: "Native Campaign" });
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __savedSettings: any[] }).__savedSettings.at(-1)))
    .toMatchObject({ recentProjects: ["C:\\Picked\\Native Campaign.ether"] });
});

test("creates a first-run project in the native default parent without choosing a folder", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __createdOptions: unknown;
    };

    const graph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };

    Object.assign(testWindow, {
      __createdOptions: null,
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        settings: {
          load: async () => ({
            parentDirectory: "",
            projectName: "Untitled Ether Project",
            projectPath: "",
            recentProjects: []
          }),
          save: async (settings: unknown) => settings
        },
        project: {
          defaultParentDirectory: async () => "C:\\Users\\Tester\\Documents\\Ether Projects",
          selectParentDirectory: async () => {
            throw new Error("not used");
          },
          selectProjectBundle: async () => null,
          create: async (options: { parentDirectory: string; name: string }) => {
            testWindow.__createdOptions = options;

            return {
              projectId: "11111111-1111-4111-8111-111111111111",
              path: `${options.parentDirectory}\\${options.name}.ether`,
              metadata: {
                id: "22222222-2222-4222-8222-222222222222",
                displayName: options.name,
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
                path: `${options.parentDirectory}\\${options.name}.ether\\ether.db`,
                tables: [],
                healthIssueCount: 0
              }
            };
          },
          open: async () => {
            throw new Error("not used");
          },
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
          saveMask: async () => {
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
  await page.getByRole("button", { name: "New Project" }).click();
  await page.getByLabel("Project name").fill("Immediate Campaign");
  await page.getByRole("button", { name: "Create Project" }).click();

  await expect(page.getByTestId("project-header")).toContainText("Immediate Campaign");
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __createdOptions: unknown }).__createdOptions))
    .toMatchObject({
      parentDirectory: "C:\\Users\\Tester\\Documents\\Ether Projects",
      name: "Immediate Campaign"
    });
});

test("opens a .ether bundle through the native-backed open flow", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & { __openedPath: string | null };
    const graph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };

    Object.assign(testWindow, {
      __openedPath: null,
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        settings: {
          load: async () => ({
            parentDirectory: "C:\\Ether",
            projectName: "Untitled Ether Project",
            projectPath: "",
            recentProjects: []
          }),
          save: async (settings: unknown) => settings
        },
        project: {
          selectParentDirectory: async () => null,
          selectProjectBundle: async () => "C:\\Picked\\Opened.ether",
          create: async () => {
            throw new Error("not used");
          },
          open: async (projectPath: string) => {
            testWindow.__openedPath = projectPath;

            return {
              projectId: "11111111-1111-4111-8111-111111111111",
              path: projectPath,
              metadata: {
                id: "22222222-2222-4222-8222-222222222222",
                displayName: "Opened",
                appVersion: "0.1.0",
                createdAt: "2026-06-17T12:00:00.000Z",
                updatedAt: "2026-06-17T12:00:00.000Z",
                brandLockup: "ETHER by DreamBay",
                autosave: { enabled: true, intervalMs: 60000 },
                providerPreferences: {},
                activeSnapshotId: null
              },
              graph,
              database: { path: `${projectPath}\\ether.db`, tables: [], healthIssueCount: 0 }
            };
          },
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
          saveMask: async () => {
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
  await page.getByRole("button", { name: "Open Project" }).click();

  await expect(page.getByTestId("project-header")).toContainText("Opened");
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __openedPath: string | null }).__openedPath))
    .toBe("C:\\Picked\\Opened.ether");
});

test("opens recent projects from the start screen", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & { __openedPath: string | null };
    const graph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };

    Object.assign(testWindow, {
      __openedPath: null,
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        settings: {
          load: async () => ({
            parentDirectory: "C:\\Ether",
            projectName: "Untitled Ether Project",
            projectPath: "",
            recentProjects: ["C:\\Ether\\Recent Campaign.ether"]
          }),
          save: async (settings: unknown) => settings
        },
        project: {
          create: async () => {
            throw new Error("not used");
          },
          open: async (projectPath: string) => {
            testWindow.__openedPath = projectPath;

            return {
              projectId: "11111111-1111-4111-8111-111111111111",
              path: projectPath,
              metadata: {
                id: "22222222-2222-4222-8222-222222222222",
                displayName: "Recent Campaign",
                appVersion: "0.1.0",
                createdAt: "2026-06-17T12:00:00.000Z",
                updatedAt: "2026-06-17T12:00:00.000Z",
                brandLockup: "ETHER by DreamBay",
                autosave: { enabled: true, intervalMs: 60000 },
                providerPreferences: {},
                activeSnapshotId: null
              },
              graph,
              database: { path: `${projectPath}\\ether.db`, tables: [], healthIssueCount: 0 }
            };
          },
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
          saveMask: async () => {
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
  await page.getByRole("button", { name: /Recent Campaign/ }).click();

  await expect(page.getByTestId("project-header")).toContainText("Recent Campaign");
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __openedPath: string | null }).__openedPath))
    .toBe("C:\\Ether\\Recent Campaign.ether");
});

test("renders a thin project header and keeps canvas as the growing area", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await openEmptyProject(page);

  const headerBox = await page.getByTestId("project-header").boundingBox();
  const workspaceBox = await page.getByTestId("canvas-workspace").boundingBox();
  const headerResizeMode = await page.getByTestId("project-header").evaluate((element) =>
    getComputedStyle(element).resize
  );
  const traceResizeMode = await page.getByTestId("panel-run-trace").evaluate((element) =>
    getComputedStyle(element).resize
  );

  expect(headerBox?.height).toBeLessThan(100);
  expect(workspaceBox?.height).toBeGreaterThan(560);
  expect(headerResizeMode).toBe("none");
  expect(traceResizeMode).toBe("none");
  await expect(page.getByTestId("project-header-resize")).toHaveAttribute("role", "separator");
  await expect(page.getByTestId("project-header-resize")).toHaveAttribute("aria-label", "Resize top toolbox");
  await expect(page.getByTestId("run-trace-resize")).toHaveAttribute("role", "separator");
  await expect(page.getByTestId("run-trace-resize")).toHaveAttribute("aria-label", "Resize run trace");
  await expect(page.getByRole("button", { name: "Command Palette" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check Health" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Graph" })).toBeVisible();
});

test("toolbox panels hide, restore, and resize with canvas adjusting", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await openEmptyProject(page);

  const initialHeader = await page.getByTestId("project-header").boundingBox();
  const initialTrace = await page.getByTestId("panel-run-trace").boundingBox();
  const initialWorkspace = await page.getByTestId("canvas-workspace").boundingBox();

  await page.getByTestId("panel-project-header-toggle").click();
  await expect(page.getByTestId("project-header")).toHaveCount(0);
  await expect(page.getByTestId("panel-project-header-toggle")).toHaveAccessibleName("Show top toolbox");
  await page.getByTestId("panel-project-header-toggle").click();
  await expect(page.getByTestId("project-header")).toBeVisible();

  await page.getByTestId("panel-run-trace-toggle").click();
  await expect(page.getByTestId("panel-run-trace")).toHaveCount(0);
  await expect(page.getByTestId("panel-run-trace-toggle")).toHaveAccessibleName("Show run trace");
  await page.getByTestId("panel-run-trace-toggle").click();
  await expect(page.getByTestId("panel-run-trace")).toBeVisible();

  await dragElementBy(page, "project-header-resize", 0, 54);
  const tallerHeader = await page.getByTestId("project-header").boundingBox();
  const workspaceAfterHeaderDrag = await page.getByTestId("canvas-workspace").boundingBox();

  expect(tallerHeader?.height ?? 0).toBeGreaterThan((initialHeader?.height ?? 0) + 32);
  expect(workspaceAfterHeaderDrag?.height ?? 0).toBeLessThan((initialWorkspace?.height ?? 0) - 24);

  await dragElementBy(page, "run-trace-resize", 0, -66);
  const tallerTrace = await page.getByTestId("panel-run-trace").boundingBox();
  const workspaceAfterTraceDrag = await page.getByTestId("canvas-workspace").boundingBox();

  expect(tallerTrace?.height ?? 0).toBeGreaterThan((initialTrace?.height ?? 0) + 42);
  expect(workspaceAfterTraceDrag?.height ?? 0).toBeLessThan(
    (workspaceAfterHeaderDrag?.height ?? 0) - 34
  );
});

test("panel splitters honor app clamps on a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 560 });
  await openEmptyProject(page);

  await dragElementBy(page, "run-trace-resize", 0, -360);
  await dragElementBy(page, "project-header-resize", 0, 360);

  const headerBox = await page.getByTestId("project-header").boundingBox();
  const traceBox = await page.getByTestId("panel-run-trace").boundingBox();

  expect(headerBox?.height ?? 0).toBeGreaterThan(170);
  expect(headerBox?.height ?? 0).toBeLessThanOrEqual(181);
  expect(traceBox?.height ?? 0).toBeGreaterThan(305);
  expect(traceBox?.height ?? 0).toBeLessThanOrEqual(315);
});

test("splitter separators expose keyboard resizing controls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await openEmptyProject(page);

  await expect(page.getByTestId("project-header-resize")).toHaveAttribute("tabindex", "0");
  await expect(page.getByTestId("project-header-resize")).toHaveAttribute("aria-orientation", "horizontal");
  await expect(page.getByTestId("run-trace-resize")).toHaveAttribute("tabindex", "0");
  await expect(page.getByTestId("run-trace-resize")).toHaveAttribute("aria-orientation", "horizontal");
  await expect(page.getByTestId("panel-node-library-resize")).toHaveAttribute("tabindex", "0");
  await expect(page.getByTestId("panel-node-library-resize")).toHaveAttribute("aria-orientation", "vertical");
  await expect(page.getByTestId("panel-inspector-resize")).toHaveAttribute("tabindex", "0");
  await expect(page.getByTestId("panel-inspector-resize")).toHaveAttribute("aria-orientation", "vertical");

  const initialHeader = await page.getByTestId("project-header").boundingBox();
  await page.getByTestId("project-header-resize").press("ArrowDown");
  const keyboardHeader = await page.getByTestId("project-header").boundingBox();
  expect(keyboardHeader?.height ?? 0).toBeGreaterThan((initialHeader?.height ?? 0) + 6);

  const initialTrace = await page.getByTestId("panel-run-trace").boundingBox();
  await page.getByTestId("run-trace-resize").press("ArrowUp");
  const keyboardTrace = await page.getByTestId("panel-run-trace").boundingBox();
  expect(keyboardTrace?.height ?? 0).toBeGreaterThan((initialTrace?.height ?? 0) + 6);

  const initialLibrary = await page.getByTestId("panel-node-library").boundingBox();
  await page.getByTestId("panel-node-library-resize").press("ArrowRight");
  const keyboardLibrary = await page.getByTestId("panel-node-library").boundingBox();
  expect(keyboardLibrary?.width ?? 0).toBeGreaterThan((initialLibrary?.width ?? 0) + 6);

  const initialInspector = await page.getByTestId("panel-inspector").boundingBox();
  await page.getByTestId("panel-inspector-resize").press("ArrowLeft");
  const keyboardInspector = await page.getByTestId("panel-inspector").boundingBox();
  expect(keyboardInspector?.width ?? 0).toBeGreaterThan((initialInspector?.width ?? 0) + 6);
});

test("inspector action buttons stay readable at narrow widths", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await openEmptyProject(page);
  await page.getByTestId("library-node-prompt-prompt").click();
  await dragElementBy(page, "panel-inspector-resize", 500, 0);

  const inspectorBox = await page.getByTestId("panel-inspector").boundingBox();
  expect(inspectorBox?.width).toBeLessThanOrEqual(304);

  const actionButtons = page.locator(".execution-actions .run-node-button");
  await expect(actionButtons).toHaveCount(6);

  const readability = await actionButtons.evaluateAll((buttons) =>
    buttons.map((button) => {
      const element = button as HTMLElement;
      const rect = element.getBoundingClientRect();

      return {
        text: element.innerText.trim(),
        width: rect.width,
        height: rect.height,
        overflows: element.scrollWidth > element.clientWidth + 1
      };
    })
  );

  for (const button of readability) {
    expect(button.text.length).toBeGreaterThan(3);
    expect(button.width).toBeGreaterThanOrEqual(86);
    expect(button.height).toBeLessThanOrEqual(68);
    expect(button.overflows).toBe(false);
  }
});

test("minimap stays adjacent to the visible inspector when the inspector is resized", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await openEmptyProject(page);

  const initialMinimap = await page.locator(".react-flow__minimap").boundingBox();
  const initialInspector = await page.getByTestId("panel-inspector").boundingBox();

  expect(initialMinimap?.x && initialMinimap?.width && initialInspector?.x).toBeTruthy();
  expect((initialMinimap?.x ?? 0) + (initialMinimap?.width ?? 0)).toBeLessThanOrEqual(
    (initialInspector?.x ?? 0) - 1
  );

  await dragElementBy(page, "panel-inspector-resize", -120, 0);

  const resizedMinimap = await page.locator(".react-flow__minimap").boundingBox();
  const resizedInspector = await page.getByTestId("panel-inspector").boundingBox();

  expect(resizedInspector?.width ?? 0).toBeGreaterThan((initialInspector?.width ?? 0) + 90);
  expect((resizedMinimap?.x ?? 0) + (resizedMinimap?.width ?? 0)).toBeLessThanOrEqual(
    (resizedInspector?.x ?? 0) - 1
  );
  expect(resizedMinimap?.x ?? 0).toBeLessThan((initialMinimap?.x ?? 0) - 80);
});

test("minimap offset follows the rendered inspector after a narrow viewport resize", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await openEmptyProject(page);
  await dragElementBy(page, "panel-inspector-resize", -520, 0);

  await page.setViewportSize({ width: 520, height: 720 });

  const minimap = await page.locator(".react-flow__minimap").boundingBox();
  const inspector = await page.getByTestId("panel-inspector").boundingBox();
  const minimapRight = (minimap?.x ?? 0) + (minimap?.width ?? 0);
  const inspectorLeft = inspector?.x ?? 0;
  const gap = inspectorLeft - minimapRight;

  expect(inspector?.width ?? 0).toBeLessThan(500);
  expect(minimapRight).toBeLessThanOrEqual(inspectorLeft - 1);
  expect(gap).toBeLessThan(90);
});

test("opens project health panel and confirms privacy cleanup actions", async ({ page }) => {
  await openEmptyProject(page, "Health Project");
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __healthIssues: Array<{
        id: string;
        code: string;
        severity: "warning" | "error";
        message: string;
        path: string | null;
        detectedAt: string;
      }>;
      __providerLogClears: number;
      __runArtifactClears: number;
    };

    testWindow.__providerLogClears = 0;
    testWindow.__runArtifactClears = 0;
    testWindow.__healthIssues = [
      {
        id: "issue-provider-logs",
        code: "PROVIDER_LOGS_RETAINED",
        severity: "warning",
        message: "Provider logs retain request and response payloads.",
        path: "C:\\Fake\\Health Project.ether\\ether.db",
        detectedAt: "2026-06-26T10:00:00.000Z"
      },
      {
        id: "issue-artifact-missing",
        code: "ARTIFACT_FILE_MISSING",
        severity: "error",
        message: "Artifact file is missing from disk.",
        path: "C:\\Fake\\Health Project.ether\\assets\\generated\\missing.png",
        detectedAt: "2026-06-26T10:00:00.000Z"
      }
    ];
    (testWindow.ether.project as any).health = async () => ({ issues: testWindow.__healthIssues });
    (testWindow.ether.project as any).clearProviderLogs = async () => {
      testWindow.__providerLogClears += 1;
      testWindow.__healthIssues = testWindow.__healthIssues.filter(
        (issue) => issue.code !== "PROVIDER_LOGS_RETAINED"
      );
      return { deletedProviderRuns: 2 };
    };
    (testWindow.ether.project as any).clearRunArtifacts = async () => {
      testWindow.__runArtifactClears += 1;
      return { deletedRunRecords: 1, deletedRunArtifacts: 1 };
    };
  });

  await page.getByRole("button", { name: "Check Health" }).click();

  await expect(page.getByTestId("project-health-panel")).toBeVisible();
  await expect(page.getByTestId("project-health-panel")).toContainText("ARTIFACT_FILE_MISSING");
  await expect(page.getByTestId("project-health-panel")).toContainText(
    "C:\\Fake\\Health Project.ether\\assets\\generated\\missing.png"
  );
  await expect(page.getByTestId("project-health-action-clear-provider-logs")).toBeVisible();
  await expect(page.getByTestId("project-health-action-clear-run-artifacts")).toBeVisible();

  await page.getByTestId("project-health-action-clear-provider-logs").click();
  await expect(page.getByTestId("project-health-confirm-provider-logs")).toBeVisible();
  await page.getByTestId("project-health-confirm-provider-logs").click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __providerLogClears: number }).__providerLogClears))
    .toBe(1);
  await expect(page.getByTestId("project-health-panel")).not.toContainText("PROVIDER_LOGS_RETAINED");

  await page.getByTestId("project-health-action-clear-run-artifacts").click();
  await expect(page.getByTestId("project-health-confirm-run-artifacts")).toBeVisible();
  await page.getByTestId("project-health-confirm-run-artifacts").click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __runArtifactClears: number }).__runArtifactClears))
    .toBe(1);
});

test("keeps run metadata cleanup disabled for provider-log-only health issues", async ({ page }) => {
  await openEmptyProject(page, "Provider Logs Only");
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __providerLogClears: number;
      __runArtifactClears: number;
    };

    testWindow.__providerLogClears = 0;
    testWindow.__runArtifactClears = 0;
    (testWindow.ether.project as any).health = async () => ({
      issues: [
        {
          id: "issue-provider-logs-only",
          code: "PROVIDER_LOGS_RETAINED",
          severity: "warning",
          message: "Provider logs retain request and response payloads.",
          path: "C:\\Fake\\Provider Logs Only.ether\\ether.db",
          detectedAt: "2026-06-26T10:00:00.000Z"
        }
      ]
    });
    (testWindow.ether.project as any).clearProviderLogs = async () => {
      testWindow.__providerLogClears += 1;
      return { deletedProviderRuns: 1 };
    };
    (testWindow.ether.project as any).clearRunArtifacts = async () => {
      testWindow.__runArtifactClears += 1;
      return { deletedRunRecords: 1 };
    };
  });

  await page.getByRole("button", { name: "Check Health" }).click();

  await expect(page.getByTestId("project-health-panel")).toContainText("PROVIDER_LOGS_RETAINED");
  await expect(page.getByTestId("project-health-action-clear-provider-logs")).toBeEnabled();
  await expect(page.getByTestId("project-health-action-clear-run-artifacts")).toBeDisabled();

  await page.getByTestId("project-health-action-clear-run-artifacts").click({ force: true });
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __runArtifactClears: number }).__runArtifactClears))
    .toBe(0);
});

test("renders the React Flow canvas, library, inspector, run panel, and minimap after opening a project", async ({ page }) => {
  await openEmptyProject(page);

  await expect(page.locator(".react-flow")).toBeVisible();
  await expect(page.locator(".react-flow__minimap")).toBeVisible();
  await expect(page.getByTestId("panel-node-library")).toBeVisible();
  await expect(page.getByTestId("panel-inspector")).toBeVisible();
  await expect(page.getByTestId("panel-run-trace")).toBeVisible();
  await expect(page.getByTestId("panel-node-library-toggle")).toBeVisible();
  await expect(page.getByTestId("panel-inspector-toggle")).toBeVisible();
  await expect(page.getByTestId("panel-project-header-toggle")).toBeVisible();
  await expect(page.getByTestId("panel-run-trace-toggle")).toBeVisible();

  await page.getByTestId("panel-inspector-toggle").click();
  await expect(page.getByTestId("panel-inspector")).toHaveCount(0);
  await page.getByRole("button", { name: "Show inspector" }).click();
  await expect(page.getByTestId("panel-inspector")).toBeVisible();

  await page.getByTestId("panel-run-trace-toggle").click();
  await expect(page.getByTestId("panel-run-trace")).toHaveCount(0);
  await page.getByTestId("panel-run-trace-toggle").click();
  await expect(page.getByTestId("panel-run-trace")).toBeVisible();
});

test("creates a node from the library and selects it", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();

  await expect(page.getByTestId("ether-node")).toHaveCount(1);
  await expect(page.getByTestId("ether-node").getByRole("heading", { name: "Prompt" })).toBeVisible();
  await expect(page.getByTestId("canvas-status")).toContainText("Selected Prompt");
});

test("left-clicking empty canvas clears selected nodes", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await expect(page.locator(".ether-node.is-selected")).toHaveCount(1);

  const canvasBox = await page.locator(".react-flow").boundingBox();
  expect(canvasBox).not.toBeNull();

  await page.mouse.click(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height / 2);

  await expect(page.locator(".ether-node.is-selected")).toHaveCount(0);
  await expect(page.getByTestId("canvas-status")).toContainText("Canvas ready");
});

test("new nodes are tall enough to space six channel dots cleanly", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();

  const nodeBox = await page.getByTestId("ether-node").boundingBox();
  expect(nodeBox).not.toBeNull();
  expect(nodeBox!.height).toBeGreaterThanOrEqual(180);
});

test("renders six channel rail affordances without typed labels at rest", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByTestId("library-node-generation-image").click();

  const channels = ["text", "image", "mask", "data", "video", "audio"];

  await expect(page.locator(".typed-port-label")).toHaveCount(0);
  await expect(page.locator(".typed-port-state")).toHaveCount(0);

  for (const channel of channels) {
    await expect(page.getByTestId(`channel-zone-output-${channel}`).first()).toBeVisible();
    await expect(page.getByTestId(`channel-zone-input-${channel}`).first()).toBeVisible();
  }

  await expect
    .poll(() =>
      page.getByTestId("channel-zone-output-text").first().locator(".channel-handle-dot").evaluate((element) => getComputedStyle(element).opacity)
    )
    .toBe("0");
  await expect(page.locator(".channel-zone-label").filter({ hasText: "Text" })).toHaveCount(0);
  await page.getByTestId("channel-zone-output-text").first().focus();
  await expect(page.locator(".channel-zone-label").filter({ hasText: "Text" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Connect first valid pair" }).click();
  await expect
    .poll(() =>
      page.getByTestId("channel-zone-output-text").first().locator(".channel-handle-dot").evaluate((element) => getComputedStyle(element).opacity)
    )
    .toBe("1");
  await expect
    .poll(() =>
      page.getByTestId("channel-zone-input-text").nth(1).locator(".channel-handle-dot").evaluate((element) => getComputedStyle(element).opacity)
    )
    .toBe("1");
  await expect
    .poll(() =>
      page.getByTestId("channel-zone-output-image").first().locator(".channel-handle-dot").evaluate((element) => getComputedStyle(element).opacity)
    )
    .toBe("0");
});

test("empty canvas offers starter node and template actions", async ({ page }) => {
  await openEmptyProject(page);

  await expect(page.getByRole("button", { name: "Drop Prompt" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Drop Image" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose Template" })).toBeVisible();

  await page.getByRole("button", { name: "Drop Prompt" }).click();

  await expect(page.getByTestId("ether-node")).toHaveCount(1);
  await expect(page.getByTestId("ether-node").getByRole("heading", { name: "Prompt" })).toBeVisible();
});

test("searches nodes by name in the searchable palette", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("node-palette-search").fill("mutator");

  await expect(page.getByTestId("library-node-prompt-mutator")).toBeVisible();
  await expect(page.getByTestId("library-node-prompt-prompt")).toHaveCount(0);
});

test("adds a node from the searchable palette", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("node-palette-search").fill("character");
  await page.getByTestId("library-node-generation-character-sheet").click();

  await expect(page.getByTestId("ether-node")).toHaveCount(1);
  await expect(page.getByTestId("ether-node").getByRole("heading", { name: "Character Sheet" })).toBeVisible();
  await expect(page.getByTestId("canvas-status")).toContainText("Selected Character Sheet");
});

test("adds a template from the gallery", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByRole("button", { name: "Choose Template" }).click();
  await page.getByTestId("template-card-prompt-to-image").click();

  await expect(page.getByTestId("ether-node")).toHaveCount(2);
  await expect(page.getByTestId("ether-node").getByRole("heading", { name: "Prompt" })).toBeVisible();
  await expect(page.getByTestId("ether-node").getByRole("heading", { name: "Image" })).toBeVisible();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.getByTestId("edge-role-chip")).toContainText("General");

  await page.getByRole("button", { name: "Save Graph" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__lastSavedGraph?.edges?.[0]))
    .toMatchObject({
      sourceHandle: "text",
      targetHandle: "text",
      data: {
        graphVersion: "2.5",
        sourceChannel: "text",
        targetChannel: "text",
        role: "general"
      }
    });
});

test("disables reference upload until a project is open", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("start-screen")).toBeVisible();
  await expect(page.getByRole("button", { name: "Link reference image" })).toHaveCount(0);
  await expect(page.locator(".react-flow")).toHaveCount(0);
});

test("inspector edits selected node title, instruction, and notes", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByLabel("Title").fill("Subject Seed");
  await page.getByLabel("Title").blur();
  await page.getByLabel("Instruction").fill("Campaign spine");
  await page.getByLabel("Notes").fill("Launch prompt");

  await expect(page.getByTestId("ether-node").getByRole("heading", { name: "Subject Seed" })).toBeVisible();
  await expect(page.getByTestId("ether-node").getByText("Campaign spine")).toBeVisible();
  await expect(page.getByTestId("ether-node").getByText("Launch prompt")).toBeVisible();
});

test("selected prompt node shows contract summary and assembled preview", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();

  await expect(page.getByTestId("inspector-contract")).toContainText("Assemble Prompt");
  await expect(page.getByTestId("inspector-contract")).toContainText("Outputs");
  await expect(page.getByTestId("inspector-assembly-preview")).toContainText(
    "Prompt prompt placeholder"
  );
});

test("generation assembled prompt preview is editable from the inspector", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByLabel("Instruction").fill("chrome bottle on a white table");
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();
  await page.getByTestId("ether-node").filter({ hasText: "Image" }).first().click();

  await expect(page.getByTestId("inspector-assembly-preview")).toContainText("chrome bottle");
  await page.getByLabel("Prepared generation prompt").fill("Manual override prompt");
  await page.getByLabel("Prepared generation prompt").blur();
  await page.getByRole("button", { name: "Save Graph" }).click();

  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__lastSavedGraph?.nodes?.find((node: any) => node.data?.kind === "Generation")?.data?.assembledPrompt)
    )
    .toBe("Manual override prompt");
});

test("generation node exposes aspect ratio and resolution controls that persist into graph data", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-generation-image").click();

  await expect(page.getByLabel("Aspect ratio")).toBeVisible();
  await expect(page.getByLabel("Resolution")).toBeVisible();

  await page.getByLabel("Aspect ratio").selectOption("9:16");
  await page.getByLabel("Resolution").selectOption("1536-long-edge");
  await page.getByRole("button", { name: "Save Graph" }).click();

  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__lastSavedGraph?.nodes?.find((node: any) => node.data?.kind === "Generation")?.data)
    )
    .toMatchObject({
      generationAspectRatio: "9:16",
      generationResolution: "1536-long-edge",
      generationWidth: 864,
      generationHeight: 1536
    });
});

test("running nodes show canvas status overlay until shortly after completion", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __finishRun?: () => void;
    };
    const graph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Run Overlay.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Run Overlay",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Run Overlay.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(testWindow, {
      __finishRun: undefined,
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        project: {
          selectParentDirectory: async () => "C:\\Fake",
          selectProjectBundle: async () => null,
          create: async () => project,
          open: async () => project,
          saveGraph: async (_projectId: string, nextGraph: unknown) => nextGraph,
          loadGraph: async () => graph,
          health: async () => ({ issues: [] })
        },
        settings: {
          load: async () => ({
            parentDirectory: "C:\\Fake",
            projectName: "Run Overlay",
            projectPath: "",
            recentProjects: []
          }),
          save: async (settings: unknown) => settings
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
          saveMask: async () => {
            throw new Error("not used");
          },
          moveToCollection: async () => {
            throw new Error("not used");
          },
          listMoves: async () => []
        },
        execution: {
          preview: async (_projectId: string, _graph: any, request: any) => ({
            plan: {
              policy: request.policy,
              targetNodeIds: request.targetNodeIds,
              nodeIds: request.targetNodeIds,
              items: request.targetNodeIds.map((nodeId: string) => ({ nodeId, iteration: 1 })),
              parallel: false,
              runCountCap: 1
            },
            dirtyNodeIds: request.targetNodeIds,
            providerCallCandidates: request.targetNodeIds,
            expectedOutputCount: 1,
            blockedReasons: [],
            items: request.targetNodeIds.map((nodeId: string) => ({
              nodeId,
              iteration: 1,
              kind: "Generation",
              willCallProvider: true
            }))
          }),
          run: async (_projectId: string, nextGraph: any, request: any) =>
            new Promise((resolve) => {
              testWindow.__finishRun = () =>
                resolve({
                  graph: {
                    ...nextGraph,
                    nodes: nextGraph.nodes.map((node: any) =>
                      request.targetNodeIds.includes(node.id)
                        ? {
                            ...node,
                            data: {
                              ...node.data,
                              status: "complete",
                              rerunState: "complete",
                              lastRunAt: "2026-06-17T12:04:00.000Z"
                            }
                          }
                        : node
                    ),
                    updatedAt: "2026-06-17T12:04:00.000Z"
                  },
                  plan: {
                    policy: request.policy,
                    targetNodeIds: request.targetNodeIds,
                    nodeIds: request.targetNodeIds,
                    items: request.targetNodeIds.map((nodeId: string) => ({ nodeId, iteration: 1 })),
                    parallel: false,
                    runCountCap: 1
                  },
                  results: request.targetNodeIds.map((nodeId: string) => ({
                    nodeId,
                    iteration: 1,
                    status: "complete",
                    action: "generate",
                    startedAt: "2026-06-17T12:03:00.000Z",
                    finishedAt: "2026-06-17T12:04:00.000Z"
                  }))
                });
            })
        }
      }
    });
  });
  await page.goto("/");
  await createProjectFromStart(page, "Run Overlay");
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Run Node" }).click();
  await page.getByTestId("run-preview-start").click();

  await expect(page.getByTestId("node-run-status")).toContainText("running");
  await page.evaluate(() => (window as any).__finishRun?.());
  await expect(page.getByTestId("node-run-status")).toContainText("done");
});

test("assembling a prompt node freezes a local prompt artifact", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByLabel("Instruction").fill("hero bottle on reflective glass");
  await page.getByTestId("inspector-run-node").click();

  await expect(page.getByTestId("canvas-status")).toContainText("Assembled Prompt");
  await expect(page.getByTestId("panel-run-trace")).toContainText("Assembled Prompt");
  await expect(page.getByTestId("inspector-assembly-preview")).toContainText("Frozen");
});

test("prompt mutation controls store seeded lineage in the run trace", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByLabel("Instruction").fill("minimal studio product image");
  await page.getByLabel("Enable prompt mutation").check();
  await page.getByLabel("Mutation preset").selectOption("Lens Shift");
  await page.getByLabel("Mutation seed").fill("smoke-seed");
  await page.getByLabel("Variation strength").fill("62");
  await page.getByLabel("Locked terms").fill("chrome bottle");
  await page.getByLabel("Mutation direction").fill("keep it premium");
  await page.getByTestId("inspector-run-node").click();

  await expect(page.getByTestId("panel-run-trace")).toContainText("Mutation");
  await expect(page.getByTestId("inspector-mutation-lineage")).toContainText("smoke-seed");
  await expect(page.getByTestId("inspector-assembly-preview")).toContainText("chrome bottle");
});

test("editing a frozen prompt marks it stale and clears the old frozen preview", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByLabel("Instruction").fill("hero bottle on reflective glass");
  await page.getByTestId("inspector-run-node").click();

  await expect(page.getByTestId("inspector-assembly-preview")).toContainText("Frozen");

  await page.getByLabel("Instruction").fill("revised reflective bottle");

  await expect(page.getByTestId("ether-node")).toContainText("stale");
  await expect(page.getByTestId("inspector-assembly-preview")).not.toContainText("Frozen");
  await expect(page.getByTestId("inspector-assembly-preview")).toContainText("revised reflective bottle");
});

test("inspector exposes execution controls and lock disables node edits", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();

  await expect(page.getByTestId("inspector-execution-controls")).toBeVisible();
  await expect(page.getByLabel("Run policy")).toHaveValue("cached-inputs");
  await expect(page.getByLabel("Run count cap")).toHaveValue("1");
  await expect(page.getByLabel("Parallel execution")).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Run Node" })).toBeVisible();
  await expect(page.getByTestId("inspector-run-node")).toBeEnabled();

  await page.getByRole("button", { name: "Lock node" }).click();

  await expect(page.getByTestId("inspector-node-title")).toHaveValue("Prompt");
  await expect(page.getByTestId("inspector-run-node")).toBeDisabled();
  await expect(page.getByTestId("ether-node")).toContainText("locked");
});

test("dragging a locked node is discarded on release", async ({ page }) => {
  const graph = {
    nodes: [
      {
        id: "locked-prompt",
        type: "etherNode",
        position: { x: 320, y: 180 },
        width: 260,
        height: 160,
        selected: true,
        data: {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          title: "Locked Prompt",
          label: "Locked Prompt",
          notes: "",
          instruction: "locked prompt body",
          status: "idle",
          locked: true
        }
      }
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedSnapshotId: null,
    updatedAt: "2026-06-17T12:00:00.000Z"
  };

  await openProjectWithGraph(page, graph, "Locked Drag");

  const nodeBox = await page.getByTestId("ether-node").boundingBox();

  if (!nodeBox) {
    throw new Error("Locked node was not measurable.");
  }

  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(nodeBox.x + nodeBox.width / 2 + 160, nodeBox.y + nodeBox.height / 2 + 90, {
    steps: 6
  });
  await page.mouse.up();
  await expect(page.getByTestId("canvas-status")).toContainText("Unlock");
  await page.getByRole("button", { name: "Save Graph" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__lastSavedGraph?.nodes?.find((node: any) => node.id === "locked-prompt")?.position
      )
    )
    .toEqual({ x: 320, y: 180 });
});

test("connect first valid pair refuses locked endpoints", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByRole("button", { name: "Lock node" }).click();
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();

  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect(page.getByTestId("canvas-status")).toContainText(
    "Unlock connected nodes before changing relationships"
  );
});

test("invalid connection attempts show the engine rejection reason", async ({ page }) => {
  await openEmptyProject(page);

  await page.locator("summary").filter({ hasText: "Note" }).click();
  await page.getByTestId("library-node-note-cloud").click();
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();

  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect(page.getByTestId("canvas-status")).toContainText(
    "Note nodes cannot connect directly to Generation nodes."
  );
});

test("locked edge endpoints disable role edits and deletion", async ({ page }) => {
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
            definitionId: "prompt-prompt",
            kind: "Prompt",
            subtype: "Prompt",
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
          sourceHandle: "text",
          targetHandle: "text",
          label: "prompt",
          selected: true,
          type: "etherEdge",
          data: {
            graphVersion: "2.5",
            label: "prompt",
            sourceChannel: "text",
            targetChannel: "text",
            role: "general"
          }
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

  await createProjectFromStart(page);

  await expect(page.getByTestId("inspector-edge-label")).toBeDisabled();
  await page.keyboard.press("Delete");

  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.getByTestId("edge-role-chip")).toContainText("General");
  await page.getByTestId("edge-role-chip").click({ button: "right" });
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.getByTestId("canvas-status")).toContainText(
    "Unlock connected nodes before changing relationships"
  );
});

test("locked edge data blocks role grid, inspector, and right-click deletion", async ({ page }) => {
  await page.addInitScript(() => {
    const graph = {
      nodes: [
        {
          id: "prompt",
          type: "etherNode",
          position: { x: 160, y: 180 },
          width: 224,
          height: 138,
          data: {
            definitionId: "prompt-prompt",
            kind: "Prompt",
            subtype: "Prompt",
            title: "Prompt",
            label: "Prompt",
            notes: "",
            instruction: "protected prompt",
            status: "complete"
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
          id: "edge-locked-data",
          source: "prompt",
          target: "generation",
          sourceHandle: "text",
          targetHandle: "text",
          label: "prompt",
          selected: true,
          type: "etherEdge",
          data: {
            graphVersion: "2.5",
            label: "prompt",
            sourceChannel: "text",
            targetChannel: "text",
            role: "general",
            locked: true
          }
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\LockedEdgeData.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Locked Edge Data",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\LockedEdgeData.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(window, {
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
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
  await createProjectFromStart(page);

  await expect(page.getByTestId("inspector-edge-label")).toBeDisabled();
  await expect(page.getByTestId("edge-role-chip")).toContainText("General");

  await page.getByTestId("edge-role-chip").click();
  await page.getByRole("button", { name: "Set role Subject" }).click();
  await expect(page.getByTestId("edge-role-chip")).toContainText("General");
  await expect(page.getByTestId("canvas-status")).toContainText(
    "Unlock connected nodes before changing relationships"
  );

  await page.getByTestId("edge-role-chip").click({ button: "right" });
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
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

  await createProjectFromStart(page);
  await page.keyboard.press("Delete");

  await expect(page.getByTestId("ether-node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.getByTestId("canvas-status")).toContainText(
    "Unlock connected nodes before changing relationships"
  );
});

test("generation node previews prompt inputs from a connected prompt", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
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

  await expect(page.getByTestId("start-screen")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save fake output" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mirror" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Move pending generated" })).toHaveCount(0);
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

  await createProjectFromStart(page);
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

test("adds a Review Router template from the canvas toolbar", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByRole("button", { name: "Add review router" }).click();

  await expect(page.getByTestId("ether-node")).toHaveCount(6);
  await expect(page.locator(".ether-node-main h3").filter({ hasText: /^Compare$/ })).toHaveCount(1);
  await expect(page.locator(".ether-node-main h3").filter({ hasText: /^Evaluate$/ })).toHaveCount(1);
  await expect(page.locator(".ether-node-main h3").filter({ hasText: /^Filter$/ })).toHaveCount(1);
  await expect(page.locator(".ether-node-main h3").filter({ hasText: /^Selected$/ })).toHaveCount(1);
  await expect(page.locator(".ether-node-main h3").filter({ hasText: /^Needs Edit$/ })).toHaveCount(1);
  await expect(page.locator(".ether-node-main h3").filter({ hasText: /^Rejected$/ })).toHaveCount(1);
  await page.getByRole("button", { name: "Save Graph" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__lastSavedGraph?.edges?.map((edge: any) => edge.label)))
    .toEqual(expect.arrayContaining(["pass", "needs-edit", "fail"]));
});

test("Review nodes expose Compare, Evaluation, and Filter inspector controls", async ({ page }) => {
  await openEmptyProject(page);

  await page.locator("summary").filter({ hasText: "Review" }).click();
  await page.getByTestId("library-node-review-compare").click();
  await expect(page.getByTestId("inspector-compare-controls")).toBeVisible();
  await page.getByLabel("Compare grid").selectOption("6");
  await page.getByLabel("Rating").fill("4");
  await page.getByLabel("Tags").fill("keeper, campaign");
  await page.getByLabel("Decision").selectOption("select");
  await page.getByLabel("Review notes").fill("Strong campaign candidate.");

  await page.getByTestId("library-node-review-evaluation").click();
  await expect(page.getByTestId("inspector-evaluate-controls")).toBeVisible();
  await page.getByLabel("Evaluation threshold").fill("72");

  await page.getByTestId("library-node-review-filter").click();
  await expect(page.getByTestId("inspector-filter-controls")).toBeVisible();
  await expect(page.getByLabel("Auto-apply routes")).toBeChecked();
  await page.getByLabel("Dry run").check();
  await page.getByLabel("Route mode").selectOption("copy");
  await page.getByLabel("Manual override").fill("Manual Picks");
  await page.getByLabel("Routing rules").fill("pass -> Selected; needs-edit -> Needs Edit; fail -> Rejected");
});

test("Review inspector summarizes compare, evaluation, and filter route artifacts", async ({ page }) => {
  await page.addInitScript(() => {
    const graph = {
      nodes: [
        {
          id: "compare",
          type: "etherNode",
          position: { x: 520, y: 120 },
          data: {
            definitionId: "store-compare",
            kind: "Store",
            subtype: "Compare",
            title: "Compare Store",
            label: "Compare",
            instruction: "",
            notes: "",
            status: "complete",
            compareLayout: 2,
            compareArtifact: {
              kind: "compare",
              winnerAssetId: "asset-hero",
              rating: 5,
              notes: "Best campaign hero so far.",
              membership: [
                {
                  assetId: "asset-hero",
                  assetPath: "C:\\Fake\\Review.ether\\assets\\generated\\hero.png",
                  decision: "select",
                  rating: 5,
                  tags: ["keeper", "on-brand"],
                  notes: "Best campaign hero so far."
                }
              ],
              items: [
                {
                  assetId: "asset-hero",
                  assetPath: "C:\\Fake\\Review.ether\\assets\\generated\\hero.png",
                  decision: "select",
                  rating: 5,
                  tags: ["keeper", "on-brand"],
                  notes: "Best campaign hero so far."
                }
              ]
            }
          }
        },
        {
          id: "evaluate",
          type: "etherNode",
          position: { x: 520, y: 300 },
          data: {
            definitionId: "store-evaluate",
            kind: "Store",
            subtype: "Evaluate",
            title: "Evaluate Store",
            label: "Evaluate",
            instruction: "",
            notes: "",
            status: "complete",
            evaluationThreshold: 70,
            evaluationArtifact: {
              kind: "evaluation",
              summary: "Strong visual pass.",
              items: [
                {
                  assetId: "asset-hero",
                  decision: "pass",
                  score: 88,
                  confidence: 0.91,
                  tags: ["keeper"],
                  explanation: "Clean typography and strong composition.",
                  detectedIssues: ["minor glare"]
                }
              ]
            }
          }
        },
        {
          id: "filter",
          type: "etherNode",
          position: { x: 520, y: 480 },
          data: {
            definitionId: "store-filter",
            kind: "Store",
            subtype: "Filter",
            title: "Filter Store",
            label: "Filter",
            instruction: "",
            notes: "",
            status: "complete",
            filterDryRun: true,
            filterRouteMode: "copy",
            filterResult: {
              kind: "filter",
              dryRun: true,
              autoApply: true,
              mode: "copy",
              candidateRoutes: [
                {
                  assetId: "asset-hero",
                  decision: "pass",
                  destinationCollectionName: "Selected",
                  mode: "copy",
                  metadataChanges: {
                    filter: {
                      decision: "pass",
                      targetCollectionName: "Selected",
                      mode: "copy"
                    }
                  }
                }
              ],
              routed: [
                {
                  assetId: "asset-hero",
                  decision: "pass",
                  targetCollectionName: "Selected",
                  mode: "copy",
                  preview: true,
                  moved: false
                }
              ]
            }
          }
        }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Review.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Review",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Review.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(window, {
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        project: {
          create: async () => project,
          open: async () => project,
          saveGraph: async (_projectId: string, nextGraph: unknown) => nextGraph,
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
          saveMask: async () => {
            throw new Error("not used");
          },
          moveToCollection: async () => {
            throw new Error("not used");
          },
          listMoves: async () => []
        }
      }
    });
  });

  await page.goto("/");
  await createProjectFromStart(page, "Review");

  await page.getByTestId("rf__node-compare").click();
  await expect(page.getByTestId("inspector-compare-summary")).toContainText("Winner");
  await expect(page.getByTestId("inspector-compare-summary")).toContainText("asset-hero");
  await expect(page.getByTestId("inspector-compare-summary")).toContainText("Best campaign hero");

  await page.getByTestId("rf__node-evaluate").click();
  await expect(page.getByTestId("inspector-evaluation-results")).toContainText("pass");
  await expect(page.getByTestId("inspector-evaluation-results")).toContainText("88");
  await expect(page.getByTestId("inspector-evaluation-results")).toContainText("minor glare");

  await page.getByTestId("rf__node-filter").click();
  await expect(page.getByTestId("inspector-filter-preview")).toContainText("Selected");
  await expect(page.getByTestId("inspector-filter-preview")).toContainText("copy");
  await expect(page.getByTestId("inspector-filter-preview")).toContainText("metadata");
});

test("modular inspector shows primary actions for core node families", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await expect(page.getByTestId("inspector-section-setup")).toBeVisible();
  await expect(page.getByTestId("inspector-section-inputs")).toBeVisible();
  await expect(page.getByTestId("inspector-section-run")).toBeVisible();
  await expect(page.getByTestId("inspector-section-output")).toBeVisible();
  await expect(page.getByTestId("inspector-section-review")).toBeVisible();
  await expect(page.getByTestId("inspector-section-advanced")).toBeVisible();
  await expect(page.getByRole("button", { name: "Assemble Prompt" })).toBeVisible();

  await page.getByTestId("library-node-prompt-brainstormer").click();
  await expect(page.getByLabel("Enable prompt mutation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run Node" })).toBeVisible();

  await page.getByTestId("library-node-generation-image").click();
  await expect(page.getByRole("button", { name: "Save fake output" })).toBeVisible();

  await page.locator("summary").filter({ hasText: "Edit" }).click();
  await page.getByTestId("library-node-edit-inpaint").click();
  await expect(page.getByRole("button", { name: "Create mask overlay" })).toBeVisible();

  await page.locator("summary").filter({ hasText: "Review" }).click();
  await page.getByTestId("library-node-review-compare").click();
  await expect(page.getByLabel("Compare grid")).toBeVisible();

  await page.getByTestId("library-node-review-evaluation").click();
  await expect(page.getByLabel("Evaluation threshold")).toBeVisible();

  await page.getByTestId("library-node-review-filter").click();
  await expect(page.getByLabel("Routing rules")).toBeVisible();

  await page.locator("summary").filter({ hasText: "Store" }).click();
  await page.getByTestId("library-node-store-collection").click();
  await expect(page.getByRole("button", { name: "Create / update" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move pending generated" })).toBeVisible();

  await page.getByTestId("library-node-store-directory").click();
  await expect(page.getByRole("button", { name: "Create / update" })).toBeVisible();

  await page.locator("summary").filter({ hasText: "Note" }).click();
  await page.getByTestId("library-node-note-cloud").click();
  await expect(page.getByLabel("Notes")).toBeVisible();
});

test("Store collection nodes can choose and create a custom folder path", async ({ page }) => {
  await openEmptyProject(page, "Store Folder");
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __ensureCollectionOptions: unknown[];
      __selectedStoreDirectoryCalls: number;
    };

    testWindow.__ensureCollectionOptions = [];
    testWindow.__selectedStoreDirectoryCalls = 0;
    testWindow.ether.asset.selectStoreDirectory = async () => {
      testWindow.__selectedStoreDirectoryCalls += 1;
      return "C:\\Campaigns\\Hero Picks";
    };
    testWindow.ether.asset.ensureCollection = async (_projectId: string, options: any) => {
      testWindow.__ensureCollectionOptions.push(options);

      return {
        id: "collection-asset-1",
        kind: "collection",
        path: options.path,
        metadata: { displayName: options.name, customPath: true },
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z"
      };
    };
  });

  await page.locator("summary").filter({ hasText: "Store" }).click();
  await page.getByTestId("library-node-store-collection").click();

  await expect(page.getByLabel("Folder path")).toBeVisible();
  await page.getByRole("button", { name: "Choose folder" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __selectedStoreDirectoryCalls: number }).__selectedStoreDirectoryCalls))
    .toBe(1);
  await expect(page.getByLabel("Folder path")).toHaveValue("C:\\Campaigns\\Hero Picks");

  await page.getByRole("button", { name: "Create / update" }).click();

  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { __ensureCollectionOptions: unknown[] }).__ensureCollectionOptions)
    )
    .toEqual([
      expect.objectContaining({
        name: "Collection",
        path: "C:\\Campaigns\\Hero Picks"
      })
    ]);
  await expect(page.getByTestId("inspector-store-folder")).toContainText("C:\\Campaigns\\Hero Picks");
});

test("inspector section help is visible and focusable", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();

  const sectionHelp = [
    ["setup", "node identity"],
    ["inputs", "incoming context"],
    ["run", "preview"],
    ["output", "artifacts"],
    ["review", "compare"],
    ["advanced", "contract"]
  ] as const;

  for (const [sectionId, expectedText] of sectionHelp) {
    const button = page.getByTestId(`context-help-control-inspector-${sectionId}`);
    const tooltip = page.getByTestId(`context-help-tooltip-inspector-${sectionId}`);

    await expect(button).toBeVisible();
    await expect(tooltip).toHaveAttribute("aria-hidden", "true");
    await button.focus();
    await expect(button).toBeFocused();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveAttribute("aria-hidden", "false");
    await expect(tooltip).toContainText(expectedText);
  }

  await page.getByTestId("context-help-control-inspector-advanced").press("Escape");
  await expect(page.getByTestId("context-help-tooltip-inspector-advanced")).toHaveAttribute("aria-hidden", "true");
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.getByTestId("context-help-control-inspector-run").hover();
  await expect(page.getByTestId("context-help-tooltip-inspector-run")).toBeVisible();
  await expect(page.getByTestId("context-help-tooltip-inspector-run")).toHaveAttribute("aria-hidden", "false");
});

test("creates an edge and edits the visible edge label", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();

  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.getByTestId("edge-role-chip")).toContainText("General");
  await page.getByTestId("inspector-edge-label").selectOption("subject");
  await expect(page.getByTestId("edge-role-chip")).toContainText("Subject");
  await expect(page.getByTestId("edge-role-chip")).toHaveClass(/is-named-role/);
  await expect
    .poll(() => page.getByTestId("edge-role-chip").evaluate((element) => getComputedStyle(element).opacity))
    .toBe("1");
  const promptBox = await page.getByTestId("ether-node").filter({ hasText: "Prompt" }).first().boundingBox();
  if (!promptBox) {
    throw new Error("Prompt node bounding box missing.");
  }
  await page.mouse.click(promptBox.x + 12, promptBox.y + 12);
  await expect(page.getByTestId("inspector-outgoing-roles")).toContainText("Subject");
  await page.getByRole("button", { name: "Save Graph" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__lastSavedGraph?.edges?.[0]?.data?.role))
    .toBe("subject");
});

test("channel connections save 2.5 edge data and role chips use the fixed role grid", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();

  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.getByTestId("edge-role-chip")).toContainText("General");

  await page.getByRole("button", { name: "Save Graph" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__lastSavedGraph?.edges?.[0]))
    .toMatchObject({
      sourceHandle: "text",
      targetHandle: "text",
      data: {
        graphVersion: "2.5",
        sourceChannel: "text",
        targetChannel: "text",
        role: "general"
      }
    });

  await page.getByTestId("edge-role-chip").click();
  await expect(page.getByTestId("edge-role-grid")).toBeVisible();
  await expect(page.getByTestId("edge-role-grid").getByRole("button")).toHaveCount(15);
  await expect
    .poll(() =>
      page
        .getByTestId("edge-role-grid")
        .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)
    )
    .toBe(5);

  await page.getByRole("button", { name: "Set role Subject" }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("edge-role-chip")).toContainText("Subject");
  await expect(page.getByTestId("edge-role-grid")).toHaveCount(0);
  await page.getByTestId("edge-role-chip").hover();
  await page.mouse.wheel(0, 500);
  await expect(page.getByTestId("edge-role-chip")).toContainText("Subject");

  await page.getByRole("button", { name: "Save Graph" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__lastSavedGraph?.edges?.[0]?.data?.role))
    .toBe("subject");

  await page.getByTestId("edge-role-chip").click({ button: "right" });
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await page.getByTestId("canvas-undo").click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("edge channel picker changes the target channel and undo redo restores it", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();

  await page.getByTestId("edge-channel-dot-target").click();
  await expect(page.getByTestId("edge-channel-picker-target")).toBeVisible();
  await expect(page.getByTestId("edge-channel-picker-target").getByRole("menuitem")).toHaveCount(6);
  await page.getByRole("menuitem", { name: "Set target channel Image" }).click();
  await expect(page.getByTestId("edge-role-chip")).toHaveAttribute("data-target-channel", "image");

  await page.getByTestId("canvas-undo").click();
  await expect(page.getByTestId("edge-role-chip")).toHaveAttribute("data-target-channel", "text");

  await page.getByTestId("canvas-redo").click();
  await expect(page.getByTestId("edge-role-chip")).toHaveAttribute("data-target-channel", "image");

  await page.getByRole("button", { name: "Save Graph" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__lastSavedGraph?.edges?.[0]))
    .toMatchObject({
      targetHandle: "image",
      data: {
        targetChannel: "image",
        role: "general"
      }
    });
});

test("right-clicking an edge channel dot removes the connection", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();

  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.getByTestId("edge-channel-dot-target").click({ button: "right" });
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await page.getByTestId("canvas-undo").click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("right-clicking an edge channel dot removes only the connection even when nodes are selected", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();
  await page.getByTestId("panel-node-library-toggle").click();
  await page.getByTestId("panel-inspector-toggle").click();

  const nodeBoxes = await page.getByTestId("ether-node").evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    })
  );
  const left = Math.min(...nodeBoxes.map((box) => box.left)) - 40;
  const top = Math.min(...nodeBoxes.map((box) => box.top)) - 40;
  const right = Math.max(...nodeBoxes.map((box) => box.right)) + 40;
  const bottom = Math.max(...nodeBoxes.map((box) => box.bottom)) + 40;

  await page.keyboard.down("Shift");
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(right, bottom, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  await expect(page.locator(".ether-node.is-selected")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  await page.getByTestId("edge-channel-dot-target").click({ button: "right" });

  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect(page.getByTestId("ether-node")).toHaveCount(2);
});

test("locked edge data blocks channel picker changes", async ({ page }) => {
  await openProjectWithGraph(page, {
    nodes: [
      {
        id: "prompt",
        type: "etherNode",
        position: { x: 160, y: 180 },
        width: 224,
        height: 138,
        data: {
          definitionId: "prompt-prompt",
          kind: "Prompt",
          subtype: "Prompt",
          title: "Prompt",
          label: "Prompt",
          notes: "",
          instruction: "protected prompt",
          status: "complete"
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
        id: "edge-locked-channel",
        source: "prompt",
        target: "generation",
        sourceHandle: "text",
        targetHandle: "text",
        label: "prompt",
        selected: true,
        type: "etherEdge",
        data: {
          graphVersion: "2.5",
          label: "prompt",
          sourceChannel: "text",
          targetChannel: "text",
          role: "general",
          locked: true
        }
      }
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedSnapshotId: null,
    updatedAt: "2026-06-17T12:00:00.000Z"
  }, "Locked Channel Edge");

  await page.getByTestId("edge-channel-dot-target").click();
  await page.getByRole("menuitem", { name: "Set target channel Image" }).click();

  await expect(page.getByTestId("canvas-status")).toContainText(
    "Unlock connected nodes before changing relationships"
  );
  await page.getByRole("button", { name: "Save Graph" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__lastSavedGraph?.edges?.[0]))
    .toMatchObject({
      targetHandle: "text",
      data: {
        targetChannel: "text",
        role: "general",
        locked: true
      }
    });
});

test("invalid edge channel picker changes are rejected with a visible status", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();

  await page.getByTestId("edge-channel-dot-target").click();
  await page.getByRole("menuitem", { name: "Set target channel Mask" }).click();

  await expect(page.getByTestId("canvas-status")).toContainText(
    "Generation Image does not accept Mask channel connections."
  );
  await page.getByRole("button", { name: "Save Graph" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__lastSavedGraph?.edges?.[0]))
    .toMatchObject({
      targetHandle: "text",
      data: {
        targetChannel: "text",
        role: "general"
      }
    });
});

test("wheel over edge channel controls does not change role or channel", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();

  await page.getByTestId("edge-channel-dot-target").hover();
  await page.mouse.wheel(0, 500);
  await page.getByRole("button", { name: "Save Graph" }).click();

  await expect
    .poll(() => page.evaluate(() => (window as any).__lastSavedGraph?.edges?.[0]))
    .toMatchObject({
      sourceHandle: "text",
      targetHandle: "text",
      data: {
        sourceChannel: "text",
        targetChannel: "text",
        role: "general"
      }
    });
});

test("Delete key removes the selected node", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await expect(page.getByTestId("ether-node")).toHaveCount(1);

  await page.keyboard.press("Delete");

  await expect(page.getByTestId("ether-node")).toHaveCount(0);
});

test("Shift-dragging a marquee selects multiple nodes without blanking the canvas", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByTestId("library-node-generation-image").click();
  await page.getByTestId("panel-node-library-toggle").click();
  await page.getByTestId("panel-inspector-toggle").click();

  const nodeBoxes = await page.getByTestId("ether-node").evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    })
  );
  const left = Math.min(...nodeBoxes.map((box) => box.left)) - 40;
  const top = Math.min(...nodeBoxes.map((box) => box.top)) - 40;
  const right = Math.max(...nodeBoxes.map((box) => box.right)) + 40;
  const bottom = Math.max(...nodeBoxes.map((box) => box.bottom)) + 40;

  await page.keyboard.down("Shift");
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(right, bottom, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  await expect(page.locator(".react-flow")).toBeVisible();
  await expect(page.getByTestId("ether-node")).toHaveCount(2);
  await expect(page.locator(".ether-node.is-selected")).toHaveCount(2);
});

test("plain left-drag marquee selects multiple nodes and offers to run selected nodes", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();
  await page.getByTestId("panel-node-library-toggle").click();
  await page.getByTestId("panel-inspector-toggle").click();

  const nodeBoxes = await page.getByTestId("ether-node").evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    })
  );
  const left = Math.min(...nodeBoxes.map((box) => box.left)) - 40;
  const top = Math.min(...nodeBoxes.map((box) => box.top)) - 40;
  const right = Math.max(...nodeBoxes.map((box) => box.right)) + 40;
  const bottom = Math.max(...nodeBoxes.map((box) => box.bottom)) + 40;

  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(right, bottom, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator(".react-flow")).toBeVisible();
  await expect(page.getByTestId("ether-node")).toHaveCount(2);
  await expect(page.locator(".ether-node.is-selected")).toHaveCount(2);
  await expect(page.getByTestId("selection-run-prompt")).toBeVisible();
  await expect(page.getByTestId("selection-run-prompt")).toContainText("Run only selected nodes?");

  await page.getByRole("button", { name: "Run selected nodes" }).click();
  await expect(page.getByTestId("run-plan-preview")).toBeVisible();
  await expect(page.getByTestId("run-plan-preview")).toContainText("Policy");
  await expect(page.getByTestId("run-plan-preview")).toContainText("selected");
});

test("undo and redo restore and remove a node", async ({ page }) => {
  await openEmptyProject(page);

  await page.getByTestId("library-node-prompt-prompt").click();
  await expect(page.getByTestId("ether-node")).toHaveCount(1);

  await page.getByTestId("canvas-undo").click();
  await expect(page.getByTestId("ether-node")).toHaveCount(0);

  await page.getByTestId("canvas-redo").click();
  await expect(page.getByTestId("ether-node")).toHaveCount(1);
});

test("canvas basics support add, select, connect, history, delete, save, and run", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __savedGraph: any;
      __runCalls: any[];
      __previewCalls: any[];
    };
    const graph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Canvas Basics.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Canvas Basics",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Canvas Basics.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(testWindow, {
      __savedGraph: null,
      __runCalls: [],
      __previewCalls: [],
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        settings: {
          load: async () => ({
            parentDirectory: "C:\\Fake",
            projectName: "Canvas Basics",
            projectPath: "",
            recentProjects: []
          }),
          save: async (settings: unknown) => settings
        },
        project: {
          defaultParentDirectory: async () => "C:\\Fake",
          selectParentDirectory: async () => "C:\\Fake",
          selectProjectBundle: async () => null,
          create: async () => project,
          open: async () => project,
          saveGraph: async (_projectId: string, nextGraph: any) => {
            testWindow.__savedGraph = nextGraph;
            return { ...nextGraph, updatedAt: "2026-06-17T12:02:00.000Z" };
          },
          loadGraph: async () => testWindow.__savedGraph ?? graph,
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
          saveMask: async () => {
            throw new Error("not used");
          },
          moveToCollection: async () => {
            throw new Error("not used");
          },
          listMoves: async () => []
        },
        execution: {
          preview: async (_projectId: string, nextGraph: any, request: any) => {
            const outputCount = Math.max(1, request.runCountCap ?? 1) * request.targetNodeIds.length;
            testWindow.__previewCalls.push(request);
            return {
              plan: {
                policy: request.policy,
                targetNodeIds: request.targetNodeIds,
                nodeIds: request.targetNodeIds,
                items: request.targetNodeIds.map((nodeId: string, index: number) => ({
                  nodeId,
                  iteration: index + 1
                })),
                parallel: request.parallel,
                runCountCap: request.runCountCap
              },
              dirtyNodeIds: request.targetNodeIds,
              providerCallCandidates: request.targetNodeIds,
              expectedOutputCount: outputCount,
              blockedReasons: [],
              items: request.targetNodeIds.flatMap((nodeId: string) =>
                Array.from({ length: Math.max(1, request.runCountCap ?? 1) }, (_entry, index) => ({
                  nodeId,
                  iteration: index + 1,
                  kind: "Generation",
                  willCallProvider: true
                }))
              )
            };
          },
          run: async (_projectId: string, nextGraph: any, request: any) => {
            testWindow.__runCalls.push(request);
            return {
              graph: {
                ...nextGraph,
                nodes: nextGraph.nodes.map((node: any) =>
                  request.targetNodeIds.includes(node.id)
                    ? {
                        ...node,
                        data: {
                          ...node.data,
                          status: "complete",
                          rerunState: "complete",
                          lastRunAt: "2026-06-17T12:03:00.000Z"
                        }
                      }
                    : node
                ),
                updatedAt: "2026-06-17T12:03:00.000Z"
              },
              plan: {
                policy: request.policy,
                targetNodeIds: request.targetNodeIds,
                nodeIds: request.targetNodeIds,
                items: request.targetNodeIds.map((nodeId: string) => ({ nodeId, iteration: 1 })),
                parallel: request.parallel,
                runCountCap: request.runCountCap
              },
              results: request.targetNodeIds.map((nodeId: string) => ({
                nodeId,
                iteration: 1,
                status: "complete",
                action: "generate",
                startedAt: "2026-06-17T12:03:00.000Z",
                finishedAt: "2026-06-17T12:03:00.000Z"
              }))
            };
          }
        }
      }
    });
  });

  await page.goto("/");
  await createProjectFromStart(page, "Canvas Basics");

  await page.getByTestId("library-node-prompt-prompt").click();
  await expect(page.getByTestId("canvas-status")).toContainText("Selected Prompt");
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Connect first valid pair" }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.getByTestId("edge-role-chip")).toContainText("General");

  await page.getByTestId("canvas-undo").click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await page.getByTestId("canvas-redo").click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.getByTestId("edge-role-chip")).toContainText("General");

  await page.getByRole("button", { name: "Delete selection" }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect(page.getByTestId("ether-node")).toHaveCount(2);

  await page.getByTestId("library-node-generation-image").click();
  await page.getByLabel("Run count cap").fill("2");
  await page.getByLabel("Parallel execution").check();
  await page.getByLabel("Run provider").selectOption("simulation");
  await page.getByRole("button", { name: "Run Node" }).click();
  await expect(page.getByTestId("run-plan-preview")).toBeVisible();
  await expect(page.getByTestId("run-preview-node-count")).toContainText("1");
  await expect(page.getByTestId("run-preview-provider-calls")).toContainText("2");
  await expect(page.getByTestId("run-preview-output-count")).toContainText("2");
  await expect(page.getByTestId("run-preview-mode")).toContainText("parallel");
  await expect(page.getByTestId("run-plan-preview")).toContainText("generation");
  await expect(page.getByTestId("run-plan-preview")).toContainText("Project generated assets");
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __previewCalls: any[] }).__previewCalls.at(-1)))
    .toMatchObject({ policy: "cached-inputs", runCountCap: 2, parallel: true, providerId: "ether-fake-local" });
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __runCalls: any[] }).__runCalls.length))
    .toBe(0);
  await page.getByTestId("run-preview-start").click();
  await expect(page.getByTestId("canvas-status")).toContainText("Run complete: 1 complete, 0 skipped");

  await page.getByRole("button", { name: "Save Graph" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __savedGraph: any }).__savedGraph?.nodes?.length))
    .toBe(3);
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __runCalls: any[] }).__runCalls.at(-1)))
    .toMatchObject({ policy: "cached-inputs", runCountCap: 2, parallel: true, providerId: "ether-fake-local" });
});

test("newer run preview intent wins over older pending preview responses", async ({ page }) => {
  await page.addInitScript(() => {
    type DeferredPreview = {
      request: any;
      resolve: (value: any) => void;
    };
    const testWindow = window as typeof window & {
      __previewRequests: DeferredPreview[];
    };
    const graph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Preview Race.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Preview Race",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Preview Race.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };
    const makePreview = (request: any) => {
      const outputCount = Math.max(1, request.runCountCap ?? 1) * request.targetNodeIds.length;

      return {
        plan: {
          policy: request.policy,
          targetNodeIds: request.targetNodeIds,
          nodeIds: request.targetNodeIds,
          items: request.targetNodeIds.flatMap((nodeId: string) =>
            Array.from({ length: Math.max(1, request.runCountCap ?? 1) }, (_entry, index) => ({
              nodeId,
              iteration: index + 1
            }))
          ),
          parallel: request.parallel,
          runCountCap: request.runCountCap
        },
        dirtyNodeIds: request.targetNodeIds,
        providerCallCandidates: request.targetNodeIds,
        expectedOutputCount: outputCount,
        blockedReasons: [],
        items: request.targetNodeIds.flatMap((nodeId: string) =>
          Array.from({ length: Math.max(1, request.runCountCap ?? 1) }, (_entry, index) => ({
            nodeId,
            iteration: index + 1,
            kind: "Generation",
            willCallProvider: true
          }))
        )
      };
    };

    Object.assign(testWindow, {
      __previewRequests: [],
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        settings: {
          load: async () => ({
            parentDirectory: "C:\\Fake",
            projectName: "Preview Race",
            projectPath: "",
            recentProjects: []
          }),
          save: async (settings: unknown) => settings
        },
        project: {
          defaultParentDirectory: async () => "C:\\Fake",
          selectParentDirectory: async () => "C:\\Fake",
          selectProjectBundle: async () => null,
          create: async () => project,
          open: async () => project,
          saveGraph: async (_projectId: string, nextGraph: any) => nextGraph,
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
          saveMask: async () => {
            throw new Error("not used");
          },
          moveToCollection: async () => {
            throw new Error("not used");
          },
          listMoves: async () => []
        },
        execution: {
          preview: async (_projectId: string, _nextGraph: any, request: any) =>
            new Promise((resolve) => {
              testWindow.__previewRequests.push({
                request,
                resolve: (value) => resolve(value)
              });
            }),
          run: async () => {
            throw new Error("not used");
          }
        },
        __makePreview: makePreview
      }
    });
  });

  await page.goto("/");
  await createProjectFromStart(page, "Preview Race");
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Run Node" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __previewRequests: any[] }).__previewRequests.length))
    .toBe(1);
  await page.getByLabel("Run count cap").fill("2");
  await page.getByRole("button", { name: "Run Node" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __previewRequests: any[] }).__previewRequests.length))
    .toBe(2);

  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __previewRequests: Array<{ request: any; resolve: (value: any) => void }>;
      ether: { __makePreview(request: any): any };
    };
    const first = testWindow.__previewRequests[0];
    const second = testWindow.__previewRequests[1];

    second.resolve(testWindow.ether.__makePreview(second.request));
    first.resolve(testWindow.ether.__makePreview(first.request));
  });

  await expect(page.getByTestId("run-plan-preview")).toBeVisible();
  await expect(page.getByTestId("run-preview-output-count")).toContainText("2");
  await expect(page.getByTestId("run-preview-provider-calls")).toContainText("2");
});

test("visible older run preview cannot start after newer preview intent begins", async ({ page }) => {
  await page.addInitScript(() => {
    type DeferredPreview = {
      request: any;
      resolve: (value: any) => void;
    };
    const testWindow = window as typeof window & {
      __previewRequests: DeferredPreview[];
      __runCalls: any[];
    };
    const graph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Visible Preview Race.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Visible Preview Race",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Visible Preview Race.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };
    const makePreview = (request: any) => ({
      plan: {
        policy: request.policy,
        targetNodeIds: request.targetNodeIds,
        nodeIds: request.targetNodeIds,
        items: request.targetNodeIds.map((nodeId: string) => ({ nodeId, iteration: 1 })),
        parallel: request.parallel,
        runCountCap: request.runCountCap
      },
      dirtyNodeIds: request.targetNodeIds,
      providerCallCandidates: request.targetNodeIds,
      expectedOutputCount: request.targetNodeIds.length,
      blockedReasons: [],
      items: request.targetNodeIds.map((nodeId: string) => ({
        nodeId,
        iteration: 1,
        kind: "Generation",
        willCallProvider: true
      }))
    });

    Object.assign(testWindow, {
      __previewRequests: [],
      __runCalls: [],
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        settings: {
          load: async () => ({
            parentDirectory: "C:\\Fake",
            projectName: "Visible Preview Race",
            projectPath: "",
            recentProjects: []
          }),
          save: async (settings: unknown) => settings
        },
        project: {
          defaultParentDirectory: async () => "C:\\Fake",
          selectParentDirectory: async () => "C:\\Fake",
          selectProjectBundle: async () => null,
          create: async () => project,
          open: async () => project,
          saveGraph: async (_projectId: string, nextGraph: any) => nextGraph,
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
          saveMask: async () => {
            throw new Error("not used");
          },
          moveToCollection: async () => {
            throw new Error("not used");
          },
          listMoves: async () => []
        },
        execution: {
          preview: async (_projectId: string, _nextGraph: any, request: any) =>
            new Promise((resolve) => {
              testWindow.__previewRequests.push({
                request,
                resolve: (value) => resolve(value)
              });
            }),
          run: async (_projectId: string, _nextGraph: any, request: any) => {
            testWindow.__runCalls.push(request);
            return {
              graph: _nextGraph,
              plan: {
                policy: request.policy,
                targetNodeIds: request.targetNodeIds,
                nodeIds: request.targetNodeIds,
                items: request.targetNodeIds.map((nodeId: string) => ({ nodeId, iteration: 1 })),
                parallel: request.parallel,
                runCountCap: request.runCountCap
              },
              results: []
            };
          }
        },
        __makePreview: makePreview
      }
    });
  });

  await page.goto("/");
  await createProjectFromStart(page, "Visible Preview Race");
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Run Node" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __previewRequests: any[] }).__previewRequests.length))
    .toBe(1);
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __previewRequests: Array<{ request: any; resolve: (value: any) => void }>;
      ether: { __makePreview(request: any): any };
    };
    const first = testWindow.__previewRequests[0];

    first.resolve(testWindow.ether.__makePreview(first.request));
  });
  await expect(page.getByTestId("run-plan-preview")).toBeVisible();

  await page.getByLabel("Run count cap").fill("2");
  await page.evaluate(() => {
    const runButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Run Node")
    );

    if (!(runButton instanceof HTMLButtonElement)) {
      throw new Error("Run Node button missing");
    }

    runButton.click();
  });
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __previewRequests: any[] }).__previewRequests.length))
    .toBe(2);
  await expect(page.getByTestId("run-plan-preview")).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __runCalls: any[] }).__runCalls.length))
    .toBe(0);
});

test("start run only submits a preview once under rapid clicks", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __runCalls: any[];
    };
    const graph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Double Start.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Double Start",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Double Start.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(testWindow, {
      __runCalls: [],
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        settings: {
          load: async () => ({
            parentDirectory: "C:\\Fake",
            projectName: "Double Start",
            projectPath: "",
            recentProjects: []
          }),
          save: async (settings: unknown) => settings
        },
        project: {
          defaultParentDirectory: async () => "C:\\Fake",
          selectParentDirectory: async () => "C:\\Fake",
          selectProjectBundle: async () => null,
          create: async () => project,
          open: async () => project,
          saveGraph: async (_projectId: string, nextGraph: any) => nextGraph,
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
          saveMask: async () => {
            throw new Error("not used");
          },
          moveToCollection: async () => {
            throw new Error("not used");
          },
          listMoves: async () => []
        },
        execution: {
          preview: async (_projectId: string, _nextGraph: any, request: any) => ({
            plan: {
              policy: request.policy,
              targetNodeIds: request.targetNodeIds,
              nodeIds: request.targetNodeIds,
              items: request.targetNodeIds.map((nodeId: string) => ({ nodeId, iteration: 1 })),
              parallel: request.parallel,
              runCountCap: request.runCountCap
            },
            dirtyNodeIds: [],
            providerCallCandidates: request.targetNodeIds,
            expectedOutputCount: request.targetNodeIds.length,
            blockedReasons: [],
            items: request.targetNodeIds.map((nodeId: string) => ({
              nodeId,
              iteration: 1,
              kind: "Generation",
              willCallProvider: true
            }))
          }),
          run: async (_projectId: string, _nextGraph: any, request: any) => {
            testWindow.__runCalls.push(request);
            return new Promise(() => undefined);
          }
        }
      }
    });
  });

  await page.goto("/");
  await createProjectFromStart(page, "Double Start");
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Run Node" }).click();
  await expect(page.getByTestId("run-plan-preview")).toBeVisible();
  await page.evaluate(() => {
    const startButton = document.querySelector('[data-testid="run-preview-start"]');

    if (!(startButton instanceof HTMLButtonElement)) {
      throw new Error("Start Run button missing");
    }

    startButton.click();
    startButton.click();
  });

  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __runCalls: any[] }).__runCalls.length))
    .toBe(1);
});

test("stale save completion does not replace newer canvas edits", async ({ page }) => {
  await page.addInitScript(() => {
    type DeferredSave = {
      graph: any;
      resolve: (value: any) => void;
    };
    const testWindow = window as typeof window & {
      __saveRequests: DeferredSave[];
    };
    const graph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Stale Save.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Stale Save",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Stale Save.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(testWindow, {
      __saveRequests: [],
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        settings: {
          load: async () => ({
            parentDirectory: "C:\\Fake",
            projectName: "Stale Save",
            projectPath: "",
            recentProjects: []
          }),
          save: async (settings: unknown) => settings
        },
        project: {
          defaultParentDirectory: async () => "C:\\Fake",
          selectParentDirectory: async () => "C:\\Fake",
          selectProjectBundle: async () => null,
          create: async () => project,
          open: async () => project,
          saveGraph: async (_projectId: string, nextGraph: any) =>
            new Promise((resolve) => {
              testWindow.__saveRequests.push({
                graph: nextGraph,
                resolve: (value) => resolve(value)
              });
            }),
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
          saveMask: async () => {
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
  await createProjectFromStart(page, "Stale Save");

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByRole("button", { name: "Save Graph" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __saveRequests: any[] }).__saveRequests.length))
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __saveRequests: any[] }).__saveRequests[0]?.graph?.nodes?.length))
    .toBe(1);

  await page.getByTestId("library-node-generation-image").click();
  await expect(page.getByTestId("ether-node")).toHaveCount(2);

  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __saveRequests: Array<{ graph: any; resolve: (value: any) => void }>;
    };
    const save = testWindow.__saveRequests[0];

    save.resolve({ ...save.graph, updatedAt: "2026-06-17T12:05:00.000Z" });
  });

  await expect(page.getByTestId("project-header")).toContainText("Graph saved");
  await expect(page.getByTestId("ether-node")).toHaveCount(2);
  await expect(page.getByTestId("ether-node").getByRole("heading", { name: "Image" })).toBeVisible();
});

test("stale run completion does not replace newer canvas edits", async ({ page }) => {
  await page.addInitScript(() => {
    type DeferredRun = {
      graph: any;
      request: any;
      resolve: (value: any) => void;
    };
    const testWindow = window as typeof window & {
      __runRequests: DeferredRun[];
    };
    const graph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Stale Run.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Stale Run",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Stale Run.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(testWindow, {
      __runRequests: [],
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        settings: {
          load: async () => ({
            parentDirectory: "C:\\Fake",
            projectName: "Stale Run",
            projectPath: "",
            recentProjects: []
          }),
          save: async (settings: unknown) => settings
        },
        project: {
          defaultParentDirectory: async () => "C:\\Fake",
          selectParentDirectory: async () => "C:\\Fake",
          selectProjectBundle: async () => null,
          create: async () => project,
          open: async () => project,
          saveGraph: async (_projectId: string, nextGraph: any) => nextGraph,
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
          saveMask: async () => {
            throw new Error("not used");
          },
          moveToCollection: async () => {
            throw new Error("not used");
          },
          listMoves: async () => []
        },
        execution: {
          preview: async (_projectId: string, nextGraph: any, request: any) => ({
            plan: {
              policy: request.policy,
              targetNodeIds: request.targetNodeIds,
              nodeIds: request.targetNodeIds,
              items: request.targetNodeIds.map((nodeId: string) => ({ nodeId, iteration: 1 })),
              parallel: request.parallel,
              runCountCap: request.runCountCap
            },
            dirtyNodeIds: [],
            providerCallCandidates: request.targetNodeIds,
            expectedOutputCount: request.targetNodeIds.length,
            blockedReasons: [],
            items: request.targetNodeIds.map((nodeId: string) => ({
              nodeId,
              iteration: 1,
              kind: String(nextGraph.nodes.find((node: any) => node.id === nodeId)?.data?.kind ?? "Generation"),
              willCallProvider: true
            }))
          }),
          run: async (_projectId: string, nextGraph: any, request: any) =>
            new Promise((resolve) => {
              testWindow.__runRequests.push({
                graph: nextGraph,
                request,
                resolve: (value) => resolve(value)
              });
            })
        }
      }
    });
  });

  await page.goto("/");
  await createProjectFromStart(page, "Stale Run");

  await page.getByTestId("library-node-prompt-prompt").click();
  await page.getByTestId("library-node-generation-image").click();
  await page.getByRole("button", { name: "Run Node" }).click();
  await expect(page.getByTestId("run-plan-preview")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __runRequests: any[] }).__runRequests.length))
    .toBe(0);
  await page.getByTestId("run-preview-start").click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __runRequests: any[] }).__runRequests.length))
    .toBe(1);

  await page.getByTestId("library-node-prompt-prompt").click();
  await expect(page.getByTestId("ether-node")).toHaveCount(3);

  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __runRequests: Array<{ graph: any; request: any; resolve: (value: any) => void }>;
    };
    const run = testWindow.__runRequests[0];
    const graph = {
      ...run.graph,
      nodes: run.graph.nodes.map((node: any) =>
        run.request.targetNodeIds.includes(node.id)
          ? {
              ...node,
              data: {
                ...node.data,
                status: "complete",
                rerunState: "complete",
                lastRunAt: "2026-06-17T12:06:00.000Z"
              }
            }
          : node
      ),
      updatedAt: "2026-06-17T12:06:00.000Z"
    };

    run.resolve({
      graph,
      plan: {
        policy: run.request.policy,
        targetNodeIds: run.request.targetNodeIds,
        nodeIds: run.request.targetNodeIds,
        items: run.request.targetNodeIds.map((nodeId: string) => ({ nodeId, iteration: 1 })),
        parallel: run.request.parallel,
        runCountCap: run.request.runCountCap
      },
      results: run.request.targetNodeIds.map((nodeId: string) => ({
        nodeId,
        iteration: 1,
        status: "complete",
        action: "generate",
        startedAt: "2026-06-17T12:06:00.000Z",
        finishedAt: "2026-06-17T12:06:00.000Z"
      }))
    });
  });

  await expect(page.getByTestId("canvas-status")).toContainText("Run result skipped");
  await expect(page.getByTestId("ether-node")).toHaveCount(3);
  await expect(page.getByTestId("ether-node").getByRole("heading", { name: "Prompt" })).toHaveCount(2);
});

test("generated image nodes expose preview and inspect controls", async ({ page }) => {
  await page.addInitScript(() => {
    const graph = {
      nodes: [
        {
          id: "generation",
          type: "etherNode",
          position: { x: 420, y: 220 },
          width: 260,
          height: 220,
          selected: true,
          data: {
            definitionId: "generation-image",
            kind: "Generation",
            subtype: "Image",
            title: "Image",
            label: "Generated preview",
            notes: "",
            instruction: "",
            status: "complete",
            rerunState: "complete",
            assetId: "generated-asset-1",
            assetKind: "generated",
            assetPath: "C:\\Fake\\Preview.ether\\assets\\generated\\image.svg",
            assetMetadata: { mimeType: "image/svg+xml" }
          }
        }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Preview.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Preview",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Preview.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(window, {
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
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
          saveMask: async () => {
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
  await createProjectFromStart(page);

  await expect(page.getByTestId("node-image-preview")).toBeVisible();
  await page.getByRole("button", { name: "Inspect image asset" }).click();
  await expect(page.getByTestId("node-image-inspector")).toBeVisible();
});

test("run trace timeline shows durable job states and controls", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __cancelJobCalls: string[];
      __retryItemCalls: string[];
    };
    const graph = {
      nodes: [
        {
          id: "generation",
          type: "etherNode",
          position: { x: 420, y: 220 },
          width: 260,
          height: 220,
          selected: false,
          data: {
            definitionId: "generation-image",
            kind: "Generation",
            subtype: "Image",
            title: "Image",
            label: "Timeline Image",
            notes: "",
            instruction: "timeline smoke",
            status: "idle",
            rerunState: "ready"
          }
        }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Timeline.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Timeline",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Timeline.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };
    const jobs = [
      {
        id: "job-queued",
        status: "queued",
        kind: "graph-run",
        graphRevisionId: "rev-queued",
        rootNodeId: "generation",
        metadata: {},
        createdAt: "2026-06-17T12:01:00.000Z",
        updatedAt: "2026-06-17T12:01:00.000Z",
        startedAt: null,
        finishedAt: null
      },
      {
        id: "job-running",
        status: "running",
        kind: "graph-run",
        graphRevisionId: "rev-running",
        rootNodeId: "generation",
        metadata: {},
        createdAt: "2026-06-17T12:02:00.000Z",
        updatedAt: "2026-06-17T12:02:30.000Z",
        startedAt: "2026-06-17T12:02:00.000Z",
        finishedAt: null
      },
      {
        id: "job-completed",
        status: "completed",
        kind: "graph-run",
        graphRevisionId: "rev-completed",
        rootNodeId: "generation",
        metadata: {},
        createdAt: "2026-06-17T12:03:00.000Z",
        updatedAt: "2026-06-17T12:04:00.000Z",
        startedAt: "2026-06-17T12:03:00.000Z",
        finishedAt: "2026-06-17T12:04:00.000Z"
      },
      {
        id: "job-failed",
        status: "failed",
        kind: "graph-run",
        graphRevisionId: "rev-failed",
        rootNodeId: "generation",
        metadata: {},
        createdAt: "2026-06-17T12:05:00.000Z",
        updatedAt: "2026-06-17T12:06:00.000Z",
        startedAt: "2026-06-17T12:05:00.000Z",
        finishedAt: "2026-06-17T12:06:00.000Z"
      },
      {
        id: "job-canceled",
        status: "canceled",
        kind: "graph-run",
        graphRevisionId: "rev-canceled",
        rootNodeId: "generation",
        metadata: {},
        createdAt: "2026-06-17T12:07:00.000Z",
        updatedAt: "2026-06-17T12:08:00.000Z",
        startedAt: null,
        finishedAt: "2026-06-17T12:08:00.000Z"
      }
    ];
    const detailByJob = new Map(
      jobs.map((job, index) => [
        job.id,
        {
          job,
          items: [
            {
              id: `item-${job.id}`,
              jobId: job.id,
              nodeId: "generation",
              status:
                job.status === "completed"
                  ? "completed"
                  : job.status === "failed"
                    ? "failed"
                    : job.status === "canceled"
                      ? "canceled"
                      : job.status,
              input: { iteration: index + 1 },
              output:
                job.status === "completed"
                  ? {
                      assetPath: "C:\\Fake\\Timeline.ether\\assets\\generated\\timeline.png",
                      metadata: { path: "C:\\Fake\\Timeline.ether\\assets\\generated\\metadata-path.png" }
                    }
                  : {},
              error: job.status === "failed" ? { message: "Provider failed" } : null,
              metadata: job.status === "failed" ? { retryCount: 1 } : {},
              retryCount: job.status === "failed" ? 1 : 0,
              retryMetadata: job.status === "failed" ? { lastRetryAt: "2026-06-17T12:06:30.000Z" } : {},
              createdAt: job.createdAt,
              updatedAt: job.updatedAt,
              startedAt: job.startedAt,
              finishedAt: job.finishedAt
            }
          ],
          dependencies: [],
          events: [
            {
              id: `event-${job.id}`,
              jobId: job.id,
              jobItemId: null,
              eventType: job.status === "failed" ? "item.retry" : `run.${job.status}`,
              payload: job.status === "failed" ? { retryCount: 1 } : {},
              createdAt: job.updatedAt
            }
          ]
        }
      ])
    );

    Object.assign(testWindow, {
      __cancelJobCalls: [],
      __retryItemCalls: [],
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
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
          saveMask: async () => {
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
          },
          jobs: {
            list: async () => jobs,
            get: async (_projectId: string, jobId: string) => detailByJob.get(jobId),
            cancel: async (_projectId: string, jobId: string) => {
              testWindow.__cancelJobCalls.push(jobId);
              return jobs.find((job) => job.id === jobId);
            },
            retryItem: async (_projectId: string, jobItemId: string) => {
              testWindow.__retryItemCalls.push(jobItemId);
              return { ...detailByJob.get("job-failed")!.items[0], status: "queued", retryCount: 2 };
            },
            execute: async () => {
              throw new Error("not used");
            },
            enqueue: async () => {
              throw new Error("not used");
            }
          }
        }
      }
    });
  });

  await page.goto("/");
  await createProjectFromStart(page, "Timeline");

  await expect(page.getByTestId("run-timeline")).toBeVisible();
  await expect(page.getByTestId("run-timeline")).toContainText("queued");
  await expect(page.getByTestId("run-timeline")).toContainText("running");
  await expect(page.getByTestId("run-timeline")).toContainText("completed");
  await expect(page.getByTestId("run-timeline")).toContainText("failed");
  await expect(page.getByTestId("run-timeline")).toContainText("canceled");
  await expect(page.getByTestId("run-timeline")).toContainText("retried 1");
  await expect(page.getByTestId("run-timeline")).toContainText("timeline.png");
  await expect(page.getByTestId("run-timeline")).toContainText("metadata-path.png");
  await expect(page.getByTestId("run-timeline-execute-job-failed")).toHaveCount(0);
  await expect(page.getByTestId("run-timeline-thumbnail-item-job-completed")).toHaveAttribute(
    "src",
    /timeline\.png/
  );

  await page.getByTestId("run-timeline-item-item-job-completed").click();
  await expect(page.getByTestId("canvas-status")).toContainText("Selected Image");

  await page.getByTestId("run-timeline-cancel-job-queued").click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __cancelJobCalls: string[] }).__cancelJobCalls))
    .toEqual(["job-queued"]);

  await page.getByTestId("run-timeline-retry-item-job-failed").click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __retryItemCalls: string[] }).__retryItemCalls))
    .toEqual(["item-job-failed"]);

  await page.getByTestId("run-timeline-refresh").click();
  await expect(page.getByTestId("run-timeline")).toBeVisible();
});

test("run trace timeline keeps newer refresh results when an older poll finishes late", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __timelineListCalls: number;
      __resolveFirstTimelineList?: () => void;
    };
    const graph = {
      nodes: [
        {
          id: "generation",
          type: "etherNode",
          position: { x: 420, y: 220 },
          width: 260,
          height: 180,
          selected: false,
          data: {
            definitionId: "generation-image",
            kind: "Generation",
            subtype: "Image",
            title: "Image",
            label: "Timeline Image",
            notes: "",
            instruction: "timeline refresh race",
            status: "idle",
            rerunState: "ready"
          }
        }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Timeline Race.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Timeline Race",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Timeline Race.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };
    const staleJob = {
      id: "job-stale",
      status: "completed",
      kind: "graph-run",
      graphRevisionId: "rev-stale",
      rootNodeId: "stale-root",
      metadata: {},
      createdAt: "2026-06-17T12:01:00.000Z",
      updatedAt: "2026-06-17T12:01:30.000Z",
      startedAt: "2026-06-17T12:01:00.000Z",
      finishedAt: "2026-06-17T12:01:30.000Z"
    };
    const freshJob = {
      id: "job-fresh",
      status: "completed",
      kind: "graph-run",
      graphRevisionId: "rev-fresh",
      rootNodeId: "fresh-root",
      metadata: {},
      createdAt: "2026-06-17T12:02:00.000Z",
      updatedAt: "2026-06-17T12:02:30.000Z",
      startedAt: "2026-06-17T12:02:00.000Z",
      finishedAt: "2026-06-17T12:02:30.000Z"
    };
    const detailByJob = new Map(
      [staleJob, freshJob].map((job) => [
        job.id,
        {
          job,
          items: [
            {
              id: `item-${job.id}`,
              jobId: job.id,
              nodeId: "generation",
              status: "completed",
              input: { iteration: 1 },
              output: {},
              error: null,
              metadata: {},
              retryCount: 0,
              retryMetadata: {},
              createdAt: job.createdAt,
              updatedAt: job.updatedAt,
              startedAt: job.startedAt,
              finishedAt: job.finishedAt
            }
          ],
          dependencies: [],
          events: []
        }
      ])
    );

    Object.assign(testWindow, {
      __timelineListCalls: 0,
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
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
          saveMask: async () => {
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
          },
          jobs: {
            list: async () => {
              testWindow.__timelineListCalls += 1;

              if (testWindow.__timelineListCalls === 1) {
                return new Promise((resolve) => {
                  testWindow.__resolveFirstTimelineList = () => resolve([staleJob]);
                });
              }

              return [freshJob];
            },
            get: async (_projectId: string, jobId: string) => detailByJob.get(jobId),
            cancel: async () => {
              throw new Error("not used");
            },
            retryItem: async () => {
              throw new Error("not used");
            },
            execute: async () => {
              throw new Error("not used");
            },
            enqueue: async () => {
              throw new Error("not used");
            }
          }
        }
      }
    });
  });

  await page.goto("/");
  await createProjectFromStart(page, "Timeline Race");

  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __timelineListCalls: number }).__timelineListCalls), {
      timeout: 7000
    })
    .toBeGreaterThan(1);
  await expect(page.getByTestId("run-timeline")).toContainText("fresh-root");

  await page.evaluate(() => (window as typeof window & { __resolveFirstTimelineList?: () => void }).__resolveFirstTimelineList?.());
  await expect(page.getByTestId("run-timeline")).toContainText("fresh-root");
  await expect(page.getByTestId("run-timeline")).not.toContainText("stale-root");
});

test("Shift-dragging a generated image payload creates an Edit node", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & { __savedGraph: any };
    const graph = {
      nodes: [
        {
          id: "generation",
          type: "etherNode",
          position: { x: 380, y: 220 },
          width: 260,
          height: 220,
          selected: true,
          data: {
            definitionId: "generation-image",
            kind: "Generation",
            subtype: "Image",
            title: "Image",
            label: "Generated source",
            notes: "",
            instruction: "",
            status: "complete",
            rerunState: "complete",
            assetId: "generated-asset-1",
            assetKind: "generated",
            assetPath: "C:\\Fake\\ShiftDrag.ether\\assets\\generated\\image.svg",
            assetMetadata: { prompt: "source prompt" }
          }
        }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\ShiftDrag.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Shift Drag",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\ShiftDrag.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(testWindow, {
      __savedGraph: null,
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        project: {
          create: async () => project,
          open: async () => project,
          saveGraph: async (_projectId: string, nextGraph: any) => {
            testWindow.__savedGraph = nextGraph;
            return nextGraph;
          },
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
          saveMask: async () => {
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
  await createProjectFromStart(page);
  await page.getByTestId("panel-inspector-toggle").click();

  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.setData(
      "application/ether-image-asset",
      JSON.stringify({
        nodeId: "generation",
        assetId: "generated-asset-1",
        assetKind: "generated",
        assetPath: "C:\\Fake\\ShiftDrag.ether\\assets\\generated\\image.svg",
        assetMetadata: { prompt: "source prompt" },
        title: "Image"
      })
    );
    return transfer;
  });

  await page.locator(".react-flow").dispatchEvent("drop", {
    clientX: 620,
    clientY: 320,
    shiftKey: true,
    dataTransfer
  });

  await expect(page.getByTestId("ether-node")).toHaveCount(2);
  await expect(page.getByTestId("ether-node").getByRole("heading", { name: "Inpaint" })).toBeVisible();
  await expect(page.getByTestId("canvas-status")).toContainText("Created Inpaint edit");
  await page.getByRole("button", { name: "Save Graph" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __savedGraph: any }).__savedGraph?.edges?.length))
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __savedGraph: any }).__savedGraph?.edges?.[0]?.label))
    .toBe("image");
});

test("artifact browser filters, annotates, reveals lineage, and drags image artifacts to canvas", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __artifactCalls: string[];
      __savedGraph: any;
    };
    const artifacts = [
      {
        id: "artifact-reference-1",
        kind: "reference",
        type: "reference",
        nodeId: "reference-source",
        runId: null,
        jobId: null,
        path: "C:\\Fake\\Artifacts.ether\\references\\mood.png",
        metadata: { assetId: "reference-asset-1", title: "Mood board", tags: ["brief"] },
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z"
      },
      {
        id: "artifact-image-1",
        kind: "image",
        type: "image",
        nodeId: "generation-source",
        runId: "run-1",
        jobId: "job-1",
        path: "C:\\Fake\\Artifacts.ether\\assets\\generated\\hero.svg",
        metadata: { assetId: "generated-asset-1", title: "Hero table render", tags: ["select"] },
        createdAt: "2026-06-17T12:01:00.000Z",
        updatedAt: "2026-06-17T12:01:00.000Z"
      },
      {
        id: "artifact-report-1",
        kind: "report",
        type: "report",
        nodeId: null,
        runId: "run-1",
        jobId: "job-1",
        path: null,
        metadata: { title: "Evaluation notes", text: "Hero table is strongest" },
        createdAt: "2026-06-17T12:02:00.000Z",
        updatedAt: "2026-06-17T12:02:00.000Z"
      }
    ];
    const graph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Artifacts.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Artifacts",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Artifacts.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(testWindow, {
      __artifactCalls: [],
      __savedGraph: null,
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        project: {
          create: async () => project,
          open: async () => project,
          saveGraph: async (_projectId: string, nextGraph: any) => {
            testWindow.__savedGraph = nextGraph;
            return nextGraph;
          },
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
          saveMask: async () => {
            throw new Error("not used");
          },
          moveToCollection: async () => {
            throw new Error("not used");
          },
          listMoves: async () => []
        },
        artifacts: {
          list: async (_projectId: string, query?: any) => {
            if (query && Object.prototype.hasOwnProperty.call(query, "search") && query.search === "") {
              throw new Error("search must not be sent when empty");
            }
            testWindow.__artifactCalls.push(`list:${query?.kind ?? "all"}:${query?.search ?? ""}`);
            return artifacts.filter((artifact) => {
              const kindMatches = !query?.kind || artifact.kind === query.kind;
              const search = String(query?.search ?? "").toLowerCase();
              const haystack = `${artifact.path ?? ""} ${JSON.stringify(artifact.metadata)}`.toLowerCase();
              return kindMatches && (!search || haystack.includes(search));
            });
          },
          get: async (_projectId: string, artifactId: string) =>
            artifacts.find((artifact) => artifact.id === artifactId) ?? null,
          updateMetadata: async (_projectId: string, options: any) => {
            testWindow.__artifactCalls.push(`update:${options.artifactId}`);
            return artifacts.find((artifact) => artifact.id === options.artifactId);
          },
          tag: async (_projectId: string, options: any) => {
            testWindow.__artifactCalls.push(`tag:${options.artifactId}:${options.tag}`);
            return artifacts.find((artifact) => artifact.id === options.artifactId);
          },
          rate: async (_projectId: string, options: any) => {
            testWindow.__artifactCalls.push(`rate:${options.artifactId}:${options.rating}`);
            return artifacts.find((artifact) => artifact.id === options.artifactId);
          },
          listLineageParents: async () => [artifacts[0]],
          listLineageChildren: async () => [artifacts[2]],
          addToCollection: async (_projectId: string, options: any) => {
            testWindow.__artifactCalls.push(`collection:${options.artifactId}:${options.collectionId}`);
          },
          listByCollection: async () => [artifacts[1]],
          revealFile: async (_projectId: string, artifactId: string) => {
            testWindow.__artifactCalls.push(`reveal:${artifactId}`);
          }
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
  await createProjectFromStart(page, "Artifacts");

  await page.getByRole("button", { name: /Artifacts/ }).click();
  await expect(page.getByTestId("artifact-browser")).toBeVisible();
  await expect(page.getByTestId("artifact-card-artifact-image-1")).toContainText("Hero table render");

  await page.getByTestId("artifact-search").fill("hero");
  await expect(page.getByTestId("artifact-card-artifact-image-1")).toBeVisible();
  await expect(page.getByTestId("artifact-card-artifact-reference-1")).toHaveCount(0);

  await page.getByTestId("artifact-kind-filter").selectOption("image");
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __artifactCalls: string[] }).__artifactCalls))
    .toContain("list:image:hero");

  await page.getByTestId("artifact-tag-input-artifact-image-1").fill("keeper");
  await page.getByTestId("artifact-tag-button-artifact-image-1").click();
  await page.getByTestId("artifact-rate-button-artifact-image-1").click();
  await page.getByTestId("artifact-reveal-button-artifact-image-1").click();
  await page.getByTestId("artifact-lineage-tab").click();
  await expect(page.getByTestId("artifact-lineage")).toContainText("Mood board");
  await expect(page.getByTestId("artifact-lineage")).toContainText("Evaluation notes");
  await page.getByTestId("artifact-grid-tab").click();

  const card = page.getByTestId("artifact-card-artifact-image-1");
  const canvas = page.locator(".react-flow");
  const sourceBox = await card.boundingBox();
  const targetBox = await canvas.boundingBox();

  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await page.mouse.move(sourceBox!.x + 20, sourceBox!.y + 20);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByTestId("ether-node")).toHaveCount(1);
  await expect(page.getByTestId("ether-node")).toContainText("Hero table render");
  await page.getByRole("button", { name: "Save Graph" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __savedGraph: any }).__savedGraph?.nodes?.[0]?.data))
    .toMatchObject({
      kind: "Reference",
      assetId: "generated-asset-1",
      assetPath: "C:\\Fake\\Artifacts.ether\\assets\\generated\\hero.svg"
    });
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __artifactCalls: string[] }).__artifactCalls))
    .toEqual(expect.arrayContaining(["tag:artifact-image-1:keeper", "rate:artifact-image-1:5", "reveal:artifact-image-1"]));
});

test("artifact browser drags copied artifacts without claiming the source asset id", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __savedGraph: any;
    };
    const artifacts = [
      {
        id: "artifact-copied-1",
        kind: "image",
        type: "image",
        nodeId: "filter",
        runId: null,
        jobId: null,
        path: "C:\\Fake\\Copied.ether\\collections\\Selected\\hero.png",
        metadata: {
          assetId: "source-generated-asset",
          copiedFromAssetId: "source-generated-asset",
          copiedFromPath: "C:\\Fake\\Copied.ether\\assets\\generated\\hero.png",
          title: "Copied hero"
        },
        createdAt: "2026-06-17T12:01:00.000Z",
        updatedAt: "2026-06-17T12:01:00.000Z"
      }
    ];
    const graph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Copied.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Copied",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Copied.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(testWindow, {
      __savedGraph: null,
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        project: {
          create: async () => project,
          open: async () => project,
          saveGraph: async (_projectId: string, nextGraph: any) => {
            testWindow.__savedGraph = nextGraph;
            return nextGraph;
          },
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
          saveMask: async () => {
            throw new Error("not used");
          },
          moveToCollection: async () => {
            throw new Error("not used");
          },
          listMoves: async () => []
        },
        artifacts: {
          list: async () => artifacts,
          get: async () => artifacts[0],
          updateMetadata: async () => artifacts[0],
          tag: async () => artifacts[0],
          rate: async () => artifacts[0],
          listLineageParents: async () => [],
          listLineageChildren: async () => [],
          addToCollection: async () => undefined,
          listByCollection: async () => [],
          revealFile: async () => undefined
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
  await createProjectFromStart(page, "Copied");
  await page.getByRole("button", { name: /Artifacts/ }).click();
  await expect(page.getByTestId("artifact-card-artifact-copied-1")).toContainText("Copied hero");

  const card = page.getByTestId("artifact-card-artifact-copied-1");
  const canvas = page.locator(".react-flow");
  const sourceBox = await card.boundingBox();
  const targetBox = await canvas.boundingBox();

  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await page.mouse.move(sourceBox!.x + 20, sourceBox!.y + 20);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Save Graph" }).click();

  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __savedGraph: any }).__savedGraph?.nodes?.[0]?.data))
    .toMatchObject({
      assetPath: "C:\\Fake\\Copied.ether\\collections\\Selected\\hero.png",
      assetMetadata: expect.objectContaining({
        artifactId: "artifact-copied-1",
        copiedFromAssetId: "source-generated-asset"
      })
    });
  const savedData = await page.evaluate(() => (window as typeof window & { __savedGraph: any }).__savedGraph?.nodes?.[0]?.data);
  expect(savedData.assetId).toBeUndefined();
});

test("Shift-dragging an artifact browser image into an empty canvas creates an Edit route", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & { __savedGraph: any };
    const artifacts = [
      {
        id: "artifact-image-orphan",
        kind: "image",
        type: "image",
        nodeId: null,
        runId: "run-1",
        jobId: "job-1",
        path: "C:\\Fake\\Artifact Shift.ether\\assets\\generated\\orphan.svg",
        metadata: { assetId: "generated-asset-orphan", title: "Reusable orphan" },
        createdAt: "2026-06-17T12:01:00.000Z",
        updatedAt: "2026-06-17T12:01:00.000Z"
      }
    ];
    const graph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Artifact Shift.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Artifact Shift",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Artifact Shift.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(testWindow, {
      __savedGraph: null,
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        project: {
          create: async () => project,
          open: async () => project,
          saveGraph: async (_projectId: string, nextGraph: any) => {
            testWindow.__savedGraph = nextGraph;
            return nextGraph;
          },
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
          saveMask: async () => {
            throw new Error("not used");
          },
          moveToCollection: async () => {
            throw new Error("not used");
          },
          listMoves: async () => []
        },
        artifacts: {
          list: async () => artifacts,
          get: async () => artifacts[0],
          updateMetadata: async () => artifacts[0],
          tag: async () => artifacts[0],
          rate: async () => artifacts[0],
          listLineageParents: async () => [],
          listLineageChildren: async () => [],
          addToCollection: async () => undefined,
          listByCollection: async () => [],
          revealFile: async () => undefined
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
  await createProjectFromStart(page, "Artifact Shift");
  await page.getByRole("button", { name: /Artifacts/ }).click();
  await expect(page.getByTestId("artifact-card-artifact-image-orphan")).toBeVisible();

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await page.getByTestId("artifact-card-artifact-image-orphan").dispatchEvent("dragstart", { dataTransfer });
  await page.locator(".react-flow").dispatchEvent("drop", {
    clientX: 620,
    clientY: 320,
    shiftKey: true,
    dataTransfer
  });

  await expect(page.getByTestId("ether-node")).toHaveCount(2);
  await expect(page.getByTestId("ether-node").getByRole("heading", { name: "Inpaint" })).toBeVisible();
  await expect(page.getByTestId("canvas-status")).toContainText("Created Inpaint edit");
  await page.getByRole("button", { name: "Save Graph" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __savedGraph: any }).__savedGraph?.edges?.length))
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __savedGraph: any }).__savedGraph?.nodes?.map((node: any) => node.data.kind)))
    .toEqual(expect.arrayContaining(["Reference", "Edit"]));
});

test("edit workspace draws, saves, and previews mask recipe metadata", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __maskCalls: number;
      __maskSaveOptions: any;
      __previewCalls: any[];
    };
    const capturedPointerIds = new WeakMap<Element, number>();

    Object.defineProperty(Element.prototype, "setPointerCapture", {
      configurable: true,
      value(this: Element, pointerId: number) {
        capturedPointerIds.set(this, pointerId);
      }
    });
    Object.defineProperty(Element.prototype, "hasPointerCapture", {
      configurable: true,
      value(this: Element, pointerId: number) {
        return capturedPointerIds.get(this) === pointerId;
      }
    });
    Object.defineProperty(Element.prototype, "releasePointerCapture", {
      configurable: true,
      value(this: Element, pointerId: number) {
        if (capturedPointerIds.get(this) === pointerId) {
          capturedPointerIds.delete(this);
        }
      }
    });
    let savedGraph: any = null;
    const graph = {
      nodes: [
        {
          id: "edit",
          type: "etherNode",
          position: { x: 420, y: 220 },
          width: 260,
          height: 220,
          selected: true,
          data: {
            definitionId: "edit-inpaint",
            kind: "Edit",
            subtype: "Inpaint",
            title: "Inpaint",
            label: "Face repair",
            notes: "soft edge",
            instruction: "mask the face only",
            status: "idle",
            sourceAssetId: "generated-asset-1",
            sourceAssetKind: "generated",
            sourceAssetPath: "C:\\Fake\\Mask.ether\\assets\\generated\\image.svg",
            sourceAssetMetadata: { prompt: "source prompt", artifactId: "source-artifact-1" }
          }
        }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Mask.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Mask",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Mask.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(testWindow, {
      __maskCalls: 0,
      __maskSaveOptions: null,
      __previewCalls: [],
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        project: {
          create: async () => ({ ...project, graph: savedGraph ?? graph }),
          open: async () => ({ ...project, graph: savedGraph ?? graph }),
          saveGraph: async (_projectId: string, nextGraph: any) => {
            savedGraph = nextGraph;
            return nextGraph;
          },
          loadGraph: async () => savedGraph ?? graph,
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
          saveMask: async (_projectId: string, options: any) => {
            testWindow.__maskCalls += 1;
            testWindow.__maskSaveOptions = options;
            return {
              id: "mask-asset-1",
              kind: "mask",
              path: "C:\\Fake\\Mask.ether\\assets\\masks\\edit\\mask.svg",
              metadata: {
                ...options.metadata,
                artifactId: "mask-artifact-1",
                editNodeId: "edit",
                sourceAssetId: "generated-asset-1"
              },
              createdAt: "2026-06-17T12:00:00.000Z",
              updatedAt: "2026-06-17T12:00:00.000Z"
            };
          },
          moveToCollection: async () => {
            throw new Error("not used");
          },
          listMoves: async () => []
        },
        execution: {
          preview: async (_projectId: string, previewGraph: any, request: any) => {
            testWindow.__previewCalls.push({ graph: previewGraph, request });
            return {
              plan: {
                policy: request.policy,
                targetNodeIds: request.targetNodeIds,
                nodeIds: request.targetNodeIds,
                items: request.targetNodeIds.map((nodeId: string) => ({ nodeId, iteration: 1 })),
                parallel: false,
                runCountCap: request.runCountCap
              },
              dirtyNodeIds: ["edit"],
              providerCallCandidates: ["edit"],
              expectedOutputCount: 1,
              blockedReasons: [],
              items: [{ nodeId: "edit", iteration: 1, kind: "Edit", willCallProvider: true }]
            };
          },
          run: async () => {
            throw new Error("not used");
          }
        }
      }
    });
  });

  await page.goto("/");
  await createProjectFromStart(page);

  await expect(page.getByTestId("edit-workspace")).toBeVisible();
  await expect(page.getByTestId("edit-before-preview")).toContainText("Before");
  await expect(page.getByTestId("edit-after-preview")).toContainText("After");
  await expect(page.getByTestId("mask-canvas-source")).toBeVisible();
  await expect(page.getByTestId("mask-canvas-overlay")).toBeVisible();

  const brushButton = page.getByRole("button", { name: "Brush" });
  const eraserButton = page.getByRole("button", { name: "Eraser" });
  await expect(brushButton).toBeVisible();
  await expect(eraserButton).toBeVisible();
  await eraserButton.click();
  await expect(eraserButton).toHaveAttribute("aria-pressed", "true");
  await brushButton.click();
  await expect(brushButton).toHaveAttribute("aria-pressed", "true");

  await page.getByLabel("Edit recipe").selectOption("product-cleanup");
  await page.getByLabel("Frame mode").selectOption("outpaint");
  await page.getByLabel("Frame X").fill("-24");
  await page.getByLabel("Frame Y").fill("12");
  await page.getByLabel("Frame width").fill("1180");
  await page.getByLabel("Frame height").fill("900");

  await setRangeInput(page, "Brush size", "34");
  await setRangeInput(page, "Mask opacity", "70");

  await drawMaskStroke(page);
  await expect(page.getByTestId("mask-stroke")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear mask" }).click();
  await expect(page.getByTestId("mask-stroke")).toHaveCount(0);
  await drawMaskStrokePastSecondaryPointer(page);
  await expect(page.getByTestId("mask-stroke")).toHaveCount(1);

  await page.getByRole("button", { name: "Save mask" }).click();

  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __maskCalls: number }).__maskCalls))
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __maskSaveOptions: any }).__maskSaveOptions))
    .toMatchObject({
      editNodeId: "edit",
      sourceAssetId: "generated-asset-1",
      sourceAssetPath: "C:\\Fake\\Mask.ether\\assets\\generated\\image.svg",
      mimeType: "image/svg+xml",
      metadata: {
        brush: { tool: "brush", size: 34, opacity: 0.7 },
        recipe: { id: "product-cleanup" },
        frame: { mode: "outpaint", x: -24, y: 12, width: 1180, height: 900 },
        canvas: { width: 1024, height: 768 },
        source: { assetId: "generated-asset-1", artifactId: "source-artifact-1" },
        strokeCount: 1
      }
    });
  await expect
    .poll(() => page.evaluate(() => String((window as typeof window & { __maskSaveOptions: any }).__maskSaveOptions?.content ?? "")))
    .toContain("<path");
  await expect
    .poll(() => page.evaluate(() => String((window as typeof window & { __maskSaveOptions: any }).__maskSaveOptions?.content ?? "")))
    .toContain(" L ");
  await expect
    .poll(() => page.evaluate(() => String((window as typeof window & { __maskSaveOptions: any }).__maskSaveOptions?.content ?? "")))
    .not.toContain("ETHER_MASK_OVERLAY");
  await expect(page.getByTestId("inspector-mask-metadata")).toContainText("mask-asset-1");
  await expect(page.getByTestId("node-mask-overlay")).toBeVisible();

  await page.getByRole("button", { name: "Run Node" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __previewCalls: any[] }).__previewCalls.length))
    .toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const call = (window as typeof window & { __previewCalls: any[] }).__previewCalls[0];
        return call?.graph?.nodes?.find((node: any) => node.id === "edit")?.data;
      })
    )
    .toMatchObject({
      editRecipe: "product-cleanup",
      editFrame: { mode: "outpaint", x: -24, y: 12, width: 1180, height: 900 },
      maskAssetId: "mask-asset-1",
      maskAssetPath: "C:\\Fake\\Mask.ether\\assets\\masks\\edit\\mask.svg",
      maskMetadata: {
        brush: { tool: "brush", size: 34, opacity: 0.7 },
        recipe: { id: "product-cleanup" },
        frame: { mode: "outpaint", x: -24, y: 12, width: 1180, height: 900 }
      }
    });
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { __previewCalls: any[] }).__previewCalls[0]?.request)
    )
    .toMatchObject({ targetNodeIds: ["edit"] });

  await page.getByRole("button", { name: "Save Graph" }).click();
  await page.getByRole("button", { name: "Load Graph" }).click();

  await expect(page.getByTestId("inspector-mask-metadata")).toContainText("mask-asset-1");
});

test("note visual subtypes render cloud and bubble as distinct non-rectangular visuals", async ({ page }) => {
  const graph = {
    nodes: [
      {
        id: "note-cloud",
        type: "etherNode",
        position: { x: 280, y: 160 },
        width: 240,
        height: 156,
        selected: false,
        data: {
          definitionId: "note-cloud",
          kind: "Note",
          subtype: "Cloud",
          title: "Cloud",
          label: "Cloud",
          notes: "Soft campaign thought",
          instruction: "",
          status: "idle"
        }
      },
      {
        id: "note-bubble",
        type: "etherNode",
        position: { x: 560, y: 160 },
        width: 240,
        height: 156,
        selected: true,
        data: {
          definitionId: "note-bubble",
          kind: "Note",
          subtype: "Bubble",
          title: "Bubble",
          label: "Bubble",
          notes: "Client quote",
          instruction: "",
          status: "idle"
        }
      }
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedSnapshotId: null,
    updatedAt: "2026-06-17T12:00:00.000Z"
  };

  await openProjectWithGraph(page, graph, "Note Visuals");

  await expect(page.getByTestId("note-visual-cloud")).toBeVisible();
  await expect(page.getByTestId("note-visual-bubble")).toBeVisible();
  await expect(page.getByTestId("note-visual-cloud").locator("path")).toHaveCount(1);
  await expect(page.getByTestId("note-visual-bubble").locator("ellipse")).toHaveCount(1);

  for (const visual of ["note-visual-cloud", "note-visual-bubble"]) {
    const shellStyle = await page.getByTestId(visual).locator("xpath=ancestor::article[1]").evaluate((element) => {
      const style = getComputedStyle(element);

      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderColor: style.borderColor,
        boxShadow: style.boxShadow
      };
    });

    expect(shellStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(shellStyle.backgroundImage).toBe("none");
    expect(shellStyle.borderColor).toBe("rgba(0, 0, 0, 0)");
    expect(shellStyle.boxShadow).toBe("none");
  }
});

test("free draw note stores strokes on save graph, reloads them, and clear persists", async ({ page }) => {
  const graph = {
    nodes: [
      {
        id: "free-draw",
        type: "etherNode",
        position: { x: 340, y: 160 },
        width: 280,
        height: 220,
        selected: true,
        data: {
          definitionId: "note-free-draw",
          kind: "Note",
          subtype: "Free Draw",
          title: "Free Draw",
          label: "Free Draw",
          notes: "",
          instruction: "",
          status: "idle"
        }
      }
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedSnapshotId: null,
    updatedAt: "2026-06-17T12:00:00.000Z"
  };

  await openProjectWithGraph(page, graph, "Free Draw");
  await drawNoteStroke(page);

  await expect(page.getByTestId("note-stroke")).toHaveCount(1);
  await page.getByRole("button", { name: "Save Graph" }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = (window as any).__lastSavedGraph;
        return saved?.nodes?.find((node: any) => node.id === "free-draw")?.data?.noteStrokes;
      })
    )
    .toEqual([
      expect.objectContaining({
        points: expect.arrayContaining([
          expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })
        ])
      })
    ]);

  await page.getByRole("button", { name: "Load Graph" }).click();
  await expect(page.getByTestId("note-stroke")).toHaveCount(1);

  await page.getByRole("button", { name: "Clear drawing" }).click();
  await expect(page.getByTestId("note-stroke")).toHaveCount(0);
  await page.getByRole("button", { name: "Save Graph" }).click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = (window as any).__lastSavedGraph;
        return saved?.nodes?.find((node: any) => node.id === "free-draw")?.data?.noteStrokes;
      })
    )
    .toEqual([]);
});

test("reference preview renders multiple image assets in the grid", async ({ page }) => {
  const graph = {
    nodes: [
      {
        id: "reference-images",
        type: "etherNode",
        position: { x: 340, y: 160 },
        width: 280,
        height: 220,
        selected: true,
        data: {
          definitionId: "reference-image",
          kind: "Reference",
          subtype: "Image",
          title: "3 references",
          label: "3 references",
          notes: "",
          instruction: "Linked 3 image references",
          status: "complete",
          referenceAssets: [
            { assetPath: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", assetKind: "reference", title: "One.png" },
            { assetPath: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", assetKind: "reference", title: "Two.png" },
            { assetPath: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", assetKind: "reference", title: "Three.png" }
          ]
        }
      }
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedSnapshotId: null,
    updatedAt: "2026-06-17T12:00:00.000Z"
  };

  await openProjectWithGraph(page, graph, "Image Grid");

  await expect(page.getByTestId("node-reference-grid")).toBeVisible();
  await expect(page.getByTestId("node-reference-image")).toHaveCount(3);
  await expect(page.getByTestId("node-reference-add")).toBeVisible();
  await expect(page.getByTestId("node-reference-replace")).toBeVisible();
});

test("reference preview shows image, video, audio, mask, data, and text states without broken image tags", async ({ page }) => {
  const graph = {
    nodes: [
      {
        id: "reference-mixed",
        type: "etherNode",
        position: { x: 300, y: 120 },
        width: 340,
        height: 300,
        selected: true,
        data: {
          definitionId: "reference-moodboard",
          kind: "Reference",
          subtype: "Moodboard",
          title: "Mixed references",
          label: "Mixed references",
          notes: "",
          instruction: "Six-channel reference bundle",
          status: "complete",
          referenceAssets: [
            { assetPath: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", assetKind: "reference", title: "hero.png", assetMetadata: { channel: "image", mimeType: "image/png" } },
            { assetPath: "C:\\Fake\\clip.mp4", assetKind: "reference", title: "clip.mp4", assetMetadata: { channel: "video", mimeType: "video/mp4" } },
            { assetPath: "C:\\Fake\\beat.wav", assetKind: "reference", title: "beat.wav", assetMetadata: { channel: "audio", mimeType: "audio/wav" } },
            { assetPath: "C:\\Fake\\mask.svg", assetKind: "mask", title: "mask.svg", assetMetadata: { channel: "mask", mimeType: "image/svg+xml" } },
            { assetPath: "C:\\Fake\\palette.csv", assetKind: "reference", title: "palette.csv", assetMetadata: { channel: "data", mimeType: "text/csv" } },
            { assetPath: "C:\\Fake\\brief.txt", assetKind: "reference", title: "brief.txt", assetMetadata: { channel: "text", mimeType: "text/plain" } }
          ]
        }
      }
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedSnapshotId: null,
    updatedAt: "2026-06-17T12:00:00.000Z"
  };

  await openProjectWithGraph(page, graph, "Reference Preview");

  for (const channel of ["image", "video", "audio", "mask", "data", "text"]) {
    await expect(page.getByTestId(`node-reference-${channel}`)).toBeVisible();
  }

  await expect(page.getByTestId("node-reference-video").locator("img")).toHaveCount(0);
  await expect(page.getByTestId("node-reference-audio").locator("img")).toHaveCount(0);
  await expect(page.getByTestId("node-reference-data").locator("img")).toHaveCount(0);
  await expect(page.getByTestId("inspector-reference-controls")).toContainText("6 linked assets");
});

test("ReferenceInspector includes Audio Reference in the type dropdown", async ({ page }) => {
  const graph = {
    nodes: [
      {
        id: "audio-reference",
        type: "etherNode",
        position: { x: 340, y: 160 },
        width: 260,
        height: 180,
        selected: true,
        data: {
          definitionId: "reference-audio-reference",
          kind: "Reference",
          subtype: "Audio Reference",
          title: "Audio Reference",
          label: "Audio Reference",
          notes: "",
          instruction: "Audio reference",
          status: "idle"
        }
      }
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedSnapshotId: null,
    updatedAt: "2026-06-17T12:00:00.000Z"
  };

  await openProjectWithGraph(page, graph, "Audio Reference");

  await expect(page.getByLabel("Reference type")).toHaveValue("reference-audio-reference");
  await expect(page.getByLabel("Reference type").locator("option")).toContainText([
    "Image",
    "Video Reference",
    "Audio Reference",
    "Colour Grid",
    "Moodboard"
  ]);
  await expect(page.getByTestId("inspector-reference-controls").getByRole("button", { name: "Add image" })).toBeVisible();
  await expect(page.getByTestId("inspector-reference-controls").getByRole("button", { name: "Replace image" })).toBeVisible();
});

test("loads and persists desktop project fields through settings", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & { __savedSettings: unknown[] };

    Object.assign(testWindow, {
      __savedSettings: [],
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        settings: {
          load: async () => ({
            parentDirectory: "C:\\Ether",
            projectName: "Persisted Campaign",
            projectPath: "C:\\Ether\\Persisted.ether",
            recentProjects: ["C:\\Ether\\Persisted.ether"]
          }),
          save: async (settings: unknown) => {
            testWindow.__savedSettings.push(settings);
            return settings;
          }
        },
        project: {
          create: async () => {
            throw new Error("not used");
          },
          open: async () => {
            throw new Error("not used");
          },
          saveGraph: async () => {
            throw new Error("not used");
          },
          loadGraph: async () => {
            throw new Error("not used");
          },
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
          saveMask: async () => {
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

  await expect(page.getByTestId("start-screen")).toContainText("C:\\Ether\\Persisted.ether");
  await page.getByRole("button", { name: "New Project" }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("Persisted Campaign");

  await page.getByLabel("Project name").fill("Revised Campaign");

  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __savedSettings: any[] }).__savedSettings.at(-1)))
    .toMatchObject({ projectName: "Revised Campaign" });
});

test("desktop settings persistence keeps the newest rapid edit", async ({ page }) => {
  await page.addInitScript(() => {
    type DeferredSave = {
      settings: any;
      resolve: (value: any) => void;
    };
    const testWindow = window as typeof window & {
      __settingsSaves: DeferredSave[];
      __savedSettings: any[];
    };

    Object.assign(testWindow, {
      __settingsSaves: [],
      __savedSettings: [],
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        settings: {
          load: async () => ({
            parentDirectory: "",
            projectName: "Untitled Ether Project",
            projectPath: "",
            recentProjects: []
          }),
          save: async (settings: any) => {
            if (settings.projectName === "Untitled Ether Project") {
              return settings;
            }

            return new Promise((resolve) => {
              testWindow.__settingsSaves.push({
                settings,
                resolve: (value) => {
                  testWindow.__savedSettings.push(value);
                  resolve(value);
                }
              });
            });
          }
        },
        project: {
          create: async () => {
            throw new Error("not used");
          },
          open: async () => {
            throw new Error("not used");
          },
          saveGraph: async () => {
            throw new Error("not used");
          },
          loadGraph: async () => {
            throw new Error("not used");
          },
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
          saveMask: async () => {
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
  await page.getByRole("button", { name: "New Project" }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("Untitled Ether Project");
  await page.getByLabel("Project name").fill("A");

  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __settingsSaves: any[] }).__settingsSaves.length))
    .toBe(1);

  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __settingsSaves: any[] }).__settingsSaves[0]?.settings))
    .toMatchObject({ projectName: "A" });

  await page.getByLabel("Project name").fill("AB");
  await page.getByLabel("Project name").fill("ABC");

  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __settingsSaves: Array<{ settings: any; resolve: (value: any) => void }>;
    };
    const first = testWindow.__settingsSaves[0];

    first.resolve(first.settings);
  });

  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __settingsSaves: any[] }).__settingsSaves.length))
    .toBe(2);

  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __settingsSaves: any[] }).__settingsSaves[1]?.settings))
    .toMatchObject({ projectName: "ABC" });

  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __savedSettings: any[] }).__savedSettings.at(-1)))
    .toMatchObject({ projectName: "A" });
});

test("provider run errors stay recoverable in the canvas", async ({ page }) => {
  await page.addInitScript(() => {
    const graph = {
      nodes: [
        {
          id: "generation",
          type: "etherNode",
          position: { x: 420, y: 220 },
          width: 260,
          height: 180,
          selected: true,
          data: {
            definitionId: "generation-image",
            kind: "Generation",
            subtype: "Image",
            title: "Image",
            label: "Recoverable generation",
            notes: "",
            instruction: "test unavailable provider",
            status: "idle",
            rerunState: "ready"
          }
        }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const failedGraph = {
      ...graph,
      nodes: [
        {
          ...graph.nodes[0],
          data: {
            ...graph.nodes[0].data,
            status: "error",
            rerunState: "error",
            lastRunAt: "2026-06-17T12:01:00.000Z"
          }
        }
      ],
      updatedAt: "2026-06-17T12:01:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Recoverable.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Recoverable",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Recoverable.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(window, {
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
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
          saveMask: async () => {
            throw new Error("not used");
          },
          moveToCollection: async () => {
            throw new Error("not used");
          },
          listMoves: async () => []
        },
        execution: {
          preview: async () => ({
            plan: {
              policy: "cached-inputs",
              targetNodeIds: ["generation"],
              nodeIds: ["generation"],
              items: [{ nodeId: "generation", iteration: 1 }],
              parallel: false,
              runCountCap: 1
            },
            dirtyNodeIds: [],
            providerCallCandidates: ["generation"],
            expectedOutputCount: 1,
            blockedReasons: [],
            items: [
              {
                nodeId: "generation",
                iteration: 1,
                kind: "Generation",
                willCallProvider: true
              }
            ]
          }),
          run: async () => ({
            graph: failedGraph,
            plan: {
              policy: "cached-inputs",
              targetNodeIds: ["generation"],
              nodeIds: ["generation"],
              items: [{ nodeId: "generation", iteration: 1 }],
              parallel: false,
              runCountCap: 1
            },
            results: [
              {
                nodeId: "generation",
                iteration: 1,
                status: "error",
                action: "generate",
                reason: "Provider unavailable",
                startedAt: "2026-06-17T12:01:00.000Z",
                finishedAt: "2026-06-17T12:01:00.000Z"
              }
            ]
          })
        }
      }
    });
  });

  await page.goto("/");
  await createProjectFromStart(page);
  await page.getByRole("button", { name: "Run Node" }).click();
  await expect(page.getByTestId("run-plan-preview")).toBeVisible();
  await page.getByTestId("run-preview-start").click();

  await expect(page.getByTestId("canvas-status")).toContainText("Run finished with 1 error");
  await expect(page.getByTestId("ether-node")).toContainText("error");
  await expect(page.getByRole("button", { name: "Run Node" })).toBeEnabled();
});

test("co-pilot graph patch lane previews, applies, rejects, and does not run", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __runCalls: number;
      __savedGraph: any;
    };
    const graph = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedSnapshotId: null,
      updatedAt: "2026-06-17T12:00:00.000Z"
    };
    const project = {
      projectId: "11111111-1111-4111-8111-111111111111",
      path: "C:\\Fake\\Co-Pilot.ether",
      metadata: {
        id: "22222222-2222-4222-8222-222222222222",
        displayName: "Co-Pilot",
        appVersion: "0.1.0",
        createdAt: "2026-06-17T12:00:00.000Z",
        updatedAt: "2026-06-17T12:00:00.000Z",
        brandLockup: "ETHER by DreamBay",
        autosave: { enabled: true, intervalMs: 60000 },
        providerPreferences: {},
        activeSnapshotId: null
      },
      graph,
      database: { path: "C:\\Fake\\Co-Pilot.ether\\ether.db", tables: [], healthIssueCount: 0 }
    };

    Object.assign(testWindow, {
      __runCalls: 0,
      __savedGraph: null,
      ether: {
        shell: "desktop",
        file: { getDroppedFilePath: () => null },
        settings: {
          load: async () => ({
            parentDirectory: "C:\\Fake",
            projectName: "Co-Pilot",
            projectPath: "",
            recentProjects: []
          }),
          save: async (settings: unknown) => settings
        },
        project: {
          defaultParentDirectory: async () => "C:\\Fake",
          selectParentDirectory: async () => "C:\\Fake",
          selectProjectBundle: async () => "C:\\Fake\\Co-Pilot.ether",
          create: async () => ({ ...project, graph: testWindow.__savedGraph ?? graph }),
          open: async () => ({ ...project, graph: testWindow.__savedGraph ?? graph }),
          saveGraph: async (_projectId: string, nextGraph: any) => {
            testWindow.__savedGraph = nextGraph;
            return nextGraph;
          },
          loadGraph: async () => testWindow.__savedGraph ?? graph,
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
          saveMask: async () => {
            throw new Error("not used");
          },
          moveToCollection: async () => {
            throw new Error("not used");
          },
          listMoves: async () => []
        },
        execution: {
          preview: async () => ({
            plan: {
              policy: "cached-inputs",
              targetNodeIds: ["generation"],
              nodeIds: ["generation"],
              items: [{ nodeId: "generation", iteration: 1 }],
              parallel: false,
              runCountCap: 1
            },
            dirtyNodeIds: ["generation"],
            providerCallCandidates: ["generation"],
            expectedOutputCount: 1,
            blockedReasons: [],
            items: [
              { nodeId: "generation", iteration: 1, kind: "Generation", willCallProvider: true }
            ]
          }),
          run: async () => {
            testWindow.__runCalls += 1;
            throw new Error("run must be explicit");
          }
        }
      }
    });
  });

  await page.goto("/");
  await createProjectFromStart(page, "Co-Pilot");

  await page.getByRole("button", { name: "Command Palette" }).click();
  await expect(page.getByTestId("codex-command-palette")).toBeVisible();
  await page.getByRole("button", { name: "Propose starter workflow" }).click();
  await expect(page.getByTestId("graph-patch-diff")).toContainText("Added nodes");
  await expect(page.getByTestId("graph-patch-diff")).toContainText("Added edges");
  await expect(page.getByTestId("ether-node")).toHaveCount(0);

  await page.getByRole("button", { name: "Reject Patch" }).click();
  await expect(page.getByTestId("graph-patch-diff")).toHaveCount(0);
  await expect(page.getByTestId("ether-node")).toHaveCount(0);

  await page.getByRole("button", { name: "Propose starter workflow" }).click();
  await page.getByRole("button", { name: "Apply Patch" }).click();
  await expect(page.getByTestId("ether-node")).toHaveCount(2);
  await expect(page.getByTestId("canvas-status")).toContainText("Patch applied");
  await expect(page.getByRole("button", { name: "Run Node" })).toBeVisible();
  await page.getByRole("button", { name: "Save Graph" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __savedGraph: any }).__savedGraph?.edges?.[0]))
    .toMatchObject({
      sourceHandle: "text",
      targetHandle: "text",
      data: {
        graphVersion: "2.5",
        sourceChannel: "text",
        targetChannel: "text",
        role: "general"
      }
    });
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __runCalls: number }).__runCalls))
    .toBe(0);
});

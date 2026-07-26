import { expect, test } from "@playwright/test";

test("Provider Health and Settings expose truthful local runtime, privacy, layout, and About state", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const graph = {
      id: "release-status-graph",
      title: "Release status",
      kind: "root",
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:00.000Z",
      nodes: [],
      edges: [],
      groups: [],
      modules: [],
      viewState: {
        viewport: { x: 0, y: 0, zoom: 1 },
        selectedNodeIds: [],
        selectedEdgeIds: [],
        inspectorTarget: null
      }
    };
    const descriptor = {
      documentId: "release-status-document",
      displayName: "Release status.ether",
      named: true,
      mode: "writable",
      readOnlyReason: null,
      commands: { save: true, saveAs: true, saveCopy: true, compact: true, makePortable: true },
      saveState: "saved",
      documentRevisionId: "revision-1",
      graphId: graph.id,
      graphRevisionId: "graph-revision-1",
      simulationEnabled: false,
      revision: 1
    };
    const health = {
      providerId: "codex-chatgpt-image-2",
      status: "degraded",
      message: "App Server is unavailable; the explicit local exec fallback is active.",
      checkedAt: "2026-07-23T00:00:00.000Z",
      transport: "exec-fallback",
      version: "codex-cli-1.2.3",
      manifestHash: "1234567890abcdef1234567890abcdef",
      generation: 2,
      restartCount: 1,
      restartReason: null,
      fallbackReason: "App Server initialization failed.",
      processPhase: "ready",
      threadId: null,
      turnId: null,
      timing: {
        startedAt: "2026-07-23T00:00:00.000Z",
        initializedAt: "2026-07-23T00:00:01.000Z",
        initializationMs: 1000,
        lastExitAt: null
      }
    };
    const capability = {
      providerId: "codex-chatgpt-image-2",
      profileId: "codex-image-release",
      operation: "generate-image",
      inputChannels: ["text", "image"],
      outputChannels: ["image"],
      aspectRatios: ["1:1"],
      resolutions: [{ id: "1024", width: 1024, height: 1024, label: "1024 square" }],
      maxReferences: 4,
      maxOutputsPerCall: 1,
      supportsCancellation: true,
      supportsSeed: false,
      provenance: "conformance-verified",
      limitations: []
    };
    const providerQueries: Array<Record<string, unknown>> = [];
    const providerPolicies: boolean[] = [];
    let antigravityConfirmed = false;
    Object.defineProperty(window, "__releaseStatusProviderQueries", {
      value: providerQueries
    });
    Object.defineProperty(window, "__releaseStatusProviderPolicies", {
      value: providerPolicies
    });
    Object.defineProperty(window, "ether", { value: {
      document: {
        onEvent: () => () => undefined,
        bootstrap: async () => descriptor,
        new: async () => descriptor,
        open: async () => descriptor,
        openDropped: async () => descriptor,
        save: async () => descriptor,
        saveAs: async () => descriptor,
        saveCopy: async () => descriptor,
        close: async () => null,
        compact: async () => ({ beforeBytes: 10, afterBytes: 9 }),
        makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] })
      },
      graph: {
        snapshot: async () => ({ graph, revision: 1 }),
        applyTransaction: async () => ({ graph, revision: 1 })
      },
      artifacts: { search: async () => [], generateFake: async () => [] },
      references: { list: async () => [], act: async () => [] },
      application: {
        onEvent: () => () => undefined,
        command: async () => ({ payload: {} }),
        query: async (request: { name: string }) => {
          if (request.name === "provider.health" || request.name === "provider.capabilities") {
            providerQueries.push(request as unknown as Record<string, unknown>);
          }
          return request.name === "provider.health"
            ? { payload: { providers: [health] } }
            : request.name === "provider.capabilities"
              ? { payload: { capabilities: [capability] } }
              : request.name === "recovery.status"
                ? { payload: { state: "healthy", reportId: null, message: null } }
                : request.name === "recipe.catalog"
                  ? { payload: { recipes: [] } }
                  : { payload: { jobs: [] } };
        }
      },
      runtime: {
        providerHealth: async () => health,
        providerPolicy: async () => ({
          antigravityCreditOveragesConfirmed: antigravityConfirmed
        }),
        setProviderPolicy: async (confirmed: boolean) => {
          antigravityConfirmed = confirmed;
          providerPolicies.push(confirmed);
          return {
            antigravityCreditOveragesConfirmed: antigravityConfirmed
          };
        },
        versions: async () => ({ app: "4.0.0", electron: "43.1.1", node: "24.0.0" })
      }
    }});
    window.localStorage.setItem("ether.desktop.shell.v2:release-status-document", "{\"build\":{}}");
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("document-canvas")).toBeVisible();

  await page.getByRole("button", { name: "Provider Health" }).click();
  const providerDialog = page.getByRole("dialog", { name: "Provider Health" });
  await expect(providerDialog).toBeVisible();
  await expect(providerDialog).toContainText("Degraded");
  await expect(providerDialog).toContainText("exec-fallback");
  await expect(providerDialog).toContainText("codex-image-release");
  await expect(providerDialog).toContainText("No telemetry leaves this machine.");
  const providerQueries = await page.evaluate(() =>
    (window as typeof window & {
      __releaseStatusProviderQueries: Array<Record<string, unknown>>;
    }).__releaseStatusProviderQueries
  );
  expect(providerQueries.map((query) => query.name)).toEqual([
    "provider.health",
    "provider.capabilities",
  ]);
  for (const query of providerQueries) {
    expect(query).not.toHaveProperty("documentId");
  }
  await page.getByRole("button", { name: "Close Provider Health" }).click();

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await expect(settings.getByTestId("about-ether")).toContainText("4.0.0");
  await expect(settings).toContainText("Off in Ether 4.0");
  await expect(settings).toContainText("Credentials, user paths, and personal identifiers");
  await expect(settings.getByTestId("release-recovery-status")).toContainText("healthy");
  const antigravityPolicy = settings.getByRole("checkbox", {
    name: "Confirm Antigravity AI Credit Overages is Never"
  });
  await expect(antigravityPolicy).not.toBeChecked();
  await antigravityPolicy.check();
  await expect(settings).toContainText("Confirmation saved");
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __releaseStatusProviderPolicies: boolean[] })
      .__releaseStatusProviderPolicies
  )).toEqual([true]);
  await settings.getByRole("combobox", { name: "Control density" }).selectOption("compact");
  await settings.getByRole("combobox", { name: "Interface motion" }).selectOption("reduced");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await settings.getByRole("button", { name: "Reset panel layouts" }).click();
  await expect(settings).toContainText("Panel layouts will return to defaults");
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("ether.desktop.shell.v2:release-status-document"))).toBeNull();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(settings).toHaveCount(0);

  await page.getByRole("button", { name: "Provider Health" }).click();
  await expect(providerDialog).toBeVisible();
  const providerQueriesBeforePolicyRefresh = await page.evaluate(() =>
    (window as typeof window & {
      __releaseStatusProviderQueries: Array<Record<string, unknown>>;
    }).__releaseStatusProviderQueries.length
  );
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("ether:provider-policy-changed")));
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & {
      __releaseStatusProviderQueries: Array<Record<string, unknown>>;
    }).__releaseStatusProviderQueries.length
  )).toBe(providerQueriesBeforePolicyRefresh + 2);
});

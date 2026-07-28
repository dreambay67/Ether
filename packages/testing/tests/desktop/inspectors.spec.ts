import { expect, test } from "@playwright/test";
import { ApplicationCommandSchema, ApplicationQuerySchema, type EtherGraph } from "@ether/schema";

test("keeps inspector edits conflict-safe while exposing runtime, review, and provider controls", async ({ page }) => {
  test.setTimeout(45_000);
  page.on("pageerror", (error) => { throw error; });
  await page.addInitScript(() => {
    const now = new Date(); const completed = new Date(now.getTime() - 8_000).toISOString();
    let documentRevision = 1; let documentEventListener: ((event: unknown) => void) | undefined;
    let graph: EtherGraph = {
      id: "inspector-graph", title: "Inspector fixture", kind: "root", createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z",
      nodes: [
        { id: "prompt", definitionId: "prompt.text", title: "Direction", position: { x: 80, y: 100 }, size: { width: 250, height: 150 }, config: { kind: "prompt.text", body: "A quiet editorial still life", assembly: "append" }, presentation: { collapsed: false, accent: "default", previewMode: "content" } },
        { id: "worker", definitionId: "prompt.worker", title: "Prompt polish", position: { x: 390, y: 100 }, size: { width: 250, height: 150 }, config: { kind: "prompt.worker", behavior: "rewrite", instruction: "Make the direction vivid", profile: "balanced", model: "gpt-5", reasoningEffort: "medium", variation: .2, contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 8000 }, memoryPolicy: { mode: "stateless" }, outputContract: { channel: "text", count: 1, selectionPolicy: "latest" } }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } },
        { id: "image", definitionId: "generation.image", title: "Image", position: { x: 690, y: 100 }, size: { width: 250, height: 150 }, config: { kind: "generation.image", providerId: "fake-image", profileId: "studio", aspectRatio: "1:1", resolution: { width: 1024, height: 1024 }, outputCount: 1 }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } },
        { id: "references", definitionId: "reference.set", title: "Reference desk", position: { x: 390, y: 340 }, size: { width: 250, height: 150 }, config: { kind: "reference.set", members: [], enabledChannels: ["image"], ordering: "manual" }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } }
      ], edges: [{ id: "lane", from: { kind: "node", nodeId: "worker", channel: "text" }, to: { kind: "node", nodeId: "image", channel: "text" }, role: "style", order: 0, selector: { kind: "latest-approved" }, adapter: { kind: "auto" }, enabled: true }, { id: "lane-two", from: { kind: "node", nodeId: "worker", channel: "data" }, to: { kind: "node", nodeId: "references", channel: "data" }, role: "general", order: 1, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true }], groups: [], modules: [], viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
    };
    const descriptor = () => ({ documentId: "inspector-document", displayName: "Inspector", named: true, mode: "writable", readOnlyReason: null, commands: { save: true, saveAs: true, saveCopy: true, compact: true, makePortable: true }, saveState: "saved", documentRevisionId: `revision-${documentRevision}`, graphId: "inspector-graph", graphRevisionId: `graph-revision-${documentRevision}`, simulationEnabled: false, revision: documentRevision });
    const commands: Array<{ name: string; payload: Record<string, unknown> }> = []; const queries: unknown[] = [];
    const capabilities = [
      { providerId: "fake-image", profileId: "studio", operation: "generate-image", inputChannels: ["text", "image"], outputChannels: ["image"], aspectRatios: ["1:1", "16:9"], resolutions: [{ id: "1024", width: 1024, height: 1024, label: "1024 square" }, { id: "wide", width: 1536, height: 864, label: "1536 x 864" }], maxReferences: 4, maxOutputsPerCall: 3, supportsCancellation: true, supportsSeed: false, provenance: "conformance-verified", limitations: ["No seed support"] },
      { providerId: "fake-image", profileId: "cinematic", operation: "generate-image", inputChannels: ["text", "image"], outputChannels: ["image"], aspectRatios: ["21:9", "16:9"], resolutions: [{ id: "cinema", width: 2048, height: 878, label: "2K · 21:9", aspectRatio: "21:9", tier: "2K" }, { id: "cinema-4k", width: 4096, height: 1755, label: "4K · 21:9", aspectRatio: "21:9", tier: "4K" }, { id: "hd", width: 1920, height: 1080, label: "2K · 16:9", aspectRatio: "16:9", tier: "2K" }, { id: "uhd", width: 3840, height: 2160, label: "4K · 16:9", aspectRatio: "16:9", tier: "4K" }], maxReferences: 6, maxOutputsPerCall: 2, supportsCancellation: true, supportsSeed: true, provenance: "conformance-verified", limitations: [] }
    ];
    const outputs = [
      { id: "output-version-one", approval: { state: "unreviewed" }, outputPayloadIds: ["payload-1"], createdAt: now.toISOString() },
      { id: "output-version-two", approval: { state: "approved", reviewedAt: now.toISOString(), reviewer: "user" }, outputPayloadIds: ["payload-2"], createdAt: completed }
    ];
    const plans: Record<string, unknown> = {
      "plan-running": { id: "plan-running", graphId: "inspector-graph", steps: [{ nodeId: "worker" }] },
      "plan-queued": { id: "plan-queued", graphId: "inspector-graph", steps: [{ nodeId: "prompt" }] },
      "plan-done": { id: "plan-done", graphId: "inspector-graph", steps: [{ nodeId: "image" }] },
      "plan-attention": { id: "plan-attention", graphId: "inspector-graph", steps: [{ nodeId: "references" }] }
    };
    Object.defineProperty(window, "__inspectorCommands", { value: commands });
    Object.defineProperty(window, "__inspectorQueries", { value: queries });
    Object.defineProperty(window, "__externalPromptUpdate", { value: () => {
      documentRevision += 1;
      graph = {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === "prompt" && node.definitionId === "prompt.text"
            ? {
                ...node,
                title: `Externally renamed direction ${documentRevision}`,
                config: {
                  kind: "prompt.text",
                  body: `Externally revised prompt ${documentRevision}`,
                  assembly: "append"
                }
              }
            : node
        )
      };
      documentEventListener?.({ kind: "snapshot", documentId: "inspector-document", revision: documentRevision, saveState: "saved", snapshot: descriptor() });
    } });
    Object.defineProperty(window, "ether", { value: {
      document: { onEvent: (listener: (event: unknown) => void) => { documentEventListener = listener; return () => { documentEventListener = undefined; }; }, bootstrap: async () => descriptor(), new: async () => descriptor(), open: async () => descriptor(), openDropped: async () => descriptor(), save: async () => descriptor(), saveAs: async () => descriptor(), saveCopy: async () => descriptor(), compact: async () => ({ beforeBytes: 1, afterBytes: 1 }), makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] }), close: async () => null },
      graph: { snapshot: async () => ({ graph, revision: 1 }), applyTransaction: async () => ({ graph, revision: 1 }) },
      application: {
        onEvent: () => () => undefined,
        command: async (command: { name: string; payload: Record<string, unknown> }) => {
          commands.push(command);
          const transaction = command.payload.transaction as { operations?: Array<{ type: string; node?: typeof graph.nodes[number]; nodeId?: string }> } | undefined;
          const operation = transaction?.operations?.[0];
          if (operation?.type === "updateNode" && operation.nodeId && operation.node) graph = { ...graph, nodes: graph.nodes.map((node) => node.id === operation.nodeId ? operation.node! : node) };
          if (command.name === "reference.assignToSet") {
            const payload = command.payload as { nodeId: string; members: Array<{ kind: "linked-reference"; referenceId: string; enabled: boolean }>; replace: boolean };
            graph = {
              ...graph,
              nodes: graph.nodes.map((node) => {
                if (node.id !== payload.nodeId || node.definitionId !== "reference.set") return node;
                return {
                  ...node,
                  config: {
                    ...node.config,
                    members: payload.replace
                      ? payload.members
                      : [...(node.config.members ?? []), ...payload.members]
                  }
                };
              })
            };
          }
          return command.name === "run.preview" ? { payload: { plan: { id: "plan-preview", estimatedCalls: 1 } } } : { payload: { documentRevisionId: "revision-2", graphRevisions: [{ graphId: "inspector-graph", revisionId: `graph-revision-${commands.length + 1}` }] } };
        },
        query: async (request: { name: string; payload: Record<string, unknown> }) => {
          queries.push(request);
          if (request.name === "provider.capabilities") return { payload: { capabilities } };
          if (request.name === "node.compiledInputPreview") return { payload: { nodeId: request.payload.nodeId, instruction: "A quiet editorial still life\n\n[assembled reference context]", contextHash: "context-hash-123456789" } };
          if (request.name === "node.outputs") return { payload: { outputs: request.payload.nodeId === "worker" ? outputs : [] } };
          if (request.name === "job.list") return { payload: { jobs: [
            { id: "job-queued", planId: "plan-queued", status: "queued", completedAt: null },
            { id: "job-running", planId: "plan-running", status: "running", completedAt: null },
            { id: "job-done", planId: "plan-done", status: "completed", completedAt: completed },
            { id: "job-attention", planId: "plan-attention", status: "needs-attention", completedAt: completed }
          ] } };
          if (request.name === "plan.summary") return { payload: { plan: plans[String(request.payload.planId)] } };
          return { payload: { graph, documentRevisionId: `revision-${documentRevision}`, graphRevisionId: `graph-revision-${documentRevision}` } };
        }
      },
      artifacts: { search: async () => [], generateFake: async () => [] }, references: { list: async () => [], act: async () => [] }, runtime: { versions: async () => ({ electron: "43", node: "24" }) }
    } });
  });
  await page.goto("/");
  const commandCount = () => page.evaluate(() => (window as typeof window & { __inspectorCommands: Array<{ name: string }> }).__inspectorCommands.length);
  const commandNames = () => page.evaluate(() => (window as typeof window & { __inspectorCommands: Array<{ name: string }> }).__inspectorCommands.map((command) => command.name));

  await expect(page.locator(".ether-inspector-empty")).toBeVisible();
  await expect(page.getByTestId("node-status-queued")).toHaveCount(1);
  await expect(page.getByTestId("node-status-running")).toHaveCount(1);
  await expect(page.getByTestId("node-status-done")).toHaveCount(1);
  await expect(page.getByTestId("node-status-attention")).toHaveCount(1);
  await expect(page.getByTestId("node-status-done")).toHaveCount(0, { timeout: 4_000 });

  await page.locator('[data-testid="rf__node-prompt"] .ether-node-main p').click();
  const beforeTitle = await commandCount();
  await page.getByRole("textbox", { name: "Title" }).fill("Editorial direction");
  await page.evaluate(() => (window as typeof window & { __externalPromptUpdate(): void }).__externalPromptUpdate());
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Editorial direction");
  await expect(page.getByText("Saved settings changed elsewhere.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Rebase my draft" }).click();
  await page.getByRole("button", { name: "Save title" }).click();
  await expect.poll(commandCount).toBe(beforeTitle + 1);
  const prompt = page.getByRole("textbox", { name: "Authored text" });
  const beforePrompt = await commandCount();
  await prompt.fill("A luminous still life with quiet shadows");
  expect(await commandCount()).toBe(beforePrompt);
  await page.evaluate(() => (window as typeof window & { __externalPromptUpdate(): void }).__externalPromptUpdate());
  await expect(page.getByText("Saved settings changed elsewhere.", { exact: true })).toBeVisible();
  await expect(prompt).toHaveValue("A luminous still life with quiet shadows");
  await expect(page.getByRole("button", { name: "Save prompt" })).toBeDisabled();
  await page.getByRole("button", { name: "Rebase my draft" }).click();
  await page.getByRole("button", { name: "Save prompt" }).click();
  await expect.poll(commandCount).toBe(beforePrompt + 1);
  await expect(page.getByRole("textbox", { name: "Assembled text" })).toHaveAttribute("readonly", "");
  await expect(page.getByRole("textbox", { name: "Assembled text" })).toHaveValue(/assembled reference context/);
  await page.getByRole("button", { name: "Use assembled text as manual override" }).click();
  await expect(page.getByRole("textbox", { name: "Manual override text" })).toHaveValue(/assembled reference context/);
  await page.getByRole("button", { name: "Save prompt" }).click();
  await expect.poll(commandCount).toBe(beforePrompt + 2);
  const savedPromptAssembly = await page.evaluate(() => {
    const commands = (window as typeof window & { __inspectorCommands: Array<{ name: string; payload: { transaction?: { operations?: Array<{ node?: { config?: { assembly?: string } } }> } } }> }).__inspectorCommands;
    return commands.filter((command) => command.name === "graph.applyTransaction").at(-1)?.payload.transaction?.operations?.[0]?.node?.config?.assembly;
  });
  expect(savedPromptAssembly).toBe("replace");
  await expect(page.getByRole("button", { name: "Generate Output" })).toHaveCount(0);
  await expect(page.getByText("Node ID:", { exact: false })).not.toBeVisible();
  await page.getByText("Diagnostics & provenance", { exact: true }).click();
  await expect(page.getByText("Node ID:", { exact: false })).toBeVisible();

  const selectNode = async (nodeId: string) => {
    await page.getByTestId(`rf__node-${nodeId}`).evaluate((node) => {
      node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };
  const selectWorker = async () => {
    await selectNode("worker");
    await expect(page.getByTestId("node-inspector").getByRole("button", { name: "Compare" })).toHaveCount(2);
  };

  await page.getByRole("button", { name: "Fit View" }).click();
  await selectWorker();
  await expect(page.getByText("Style to Image", { exact: true })).toBeVisible();
  const beforeWorker = await commandCount();
  await page.getByRole("textbox", { name: "Worker instruction" }).fill("Make the direction tactile and restrained");
  await page.getByRole("combobox", { name: "Worker behavior" }).selectOption("critique");
  expect(await commandCount()).toBe(beforeWorker);
  await page.getByRole("button", { name: "Save worker" }).click();
  await expect.poll(commandCount).toBe(beforeWorker + 1);
  await page.getByRole("button", { name: "Generate Output" }).click();
  await expect.poll(async () => (await commandNames()).includes("run.preview")).toBeTruthy();

  await page.getByRole("button", { name: "Approve" }).first().click();
  await selectWorker();
  await page.getByRole("button", { name: "Reject" }).first().click();
  await selectWorker();
  await page.getByRole("textbox", { name: "Manual output text output-version-one" }).fill("Manual descendant");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await selectWorker();
  const outputCompareButtons = page.getByTestId("node-inspector").getByRole("button", { name: "Compare" });
  await outputCompareButtons.nth(0).click();
  await outputCompareButtons.nth(1).click();
  await expect(page.getByTestId("output-compare")).toBeVisible();
  await page.getByRole("combobox", { name: "Pin lane output-version-one" }).selectOption("lane-two");
  await page.getByRole("button", { name: "Pin" }).first().click();
  await page.getByRole("button", { name: "Restore" }).first().click();
  await expect.poll(commandNames).toEqual(expect.arrayContaining(["review.approve", "review.reject", "output.edit", "output.pin", "output.restore"]));

  await selectNode("image");
  const beforeProvider = await commandCount();
  await page.getByRole("combobox", { name: "Provider profile" }).selectOption("fake-image:cinematic");
  await expect(page.getByText("Defaults reset for fake-image / cinematic", { exact: false })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Aspect ratio" })).toHaveValue("21:9");
  await page.getByRole("combobox", { name: "Aspect ratio" }).selectOption("16:9");
  await expect(page.getByRole("combobox", { name: "Resolution" })).toHaveValue("1920x1080");
  await expect(page.getByRole("combobox", { name: "Resolution" }).locator("option")).toHaveCount(2);
  await page.getByRole("combobox", { name: "Resolution" }).selectOption("3840x2160");
  await page.getByRole("combobox", { name: "Aspect ratio" }).selectOption("21:9");
  await expect(page.getByRole("combobox", { name: "Resolution" })).toHaveValue("4096x1755");
  await page.getByRole("combobox", { name: "Aspect ratio" }).selectOption("16:9");
  await page.getByRole("combobox", { name: "Resolution" }).selectOption("1920x1080");
  await page.getByRole("spinbutton", { name: "Output count" }).fill("2");
  expect(await commandCount()).toBe(beforeProvider);
  await page.getByRole("button", { name: "Reset to profile defaults" }).click();
  await expect(page.getByRole("combobox", { name: "Aspect ratio" })).toHaveValue("21:9");
  await expect(page.getByRole("combobox", { name: "Resolution" })).toHaveValue("2048x878");
  await expect(page.getByRole("spinbutton", { name: "Output count" })).toHaveValue("1");
  await page.getByRole("button", { name: "Save provider settings" }).click();
  await expect.poll(commandCount).toBe(beforeProvider + 1);
  await expect(page.getByText("Provenance: conformance-verified", { exact: true })).not.toBeVisible();
  await page.getByText("Provider capability", { exact: true }).click();
  await expect(page.getByText("Provenance: conformance-verified", { exact: true })).toBeVisible();

  await selectNode("references");
  await page.getByRole("textbox", { name: "Reference IDs" }).fill("reference-a, reference-b");
  await page.getByRole("button", { name: "Add references" }).click();
  await expect(page.getByText("2 saved members", { exact: false })).toBeVisible();
  await page.getByRole("textbox", { name: "Reference IDs" }).fill("reference-c");
  await page.getByTestId("node-inspector").getByRole("button", { name: "Replace set" }).click();
  await expect(page.getByText("1 saved member", { exact: false })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect(page.getByTestId("node-inspector").getByRole("button", { name: "Replace set" })).toBeVisible();
  const geometry = await page.getByTestId("pane-inspector").evaluate((pane) => {
    const root = pane.querySelector<HTMLElement>(".ether-inspector")!;
    const controls = Array.from(root.querySelectorAll<HTMLElement>("button,input,textarea,select")).filter((element) => {
      const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0;
    });
    const overlap = controls.some((control, index) => controls.slice(index + 1).some((other) => {
      const a = control.getBoundingClientRect(); const b = other.getBoundingClientRect();
      return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    }));
    return { horizontalOverflow: root.scrollWidth > root.clientWidth + 1, overlap, controls: controls.length };
  });
  expect(geometry).toMatchObject({ horizontalOverflow: false, overlap: false });
  expect(geometry.controls).toBeGreaterThanOrEqual(3);

  const recordedQueries = await page.evaluate(() => (window as typeof window & { __inspectorQueries: unknown[] }).__inspectorQueries);
  const recordedCommands = await page.evaluate(() => (window as typeof window & { __inspectorCommands: unknown[] }).__inspectorCommands);
  for (const query of recordedQueries) ApplicationQuerySchema.parse(query);
  for (const command of recordedCommands) ApplicationCommandSchema.parse(command);
  const providerRequest = recordedQueries.find((query) => typeof query === "object" && query !== null && "name" in query && query.name === "provider.capabilities") as Record<string, unknown>;
  expect(providerRequest).not.toHaveProperty("documentId");
  const pinCommand = recordedCommands.find((command) => typeof command === "object" && command !== null && "name" in command && command.name === "output.pin") as { payload: { edgeId: string; baseDocumentRevisionId: string } };
  expect(pinCommand.payload).toMatchObject({ edgeId: "lane-two", baseDocumentRevisionId: "revision-3" });
});

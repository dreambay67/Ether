import { expect, test } from "@playwright/test";
import { ApplicationCommandSchema, ApplicationQuerySchema, type EtherGraph } from "@ether/schema";

test("keeps inspector edits conflict-safe while exposing runtime, review, and provider controls", async ({ page }) => {
  test.setTimeout(60_000);
  page.on("pageerror", (error) => { throw error; });
  await page.addInitScript(() => {
    const now = new Date(); const completed = new Date(now.getTime() - 8_000).toISOString();
    let documentRevision = 1; let documentEventListener: ((event: unknown) => void) | undefined;
    let graph: EtherGraph = {
      id: "inspector-graph", title: "Inspector fixture", kind: "root", createdAt: "2026-07-22T00:00:00.000Z", updatedAt: "2026-07-22T00:00:00.000Z",
      nodes: [
        { id: "prompt", definitionId: "prompt.text", title: "Direction", position: { x: 80, y: 100 }, size: { width: 250, height: 150 }, config: { kind: "prompt.text", body: "A quiet editorial still life", assembly: "append" }, presentation: { collapsed: false, accent: "default", previewMode: "content" } },
        { id: "worker", definitionId: "prompt.worker", title: "Prompt polish", position: { x: 390, y: 100 }, size: { width: 250, height: 150 }, config: { kind: "prompt.worker", behavior: "rewrite", instruction: "Make the direction vivid", profile: "balanced", model: "gpt-5", reasoningEffort: "medium", variation: .2, contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 8000 }, memoryPolicy: { mode: "stateless" }, outputContract: { channel: "text", count: 1, selectionPolicy: "latest" }, reviewPolicy: "inspect-first" }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } },
        { id: "image", definitionId: "generation.image", title: "Image", position: { x: 690, y: 100 }, size: { width: 250, height: 150 }, config: { kind: "generation.image", providerId: "fake-image", profileId: "studio", aspectRatio: "1:1", resolution: { width: 1024, height: 1024 }, outputCount: 1 }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } },
        { id: "batch", definitionId: "flow.batch", title: "Campaign batch", position: { x: 80, y: 340 }, size: { width: 250, height: 150 }, config: { kind: "flow.batch", dimensions: [{ id: "palette", name: "Palette", values: ["amber", "blue"] }], exclusions: [{ values: { palette: "blue" } }], parallelism: 2 }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } },
        { id: "references", definitionId: "reference.set", title: "Reference desk", position: { x: 390, y: 340 }, size: { width: 250, height: 150 }, config: { kind: "reference.set", members: [], enabledChannels: ["image"], ordering: "manual" }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } },
        { id: "compare", definitionId: "review.compare", title: "Choose direction", position: { x: 690, y: 340 }, size: { width: 250, height: 150 }, config: { kind: "review.compare", selectionMode: "one", minimumSelections: 1 }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } }
      ], edges: [{ id: "lane", from: { kind: "node", nodeId: "worker", channel: "text" }, to: { kind: "node", nodeId: "image", channel: "text" }, role: "style", order: 0, selector: { kind: "latest-approved" }, adapter: { kind: "auto" }, enabled: true }, { id: "lane-two", from: { kind: "node", nodeId: "worker", channel: "data" }, to: { kind: "node", nodeId: "references", channel: "data" }, role: "general", order: 1, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true }, { id: "compare-downstream", from: { kind: "node", nodeId: "compare", channel: "data" }, to: { kind: "node", nodeId: "references", channel: "data" }, role: "general", order: 2, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true }], groups: [], modules: [], viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
    };
    const descriptor = () => ({ documentId: "inspector-document", displayName: "Inspector", named: true, mode: "writable", readOnlyReason: null, commands: { save: true, saveAs: true, saveCopy: true, compact: true, makePortable: true }, saveState: "saved", documentRevisionId: `revision-${documentRevision}`, graphId: "inspector-graph", graphRevisionId: `graph-revision-${documentRevision}`, simulationEnabled: false, revision: documentRevision });
    const catalog = [
      { definitionId: "prompt.text", family: "prompt", title: "Prompt", description: "Write reusable text instructions.", example: "Describe a quiet studio portrait.", synonyms: ["instruction", "text"], inputChannels: [], outputChannels: ["text"], defaultConfig: { kind: "prompt.text", body: "", assembly: "append" }, inspector: { sections: [{ id: "main", title: "Prompt", fields: ["body", "assembly"] }] }, executor: "deterministic-assembly", presentation: { width: 250, height: 150, previewMode: "content" }, setupRequirement: "none" },
      { definitionId: "prompt.worker", family: "prompt", title: "Worker", description: "Transform prompt material with a configured assistant.", example: "Rewrite the direction.", synonyms: ["assistant", "rewrite"], inputChannels: ["text", "image", "data"], outputChannels: ["text", "data"], defaultConfig: { kind: "prompt.worker", behavior: "rewrite", instruction: "", profile: "balanced", model: "gpt-5", reasoningEffort: "medium", variation: 0.2, contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 8000 }, memoryPolicy: { mode: "stateless" }, outputContract: { channel: "text", count: 1, selectionPolicy: "latest" }, reviewPolicy: "inspect-first" }, inspector: { sections: [{ id: "main", title: "Worker", fields: ["behavior", "instruction", "profile", "model", "reasoningEffort", "variation", "contextPolicy", "memoryPolicy", "outputContract", "reviewPolicy"] }] }, executor: "codex-llm", presentation: { width: 250, height: 150, previewMode: "summary" }, setupRequirement: "provider-capability" },
      { definitionId: "generation.image", family: "generation", title: "Image Generator", description: "Generate images from text direction.", example: "Create a studio image.", synonyms: ["image", "render"], inputChannels: ["text", "image", "data"], outputChannels: ["image", "data"], defaultConfig: { kind: "generation.image", providerId: "fake-image", profileId: "studio", aspectRatio: "1:1", resolution: { width: 1024, height: 1024 }, outputCount: 1 }, inspector: { sections: [{ id: "main", title: "Image Generator", fields: ["providerId", "profileId"] }] }, executor: "image-provider", presentation: { width: 250, height: 150, previewMode: "summary" }, setupRequirement: "provider-capability" },
      { definitionId: "flow.batch", family: "flow", title: "Batch", description: "Expand dimensions into explicit work items.", example: "Create palette variations.", synonyms: ["matrix", "variants"], inputChannels: ["text", "image", "data"], outputChannels: ["text", "image", "data"], defaultConfig: { kind: "flow.batch", dimensions: [{ id: "items", name: "Items", values: [""] }], parallelism: 1 }, inspector: { sections: [{ id: "main", title: "Batch", fields: ["dimensions", "exclusions", "parallelism"] }] }, executor: "batch", presentation: { width: 250, height: 150, previewMode: "summary" }, setupRequirement: "none" },
      { definitionId: "reference.set", family: "reference", title: "Reference Set", description: "Collect reusable reference material.", example: "Group visual references.", synonyms: ["reference", "assets"], inputChannels: ["image", "data"], outputChannels: ["image", "data"], defaultConfig: { kind: "reference.set", members: [], enabledChannels: ["image"], ordering: "manual" }, inspector: { sections: [{ id: "main", title: "Reference Set", fields: ["members", "enabledChannels", "ordering"] }] }, executor: "non-runnable", presentation: { width: 250, height: 150, previewMode: "summary" }, setupRequirement: "none" },
      { definitionId: "review.compare", family: "review", title: "Compare", description: "Choose approved candidates at a human checkpoint.", example: "Choose the strongest direction.", synonyms: ["review", "choose"], inputChannels: ["text", "image", "video", "audio", "data"], outputChannels: ["text", "image", "video", "audio", "data"], defaultConfig: { kind: "review.compare", selectionMode: "one", minimumSelections: 1 }, inspector: { sections: [{ id: "main", title: "Compare", fields: ["selectionMode", "minimumSelections"] }] }, executor: "human-checkpoint", presentation: { width: 250, height: 150, previewMode: "summary" }, setupRequirement: "none" }
    ];
    const commands: Array<{ name: string; payload: Record<string, unknown> }> = []; const queries: unknown[] = [];
    const capabilities = [
      { providerId: "codex-vision-assistant", profileId: "worker:gpt-5", modelId: "gpt-5", operation: "llm", inputChannels: ["text", "image", "data"], outputChannels: ["text", "data"], aspectRatios: [], resolutions: [], maxReferences: 32, maxOutputsPerCall: 4, maxParallelism: 4, supportsCancellation: true, supportsSeed: false, provenance: "runtime-discovered", limitations: [] },
      { providerId: "fake-image", profileId: "studio", operation: "generate-image", inputChannels: ["text", "image"], outputChannels: ["image"], aspectRatios: ["1:1", "16:9"], resolutions: [{ id: "1024", width: 1024, height: 1024, label: "1024 square" }, { id: "wide", width: 1536, height: 864, label: "1536 x 864" }], maxReferences: 4, maxOutputsPerCall: 3, supportsCancellation: true, supportsSeed: false, provenance: "conformance-verified", limitations: ["No seed support"] },
      { providerId: "fake-image", profileId: "cinematic", operation: "generate-image", inputChannels: ["text", "image"], outputChannels: ["image"], aspectRatios: ["21:9", "16:9"], resolutions: [{ id: "cinema", width: 2048, height: 878, label: "2K · 21:9", aspectRatio: "21:9", tier: "2K" }, { id: "cinema-4k", width: 4096, height: 1755, label: "4K · 21:9", aspectRatio: "21:9", tier: "4K" }, { id: "hd", width: 1920, height: 1080, label: "2K · 16:9", aspectRatio: "16:9", tier: "2K" }, { id: "uhd", width: 3840, height: 2160, label: "4K · 16:9", aspectRatio: "16:9", tier: "4K" }], maxReferences: 6, maxOutputsPerCall: 2, supportsCancellation: true, supportsSeed: true, provenance: "conformance-verified", limitations: [] }
    ];
    let outputs = [
      { id: "output-version-one", approval: { state: "unreviewed" }, outputPayloadIds: ["payload-1"], createdAt: now.toISOString() },
      { id: "output-version-two", approval: { state: "approved", reviewedAt: now.toISOString(), reviewer: "user" }, outputPayloadIds: ["payload-2"], createdAt: completed }
    ];
    const plans: Record<string, unknown> = {
      "plan-running": { id: "plan-running", graphId: "inspector-graph", steps: [{ nodeId: "worker" }] },
      "plan-old-attention": { id: "plan-old-attention", graphId: "inspector-graph", steps: [{ nodeId: "worker" }] },
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
    Object.defineProperty(window, "__externalRunContextUpdate", { value: () => {
      documentRevision += 1;
      graph = {
        ...graph,
        nodes: graph.nodes.map((node) => node.id === "image" && node.definitionId === "generation.image"
          ? { ...node, config: { ...node.config, outputCount: node.config.outputCount + 1 } }
          : node)
      };
      documentEventListener?.({ kind: "snapshot", documentId: "inspector-document", revision: documentRevision, saveState: "saved", snapshot: descriptor() });
    } });
    const applicationEventListeners = new Set<(event: unknown) => void>();
    Object.defineProperty(window, "__externalOutputCreated", { value: () => {
      outputs = [...outputs, { id: "live-output", approval: { state: "unreviewed" }, outputPayloadIds: ["payload-live"], createdAt: new Date().toISOString() }];
      for (const listener of applicationEventListeners) listener({ name: "job.stateChanged", documentId: "inspector-document", payload: { jobId: "live-job", state: "completed" } });
    } });
    Object.defineProperty(window, "ether", { value: {
      document: { onEvent: (listener: (event: unknown) => void) => { documentEventListener = listener; return () => { documentEventListener = undefined; }; }, bootstrap: async () => descriptor(), new: async () => descriptor(), open: async () => descriptor(), openDropped: async () => descriptor(), save: async () => descriptor(), saveAs: async () => descriptor(), saveCopy: async () => descriptor(), compact: async () => ({ beforeBytes: 1, afterBytes: 1 }), makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] }), close: async () => null },
      graph: { snapshot: async () => ({ graph, revision: 1 }), applyTransaction: async () => ({ graph, revision: 1 }) },
      application: {
        onEvent: (listener: (event: unknown) => void) => { applicationEventListeners.add(listener); return () => { applicationEventListeners.delete(listener); }; },
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
          if (command.name === "run.preview") return { payload: { plan: { id: `plan-preview-${commands.length}`, contentHash: `sha256:v1:${"b".repeat(64)}`, scope: command.payload.scope, estimatedCalls: 1, batchSummary: { dimensions: 2, exclusions: 1, workItemCount: 3 }, workItems: [{ id: "work-preview" }], warnings: [], steps: [{ id: "step-preview", nodeId: "worker", subject: { kind: "node", nodeId: "worker" }, executor: "codex-llm", inputPayloadIds: ["payload-preview"], resolvedInputBindings: [{ name: "Direction", payloadId: "payload-preview", selector: "latest-approved" }], compiledPrompt: "Preview the intended campaign direction.", compiledContext: { referenceInputs: Object.freeze([{ id: "reference-binding-poster", edgeId: "reference-edge", sourceNodeId: "references", payloadId: "reference-payload-poster", channel: "image", role: "style", order: 2, displayName: "Poster grain", mediaType: "image/png", memberKind: "linked-reference", referenceId: "reference-poster", fingerprint: { byteLength: 8192, modifiedAt: 1777777777777, sampleSha256: "poster-fingerprint" } }, { id: "reference-binding-palette", edgeId: "reference-edge", sourceNodeId: "references", payloadId: "reference-payload-palette", channel: "image", role: "composition", order: 0, displayName: "Palette study", mediaType: "image/png", memberKind: "embedded-reference", referenceId: "reference-palette", contentKey: "embedded-palette", byteLength: 4096 }, { id: "reference-binding-layout", edgeId: "reference-edge", sourceNodeId: "references", payloadId: "reference-payload-layout", channel: "image", role: "general", order: 1, displayName: "Layout rhythm", mediaType: "image/jpeg", memberKind: "embedded-artifact", artifactId: "artifact-layout", contentKey: "embedded-layout", byteLength: 2048 }]) }, provider: { providerId: "preview-provider", profileId: "preview-profile", modelId: "preview-model", settings: { temperature: 0.4, apiKey: "preview-secret", nested: { accessToken: "nested-secret", topP: 0.9 } } } }] } } };
          if (command.name === "permission.grantRun") return { payload: { permitId: "permit-preview" } };
          if (command.name === "run.start") return { payload: { job: { id: "job-preview" } } };
          return { payload: { documentRevisionId: "revision-2", graphRevisions: [{ graphId: "inspector-graph", revisionId: `graph-revision-${commands.length + 1}` }] } };
        },
        query: async (request: { name: string; payload: Record<string, unknown> }) => {
          queries.push(request);
          if (request.name === "node.catalog") return { name: request.name, payload: { nodes: catalog } };
          if (request.name === "reference.list") return { name: request.name, payload: { references: [] } };
          if (request.name === "provider.capabilities") return { name: request.name, payload: { capabilities } };
          if (request.name === "node.compiledInputPreview") return { name: request.name, payload: { nodeId: request.payload.nodeId, instruction: "A quiet editorial still life\n\n[assembled reference context]", contextHash: "context-hash-123456789" } };
          if (request.name === "node.outputs") return { name: request.name, payload: { outputs: request.payload.nodeId === "worker" ? outputs : [] } };
          if (request.name === "job.list") return { name: request.name, payload: { jobs: [
            { id: "job-queued", planId: "plan-queued", status: "queued", createdAt: now.toISOString(), startedAt: now.toISOString(), completedAt: null },
            { id: "job-running", planId: "plan-running", status: "running", createdAt: now.toISOString(), startedAt: now.toISOString(), completedAt: null },
            { id: "job-old-attention", planId: "plan-old-attention", status: "failed", createdAt: new Date(now.getTime() - 20_000).toISOString(), startedAt: new Date(now.getTime() - 20_000).toISOString(), completedAt: new Date(now.getTime() - 19_000).toISOString() },
            { id: "job-done", planId: "plan-done", status: "completed", createdAt: completed, startedAt: completed, completedAt: completed },
            { id: "job-attention", planId: "plan-attention", status: "needs-attention", createdAt: completed, startedAt: completed, completedAt: completed }
          ] } };
          if (request.name === "plan.summary") return { name: request.name, payload: { plan: plans[String(request.payload.planId)] } };
          return { name: request.name, payload: { graph, documentRevisionId: `revision-${documentRevision}`, graphRevisionId: `graph-revision-${documentRevision}` } };
        }
      },
      artifacts: { search: async () => [], generateFake: async () => [] }, references: { list: async () => [], act: async () => [] }, runtime: { versions: async () => ({ electron: "43", node: "24" }) }
    } });
  });
  await page.goto("/");
  const commandCount = () => page.evaluate(() => (window as typeof window & { __inspectorCommands: Array<{ name: string }> }).__inspectorCommands.length);
  const commandNames = () => page.evaluate(() => (window as typeof window & { __inspectorCommands: Array<{ name: string }> }).__inspectorCommands.map((command) => command.name));

  await expect(page.locator(".ether-inspector-empty")).toBeVisible();
  await expect(page.getByTestId("ether-canvas-surface")).toBeVisible();
  await page.getByRole("button", { name: "Fit View" }).click();
  await expect(page.getByTestId("node-status-queued")).toHaveCount(1);
  await expect(page.getByTestId("node-status-running")).toHaveCount(1);
  await expect(page.getByTestId("node-status-done")).toHaveCount(1);
  await expect(page.getByTestId("node-status-attention")).toHaveCount(1);
  await expect(page.getByTestId("node-status-done")).toHaveCount(0, { timeout: 4_000 });
  await expect.poll(() => page.locator(".react-flow__node").evaluateAll((nodes) =>
    nodes.every((node) => getComputedStyle(node).visibility === "visible")
  )).toBe(true);

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
  await expect(page.getByRole("button", { name: "Generate Output", exact: true })).toHaveCount(0);
  await expect(page.getByText("Node ID:", { exact: false })).not.toBeVisible();
  await page.getByTestId("node-inspector").getByRole("button", { name: "Diagnostics & provenance", exact: true }).click();
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

  await selectWorker();
  await expect(page.getByTestId("node-inspector")).toContainText("Style · Text → Text · latest-approved · Image");
  await expect(page.getByTestId("node-inspector")).toContainText("codex-vision-assistant · gpt-5 · medium");
  const beforeWorker = await commandCount();
  await page.getByRole("textbox", { name: "Worker instruction" }).fill("Make the direction tactile and restrained");
  await page.getByRole("combobox", { name: "Worker behavior" }).selectOption("critique");
  await expect(page.getByRole("combobox", { name: "Worker result handling" })).toHaveValue("inspect-first");
  await page.getByRole("combobox", { name: "Worker result handling" }).selectOption("auto-apply");
  await page.getByRole("checkbox", { name: "Include upstream context" }).uncheck();
  await page.getByRole("combobox", { name: "Worker memory" }).selectOption("per-branch");
  await page.getByRole("combobox", { name: "Worker output channel" }).selectOption("data");
  await page.getByRole("textbox", { name: "Worker output schema ID" }).fill("campaign-brief");
  await page.getByRole("spinbutton", { name: "Worker result count" }).fill("2");
  await page.getByRole("combobox", { name: "Worker output selection policy" }).selectOption("all");
  expect(await commandCount()).toBe(beforeWorker);
  await page.getByRole("button", { name: "Save worker", exact: true }).click();
  await expect.poll(commandCount).toBe(beforeWorker + 1);
  const savedWorkerPolicy = await page.evaluate(() => {
    const commands = (window as typeof window & { __inspectorCommands: Array<{ name: string; payload: { transaction?: { operations?: Array<{ node?: { config?: Record<string, unknown> } }> } } }> }).__inspectorCommands;
    return commands.filter((command) => command.name === "graph.applyTransaction").at(-1)?.payload.transaction?.operations?.[0]?.node?.config;
  });
  expect(savedWorkerPolicy).toMatchObject({
    reviewPolicy: "auto-apply",
    contextPolicy: { includeUpstream: false },
    memoryPolicy: { mode: "per-branch" },
    outputContract: { channel: "data", schemaId: "campaign-brief", count: 2, selectionPolicy: "all" }
  });
  await page.getByRole("button", { name: "Generate Output", exact: true }).click();
  await expect.poll(async () => (await commandNames()).includes("run.preview")).toBeTruthy();
  await expect(page.getByRole("button", { name: "Start 1 call", exact: true })).toBeVisible();
  const preparedPlan = page.getByLabel("Prepared plan");
  await expect(preparedPlan).toContainText("Plan ID · plan-preview-");
  await expect(preparedPlan).toContainText("Content hash · sha256:v1:");
  await expect(preparedPlan).toContainText("Batch · 2 dimensions · 1 exclusion · 3 work items");
  const sealedReferences = preparedPlan.getByLabel("Sealed Reference Set members");
  await expect(sealedReferences).toContainText("Reference Set · 3 included");
  await expect(sealedReferences.locator(":scope > article > strong")).toHaveText(["Palette study", "Layout rhythm", "Poster grain"]);
  await expect(sealedReferences.locator(":scope > article").nth(0)).toContainText("Included in this plan · Composition · Image · Embedded reference");
  await expect(sealedReferences.locator(":scope > article").nth(1)).toContainText("Included in this plan · General · Image · Embedded artifact");
  await expect(sealedReferences.locator(":scope > article").nth(2)).toContainText("Included in this plan · Style · Image · Linked reference");
  await expect(sealedReferences.getByText("reference-payload-palette", { exact: false })).not.toBeVisible();
  await expect(sealedReferences.getByText("poster-fingerprint", { exact: false })).not.toBeVisible();
  await sealedReferences.locator(":scope > article").nth(2).getByText("Reference details", { exact: true }).click();
  await expect(sealedReferences.locator(":scope > article").nth(2)).toContainText("Fingerprint · 8192 bytes · modified 1777777777777 · SHA-256 poster-fingerprint");
  await preparedPlan.getByText("Sanitized provider settings", { exact: true }).click();
  await expect(preparedPlan).toContainText('"temperature": 0.4');
  await expect(preparedPlan).toContainText("[redacted]");
  await expect(preparedPlan).not.toContainText("preview-secret");
  await page.evaluate(() => (window as typeof window & { __externalRunContextUpdate(): void }).__externalRunContextUpdate());
  await expect(page.getByRole("button", { name: "Generate Output", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start 1 call", exact: true })).toHaveCount(0);
  await expect.poll(commandNames).not.toContain("permission.grantRun");
  await page.getByRole("button", { name: "Generate Output", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start 1 call", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start 1 call", exact: true }).click();
  await expect.poll(commandNames).toEqual(expect.arrayContaining(["permission.grantRun", "run.start"]));

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
  await page.evaluate(() => (window as typeof window & { __externalOutputCreated(): void }).__externalOutputCreated());
  await expect(page.getByTestId("output-versions")).toContainText("live-output");

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
  await page.getByTestId("node-inspector").getByRole("button", { name: "Provider capability", exact: true }).click();
  await expect(page.getByText("Provenance: conformance-verified", { exact: true })).toBeVisible();

  await selectNode("references");
  await page.getByRole("textbox", { name: "Reference IDs" }).fill("reference-a, reference-b");
  await page.getByRole("button", { name: "Add references" }).click();
  await expect(page.getByText("2 saved members", { exact: false })).toBeVisible();
  await page.getByRole("textbox", { name: "Reference IDs" }).fill("reference-c");
  await page.getByTestId("node-inspector").getByRole("button", { name: "Replace set" }).click();
  await expect(page.getByText("1 saved member", { exact: false })).toBeVisible();

  await selectNode("batch");
  await page.getByRole("button", { name: "Build Batch", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start 1 call", exact: true })).toBeVisible();
  const batchPreviewScope = await page.evaluate(() => {
    const commands = (window as typeof window & { __inspectorCommands: Array<{ name: string; payload: { scope?: unknown } }> }).__inspectorCommands;
    return commands.filter((command) => command.name === "run.preview").at(-1)?.payload.scope;
  });
  expect(batchPreviewScope).toEqual({ kind: "batch", batchNodeId: "batch" });

  await selectNode("compare");
  const compareInspector = page.getByTestId("node-inspector");
  await expect(compareInspector.getByLabel("Run scope")).toBeVisible();
  await compareInspector.getByLabel("Run scope").selectOption("branch");
  await compareInspector.getByRole("button", { name: "Preview plan", exact: true }).click();
  const comparePreviewScope = await page.evaluate(() => {
    const commands = (window as typeof window & { __inspectorCommands: Array<{ name: string; payload: { scope?: unknown } }> }).__inspectorCommands;
    return commands.filter((command) => command.name === "run.preview").at(-1)?.payload.scope;
  });
  expect(comparePreviewScope).toEqual({ kind: "branch", rootNodeId: "compare" });

  await selectNode("references");
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
  expect(pinCommand.payload).toMatchObject({ edgeId: "lane-two", baseDocumentRevisionId: "revision-4" });
});

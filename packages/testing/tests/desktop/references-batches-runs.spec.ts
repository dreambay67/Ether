import { expect, test } from "@playwright/test";
import path from "node:path";

type BatchAllocationSnapshot = {
  targetNodeId: string;
  count: number;
  providerId: string;
  profileId: string;
  modelId: string;
};
type BatchConfigSnapshot = {
  allocations?: BatchAllocationSnapshot[];
  parallelism?: number;
};
type BatchUpdateCommand = {
  name: string;
  payload: { transaction?: { operations?: Array<{ node?: { config?: BatchConfigSnapshot } }> } };
};

test("manages 100 references, batch allocation and concurrency controls, and 500 durable jobs without polling", async ({ page }) => {
  await page.addInitScript(() => {
    const now = "2026-07-23T01:00:00.000Z";
    let graph = {
      id: "workflow-graph", title: "Campaign workflow", kind: "root", createdAt: now, updatedAt: now,
      nodes: [
        { id: "refs", definitionId: "reference.set", title: "Campaign sources", position: { x: 80, y: 80 }, size: { width: 250, height: 150 }, config: { kind: "reference.set", members: [], enabledChannels: ["image"], ordering: "manual" }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } },
        { id: "batch", definitionId: "flow.batch", title: "Markets × treatments", position: { x: 400, y: 80 }, size: { width: 250, height: 150 }, config: { kind: "flow.batch", dimensions: [{ id: "market", name: "Market", values: ["EU", "US"] }, { id: "treatment", name: "Treatment", values: ["A", "B", "C"] }, { id: "variant", name: "Variant", values: Array.from({ length: 2_000 }, (_, index) => `v${index}`) }], exclusions: [{ values: { market: "US", treatment: "C", variant: "v1999" } }], parallelism: 1 }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } },
        { id: "worker", definitionId: "prompt.worker", title: "Prompt Worker", position: { x: 720, y: 80 }, size: { width: 250, height: 150 }, config: { kind: "prompt.worker", behavior: "rewrite", instruction: "Make the campaign direction precise.", profile: "balanced", providerId: "codex-vision-assistant", profileId: "worker:gpt-5.4", model: "gpt-5.4", reasoningEffort: "medium", variation: 0.2, contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 8_000 }, memoryPolicy: { mode: "stateless" }, outputContract: { channel: "text", count: 1, selectionPolicy: "latest" }, reviewPolicy: "inspect-first" }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } },
        { id: "image", definitionId: "generation.image", title: "Image Generator", position: { x: 1_040, y: 80 }, size: { width: 250, height: 150 }, config: { kind: "generation.image", providerId: "google-nano-banana-2", profileId: "google-nano-banana-2", aspectRatio: "1:1", resolution: { width: 1024, height: 1024 }, outputCount: 1 }, presentation: { collapsed: false, accent: "default", previewMode: "summary" } }
      ], edges: [
        { id: "batch-to-worker", from: { kind: "node", nodeId: "batch", channel: "data" }, to: { kind: "node", nodeId: "worker", channel: "data" }, role: "general", order: 0, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true },
        { id: "worker-to-image", from: { kind: "node", nodeId: "worker", channel: "text" }, to: { kind: "node", nodeId: "image", channel: "text" }, role: "general", order: 1, selector: { kind: "latest" }, adapter: { kind: "auto" }, enabled: true }
      ], groups: [], modules: [], viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
    };
    let references = Array.from({ length: 100 }, (_, index) => ({
      id: `reference-${index}`, displayName: `Reference ${String(index + 1).padStart(3, "0")}.png`, mediaType: "image/png",
      state: index === 77 ? "missing" : index % 3 === 0 ? "embedded" : "linked", originalPath: null, pathGrantId: null,
      contentKey: null, previewContentKey: null, identity: null,
      fingerprint: { byteLength: index === 1 ? 100 : 100 + index, modifiedAt: index + 1, sampleSha256: "a".repeat(64) }, createdAt: now, updatedAt: now
    }));
    let jobs = Array.from({ length: 500 }, (_, index) => ({
      id: `job-${String(index).padStart(3, "0")}`, planId: `plan-${index}`, planContentHash: `hash-${index}`,
      status: index === 0 ? "failed" : index === 1 ? "running" : index === 2 ? "cancelled" : "completed",
      requestedParallelism: index === 1 ? 4 : 1, effectiveParallelism: index === 1 ? 4 : 1,
      createdAt: now, startedAt: index === 2 ? null : now, completedAt: index === 1 ? null : now,
      cancellationRequestedAt: index === 2 ? now : null
    }));
    const capabilities = [
      { providerId: "codex-vision-assistant", profileId: "worker:gpt-5.4", modelId: "gpt-5.4", operation: "llm", inputChannels: ["text", "image", "data"], outputChannels: ["text", "data"], aspectRatios: [], resolutions: [], maxReferences: 32, maxOutputsPerCall: 4, maxParallelism: 4, supportsCancellation: true, supportsSeed: false, provenance: "runtime-discovered", limitations: [] },
      { providerId: "codex-vision-assistant", profileId: "worker:gpt-5.6", modelId: "gpt-5.6", operation: "llm", inputChannels: ["text", "image", "data"], outputChannels: ["text", "data"], aspectRatios: [], resolutions: [], maxReferences: 32, maxOutputsPerCall: 4, maxParallelism: 4, supportsCancellation: true, supportsSeed: false, provenance: "runtime-discovered", limitations: [] },
      { providerId: "google-nano-banana-2", profileId: "google-nano-banana-2", modelId: "Nano Banana 2", operation: "generate-image", inputChannels: ["text", "image"], outputChannels: ["image"], aspectRatios: ["1:1"], resolutions: [{ id: "square", width: 1024, height: 1024, label: "1024 square" }], maxReferences: 16, maxOutputsPerCall: 1, maxParallelism: 4, supportsCancellation: true, supportsSeed: false, provenance: "conformance-verified", limitations: [] },
      { providerId: "google-nano-banana-pro", profileId: "google-nano-banana-pro", modelId: "Nano Banana Pro", operation: "generate-image", inputChannels: ["text", "image"], outputChannels: ["image"], aspectRatios: ["1:1"], resolutions: [{ id: "square", width: 1024, height: 1024, label: "1024 square" }], maxReferences: 16, maxOutputsPerCall: 1, maxParallelism: 4, supportsCancellation: true, supportsSeed: false, provenance: "conformance-verified", limitations: [] },
      { providerId: "wide-image-only", profileId: "wide-image-only", modelId: "Wide Image", operation: "generate-image", inputChannels: ["text", "image"], outputChannels: ["image"], aspectRatios: ["16:9"], resolutions: [{ id: "square", width: 1024, height: 1024, label: "1024 square" }], maxReferences: 16, maxOutputsPerCall: 1, maxParallelism: 1, supportsCancellation: true, supportsSeed: false, provenance: "conformance-verified", limitations: [] },
      { providerId: "small-image-only", profileId: "small-image-only", modelId: "Small Image", operation: "generate-image", inputChannels: ["text", "image"], outputChannels: ["image"], aspectRatios: ["1:1"], resolutions: [{ id: "small-square", width: 512, height: 512, label: "512 square" }], maxReferences: 16, maxOutputsPerCall: 1, maxParallelism: 1, supportsCancellation: true, supportsSeed: false, provenance: "conformance-verified", limitations: [] }
    ];
    const commands: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const pickers: Array<{ storage: string }> = [];
    const dropped: Array<{ name: string; storage: string }> = [];
    const recovery: Array<{ referenceId: string; action: string }> = [];
    const eventListeners: Array<(event: Record<string, unknown>) => void> = [];
    const descriptor = () => ({ documentId: "workflow-document", displayName: "Workflow", named: true, mode: "writable", readOnlyReason: null, commands: { save: true, saveAs: true, saveCopy: true, compact: true, makePortable: true }, saveState: "saved", documentRevisionId: "revision-1", graphId: graph.id, graphRevisionId: "graph-revision-1", simulationEnabled: false, revision: 1 });
    const emitJobStatus = (jobId: string, status: string) => {
      jobs = jobs.map((job) => job.id === jobId ? { ...job, status, completedAt: status === "running" ? null : now } : job);
      for (const listener of eventListeners) listener({ kind: "event", id: crypto.randomUUID(), correlationId: crypto.randomUUID(), documentId: "workflow-document", name: "job.stateChanged", occurredAt: now, payload: { jobId, state: status } });
    };
    Object.defineProperty(window, "__workflowState", { value: { commands, pickers, dropped, recovery, eventListeners, emitJobStatus } });
    Object.defineProperty(window, "ether", { value: {
      document: { onEvent: () => () => undefined, bootstrap: async () => descriptor(), new: async () => descriptor(), open: async () => descriptor(), openDropped: async () => descriptor(), save: async () => descriptor(), saveAs: async () => descriptor(), saveCopy: async () => descriptor(), compact: async () => ({ beforeBytes: 1, afterBytes: 1 }), makePortable: async () => ({ cancelled: false, embeddedCount: 0, embeddedBytes: 0, expectedBytes: 0, expectedCount: 0, missingReferences: [] }), close: async () => null },
      graph: { snapshot: async () => ({ graph, revision: 1 }), applyTransaction: async () => ({ graph, revision: 1 }) },
      references: {
        list: async () => references.map((reference, index) => ({ id: reference.id, displayName: reference.displayName, mediaType: reference.mediaType, state: reference.state, actions: index === 77 && reference.state === "missing" ? ["locate"] : [] })),
        act: async (_documentId: string, referenceId: string, action: string) => { recovery.push({ referenceId, action }); references = references.map((reference) => reference.id === referenceId ? { ...reference, state: "linked" } : reference); return []; },
        chooseAndLink: async (input: { storage: string }) => { pickers.push(input); return { cancelled: false, referenceId: `picked-${input.storage}` }; },
        importDropped: async (file: File, input: { storage: string }) => { dropped.push({ name: file.name, storage: input.storage }); return { cancelled: false, referenceId: `dropped-${file.name}` }; }
      },
      application: {
        onEvent: (listener: (event: Record<string, unknown>) => void) => { eventListeners.push(listener); return () => { const index = eventListeners.indexOf(listener); if (index >= 0) eventListeners.splice(index, 1); }; },
        command: async (command: { name: string; payload: Record<string, unknown> }) => {
          commands.push(command);
          if (command.name === "run.preview") {
            const requestedParallelism = Number(graph.nodes.find((node) => node.id === "batch")?.config.parallelism ?? 1);
            return { kind: "response", name: "run.preview", payload: { plan: { id: "preview", estimatedCalls: 10_000, requestedParallelism, effectiveParallelism: Math.min(requestedParallelism, 8), batchSummary: { dimensions: 3, exclusions: 1, workItemCount: 10_000 }, warnings: [{ code: "BATCH_EXPANSION_CAPPED", message: "Expansion is capped at 10,000 executable work items.", blocking: false }], workItems: [] } } };
          }
          if (command.name === "graph.applyTransaction") {
            const transaction = command.payload.transaction as { operations: Array<{ node: typeof graph.nodes[number] }> };
            const updated = transaction.operations[0]?.node; if (updated) graph = { ...graph, nodes: graph.nodes.map((node) => node.id === updated.id ? updated : node) };
            if (updated?.id === "batch") await new Promise((resolve) => setTimeout(resolve, 40));
          }
          return { kind: "response", name: command.name, payload: command.name === "graph.applyTransaction" ? { documentRevisionId: "revision-2", graphRevisions: [{ graphId: graph.id, revisionId: "graph-revision-2" }] } : { acknowledged: true } };
        },
        query: async (query: { name: string; payload: Record<string, unknown> }) => {
          if (query.name === "provider.capabilities") return { kind: "response", name: "provider.capabilities", payload: { capabilities } };
          if (query.name === "reference.list") return { kind: "response", name: "reference.list", payload: { references } };
          if (query.name === "job.list") return { kind: "response", name: "job.list", payload: { jobs: jobs.slice(0, Number(query.payload.limit ?? 500)) } };
          if (query.name === "plan.summary") return { kind: "response", name: "plan.summary", payload: { plan: { id: query.payload.planId, graphId: graph.id, estimatedCalls: 1, effectiveParallelism: 4, contentHash: "sha256:v1:" + "b".repeat(64), workItems: [], warnings: [], steps: [] } } };
          if (query.name === "job.workItems") return { kind: "response", name: "job.workItems", payload: { jobId: query.payload.jobId, workItems: query.payload.jobId === "job-000" ? [{ id: "failed-a", status: "failed" }, { id: "failed-b", status: "failed" }, { id: "accepted", status: "accepted" }] : [] } };
          if (query.name === "job.attempts") return { kind: "response", name: "job.attempts", payload: { jobId: query.payload.jobId, attempts: [] } };
          if (query.name === "job.timeline") return { kind: "response", name: "job.timeline", payload: { jobId: query.payload.jobId, entries: [{ id: "timeline-1", occurredAt: now, state: "failed", workItemId: "failed-a", attemptId: null }] } };
          return { kind: "response", name: "graph.snapshot", payload: { graph, documentRevisionId: "revision-1", graphRevisionId: "graph-revision-1" } };
        }
      },
      artifacts: { search: async () => [], generateFake: async () => [] }, runtime: { versions: async () => ({ electron: "43", node: "24" }) }
    } });
  });

  await page.goto("/");
  const latestBatchConfig = () => page.evaluate(() => {
    const commands = (window as typeof window & { __workflowState: { commands: BatchUpdateCommand[] } }).__workflowState.commands;
    return commands.filter((command) => command.name === "graph.applyTransaction").at(-1)?.payload.transaction?.operations?.[0]?.node?.config ?? null;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("heading", { name: "Reference Desk" })).toBeVisible();
  await expect(page.locator(".reference-row").first()).toBeVisible();
  expect(await page.locator(".reference-row").count()).toBeLessThan(30);
  if (process.env.ETHER_CAPTURE_SCREENSHOTS === "1") await page.screenshot({ path: path.resolve(process.cwd(), "../../output/playwright/task18-reference-desk-1440x900.png"), fullPage: true });
  for (const view of ["Grid", "Filmstrip", "Waveform", "List"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(page.getByTestId("reference-grid")).toHaveAttribute("data-view", view.toLowerCase());
  }
  await page.locator(".reference-desk").evaluate((desk) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["drop"], "dropped-style.png", { type: "image/png" }));
    desk.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __workflowState: { dropped: unknown[] } }).__workflowState.dropped.length)).toBe(1);
  await page.getByRole("checkbox", { name: "Select Reference 001.png" }).check();
  await page.getByRole("checkbox", { name: "Select Reference 002.png" }).check();
  await page.getByRole("button", { name: "Compare selected" }).click();
  await expect(page.getByRole("region", { name: "Reference comparison" })).toContainText("Reference 001.png");
  await page.getByRole("button", { name: "Deduplicate selection" }).click();
  await expect(page.getByText("1 selected · 0 saved in set · 100 total")).toBeVisible();
  await page.getByRole("article").filter({ hasText: "Reference 001.png" }).getByRole("checkbox", { name: "Include" }).uncheck();
  await page.getByRole("combobox", { name: "Reference 001.png role override" }).selectOption("style");
  await page.getByRole("button", { name: "Add to set" }).press("Enter");
  await page.getByRole("checkbox", { name: "Select Reference 001.png" }).uncheck();
  await page.getByRole("checkbox", { name: "Select Reference 003.png" }).check();
  await page.getByRole("button", { name: "Replace set" }).press("Enter");
  await page.getByRole("button", { name: "Link file" }).click();
  await page.getByRole("button", { name: "Embed copy" }).click();
  const grid = page.getByTestId("reference-grid");
  await grid.evaluate((element) => { element.scrollTop = 77 * 58; element.dispatchEvent(new Event("scroll", { bubbles: true })); });
  const missing = page.locator('[data-reference-id="reference-77"]');
  await expect(missing).toContainText("missing");
  await missing.getByRole("button", { name: "Locate" }).click();
  await grid.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll", { bubbles: true })); });
  await page.getByRole("checkbox", { name: "Select Reference 003.png" }).uncheck();
  await page.getByRole("checkbox", { name: "Select Reference 001.png" }).check();
  await page.getByRole("combobox", { name: "Batch dimension" }).selectOption({ label: "Markets × treatments · Market" });
  await page.getByRole("button", { name: "Send to Batch" }).press("Enter");
  const assignment = await page.evaluate(() => (window as typeof window & { __workflowState: { commands: Array<{ name: string; payload: Record<string, unknown> }>; pickers: Array<{ storage: string }> } }).__workflowState);
  expect(assignment.commands.find((command) => command.name === "reference.assignToSet")?.payload).toMatchObject({ members: [{ kind: "linked-reference", referenceId: "reference-0", enabled: false, roleOverride: "style" }], replace: false });
  expect(assignment.commands.find((command) => command.name === "reference.assignToSet" && command.payload.replace === true)?.payload).toMatchObject({ members: [{ kind: "linked-reference", referenceId: "reference-2", enabled: true }], replace: true });
  expect(assignment.pickers.map((picker) => picker.storage)).toEqual(["link", "embed"]);
  const workflowState = await page.evaluate(() => (window as typeof window & { __workflowState: { recovery: Array<{ referenceId: string; action: string }>; dropped: Array<{ name: string; storage: string }> } }).__workflowState);
  expect(workflowState.recovery).toEqual([{ referenceId: "reference-77", action: "locate" }]);
  expect(workflowState.dropped).toEqual([{ name: "dropped-style.png", storage: "link" }]);
  const referenceBatchUpdate = assignment.commands.filter((command) => command.name === "graph.applyTransaction")[0]?.payload as { transaction?: { operations?: Array<{ node?: { config?: { dimensions?: Array<{ id: string; values: unknown[] }> } } }> } };
  expect(referenceBatchUpdate.transaction?.operations?.[0]?.node?.config?.dimensions?.find((dimension) => dimension.id === "market")?.values).toEqual(["EU", "US", "reference-0"]);

  await page.getByTestId("workspace-switcher").getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Batch Matrix" })).toBeVisible();
  const batchMatrix = page.locator(".batch-matrix");
  const fullBatch = batchMatrix.locator('[aria-labelledby="full-batch-heading"]');
  const allocation = batchMatrix.locator('[aria-labelledby="allocation-heading"]');
  const concurrency = batchMatrix.locator('[aria-labelledby="concurrency-heading"]');
  await expect(fullBatch.getByRole("heading", { name: "Full batch" })).toBeVisible();
  await expect(fullBatch).toContainText("Dimensions create the complete work list");
  await expect(allocation.getByRole("heading", { name: "Provider and model allocation" })).toBeVisible();
  await expect(allocation).toContainText("profile and model identity come from current capability evidence");
  await expect(concurrency.getByRole("heading", { name: "Concurrent run" })).toBeVisible();
  await expect(concurrency).toContainText("Total concurrency is separate from batch size");
  await expect(page.getByText("10000 work items")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("capped at 10,000");
  await expect(page.getByText("Showing the first 500 of 18,000 combinations.", { exact: false })).toBeVisible();
  await expect(page.locator(".batch-cells button")).toHaveCount(500);
  await expect(page.getByText("effective 1 after the global and provider limits", { exact: false })).toBeVisible();
  const previewsBeforePolicyRefresh = await page.evaluate(() =>
    (window as typeof window & { __workflowState: { commands: BatchUpdateCommand[] } }).__workflowState.commands
      .filter((command) => command.name === "run.preview").length
  );
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("ether:provider-policy-changed")));
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __workflowState: { commands: BatchUpdateCommand[] } }).__workflowState.commands
      .filter((command) => command.name === "run.preview").length
  )).toBeGreaterThan(previewsBeforePolicyRefresh);
  const workerTarget = allocation.locator(".batch-target").filter({ hasText: "Prompt Worker" });
  const imageTarget = allocation.locator(".batch-target").filter({ hasText: "Image Generator" });
  await expect(workerTarget).toContainText("Prompt Worker");
  await expect(imageTarget).toContainText("Image Generator");
  await expect(concurrency).toContainText("8 calls globally, shares 4 across Codex, shares 4 across Gemini API");
  await expect(concurrency.getByLabel("Provider concurrency limits")).toContainText("Codex up to 4 at once");
  await expect(concurrency.getByLabel("Provider concurrency limits")).toContainText("Antigravity fallback up to 4 at once");
  await workerTarget.getByRole("button", { name: "Add lane" }).click();
  await expect(batchMatrix.getByRole("status")).toContainText("Saving batch changes");
  const workerProvider = workerTarget.getByRole("combobox", { name: "Prompt Worker provider and model route" });
  const workerItems = workerTarget.getByRole("spinbutton", { name: "Prompt Worker allocated items" });
  await expect(workerItems).toHaveValue("10000");
  await expect(workerTarget.getByRole("textbox", { name: "Prompt Worker model" })).toHaveCount(0);
  await workerProvider.selectOption("codex-vision-assistant\u0000worker:gpt-5.6");
  await expect.poll(async () => (await latestBatchConfig())?.allocations?.find((lane) => lane.targetNodeId === "worker")).toMatchObject({ targetNodeId: "worker", providerId: "codex-vision-assistant", profileId: "worker:gpt-5.6", modelId: "gpt-5.6" });
  await expect(page.locator(".document-status")).toContainText("Batch allocation saved.");
  await workerItems.fill("4");
  await workerItems.press("Tab");
  await expect.poll(async () => (await latestBatchConfig())?.allocations?.find((lane) => lane.targetNodeId === "worker")).toMatchObject({ targetNodeId: "worker", count: 4, providerId: "codex-vision-assistant", profileId: "worker:gpt-5.6", modelId: "gpt-5.6" });
  await imageTarget.getByRole("button", { name: "Add lane" }).click();
  const imageProvider = imageTarget.getByRole("combobox", { name: "Image Generator provider and model route" });
  const imageItems = imageTarget.getByRole("spinbutton", { name: "Image Generator allocated items" });
  await expect(imageItems).toHaveValue("10000");
  await expect(imageTarget.getByRole("textbox", { name: "Image Generator model" })).toHaveCount(0);
  await expect(imageProvider).toContainText("Antigravity fallback · Nano Banana Pro");
  await expect(imageProvider).not.toContainText("wide-image-only");
  await expect(imageProvider).not.toContainText("small-image-only");
  await imageProvider.selectOption("google-nano-banana-pro\u0000google-nano-banana-pro");
  await expect.poll(async () => (await latestBatchConfig())?.allocations?.find((lane) => lane.targetNodeId === "image")).toMatchObject({ targetNodeId: "image", providerId: "google-nano-banana-pro", profileId: "google-nano-banana-pro", modelId: "Nano Banana Pro" });
  await expect(page.locator(".document-status")).toContainText("Batch allocation saved.");
  await imageItems.fill("4");
  await imageItems.press("Tab");
  await expect.poll(async () => (await latestBatchConfig())?.allocations?.find((lane) => lane.targetNodeId === "image")).toMatchObject({ targetNodeId: "image", count: 4, providerId: "google-nano-banana-pro", profileId: "google-nano-banana-pro", modelId: "Nano Banana Pro" });
  await expect(page.getByRole("combobox", { name: "Batch execution policy" })).toHaveValue("1");
  await page.getByRole("combobox", { name: "Batch execution policy" }).selectOption("8");
  await expect.poll(async () => (await latestBatchConfig())?.parallelism).toBe(8);
  await expect(page.getByText("effective 8 after the global and provider limits", { exact: false })).toBeVisible();
  await page.locator(".batch-cells button:not(.is-excluded)").first().click();
  const batchCommands = await page.evaluate(() => (window as typeof window & { __workflowState: { commands: Array<{ name: string; payload: Record<string, unknown> }> } }).__workflowState.commands);
  const batchUpdate = batchCommands.filter((command) => command.name === "graph.applyTransaction").at(-1);
  expect(batchUpdate?.payload).toMatchObject({ transaction: { operations: [{ node: { config: { exclusions: [{ values: { market: "US", treatment: "C", variant: "v1999" } }, { values: { market: "EU", treatment: "A", variant: "v0" } }] } } }] } });

  await expect(page.getByRole("heading", { name: "Job Center" })).toBeVisible();
  if (process.env.ETHER_CAPTURE_SCREENSHOTS === "1") await page.screenshot({ path: path.resolve(process.cwd(), "../../output/playwright/task18-run-workspace-1440x900.png"), fullPage: true });
  await expect(page.getByRole("button", { name: "Active, 1 job" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Done, 498 jobs" })).toBeVisible();
  await page.getByRole("button", { name: "Attention required, 1 job" }).click();
  await expect(page.locator(".job-list button")).toHaveCount(1);
  await page.getByRole("button", { name: "All, 500 jobs" }).click();
  expect(await page.locator(".job-list > div > button").count()).toBeLessThan(20);
  await expect(page.getByRole("button", { name: "Retry failed (2)" })).toBeEnabled();
  await page.getByRole("button", { name: "Retry failed (2)" }).click();
  await page.locator(".job-list button").filter({ hasText: "job-001" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => (window as typeof window & { __workflowState: { emitJobStatus(jobId: string, status: string): void } }).__workflowState.emitJobStatus("job-001", "failed"));
  await expect(page.locator(".job-list button").filter({ hasText: "job-001" })).toContainText("failed");
  await expect(page.getByRole("button", { name: "Attention required, 2 jobs" })).toBeVisible();
  await page.locator(".job-list button").filter({ hasText: "job-002" }).click();
  await expect(page.getByRole("article", { name: "Job job-002 detail" })).toContainText("cancelled");
  await expect(page.getByRole("button", { name: "Resume" })).toHaveCount(0);
  const jobCommands = await page.evaluate(() => (window as typeof window & { __workflowState: { commands: Array<{ name: string; payload: Record<string, unknown> }> } }).__workflowState.commands);
  expect(jobCommands.find((command) => command.name === "job.retry")?.payload).toEqual({ jobId: "job-000", workItemIds: ["failed-a", "failed-b"] });
  expect(jobCommands.map((command) => command.name)).toEqual(expect.arrayContaining(["job.cancel"]));

  await page.reload();
  await page.getByTestId("workspace-switcher").getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByText("500 durable jobs", { exact: false })).toBeVisible();
  await expect(page.getByRole("article", { name: "Job job-000 detail" })).toContainText("failed");
  await expect(page.getByRole("button", { name: "Retry failed (2)" })).toBeEnabled();
});

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { GraphTransaction } from "@ether/schema";

import {
  assertAuthoringJourneySourceSafety,
  blankAuthoringJourney,
  launchRecoveryJourney,
  packagedJourneyConfig,
  recoveryShellTokenForProfile
} from "../../recovery/journeyDriver.js";
import { findExactPackagedProcessId } from "../../recovery/windowsIntegration.js";
import {
  callMcpTool,
  grantEditPermitThroughNativeMenu,
  openPackagedLocalMcpClient,
  type LocalMcpClient
} from "./t21PluginJourneyHelpers.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const thisSource = fileURLToPath(import.meta.url);
const journeyId = "t21-plugin-coproduction";

test.skip(process.platform !== "win32", "J10 operates the packaged Windows Ether application and its native Codex permission menu.");

test("J10 co-produces an inspectable tailored Prompt and Worker graph without a Run Permit or provider execution", async () => {
  assertAuthoringJourneySourceSafety(await readFile(thisSource, "utf8"), "T21 packaged plugin co-production spec");
  const session = await launchRecoveryJourney({
    ...packagedJourneyConfig(workspaceRoot, journeyId),
    evidenceMode: "committed",
    committedEvidencePath: ["phase-4", "t21-plugin-coproduction", journeyId],
    packagedArgs: (profile) => [`--ether-recovery-simulation=${recoveryShellTokenForProfile(profile)}`],
    viewport: { width: 1600, height: 1000 },
    declaration: blankAuthoringJourney(journeyId, "none")
  });
  let mcp: LocalMcpClient | null = null;
  let closed = false;
  try {
    const { page, profile, input, evidence } = session;
    const canvas = page.getByTestId("ether-canvas-surface");
    await expect(page.getByTestId("document-canvas")).toBeVisible({ timeout: 30_000 });
    await expect(canvas).toHaveAttribute("data-graph-node-count", "0");

    mcp = await openPackagedLocalMcpClient(workspaceRoot, profile.localAppData);
    const initialPermits = await callMcpTool(mcp.client, "ether.permission.inspect");
    expect(permitList(initialPermits)).toEqual([]);
    const initialJobs = await callMcpTool(mcp.client, "ether.run.list", { limit: 10 });
    expect(jobList(initialJobs)).toEqual([]);

    const ownerPid = await findExactPackagedProcessId(
      path.join(workspaceRoot, "release", "windows", "win-unpacked", "Ether.exe"),
      profile.userData
    );
    const nativeApproval = await grantEditPermitThroughNativeMenu(ownerPid);
    input.observe(
      "Grant Edit Permit through the native Codex menu",
      "The owner visibly grants only a temporary Edit Permit using the exact packaged menu and dialogs.",
      nativeApproval
    );

    const permitsAfterApproval = await callMcpTool(mcp.client, "ether.permission.inspect");
    const editPermitId = activeEditPermitId(permitsAfterApproval);
    expect(permitList(permitsAfterApproval)).not.toContainEqual(expect.objectContaining({ permission: "run" }));

    const inspected = await callMcpTool(mcp.client, "ether.graph.inspect", { graphId: "graph-root" });
    const transaction = tailoredPromptWorkerTransaction(
      requiredString(inspected.documentRevisionId, "documentRevisionId"),
      requiredString(inspected.graphRevisionId, "graphRevisionId")
    );
    const preview = await callMcpTool(mcp.client, "ether.graph.transaction.preview", { transaction });
    const proposal = record(preview.proposal, "transaction proposal");
    expect(proposal.summary).toMatchObject({ operationCount: 3, addedNodes: 2, addedEdges: 1 });
    const applied = await callMcpTool(mcp.client, "ether.graph.transaction.apply", {
      proposalId: requiredString(proposal.proposalId, "proposalId"),
      baseDocumentRevisionId: transaction.baseDocumentRevisionId,
      editPermitId
    });
    expect(applied).toMatchObject({ state: "applied" });

    await expect(canvas).toHaveAttribute("data-graph-node-count", "2");
    await expect(page.locator(".ether-edge-hit-target")).toHaveCount(1);
    await expect(page.locator(".ether-node-title", { hasText: "Coastal furniture launch brief" })).toHaveCount(1);
    await expect(page.locator(".ether-node-title", { hasText: "Campaign prompt co-producer" })).toHaveCount(1);
    const validationAfterApply = await callMcpTool(mcp.client, "ether.graph.validate", { graphId: "graph-root" });
    expect(validationAfterApply).toMatchObject({ valid: true, issues: [] });
    await input.screenshot("01-plugin-tailored-graph.png", evidence, "Capture the MCP-applied tailored graph", "The real packaged desktop visibly changed from zero to two editable cards and one text edge after one MCP Edit Permit transaction.");

    await canvas.focus();
    await input.pressKey("Control+z", "Undo the plugin graph transaction", "The single plugin-created graph revision returns the visible canvas to zero cards and zero edges.");
    await expect(canvas).toHaveAttribute("data-graph-node-count", "0");
    await expect(page.locator(".ether-edge-hit-target")).toHaveCount(0);

    await input.pressKey("Control+y", "Redo the plugin graph transaction", "Redo restores the exact two-card Prompt and Worker graph and its one visible connection.");
    await expect(canvas).toHaveAttribute("data-graph-node-count", "2");
    await expect(page.locator(".ether-edge-hit-target")).toHaveCount(1);
    await expect(page.locator(".ether-node-title", { hasText: "Coastal furniture launch brief" })).toHaveCount(1);
    await expect(page.locator(".ether-node-title", { hasText: "Campaign prompt co-producer" })).toHaveCount(1);
    const validationAfterRedo = await callMcpTool(mcp.client, "ether.graph.validate", { graphId: "graph-root" });
    expect(validationAfterRedo).toMatchObject({ valid: true, issues: [] });

    const finalPermits = await callMcpTool(mcp.client, "ether.permission.inspect");
    expect(permitList(finalPermits)).toContainEqual(expect.objectContaining({ id: editPermitId, permission: "edit", state: "active" }));
    expect(permitList(finalPermits)).not.toContainEqual(expect.objectContaining({ permission: "run" }));
    const finalJobs = await callMcpTool(mcp.client, "ether.run.list", { limit: 10 });
    expect(jobList(finalJobs)).toEqual([]);
    input.observe(
      "Keep execution separately authorized",
      "No Run Permit, run plan, job, or provider operation exists after the Edit Permit graph transaction.",
      "The MCP session used only inspect, preview, apply, validate, and job-list tools; its final permit list has no run permit and the durable job list is empty."
    );
    await input.screenshot("02-plugin-undo-redo-no-run.png", evidence, "Capture redo parity with no execution", "The restored graph remains visibly authored and ready for user inspection while execution has not been authorized or started.");

    await mcp.close();
    mcp = null;
    await session.close("passed");
    closed = true;
  } finally {
    await mcp?.close();
    if (!closed) await session.close("failed");
  }
});

function tailoredPromptWorkerTransaction(documentRevisionId: string, graphRevisionId: string): GraphTransaction {
  return {
    id: "t21-tailored-prompt-worker",
    baseDocumentRevisionId: documentRevisionId,
    baseGraphRevisions: { "graph-root": graphRevisionId },
    title: "Prepare a tailored coastal furniture campaign prompt",
    actor: "codex",
    layoutPolicy: "preserve",
    operations: [
      {
        type: "addNode",
        graphId: "graph-root",
        node: {
          id: "$temp:node:brief",
          definitionId: "prompt.text",
          title: "Coastal furniture launch brief",
          position: { x: 120, y: 180 },
          size: { width: 220, height: 140 },
          config: {
            kind: "prompt.text",
            body: "Create a calm coastal campaign for a modular oak lounge chair: pale plaster, tide-washed blue accents, morning light, and room for a concise product headline.",
            assembly: "append"
          },
          presentation: { collapsed: false, accent: "default", previewMode: "content" }
        }
      },
      {
        type: "addNode",
        graphId: "graph-root",
        node: {
          id: "$temp:node:worker",
          definitionId: "prompt.worker",
          title: "Campaign prompt co-producer",
          position: { x: 420, y: 180 },
          size: { width: 220, height: 140 },
          config: {
            kind: "prompt.worker",
            behavior: "rewrite",
            instruction: "Turn the supplied furniture launch brief into one production-ready visual prompt while preserving material, light, palette, and headline space.",
            profile: "balanced",
            model: "gpt-5",
            reasoningEffort: "medium",
            variation: 0.2,
            reviewPolicy: "inspect-first",
            contextPolicy: { includeUpstream: true, includeDownstreamCapabilities: true, maxTokens: 8_000 },
            memoryPolicy: { mode: "stateless" },
            outputContract: { channel: "text", count: 1, selectionPolicy: "latest" }
          },
          presentation: { collapsed: false, accent: "default", previewMode: "summary" }
        }
      },
      {
        type: "addEdge",
        graphId: "graph-root",
        edge: {
          id: "$temp:edge:brief-worker",
          from: { kind: "node", nodeId: "$temp:node:brief", channel: "text" },
          to: { kind: "node", nodeId: "$temp:node:worker", channel: "text" },
          role: "general",
          order: 0,
          selector: { kind: "latest-approved" },
          adapter: { kind: "auto" },
          enabled: true
        }
      }
    ]
  };
}

function permitList(result: Record<string, unknown>): unknown[] {
  if (!Array.isArray(result.permits)) throw new TypeError("MCP permit inspection did not return a permit list.");
  return result.permits;
}

function jobList(result: Record<string, unknown>): unknown[] {
  if (!Array.isArray(result.jobs)) throw new TypeError("MCP job list did not return a job list.");
  return result.jobs;
}

function activeEditPermitId(result: Record<string, unknown>): string {
  const permit = permitList(result).find((candidate) => record(candidate, "permit").permission === "edit" && record(candidate, "permit").state === "active");
  if (permit === undefined) throw new Error("The packaged host did not expose the native-granted active Edit Permit.");
  return requiredString(record(permit, "Edit Permit").id, "Edit Permit id");
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`Expected ${label} to be an object.`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`Expected ${label} to be a non-empty string.`);
  return value;
}

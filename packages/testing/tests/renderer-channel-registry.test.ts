import { describe, expect, it } from "vitest";
import { getNodeDefinition } from "@ether/graph-kernel";
import { canonicalNodeDefinitionIds, type EtherEdge, type EtherGraph, type EtherNode, type NodeDefinitionId } from "@ether/schema";
import { edgePreflightMessage } from "../../../apps/desktop/src/renderer/canvas/commands/useEdgeCommands";
import { createRegistryListItem, purposeBuiltRegistryKinds, registryFieldControl } from "../../../apps/desktop/src/renderer/canvas/inspector/registryFieldModel";
import { runPlanPresentation } from "../../../apps/desktop/src/renderer/canvas/inspector/runPlanPresentation";
import { bundledBezierPath, edgeBundleKey, edgeLabelPlacement } from "../../../apps/desktop/src/renderer/canvas/edges/edgeGeometry";
import {
  channelsFor,
  CONNECTION_ROLES,
  DEFAULT_CONNECTION_ROLE,
  PAYLOAD_CHANNELS,
  channelLabel,
  roleLabel
} from "../../../apps/desktop/src/renderer/canvas/ports/channelRegistry";

describe("renderer channel registry", () => {
  it("keeps the Ether 4.0 channel and role lists exact", () => {
    expect(PAYLOAD_CHANNELS).toEqual(["text", "image", "mask", "data", "video", "audio"]);
    expect(CONNECTION_ROLES).toEqual([
      "general",
      "negative",
      "subject",
      "product",
      "face",
      "clothing",
      "pose",
      "setting",
      "composition",
      "style",
      "lighting",
      "colourPalette",
      "typography",
      "motion",
      "timing"
    ]);
    expect(DEFAULT_CONNECTION_ROLE).toBe("general");
    expect(channelLabel("text")).toBe("Text");
    expect(channelLabel("audio")).toBe("Audio");
    expect(roleLabel("colourPalette")).toBe("Colour palette");
  });

  it("projects every rail from the canonical node registry", () => {
    expect(channelsFor("prompt.worker", "input")).toEqual(getNodeDefinition("prompt.worker").library.inputChannels);
    expect(channelsFor("generation.image", "output")).toEqual(getNodeDefinition("generation.image").library.outputChannels);
    expect(channelsFor("canvas.note", "input")).toEqual([]);
  });

  it("rejects only exact duplicate lanes while preserving role and selector variants", () => {
    const existing = edge("lane", "prompt", "worker", "text", "text");
    const graph = fixture([existing]);
    expect(edgePreflightMessage(graph, { ...existing, id: "duplicate" })).toMatch(/^DUPLICATE_LANE:/);
    expect(edgePreflightMessage(graph, { ...existing, id: "role-lane", role: "subject" })).toBeNull();
    expect(edgePreflightMessage(graph, { ...existing, id: "selector-lane", selector: { kind: "latest" } })).toBeNull();
  });

  it("fans same-endpoint lanes into readable paths and an endpoint-safe label gutter", () => {
    const lanes = PAYLOAD_CHANNELS.map((channel) => ({
      ...edge(`lane-${channel}`, "prompt", "worker", "text", "text"),
      from: { kind: "node" as const, nodeId: "prompt", channel },
      to: { kind: "node" as const, nodeId: "worker", channel }
    }));
    expect(new Set(lanes.map(edgeBundleKey))).toHaveLength(1);

    const placements = lanes.map((_, index) => edgeLabelPlacement({
      x: 180,
      y: 280,
      targetX: 240,
      targetY: 280,
      lane: { index, count: lanes.length },
      sourceBounds: { x: 100, y: 220, width: 80, height: 180 },
      targetBounds: { x: 240, y: 220, width: 80, height: 180 }
    }));
    expect(new Set(placements.map(({ x, y }) => `${x}:${y}`))).toHaveLength(lanes.length);
    expect(placements.every(({ y }) => y < 220)).toBe(true);
    expect(new Set(lanes.map((lane, index) => bundledBezierPath({
      x: 180,
      y: 280,
      targetX: 240,
      targetY: 280,
      lane: { index, count: lanes.length }
    })?.center.y))).toHaveLength(lanes.length);
  });

  it("allows local adapters but reports unavailable semantic capabilities before persistence", () => {
    const graph = fixture([]);
    expect(edgePreflightMessage(graph, edge("local", "prompt", "worker", "data", "text"))).toBeNull();
    expect(edgePreflightMessage(graph, edge("semantic", "image", "worker", "image", "text"))).toMatch(/^PROVIDER_CAPABILITY_UNAVAILABLE:/);
  });

  it("maps every canonical Inspector field to an ordinary or purpose-built control", () => {
    const coverage = canonicalNodeDefinitionIds.flatMap((definitionId) => {
      const definition = getNodeDefinition(definitionId);
      const config = definition.defaultConfig() as unknown as Record<string, unknown>;
      return definition.inspector.sections.flatMap((section) => section.fields).map((field) => ({
        definitionId,
        field,
        control: registryFieldControl(definitionId, field, config[field])
      }));
    });
    expect(coverage.filter((entry) => entry.control === "unhandled")).toEqual([]);
    expect(purposeBuiltRegistryKinds).toEqual(new Set(["prompt.text", "prompt.worker", "generation.image", "edit.image", "canvas.drawing"]));
    expect(createRegistryListItem("review.evaluate", "rubric", 0)).toMatchObject({ label: "Criterion 1", weight: 1 });
    expect(createRegistryListItem("review.filter", "rules", 0)).toMatchObject({ field: "score", operator: "gte" });
    expect(createRegistryListItem("flow.variables", "variables", 0)).toEqual({ name: "variable1", value: "" });
    expect(createRegistryListItem("flow.batch", "exclusions", 0)).toEqual({ values: {} });
  });

  it("keeps adapter steps visible in prepared-plan summaries", () => {
    const presentation = runPlanPresentation({
      steps: [{
        id: "adapter-step",
        nodeId: "worker",
        subject: { kind: "adapter", adapterId: "local.data-to-text" },
        executor: "deterministic",
        dependencyStepIds: [],
        inputPayloadIds: [],
        workItemIds: [],
        compiledPrompt: "",
        compiledContext: {},
        parameters: {},
        selectors: [],
        provider: {
          providerId: "ether.local",
          profileId: "local",
          modelId: "data-to-text",
          settings: {},
          capabilitySnapshot: {
            providerId: "ether.local",
            profileId: "local",
            modelId: "data-to-text",
            operation: "llm",
            inputChannels: ["data"],
            outputChannels: ["text"],
            aspectRatios: [],
            resolutions: [],
            maxReferences: 0,
            maxOutputsPerCall: 1,
            supportsCancellation: false,
            supportsSeed: false,
            provenance: "static-constraint",
            limitations: []
          }
        }
      }],
      warnings: []
    });
    expect(presentation.adapters).toEqual(["local.data-to-text"]);
    expect(presentation.providers).toEqual(["ether.local · data-to-text"]);
    expect(presentation.stepCount).toBe(1);
    expect(presentation.steps[0]).toMatchObject({
      subject: "Adapter · local.data-to-text",
      executor: "deterministic",
      provider: "ether.local · data-to-text"
    });
  });
});

function node(id: string, definitionId: NodeDefinitionId): EtherNode {
  const definition = getNodeDefinition(definitionId);
  return {
    id,
    definitionId,
    title: definition.title,
    position: { x: 100, y: 100 },
    size: definition.presentation,
    config: definition.defaultConfig(),
    presentation: { collapsed: false, accent: "default", previewMode: definition.presentation.previewMode }
  };
}

function edge(id: string, sourceNodeId: string, targetNodeId: string, sourceChannel: EtherEdge["from"]["channel"], targetChannel: EtherEdge["to"]["channel"]): EtherEdge {
  return {
    id,
    from: { kind: "node", nodeId: sourceNodeId, channel: sourceChannel },
    to: { kind: "node", nodeId: targetNodeId, channel: targetChannel },
    role: "general",
    order: 0,
    selector: { kind: "latest-approved" },
    adapter: { kind: "auto" },
    enabled: true
  };
}

function fixture(edges: EtherEdge[]): EtherGraph {
  return {
    id: "graph-root",
    title: "Renderer connection fixture",
    kind: "root",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    nodes: [node("prompt", "prompt.text"), node("worker", "prompt.worker"), node("image", "generation.image")] as EtherGraph["nodes"],
    edges,
    groups: [],
    modules: [],
    viewState: { viewport: { x: 0, y: 0, zoom: 1 }, selectedNodeIds: [], selectedEdgeIds: [], inspectorTarget: null }
  };
}

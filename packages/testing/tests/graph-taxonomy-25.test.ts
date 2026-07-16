import { describe, expect, it } from "vitest";
import {
  CANVAS_TEMPLATE_CATALOG,
  NODE_CATEGORIES,
  NODE_CATEGORY_LABELS,
  NODE_CONTRACTS,
  NODE_DEFINITIONS,
  PAYLOAD_CHANNELS,
  canConnectNodeKinds,
  createCanvasTemplate,
  createGraphNodeData,
  createReviewRouterTemplate
} from "@ether/engine";

const requiredCategories = ["Prompt", "Reference", "Generation", "Edit", "Review", "Store", "Note"] as const;
const requiredPromptSubtypes = ["Prompt", "Brainstormer", "Mutator", "Expander", "Reinforcer"] as const;
const removedPromptSubtypes = [
  "General",
  "Subject",
  "Clothing",
  "Pose",
  "Setting",
  "Composition",
  "Style",
  "Lighting",
  "Colour Palette",
  "Typography",
  "Custom",
  "Negative"
] as const;
const removedTemplateDefinitionIds = [
  "prompt-subject",
  "prompt-setting",
  "prompt-general",
  "prompt-negative",
  "store-compare",
  "store-evaluate",
  "store-filter"
] as const;

function contractFor(definitionId: string) {
  const contract = NODE_CONTRACTS.find((candidate) => candidate.definitionId === definitionId);

  if (!contract) {
    throw new Error(`Missing contract ${definitionId}`);
  }

  return contract;
}

function subtypesFor(category: string) {
  return NODE_DEFINITIONS
    .filter((definition) => definition.category === category)
    .map((definition) => definition.subtype);
}

describe("Ether 2.5 graph taxonomy", () => {
  it("exposes the exact 2.5 node families and prompt taxonomy", () => {
    expect(NODE_CATEGORY_LABELS).toEqual(requiredCategories);
    expect(NODE_CATEGORIES.map((category) => category.label)).toEqual(requiredCategories);
    expect(NODE_CATEGORY_LABELS).not.toContain("Assistant");

    expect(subtypesFor("Prompt")).toEqual(requiredPromptSubtypes);
    expect(createGraphNodeData("prompt-prompt")).toMatchObject({
      definitionId: "prompt-prompt",
      kind: "Prompt",
      subtype: "Prompt",
      title: "Prompt",
      label: "Prompt"
    });

    const catalogSubtypes = NODE_DEFINITIONS.map((definition) => definition.subtype);
    for (const removedSubtype of removedPromptSubtypes) {
      expect(catalogSubtypes).not.toContain(removedSubtype);
    }
  });

  it("places reference, review, and store subtypes in their 2.5 families", () => {
    expect(subtypesFor("Reference")).toEqual([
      "Image",
      "Video Reference",
      "Audio Reference",
      "Colour Grid",
      "Moodboard"
    ]);
    expect(subtypesFor("Review")).toEqual(["Compare", "Evaluation", "Filter"]);
    expect(subtypesFor("Store")).toEqual(["Collection", "Directory"]);
  });

  it("keeps node contracts aligned to definitions and adds canonical channel metadata", () => {
    expect(NODE_CONTRACTS.map((contract) => contract.definitionId).sort()).toEqual(
      NODE_DEFINITIONS.map((definition) => definition.id).sort()
    );

    const canonicalChannels = new Set<string>(PAYLOAD_CHANNELS);

    for (const contract of NODE_CONTRACTS) {
      const channelContract = contract as typeof contract & {
        acceptedChannels?: string[];
        producedChannels?: string[];
      };

      expect(channelContract.acceptedChannels).toEqual(expect.any(Array));
      expect(channelContract.producedChannels).toEqual(expect.any(Array));
      expect(channelContract.acceptedChannels?.every((channel) => canonicalChannels.has(channel))).toBe(true);
      expect(channelContract.producedChannels?.every((channel) => canonicalChannels.has(channel))).toBe(true);
    }
  });

  it("gives audio and video reference contracts matching typed artifact ports", () => {
    const video = contractFor("reference-video-reference");
    const audio = contractFor("reference-audio-reference");

    expect(video.acceptedChannels).toEqual(["video", "data", "text"]);
    expect(video.producedChannels).toEqual(["video", "data", "text"]);
    expect(video.inputPorts.map((port) => port.artifactKind)).toEqual(expect.arrayContaining(["video", "metadata", "text"]));
    expect(video.outputPorts.map((port) => port.artifactKind)).toEqual(expect.arrayContaining(["video", "metadata", "text"]));

    expect(audio.acceptedChannels).toEqual(["audio", "data", "text"]);
    expect(audio.producedChannels).toEqual(["audio", "data", "text"]);
    expect(audio.inputPorts.map((port) => port.artifactKind)).toEqual(expect.arrayContaining(["audio", "metadata", "text"]));
    expect(audio.outputPorts.map((port) => port.artifactKind)).toEqual(expect.arrayContaining(["audio", "metadata", "text"]));

    expect(
      canConnectNodeKinds("Reference", "Review", {
        sourceDefinitionId: "reference-video-reference",
        targetDefinitionId: "review-evaluation",
        sourcePortId: "video",
        targetPortId: "image"
      })
    ).toMatchObject({ allowed: true, sourceChannel: "video", targetChannel: "image" });

    expect(
      canConnectNodeKinds("Reference", "Review", {
        sourceDefinitionId: "reference-audio-reference",
        targetDefinitionId: "review-evaluation",
        sourcePortId: "audio",
        targetPortId: "text"
      })
    ).toMatchObject({ allowed: true, sourceChannel: "audio", targetChannel: "text" });
  });

  it("uses plain prompt nodes and review nodes in bundled templates", () => {
    const templates = CANVAS_TEMPLATE_CATALOG.map((summary) =>
      createCanvasTemplate(summary.id, { idPrefix: summary.id })
    );
    const templateDefinitionIds = templates.flatMap((template) =>
      template.nodes.map((node) => node.data.definitionId)
    );

    for (const removedId of removedTemplateDefinitionIds) {
      expect(templateDefinitionIds).not.toContain(removedId);
    }
    expect(templateDefinitionIds.some((definitionId) => definitionId.startsWith("assistant-"))).toBe(false);

    const productShoot = createCanvasTemplate("product-shoot", { idPrefix: "product" });

    expect(productShoot.nodes.filter((node) => node.data.kind === "Prompt").map((node) => node.data.definitionId)).toEqual([
      "prompt-prompt",
      "prompt-prompt"
    ]);
    expect(productShoot.edges.map((edge) => [
      edge.source,
      edge.target,
      edge.label,
      (edge.data as { role?: string } | undefined)?.role
    ])).toEqual([
      ["product-subject", "product-image", "subject", "subject"],
      ["product-setting", "product-image", "setting", "setting"],
      ["product-reference", "product-image", "context", undefined],
      ["product-image", "product-collection", "result", undefined]
    ]);

    const reviewRouter = createReviewRouterTemplate({ idPrefix: "review" });

    expect(reviewRouter.nodes.map((node) => node.data.definitionId)).toEqual([
      "review-compare",
      "review-evaluation",
      "review-filter",
      "store-collection",
      "store-collection",
      "store-collection"
    ]);
  });
});

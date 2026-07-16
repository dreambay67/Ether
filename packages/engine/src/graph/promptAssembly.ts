import type { EtherGraph } from "../project/schema.js";
import { CONNECTION_ROLES, DEFAULT_CONNECTION_ROLE, type ConnectionRole } from "./channels.js";
import { referenceAssetsFromNodeData, type CanvasNodeData, type ReferenceAssetEntry } from "./nodeCatalog.js";
import {
  cleanText,
  createTextMutationArtifact,
  shouldApplyMutation,
  textForNode
} from "./textMutation.js";
import type {
  EdgeRoleArtifact,
  GenerationInputAssembly,
  PromptAssembly,
  PromptSectionArtifact,
  ReferenceArtifact
} from "./artifacts.js";

type GraphNode = EtherGraph["nodes"][number] & {
  id: string;
  data?: Partial<CanvasNodeData>;
};

type GraphEdge = EtherGraph["edges"][number] & {
  id: string;
  source: string;
  target: string;
  label?: unknown;
  data?: { label?: unknown; role?: unknown };
};

type PromptAssemblyOptions = {
  ignoreTextOutputForNodeIds?: Set<string>;
};

const acceptedReferenceRoles = new Map<string, string>(
  [
    "general",
    "subject",
    "clothing",
    "pose",
    "setting",
    "composition",
    "style",
    "lighting",
    "colourPalette",
    "typography",
    "negative",
    "product",
    "face"
  ].map((role) => [normalizeRoleKey(role), role])
);

acceptedReferenceRoles.set("colour-palette", "colourPalette");
acceptedReferenceRoles.set("color-palette", "colourPalette");
acceptedReferenceRoles.set("palette", "colourPalette");
acceptedReferenceRoles.set("colour", "colourPalette");
acceptedReferenceRoles.set("color", "colourPalette");

const connectionRoleAliases = new Map<string, ConnectionRole>(
  CONNECTION_ROLES.map((role) => [roleAliasKey(role), role])
);

for (const [alias, role] of [
  ["context", "general"],
  ["prompt", "general"],
  ["instruction", "general"],
  ["reference", "general"],
  ["custom", "general"],
  ["negativePrompt", "negative"],
  ["avoid", "negative"],
  ["exclude", "negative"],
  ["colour", "colourPalette"],
  ["color", "colourPalette"],
  ["palette", "colourPalette"],
  ["colorPalette", "colourPalette"],
  ["type", "typography"],
  ["font", "typography"],
  ["movement", "motion"],
  ["action", "motion"],
  ["cameraMove", "motion"],
  ["rhythm", "timing"],
  ["pace", "timing"],
  ["duration", "timing"],
  ["time", "timing"],
  ["timecode", "timing"]
] as Array<[string, ConnectionRole]>) {
  connectionRoleAliases.set(roleAliasKey(alias), role);
}

const roleCaptions: Record<ConnectionRole, string> = {
  general: "General",
  negative: "Negative",
  subject: "Subject",
  product: "Product",
  face: "Face",
  clothing: "Clothing",
  pose: "Pose",
  setting: "Setting",
  composition: "Composition",
  style: "Style",
  lighting: "Lighting",
  colourPalette: "Colour Palette",
  typography: "Typography",
  motion: "Motion",
  timing: "Timing"
};

function nodesOf(graph: EtherGraph): GraphNode[] {
  return graph.nodes as GraphNode[];
}

function edgesOf(graph: EtherGraph): GraphEdge[] {
  return graph.edges as GraphEdge[];
}

function findNode(graph: EtherGraph, nodeId: string) {
  const node = nodesOf(graph).find((candidate) => candidate.id === nodeId);

  if (!node) {
    throw new Error(`Unknown graph node: ${nodeId}`);
  }

  return node;
}

function incomingEdges(graph: EtherGraph, nodeId: string) {
  return edgesOf(graph).filter((edge) => edge.target === nodeId);
}

function normalizeRoleKey(value: string) {
  return value.trim().replace(/\s+/g, "-").toLowerCase();
}

function roleAliasKey(value: string) {
  return value.trim().replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function connectionRoleFromUnknown(value: unknown): ConnectionRole | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  return connectionRoleAliases.get(roleAliasKey(value));
}

function connectionRoleForEdge(edge?: GraphEdge) {
  return (
    connectionRoleFromUnknown(edge?.data?.role) ??
    connectionRoleFromUnknown(edge?.data?.label) ??
    connectionRoleFromUnknown(edge?.label)
  );
}

function sectionRoleForEdge(edge?: GraphEdge, branchKind?: PromptSectionArtifact["kind"]): ConnectionRole {
  if (branchKind === "negativePrompt") {
    return "negative";
  }

  return connectionRoleForEdge(edge) ?? DEFAULT_CONNECTION_ROLE;
}

function nodeText(node: GraphNode, options: PromptAssemblyOptions = {}) {
  if (!options.ignoreTextOutputForNodeIds?.has(node.id)) {
    const output = textForNode(node.data);

    if (output) {
      return output;
    }
  }

  return [cleanText(node.data?.instruction), cleanText(node.data?.notes)].filter(Boolean).join("\n");
}

function sectionTitle(node: GraphNode) {
  return cleanText(node.data?.title) || cleanText(node.data?.label) || cleanText(node.data?.subtype) || "General";
}

function isNegativeEdge(edge?: GraphEdge) {
  return connectionRoleForEdge(edge) === "negative";
}

function canContributeTextSection(node: GraphNode) {
  return (
    node.data?.kind === "Prompt" ||
    node.data?.kind === "Assistant" ||
    node.data?.kind === "Note" ||
    node.data?.kind === "Reference"
  );
}

function isNegativePromptNode(_node: GraphNode) {
  return false;
}

function textSectionForNode(
  node: GraphNode,
  incomingEdge?: GraphEdge,
  branchKind?: PromptSectionArtifact["kind"],
  options: PromptAssemblyOptions = {}
): PromptSectionArtifact | null {
  if (!canContributeTextSection(node)) {
    return null;
  }

  const text = nodeText(node, options);

  if (!text) {
    return null;
  }

  return {
    nodeId: node.id,
    kind:
      branchKind ??
      (isNegativePromptNode(node) || (node.data?.kind === "Prompt" && isNegativeEdge(incomingEdge))
        ? "negativePrompt"
        : "prompt"),
    section: roleCaptions[sectionRoleForEdge(incomingEdge, branchKind)],
    title: sectionTitle(node),
    text
  };
}

function appendUniqueSection(sections: PromptSectionArtifact[], section: PromptSectionArtifact) {
  if (!sections.some((candidate) => candidate.nodeId === section.nodeId)) {
    sections.push(section);
  }
}

function baseSectionName(section: string) {
  return section.replace(/\s+\d+$/, "");
}

function isPromptHelperSection(graph: EtherGraph, section: PromptSectionArtifact) {
  const node = nodesOf(graph).find((candidate) => candidate.id === section.nodeId);

  return (
    node?.data?.kind === "Assistant" ||
    (node?.data?.kind === "Prompt" && cleanText(node.data?.subtype) !== "Prompt")
  );
}

function mergeSameRoleBranchSections(graph: EtherGraph, sections: PromptSectionArtifact[]) {
  const merged: PromptSectionArtifact[] = [];

  for (const section of sections) {
    const previous = merged.at(-1);
    const sectionName = baseSectionName(section.section);

    if (
      previous &&
      previous.kind === section.kind &&
      baseSectionName(previous.section) === sectionName &&
      (isPromptHelperSection(graph, previous) || isPromptHelperSection(graph, section))
    ) {
      previous.text = [previous.text, section.text].filter(Boolean).join("\n\n");
      previous.title = section.title || previous.title;
      continue;
    }

    merged.push({
      ...section,
      section: sectionName
    });
  }

  return merged;
}

function collectPromptSections(
  graph: EtherGraph,
  nodeId: string,
  seen = new Set<string>(),
  selfIncomingEdge?: GraphEdge,
  branchKind?: PromptSectionArtifact["kind"],
  options: PromptAssemblyOptions = {}
): PromptSectionArtifact[] {
  if (seen.has(nodeId)) {
    return [];
  }

  seen.add(nodeId);

  const node = findNode(graph, nodeId);
  const sections: PromptSectionArtifact[] = [];
  const nodeBranchKind = branchKind ?? (isNegativePromptNode(node) ? "negativePrompt" : undefined);
  const hasVisibleOutput =
    !options.ignoreTextOutputForNodeIds?.has(node.id) && Boolean(cleanText(node.data?.textOutput));

  if (hasVisibleOutput) {
    const outputSection = textSectionForNode(node, selfIncomingEdge, nodeBranchKind, options);
    return outputSection ? [outputSection] : [];
  }

  for (const edge of incomingEdges(graph, nodeId)) {
    const source = findNode(graph, edge.source);
    const nextBranchKind = nodeBranchKind ?? (isNegativeEdge(edge) ? "negativePrompt" : undefined);

    for (const section of collectPromptSections(graph, source.id, new Set(seen), edge, nextBranchKind, options)) {
      appendUniqueSection(sections, section);
    }

    const sourceSection = textSectionForNode(source, edge, nextBranchKind, options);
    if (sourceSection) {
      appendUniqueSection(sections, sourceSection);
    }
  }

  const selfBranchKind = nodeBranchKind ?? (isNegativeEdge(selfIncomingEdge) ? "negativePrompt" : undefined);
  const selfSection = textSectionForNode(node, selfIncomingEdge, selfBranchKind, options);
  if (selfSection) {
    appendUniqueSection(sections, selfSection);
  }

  return sections;
}

function joinSections(sections: PromptSectionArtifact[], kind: PromptSectionArtifact["kind"]) {
  return sections
    .filter((section) => section.kind === kind)
    .map((section) => formatSectionText(section))
    .filter(Boolean)
    .join("\n\n");
}

function joinRawSections(sections: PromptSectionArtifact[], kind: PromptSectionArtifact["kind"]) {
  return sections
    .filter((section) => section.kind === kind)
    .map((section) => section.text)
    .filter(Boolean)
    .join("\n\n");
}

function formatSectionText(section: PromptSectionArtifact) {
  return `${section.section}: ${section.text}`;
}

function numberRepeatedSections(sections: PromptSectionArtifact[]) {
  const counts = new Map<string, number>();

  return sections.map((section) => {
    const baseSection = section.section.replace(/\s+\d+$/, "");
    const key = `${section.kind}:${baseSection}`;
    const nextCount = (counts.get(key) ?? 0) + 1;
    counts.set(key, nextCount);

    return {
      ...section,
      section: nextCount === 1 ? baseSection : `${baseSection} ${nextCount}`
    };
  });
}

function fallbackReferenceRole(node: GraphNode) {
  if (node.data?.kind === "Prompt" && node.data.subtype === "Negative") {
    return "negative";
  }

  switch (node.data?.subtype) {
    case "Colour Grid":
      return "colourPalette";
    case "Moodboard":
      return "style";
    case "Video Reference":
      return "general";
    case "Image":
      return "general";
    default:
      return "general";
  }
}

export function resolveReferenceRole(edge: GraphEdge, sourceNode: GraphNode) {
  for (const value of [edge.data?.role, edge.data?.label, edge.label]) {
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }

    const acceptedRole = acceptedReferenceRoles.get(normalizeRoleKey(value));
    if (acceptedRole) {
      return acceptedRole;
    }

    const connectionRole = connectionRoleFromUnknown(value);
    if (connectionRole) {
      return connectionRole;
    }
  }

  return fallbackReferenceRole(sourceNode);
}

function referenceForAsset(
  source: GraphNode,
  role: string,
  steeringText: string,
  asset: ReferenceAssetEntry | null,
  index: number,
  total: number
): ReferenceArtifact {
  const baseTitle = sectionTitle(source);
  const reference: ReferenceArtifact = {
    nodeId: source.id,
    role,
    title: asset?.title || (total > 1 ? `${baseTitle} ${index + 1}` : baseTitle),
    sourceKind: cleanText(source.data?.subtype) || cleanText(source.data?.kind) || "Reference",
    ...(steeringText ? { steeringText } : {})
  };

  if (asset?.assetId) {
    reference.assetId = asset.assetId;
  }

  if (asset?.assetKind) {
    reference.assetKind = asset.assetKind;
  }

  if (asset?.assetPath) {
    reference.assetPath = asset.assetPath;
  }

  if (asset?.assetMetadata) {
    reference.assetMetadata = asset.assetMetadata;
  }

  return reference;
}

function referencesForNode(source: GraphNode, role: string): ReferenceArtifact[] {
  if (source.data?.kind !== "Reference" && source.data?.kind !== "Note") {
    return [];
  }

  const steeringText = nodeText(source);
  const assets = referenceAssetsFromNodeData(source.data);

  if (assets.length === 0) {
    return [referenceForAsset(source, role, steeringText, null, 0, 1)];
  }

  return assets.map((asset, index) => referenceForAsset(source, role, steeringText, asset, index, assets.length));
}

function collectReferences(graph: EtherGraph, nodeId: string) {
  const references: ReferenceArtifact[] = [];
  const edgeRoles: EdgeRoleArtifact[] = [];

  for (const edge of incomingEdges(graph, nodeId)) {
    const source = findNode(graph, edge.source);
    const role = resolveReferenceRole(edge, source);
    const sourceReferences = referencesForNode(source, role);

    if (sourceReferences.length > 0) {
      references.push(...sourceReferences);
      edgeRoles.push({ edgeId: edge.id, role });
    }
  }

  return { references, edgeRoles };
}

export function getUpstreamNodes(graph: EtherGraph, nodeId: string) {
  return incomingEdges(graph, nodeId).map((edge) => findNode(graph, edge.source));
}

export function assemblePromptForNode(
  graph: EtherGraph,
  nodeId: string,
  incomingEdge?: GraphEdge,
  options: PromptAssemblyOptions = {}
): PromptAssembly {
  const branchKind = isNegativeEdge(incomingEdge) ? "negativePrompt" : undefined;
  const sections = numberRepeatedSections(
    collectPromptSections(graph, nodeId, new Set<string>(), incomingEdge, branchKind, options)
  );

  return {
    nodeId,
    prompt: joinSections(sections, "prompt"),
    negativePrompt: joinSections(sections, "negativePrompt"),
    sections,
    edgeRoles: []
  };
}

export function assembleGenerationInputs(graph: EtherGraph, generationNodeId: string): GenerationInputAssembly {
  const rawSections: PromptSectionArtifact[] = [];

  for (const edge of incomingEdges(graph, generationNodeId)) {
    const source = findNode(graph, edge.source);

    if (source.data?.kind !== "Prompt" && source.data?.kind !== "Assistant") {
      continue;
    }

    const branchKind = isNegativeEdge(edge) ? "negativePrompt" : undefined;
    const branchSections = mergeSameRoleBranchSections(
      graph,
      collectPromptSections(graph, source.id, new Set<string>(), edge, branchKind)
    );

    for (const section of branchSections) {
      appendUniqueSection(rawSections, section);
    }
  }

  const sections = numberRepeatedSections(rawSections);
  const { references, edgeRoles } = collectReferences(graph, generationNodeId);

  return {
    nodeId: generationNodeId,
    prompt: joinSections(sections, "prompt"),
    negativePrompt: joinSections(sections, "negativePrompt"),
    sections,
    references,
    edgeRoles
  };
}

export function freezePromptNode(graph: EtherGraph, nodeId: string, now = new Date().toISOString()): EtherGraph {
  const node = findNode(graph, nodeId);
  const baseAssembly = assemblePromptForNode(graph, nodeId, undefined, {
    ignoreTextOutputForNodeIds: new Set([nodeId])
  });
  const mutationSourceText =
    joinRawSections(baseAssembly.sections, "prompt") || joinRawSections(baseAssembly.sections, "negativePrompt");
  const mutationArtifact = shouldApplyMutation(node.data)
    ? createTextMutationArtifact(mutationSourceText, node.data, {
        kind: "prompt-mutation",
        operation: "Prompt Mutation"
      })
    : null;
  const assembly = mutationArtifact ? mutatePromptAssembly(baseAssembly, node, mutationArtifact.resultText) : baseAssembly;

  return {
    ...graph,
    nodes: nodesOf(graph).map((node) =>
      node.id === nodeId
        ? {
            ...node,
            data: {
              ...node.data,
              artifactKind: "assembledPrompt",
              assembledPrompt: assembly.prompt,
              assembledNegativePrompt: assembly.negativePrompt,
              assembledPromptArtifact: assembly,
              textOutput: mutationArtifact ? mutationArtifact.resultText : undefined,
              textOutputArtifact: mutationArtifact ?? undefined,
              mutationArtifact: mutationArtifact ?? undefined,
              lastRunAt: now,
              status: "complete"
            }
          }
        : node
    ),
    updatedAt: now
  };
}

function mutatePromptAssembly(assembly: PromptAssembly, node: GraphNode, resultText: string): PromptAssembly {
  const negativeSections = assembly.sections.filter((section) => section.kind === "negativePrompt");
  const mutatedSection: PromptSectionArtifact = {
    nodeId: node.id,
    kind: "prompt",
    section: roleCaptions[DEFAULT_CONNECTION_ROLE],
    title: sectionTitle(node),
    text: resultText
  };

  return {
    ...assembly,
    prompt: formatSectionText(mutatedSection),
    sections: [...negativeSections, mutatedSection]
  };
}

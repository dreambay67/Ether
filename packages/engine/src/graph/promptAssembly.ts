import type { EtherGraph } from "../project/schema.js";
import type { CanvasNodeData } from "./nodeCatalog.js";
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
  data?: { label?: unknown };
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
    "custom",
    "negative",
    "product",
    "face",
    "reference",
    "context"
  ].map((role) => [normalizeRoleKey(role), role])
);

acceptedReferenceRoles.set("colour-palette", "colourPalette");
acceptedReferenceRoles.set("color-palette", "colourPalette");
acceptedReferenceRoles.set("palette", "colourPalette");
acceptedReferenceRoles.set("colour", "colourPalette");
acceptedReferenceRoles.set("color", "colourPalette");

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

function edgeLabel(edge: GraphEdge) {
  return String(edge.label ?? edge.data?.label ?? "").trim();
}

function normalizeRoleKey(value: string) {
  return value.trim().replace(/\s+/g, "-").toLowerCase();
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nodeText(node: GraphNode) {
  const instruction = cleanText(node.data?.instruction);
  const notes = cleanText(node.data?.notes);

  return [instruction, notes].filter(Boolean).join("\n");
}

function sectionName(node: GraphNode) {
  return cleanText(node.data?.label) || cleanText(node.data?.subtype) || cleanText(node.data?.title) || "General";
}

function sectionTitle(node: GraphNode) {
  return cleanText(node.data?.title) || cleanText(node.data?.label) || sectionName(node);
}

function isNegativeEdge(edge?: GraphEdge) {
  return edge ? normalizeRoleKey(edgeLabel(edge)) === "negative" : false;
}

function canContributeTextSection(node: GraphNode) {
  return (
    node.data?.kind === "Prompt" ||
    node.data?.kind === "Assistant" ||
    node.data?.kind === "Note" ||
    node.data?.kind === "Reference"
  );
}

function isNegativePromptNode(node: GraphNode) {
  return node.data?.kind === "Prompt" && node.data.subtype === "Negative";
}

function textSectionForNode(
  node: GraphNode,
  incomingEdge?: GraphEdge,
  branchKind?: PromptSectionArtifact["kind"]
): PromptSectionArtifact | null {
  if (!canContributeTextSection(node)) {
    return null;
  }

  const text = nodeText(node);

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
    section: sectionName(node),
    title: sectionTitle(node),
    text
  };
}

function appendUniqueSection(sections: PromptSectionArtifact[], section: PromptSectionArtifact) {
  if (!sections.some((candidate) => candidate.nodeId === section.nodeId)) {
    sections.push(section);
  }
}

function collectPromptSections(
  graph: EtherGraph,
  nodeId: string,
  seen = new Set<string>(),
  selfIncomingEdge?: GraphEdge,
  branchKind?: PromptSectionArtifact["kind"]
): PromptSectionArtifact[] {
  if (seen.has(nodeId)) {
    return [];
  }

  seen.add(nodeId);

  const node = findNode(graph, nodeId);
  const sections: PromptSectionArtifact[] = [];
  const nodeBranchKind = branchKind ?? (isNegativePromptNode(node) ? "negativePrompt" : undefined);

  for (const edge of incomingEdges(graph, nodeId)) {
    const source = findNode(graph, edge.source);
    const nextBranchKind = nodeBranchKind ?? (isNegativeEdge(edge) ? "negativePrompt" : undefined);

    for (const section of collectPromptSections(graph, source.id, new Set(seen), edge, nextBranchKind)) {
      appendUniqueSection(sections, section);
    }

    const sourceSection = textSectionForNode(source, edge, nextBranchKind);
    if (sourceSection) {
      appendUniqueSection(sections, sourceSection);
    }
  }

  const selfBranchKind = nodeBranchKind ?? (isNegativeEdge(selfIncomingEdge) ? "negativePrompt" : undefined);
  const selfSection = textSectionForNode(node, selfIncomingEdge, selfBranchKind);
  if (selfSection) {
    appendUniqueSection(sections, selfSection);
  }

  return sections;
}

function joinSections(sections: PromptSectionArtifact[], kind: PromptSectionArtifact["kind"]) {
  return sections
    .filter((section) => section.kind === kind)
    .map((section) => section.text)
    .filter(Boolean)
    .join("\n\n");
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
      return "reference";
    case "Image":
      return "reference";
    default:
      return node.data?.kind === "Note" ? "context" : "reference";
  }
}

export function resolveReferenceRole(edge: GraphEdge, sourceNode: GraphNode) {
  const normalized = normalizeRoleKey(edgeLabel(edge));
  return acceptedReferenceRoles.get(normalized) ?? fallbackReferenceRole(sourceNode);
}

function referenceForNode(source: GraphNode, role: string): ReferenceArtifact | null {
  if (source.data?.kind !== "Reference" && source.data?.kind !== "Note") {
    return null;
  }

  const steeringText = nodeText(source);

  const reference: ReferenceArtifact = {
    nodeId: source.id,
    role,
    title: sectionTitle(source),
    sourceKind: cleanText(source.data?.subtype) || cleanText(source.data?.kind) || "Reference",
    ...(steeringText ? { steeringText } : {})
  };

  if (source.data?.assetId) {
    reference.assetId = source.data.assetId;
  }

  if (source.data?.assetKind) {
    reference.assetKind = source.data.assetKind;
  }

  if (source.data?.assetPath) {
    reference.assetPath = source.data.assetPath;
  }

  if (source.data?.assetMetadata) {
    reference.assetMetadata = source.data.assetMetadata;
  }

  return reference;
}

function collectReferences(graph: EtherGraph, nodeId: string) {
  const references: ReferenceArtifact[] = [];
  const edgeRoles: EdgeRoleArtifact[] = [];

  for (const edge of incomingEdges(graph, nodeId)) {
    const source = findNode(graph, edge.source);
    const role = resolveReferenceRole(edge, source);
    const reference = referenceForNode(source, role);

    if (reference) {
      references.push(reference);
      edgeRoles.push({ edgeId: edge.id, role });
    }
  }

  return { references, edgeRoles };
}

export function getUpstreamNodes(graph: EtherGraph, nodeId: string) {
  return incomingEdges(graph, nodeId).map((edge) => findNode(graph, edge.source));
}

export function assemblePromptForNode(graph: EtherGraph, nodeId: string, incomingEdge?: GraphEdge): PromptAssembly {
  const branchKind = isNegativeEdge(incomingEdge) ? "negativePrompt" : undefined;
  const sections = collectPromptSections(graph, nodeId, new Set<string>(), incomingEdge, branchKind);

  return {
    nodeId,
    prompt: joinSections(sections, "prompt"),
    negativePrompt: joinSections(sections, "negativePrompt"),
    sections,
    edgeRoles: []
  };
}

export function assembleGenerationInputs(graph: EtherGraph, generationNodeId: string): GenerationInputAssembly {
  const sections: PromptSectionArtifact[] = [];

  for (const edge of incomingEdges(graph, generationNodeId)) {
    const source = findNode(graph, edge.source);

    if (source.data?.kind !== "Prompt") {
      continue;
    }

    const assembly = assemblePromptForNode(graph, source.id, edge);
    for (const section of assembly.sections) {
      appendUniqueSection(sections, section);
    }
  }

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
  const assembly = assemblePromptForNode(graph, nodeId);

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
              lastRunAt: now,
              status: "complete"
            }
          }
        : node
    ),
    updatedAt: now
  };
}

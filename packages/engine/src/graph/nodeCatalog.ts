export const NODE_CATEGORY_LABELS = [
  "Prompt",
  "Reference",
  "Edit",
  "Store",
  "Assistant",
  "Generation",
  "Note"
] as const;

export type EtherNodeKind = (typeof NODE_CATEGORY_LABELS)[number];

export type EtherNodeDefinition = {
  id: string;
  category: EtherNodeKind;
  subtype: string;
  title: string;
  accent: string;
  description: string;
};

export type CanvasNodeData = {
  definitionId: string;
  kind: EtherNodeKind;
  subtype: string;
  title: string;
  label: string;
  notes: string;
  instruction: string;
  status: "idle" | "queued" | "running" | "complete" | "error";
  rerunState?: "ready" | "stale" | "running" | "complete" | "error";
  locked?: boolean;
  staleSince?: string;
  artifactKind?: "assembledPrompt";
  assembledPrompt?: string;
  assembledNegativePrompt?: string;
  assembledPromptArtifact?: unknown;
  lastRunAt?: string;
  assetId?: string;
  assetKind?: string;
  assetPath?: string;
  assetMetadata?: Record<string, unknown>;
  sourceAssetId?: string;
  sourceAssetKind?: string;
  sourceAssetPath?: string;
  sourceAssetMetadata?: Record<string, unknown>;
  maskAssetId?: string;
  maskAssetPath?: string;
  maskMetadata?: Record<string, unknown>;
  storeAssetId?: string;
  storePath?: string;
  storeMetadata?: Record<string, unknown>;
  lastMovedAssetId?: string;
  lastMovedAssetPath?: string;
  lastMovedAt?: string;
};

export type EtherNodeCategory = {
  id: string;
  label: EtherNodeKind;
  definitions: EtherNodeDefinition[];
};

const legacyNodeData: CanvasNodeData = {
  definitionId: "",
  kind: "Note",
  subtype: "Legacy node",
  title: "Legacy node",
  label: "Legacy node",
  notes: "",
  instruction: "",
  status: "idle"
};

const categoryAccents: Record<EtherNodeKind, string> = {
  Prompt: "#1470DB",
  Reference: "#37E6EA",
  Edit: "#8A5CFF",
  Store: "#7EF4D7",
  Assistant: "#99A8BA",
  Generation: "#F4F8FF",
  Note: "#D7E0EA"
};

const subtypesByCategory: Record<EtherNodeKind, string[]> = {
  Prompt: [
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
  ],
  Reference: ["Image", "Video Reference", "Colour Grid", "Moodboard"],
  Edit: ["Inpaint", "Expand / Outpaint", "Draw & Note", "Upscale"],
  Store: ["Directory", "Collection", "Compare", "Evaluate", "Filter"],
  Assistant: ["Brainstormer", "Mutator", "Expander", "Reinforcer"],
  Generation: ["Image", "Grid", "Character Sheet", "Infographic"],
  Note: ["Cloud", "Bubble", "Free Draw"]
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function titleFor(category: EtherNodeKind, subtype: string) {
  if (category === "Prompt") {
    return `${subtype} Prompt`;
  }

  return subtype;
}

export const NODE_DEFINITIONS: EtherNodeDefinition[] = NODE_CATEGORY_LABELS.flatMap((category) =>
  subtypesByCategory[category].map((subtype) => ({
    id: `${slugify(category)}-${slugify(subtype)}`,
    category,
    subtype,
    title: titleFor(category, subtype),
    accent: categoryAccents[category],
    description: `${subtype} ${category.toLowerCase()} node`
  }))
);

export const NODE_CATEGORIES: EtherNodeCategory[] = NODE_CATEGORY_LABELS.map((label) => ({
  id: slugify(label),
  label,
  definitions: NODE_DEFINITIONS.filter((definition) => definition.category === label)
}));

export function getNodeDefinition(definitionId: string) {
  const definition = NODE_DEFINITIONS.find((candidate) => candidate.id === definitionId);

  if (!definition) {
    throw new Error(`Unknown node definition: ${definitionId}`);
  }

  return definition;
}

export function createGraphNodeData(definitionId: string): CanvasNodeData {
  const definition = getNodeDefinition(definitionId);

  return {
    definitionId: definition.id,
    kind: definition.category,
    subtype: definition.subtype,
    title: definition.title,
    label: definition.title,
    notes: "",
    instruction: `${definition.subtype} ${definition.category.toLowerCase()} placeholder`,
    status: "idle"
  };
}

function isCanvasNodeStatus(value: unknown): value is CanvasNodeData["status"] {
  return (
    value === "idle" ||
    value === "queued" ||
    value === "running" ||
    value === "complete" ||
    value === "error"
  );
}

function isRerunState(value: unknown): value is NonNullable<CanvasNodeData["rerunState"]> {
  return (
    value === "ready" ||
    value === "stale" ||
    value === "running" ||
    value === "complete" ||
    value === "error"
  );
}

function isEtherNodeKind(value: unknown): value is EtherNodeKind {
  return NODE_CATEGORY_LABELS.includes(value as EtherNodeKind);
}

export function coerceCanvasNodeData(value: unknown): CanvasNodeData {
  if (!value || typeof value !== "object") {
    return { ...legacyNodeData };
  }

  const data = value as Partial<CanvasNodeData>;
  const title = typeof data.title === "string" && data.title.trim() ? data.title : legacyNodeData.title;
  const label = typeof data.label === "string" && data.label.trim() ? data.label : title;
  const coerced: CanvasNodeData = {
    ...data,
    definitionId: typeof data.definitionId === "string" ? data.definitionId : legacyNodeData.definitionId,
    kind: isEtherNodeKind(data.kind) ? data.kind : legacyNodeData.kind,
    subtype: typeof data.subtype === "string" && data.subtype.trim() ? data.subtype : legacyNodeData.subtype,
    title,
    label,
    notes: typeof data.notes === "string" ? data.notes : legacyNodeData.notes,
    instruction: typeof data.instruction === "string" ? data.instruction : legacyNodeData.instruction,
    status: isCanvasNodeStatus(data.status) ? data.status : legacyNodeData.status
  };

  if (isRerunState(data.rerunState)) {
    coerced.rerunState = data.rerunState;
  } else {
    delete coerced.rerunState;
  }

  if (typeof data.locked === "boolean") {
    coerced.locked = data.locked;
  } else {
    delete coerced.locked;
  }

  if (typeof data.staleSince === "string") {
    coerced.staleSince = data.staleSince;
  } else {
    delete coerced.staleSince;
  }

  return coerced;
}

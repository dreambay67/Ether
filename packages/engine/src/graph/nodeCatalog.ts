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
};

export type EtherNodeCategory = {
  id: string;
  label: EtherNodeKind;
  definitions: EtherNodeDefinition[];
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

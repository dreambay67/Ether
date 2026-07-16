export const NODE_CATEGORY_LABELS = [
  "Prompt",
  "Reference",
  "Generation",
  "Edit",
  "Review",
  "Store",
  "Note"
] as const;

export type EtherNodeKind = (typeof NODE_CATEGORY_LABELS)[number];
export type LegacyEtherNodeKind = "Assistant";
export type CanvasNodeKind = EtherNodeKind | LegacyEtherNodeKind;

export type EtherNodeDefinition = {
  id: string;
  category: EtherNodeKind;
  subtype: string;
  title: string;
  accent: string;
  description: string;
};

export type EditFrameMode = "source" | "crop" | "outpaint";

export type EditFrameData = {
  mode: EditFrameMode;
  x: number;
  y: number;
  width: number;
  height: number;
  canvasWidth?: number;
  canvasHeight?: number;
};

export type ReferenceAssetEntry = {
  assetId?: string;
  assetKind?: string;
  assetPath: string;
  assetMetadata?: Record<string, unknown>;
  title?: string;
  role?: string;
  addedAt?: string;
};

export type GenerationAspectRatio = "1:1" | "4:5" | "3:4" | "9:16" | "16:9" | "4:3" | "3:2" | "2:3";

export type GenerationResolution = "1024-long-edge" | "1536-long-edge" | "2048-long-edge";

export type NoteStrokePoint = {
  x: number;
  y: number;
};

export type NoteStroke = {
  id: string;
  points: NoteStrokePoint[];
  color?: string;
  width?: number;
};

export type CanvasNodeData = {
  definitionId: string;
  kind: CanvasNodeKind;
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
  referenceAssets?: ReferenceAssetEntry[];
  noteStrokes?: NoteStroke[];
  sourceAssetId?: string;
  sourceAssetKind?: string;
  sourceAssetPath?: string;
  sourceAssetMetadata?: Record<string, unknown>;
  maskAssetId?: string;
  maskAssetPath?: string;
  maskMetadata?: Record<string, unknown>;
  editRecipe?: string;
  editFrame?: EditFrameData;
  textOutput?: string;
  textOutputArtifact?: unknown;
  generationAspectRatio?: GenerationAspectRatio;
  generationResolution?: GenerationResolution;
  generationWidth?: number;
  generationHeight?: number;
  mutationArtifact?: unknown;
  mutationEnabled?: boolean;
  mutationPreset?: string;
  mutationSeed?: string;
  variationStrength?: number;
  novelty?: number;
  drift?: number;
  preserveSubject?: number;
  preserveStyle?: number;
  lockedTerms?: string;
  negativeConstraints?: string;
  mutationInstruction?: string;
  storeFolderName?: string;
  storeAssetId?: string;
  storePath?: string;
  storeMetadata?: Record<string, unknown>;
  lastMovedAssetId?: string;
  lastMovedAssetPath?: string;
  lastMovedAt?: string;
  compareLayout?: number;
  compareArtifact?: unknown;
  reviewRating?: number;
  reviewTags?: string;
  reviewDecision?: string;
  reviewNotes?: string;
  evaluationThreshold?: number;
  evaluationArtifact?: unknown;
  filterAutoApply?: boolean;
  filterDryRun?: boolean;
  filterRouteMode?: "move" | "copy" | "link";
  filterManualOverride?: string;
  filterRules?: string;
  filterResult?: unknown;
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
  Generation: "#F4F8FF",
  Edit: "#8A5CFF",
  Review: "#FFCA7A",
  Store: "#7EF4D7",
  Note: "#D7E0EA"
};

const subtypesByCategory: Record<EtherNodeKind, string[]> = {
  Prompt: ["Prompt", "Brainstormer", "Mutator", "Expander", "Reinforcer"],
  Reference: ["Image", "Video Reference", "Audio Reference", "Colour Grid", "Moodboard"],
  Generation: ["Image", "Grid", "Character Sheet", "Infographic"],
  Edit: ["Inpaint", "Expand / Outpaint", "Draw & Note", "Upscale"],
  Review: ["Compare", "Evaluation", "Filter"],
  Store: ["Collection", "Directory"],
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

const legacyDefinitionAliases = new Map<string, string>([
  ["assistant-brainstormer", "prompt-brainstormer"],
  ["assistant-mutator", "prompt-mutator"],
  ["assistant-expander", "prompt-expander"],
  ["assistant-reinforcer", "prompt-reinforcer"],
  ["prompt-general", "prompt-prompt"],
  ["prompt-subject", "prompt-prompt"],
  ["prompt-setting", "prompt-prompt"],
  ["prompt-negative", "prompt-prompt"],
  ["prompt-custom", "prompt-prompt"]
]);

const legacyAssistantSubtypeDefinitions = new Map<string, string>([
  ["Brainstormer", "prompt-brainstormer"],
  ["Mutator", "prompt-mutator"],
  ["Expander", "prompt-expander"],
  ["Reinforcer", "prompt-reinforcer"]
]);

function resolveDefinitionId(definitionId: string) {
  return legacyDefinitionAliases.get(definitionId) ?? definitionId;
}

export function getNodeDefinition(definitionId: string) {
  const resolvedDefinitionId = resolveDefinitionId(definitionId);
  const definition = NODE_DEFINITIONS.find((candidate) => candidate.id === resolvedDefinitionId);

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

function coerceNumberInUnitRange(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : null;
}

export function coerceNoteStrokes(value: unknown): NoteStroke[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry, index): NoteStroke[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const candidate = entry as Partial<NoteStroke>;
    const points = Array.isArray(candidate.points)
      ? candidate.points.flatMap((point): NoteStrokePoint[] => {
          if (!point || typeof point !== "object" || Array.isArray(point)) {
            return [];
          }

          const pointCandidate = point as Partial<NoteStrokePoint>;
          const x = coerceNumberInUnitRange(pointCandidate.x);
          const y = coerceNumberInUnitRange(pointCandidate.y);

          return x === null || y === null ? [] : [{ x, y }];
        })
      : [];

    if (points.length === 0) {
      return [];
    }

    return [
      {
        id: typeof candidate.id === "string" && candidate.id.trim()
          ? candidate.id
          : `stroke-${index + 1}`,
        points,
        ...(typeof candidate.color === "string" && candidate.color.trim()
          ? { color: candidate.color }
          : {}),
        ...(typeof candidate.width === "number" && Number.isFinite(candidate.width)
          ? { width: Math.max(1, Math.min(20, candidate.width)) }
          : {})
      }
    ];
  });
}

function legacyAssistantDefinitionId(data: Partial<CanvasNodeData>) {
  if (typeof data.definitionId === "string" && legacyDefinitionAliases.has(data.definitionId)) {
    return legacyDefinitionAliases.get(data.definitionId);
  }

  if (data.kind !== "Assistant" || typeof data.subtype !== "string") {
    return undefined;
  }

  return legacyAssistantSubtypeDefinitions.get(data.subtype);
}

export function coerceCanvasNodeData(value: unknown): CanvasNodeData {
  if (!value || typeof value !== "object") {
    return { ...legacyNodeData };
  }

  const data = value as Partial<CanvasNodeData>;
  const migratedDefinitionId = legacyAssistantDefinitionId(data);
  const migratedDefinition = migratedDefinitionId
    ? NODE_DEFINITIONS.find((definition) => definition.id === migratedDefinitionId)
    : undefined;
  const title = typeof data.title === "string" && data.title.trim() ? data.title : legacyNodeData.title;
  const label = typeof data.label === "string" && data.label.trim() ? data.label : title;
  const coerced: CanvasNodeData = {
    ...data,
    definitionId: migratedDefinition?.id ?? (typeof data.definitionId === "string" ? data.definitionId : legacyNodeData.definitionId),
    kind: migratedDefinition?.category ?? (isEtherNodeKind(data.kind) ? data.kind : legacyNodeData.kind),
    subtype: migratedDefinition?.subtype ?? (typeof data.subtype === "string" && data.subtype.trim() ? data.subtype : legacyNodeData.subtype),
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

  if (data.kind === "Note" || migratedDefinition?.category === "Note") {
    coerced.noteStrokes = coerceNoteStrokes(data.noteStrokes);
  } else {
    delete coerced.noteStrokes;
  }

  return coerced;
}

export function referenceAssetsFromNodeData(
  data: Partial<CanvasNodeData> | undefined
): ReferenceAssetEntry[] {
  const entries = Array.isArray(data?.referenceAssets)
    ? data.referenceAssets.filter((entry): entry is ReferenceAssetEntry =>
        Boolean(entry && typeof entry === "object" && typeof entry.assetPath === "string" && entry.assetPath.trim())
      )
    : [];

  if (entries.length > 0) {
    return entries.map((entry) => ({ ...entry }));
  }

  if (typeof data?.assetPath === "string" && data.assetPath.trim()) {
    return [
      {
        assetId: data.assetId,
        assetKind: data.assetKind,
        assetPath: data.assetPath,
        assetMetadata: data.assetMetadata
      }
    ];
  }

  return [];
}

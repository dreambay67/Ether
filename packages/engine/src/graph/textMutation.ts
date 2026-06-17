import type { CanvasNodeData } from "./nodeCatalog.js";

export const MUTATION_PRESETS = [
  "Whisper",
  "Lens Shift",
  "Costume Drift",
  "Lighting Weather",
  "Material Swap",
  "Composition Nudge",
  "Radical Concept"
] as const;

export type MutationPreset = (typeof MUTATION_PRESETS)[number];

export type MutationSettings = {
  enabled: boolean;
  seed: string;
  preset: MutationPreset;
  variationStrength: number;
  novelty: number;
  drift: number;
  preserveSubject: number;
  preserveStyle: number;
  lockedTerms: string[];
  negativeConstraints: string;
  instruction: string;
};

export type TextMutationKind = "prompt-mutation" | "assistant-text";

export type TextMutationArtifact = {
  kind: TextMutationKind;
  engine: "local-deterministic-text-engine";
  operation: string;
  lineageId: string;
  sourceText: string;
  instruction: string;
  seed: string;
  settings: MutationSettings;
  resultText: string;
};

type MutationOptions = {
  kind: TextMutationKind;
  operation: string;
};

const defaultPreset: MutationPreset = "Whisper";

const presetPhrases: Record<MutationPreset, string[]> = {
  Whisper: [
    "lower the visual volume",
    "use quieter transitions",
    "make the atmosphere more intimate"
  ],
  "Lens Shift": [
    "shift the camera language",
    "change the crop and focal distance",
    "reframe the subject through a new lens"
  ],
  "Costume Drift": [
    "adjust wardrobe signals",
    "change surface styling",
    "introduce subtle styling variation"
  ],
  "Lighting Weather": [
    "change the light temperature",
    "add controlled atmospheric light",
    "move the scene into a new lighting condition"
  ],
  "Material Swap": [
    "translate surfaces through new materials",
    "change tactile finish and reflectivity",
    "introduce a refined material contrast"
  ],
  "Composition Nudge": [
    "rebalance the layout",
    "shift subject placement",
    "tighten the visual hierarchy"
  ],
  "Radical Concept": [
    "push the concept into a bolder territory",
    "alter the core visual metaphor",
    "make a larger creative leap"
  ]
};

const noveltyPhrases = [
  "add one fresh but controlled detail",
  "introduce a new supporting motif",
  "vary the scene logic without losing continuity"
];

const driftPhrases = [
  "keep the original intent legible",
  "allow a measured directional drift",
  "permit a stronger branch from the base idea"
];

export function normalizeMutationSettings(data: Partial<CanvasNodeData> | undefined): MutationSettings {
  const preset = isMutationPreset(data?.mutationPreset) ? data.mutationPreset : defaultPreset;

  return {
    enabled: data?.mutationEnabled === true,
    seed: cleanText(data?.mutationSeed) || "ether-seed",
    preset,
    variationStrength: clampPercent(data?.variationStrength, 35),
    novelty: clampPercent(data?.novelty, 25),
    drift: clampPercent(data?.drift, 15),
    preserveSubject: clampPercent(data?.preserveSubject, 75),
    preserveStyle: clampPercent(data?.preserveStyle, 65),
    lockedTerms: parseLockedTerms(data?.lockedTerms),
    negativeConstraints: cleanText(data?.negativeConstraints),
    instruction: cleanText(data?.mutationInstruction)
  };
}

export function shouldApplyMutation(data: Partial<CanvasNodeData> | undefined) {
  return data?.mutationEnabled === true;
}

export function createTextMutationArtifact(
  sourceText: string,
  data: Partial<CanvasNodeData> | undefined,
  options: MutationOptions
): TextMutationArtifact {
  const settings = normalizeMutationSettings(data);
  const cleanSource = cleanText(sourceText) || cleanText(data?.instruction) || cleanText(data?.notes) || "new visual direction";
  const fingerprint = stableHash(
    [
      cleanSource,
      settings.seed,
      settings.preset,
      settings.variationStrength,
      settings.novelty,
      settings.drift,
      settings.preserveSubject,
      settings.preserveStyle,
      settings.lockedTerms.join("|"),
      settings.negativeConstraints,
      settings.instruction,
      options.operation
    ].join("\u001f")
  );
  const resultText = buildMutatedText(cleanSource, settings, options.operation, fingerprint);

  return {
    kind: options.kind,
    engine: "local-deterministic-text-engine",
    operation: options.operation,
    lineageId: `${options.operation.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${fingerprint.toString(16)}`,
    sourceText: cleanSource,
    instruction: settings.instruction,
    seed: settings.seed,
    settings,
    resultText
  };
}

export function textForNode(data: Partial<CanvasNodeData> | undefined) {
  const textOutput = cleanText(data?.textOutput);

  if (textOutput) {
    return textOutput;
  }

  return [cleanText(data?.instruction), cleanText(data?.notes)].filter(Boolean).join("\n");
}

export function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildMutatedText(
  sourceText: string,
  settings: MutationSettings,
  operation: string,
  fingerprint: number
) {
  const presetOptions = presetPhrases[settings.preset];
  const presetPhrase = pick(presetOptions, fingerprint);
  const noveltyPhrase = pick(noveltyPhrases, fingerprint >>> 4);
  const driftPhrase = pick(driftPhrases, fingerprint >>> 8);
  const intensity =
    settings.variationStrength >= 75
      ? "strong"
      : settings.variationStrength >= 45
        ? "moderate"
        : "subtle";
  const preserveNotes = [
    settings.preserveSubject >= 70 ? "preserve subject identity" : "allow subject reinterpretation",
    settings.preserveStyle >= 70 ? "preserve style continuity" : "allow style movement"
  ].join("; ");
  const instruction = settings.instruction ? ` Direction: ${settings.instruction}.` : "";
  const locked = missingLockedTerms(sourceText, settings.lockedTerms);
  const lockedText = locked.length > 0 ? ` Locked terms: ${locked.join(", ")}.` : "";
  const negativeText = settings.negativeConstraints ? ` Avoid: ${settings.negativeConstraints}.` : "";
  const seedMarker = `Variant ${settings.seed}-${fingerprint % 997}`;

  return [
    sourceText,
    `${operation}: ${intensity} ${settings.preset.toLowerCase()} variation; ${presetPhrase}; ${noveltyPhrase}; ${driftPhrase}; ${preserveNotes}.`,
    `${seedMarker}.${instruction}${lockedText}${negativeText}`
  ]
    .filter(Boolean)
    .join("\n");
}

function missingLockedTerms(sourceText: string, lockedTerms: string[]) {
  const lowerSource = sourceText.toLowerCase();

  return lockedTerms.filter((term) => !lowerSource.includes(term.toLowerCase()));
}

function parseLockedTerms(value: unknown) {
  return cleanText(value)
    .split(/[\n,]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function isMutationPreset(value: unknown): value is MutationPreset {
  return MUTATION_PRESETS.includes(value as MutationPreset);
}

function clampPercent(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function pick<T>(items: T[], seed: number) {
  return items[Math.abs(seed) % items.length]!;
}

function stableHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

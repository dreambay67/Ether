export const DEFAULT_REFERENCE_ROLE = "context";

export const REFERENCE_ROLE_OPTIONS = [
  { value: "context", label: "Context (general)" },
  { value: "subject", label: "Subject" },
  { value: "style", label: "Style" },
  { value: "composition", label: "Composition" },
  { value: "product", label: "Product" },
  { value: "face", label: "Face" },
  { value: "setting", label: "Setting" },
  { value: "lighting", label: "Lighting" },
  { value: "colourPalette", label: "Colour palette" },
  { value: "negative", label: "Negative" },
  { value: "reference", label: "Reference" }
] as const;

export type ReferenceRole = (typeof REFERENCE_ROLE_OPTIONS)[number]["value"];

export function normalizeReferenceRole(value: unknown): ReferenceRole {
  if (typeof value !== "string") return DEFAULT_REFERENCE_ROLE;
  return REFERENCE_ROLE_OPTIONS.some((role) => role.value === value)
    ? value as ReferenceRole
    : DEFAULT_REFERENCE_ROLE;
}

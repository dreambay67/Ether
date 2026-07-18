import {
  connectionRoles,
  ConnectionRoleSchema,
  type ConnectionRole
} from "@ether/schema";

export const DEFAULT_REFERENCE_ROLE: ConnectionRole = "general";

const referenceRoleLabels = {
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
  colourPalette: "Colour palette",
  typography: "Typography",
  motion: "Motion",
  timing: "Timing"
} satisfies Record<ConnectionRole, string>;

export const REFERENCE_ROLE_OPTIONS = connectionRoles.map((value) => ({
  value,
  label: referenceRoleLabels[value]
}));

export type ReferenceRole = ConnectionRole;

export function normalizeReferenceRole(value: unknown): ReferenceRole {
  const parsed = ConnectionRoleSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_REFERENCE_ROLE;
}

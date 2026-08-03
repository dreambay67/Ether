import type { NodeConfig } from "@ether/schema";

export const purposeBuiltRegistryKinds = new Set<NodeConfig["kind"]>(["prompt.text", "prompt.worker", "generation.image", "edit.image", "canvas.drawing"]);

export const registrySelectOptions: Record<string, readonly string[]> = {
  "reference.set.ordering": ["manual", "created", "name"],
  "edit.mask.mode": ["local", "manual", "provider"],
  "edit.transform.operation": ["resize", "crop", "rotate", "upscale"],
  "review.compare.selectionMode": ["one", "many"],
  "review.evaluate.profile": ["fast", "balanced", "deep", "custom"],
  "review.filter.match": ["all", "any"],
  "flow.join.strategy": ["ordered", "zip", "merge"],
  "output.collection.membershipMode": ["add", "replace"],
  "output.export.format": ["original", "png", "jpeg", "webp"],
  "output.export.collisionPolicy": ["rename", "skip", "error"],
  "canvas.note.style": ["note", "cloud", "bubble"],
  "review.filter.rules.operator": ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "exists"],
  "review.filter.routes.outcome": ["matched", "unmatched"]
};

export type RegistryFieldControl = "select" | "boolean" | "number" | "text" | "list" | "optional-number" | "optional-list" | "managed" | "unhandled";

export function registryFieldControl(kind: NodeConfig["kind"], field: string, value: unknown): RegistryFieldControl {
  if (purposeBuiltRegistryKinds.has(kind)) return "managed";
  if (registrySelectOptions[`${kind}.${field}`] !== undefined) return "select";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "text";
  if (Array.isArray(value)) return "list";
  if (value === undefined && ["width", "height"].includes(field)) return "optional-number";
  if (value === undefined && field === "exclusions") return "optional-list";
  return "unhandled";
}

export function createRegistryListItem(kind: NodeConfig["kind"], field: string, index: number): Record<string, unknown> | null {
  const id = `${field}-${crypto.randomUUID()}`;
  if (kind === "review.evaluate" && field === "rubric") return { id, label: `Criterion ${index + 1}`, weight: 1 };
  if (kind === "review.filter" && field === "rules") return { id, field: "score", operator: "gte", value: "" };
  if (kind === "review.filter" && field === "routes") return { id, label: `Route ${index + 1}`, outcome: index === 0 ? "matched" : "unmatched" };
  if (kind === "flow.variables" && field === "variables") return { name: `variable${index + 1}`, value: "" };
  if (kind === "flow.batch" && field === "dimensions") return { id, name: `Dimension ${index + 1}`, values: [""] };
  if (kind === "flow.batch" && field === "exclusions") return { values: {} };
  return null;
}

export function parseInspectorKeyValues(value: string): Record<string, string> {
  return Object.fromEntries(value.split(/[,\n]+/).map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const separator = entry.indexOf("=");
    return separator < 0 ? [entry, ""] : [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()];
  }).filter(([key]) => key.length > 0));
}

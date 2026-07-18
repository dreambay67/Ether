export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Canonical JSON values must be JSON serializable.");
  return serialized;
}

export function canonicalPlanJson(value: unknown): string {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return canonicalJson(value);
  }
  return canonicalJson(Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "contentHash")
  ));
}

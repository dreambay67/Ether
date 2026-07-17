export function canonicalStructuralStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(canonicalStructuralStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalStructuralStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

export function structurallyEqual(left: unknown, right: unknown): boolean {
  return canonicalStructuralStringify(left) === canonicalStructuralStringify(right);
}

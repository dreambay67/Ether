export function unresolvedTemporaryPath(
  value: unknown,
  path: readonly string[] = []
): string[] | null {
  if (typeof value === "string") return value.startsWith("$temp:") ? [...path, value] : null;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = unresolvedTemporaryPath(item, [...path, String(index)]);
      if (found !== null) return found;
    }
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      const found = unresolvedTemporaryPath(item, [...path, key]);
      if (found !== null) return found;
    }
  }
  return null;
}

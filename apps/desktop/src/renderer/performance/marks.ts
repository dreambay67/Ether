export type EtherPerformanceMark =
  | "cold-start:start"
  | "cold-start:interactive"
  | "document-open:start"
  | "document-open:interactive"
  | "graph-hydration:start"
  | "graph-hydration:interactive"
  | "canvas:projection:start"
  | "canvas:projection:end"
  | "artifact-search:start"
  | "artifact-search:first-result"
  | "plan-compilation:start"
  | "plan-compilation:complete"
  | "provider-dispatch:start"
  | "provider-dispatch:first-event"
  | "artifact-import:start"
  | "artifact-import:complete"
  | "thumbnail-decode:start"
  | "thumbnail-decode:complete";

const enabled = typeof performance !== "undefined" && typeof performance.mark === "function";

/** Browser-native marks are intentionally no-ops in non-browser test hosts. */
export function markPerformance(name: EtherPerformanceMark): void {
  if (!enabled) return;
  performance.clearMarks(name);
  performance.mark(name);
}

export function measurePerformance(name: string, start: EtherPerformanceMark, end: EtherPerformanceMark): number | null {
  if (!enabled || typeof performance.measure !== "function") return null;
  try {
    performance.clearMeasures(name);
    return performance.measure(name, start, end).duration;
  } catch { return null; }
}

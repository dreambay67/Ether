export function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "CANCELLED");
}

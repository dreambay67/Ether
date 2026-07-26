export interface LifecycleDrainFailure {
  error: unknown;
  step: string;
}

export interface LifecycleDrainStep {
  close: () => void | Promise<void>;
  name: string;
}

/**
 * Drains every lifecycle participant in order. A failed closer is recorded but
 * never prevents the remaining participants from releasing their resources.
 */
export async function drainLifecycleSteps(
  steps: readonly LifecycleDrainStep[],
  onFailure?: (failure: LifecycleDrainFailure) => void | Promise<void>
): Promise<LifecycleDrainFailure[]> {
  const failures: LifecycleDrainFailure[] = [];
  for (const step of steps) {
    try {
      await step.close();
    } catch (error) {
      const failure = { error, step: step.name };
      failures.push(failure);
      try {
        await onFailure?.(failure);
      } catch {
        // Shutdown remains authoritative even when failure reporting fails.
      }
    }
  }
  return failures;
}

export interface RendererInteractiveGate {
  mark(): void;
  wait(timeoutMs: number): Promise<"renderer" | "timeout">;
}

export function startContainedLifecycle<T>(
  start: () => T | Promise<T>,
  onFailure: (error: unknown) => void | Promise<void>
): Promise<T | null> {
  return Promise.resolve().then(start).then(
    (value) => value,
    async (error) => {
      try {
        await onFailure(error);
      } catch {
        // A reporting failure cannot turn optional background startup into a shell failure.
      }
      return null;
    }
  );
}

/**
 * Renderer readiness is advisory: the renderer can explicitly mark itself
 * interactive, while a bounded timeout keeps background services reachable
 * when the renderer enters a recoverable error screen.
 */
export function createRendererInteractiveGate(): RendererInteractiveGate {
  let marked = false;
  let resolveMarked: (() => void) | null = null;
  const markedPromise = new Promise<void>((resolve) => {
    resolveMarked = resolve;
  });
  const mark = () => {
    if (marked) return;
    marked = true;
    resolveMarked?.();
    resolveMarked = null;
  };
  return {
    mark,
    async wait(timeoutMs) {
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        throw new Error("Renderer interactive timeout must be a positive integer.");
      }
      if (marked) return "renderer";
      let timer: NodeJS.Timeout | undefined;
      const outcome = await Promise.race([
        markedPromise.then(() => "renderer" as const),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), timeoutMs);
          timer.unref?.();
        })
      ]);
      if (timer !== undefined) clearTimeout(timer);
      if (outcome === "timeout") mark();
      return outcome;
    }
  };
}

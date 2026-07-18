import {
  CODEX_PROVIDER_ID,
  AssistantProviderRegistry,
  GenerationProviderRegistry,
  VisionEvaluationProviderRegistry,
  type CodexRuntimeHealth
} from "@ether/providers";
import type { ProviderHealthResult } from "@ether/schema";

import type { CodexRuntimeService } from "./codexRuntime.js";

export type ProviderService = ReturnType<typeof createProviderService>;

export function createProviderService(options: { codex: CodexRuntimeService }) {
  const generation = new GenerationProviderRegistry([options.codex.bundle.generation]);
  const assistant = new AssistantProviderRegistry([options.codex.bundle.assistant]);
  const evaluation = new VisionEvaluationProviderRegistry([options.codex.bundle.evaluation]);
  let closePromise: Promise<void> | null = null;
  return {
    generation,
    assistant,
    evaluation,
    codex: options.codex.bundle,
    runtimeIdentity: options.codex.identity,
    start: () => options.codex.start(),
    health: (): CodexRuntimeHealth => options.codex.health(),
    providerHealth: (): ProviderHealthResult => providerHealth(options.codex.health()),
    subscribe: (listener: (health: CodexRuntimeHealth) => void) => options.codex.subscribe(listener),
    clearDocument: (documentId: string) => options.codex.clearDocument(documentId),
    close: () => {
      closePromise ??= options.codex.close();
      return closePromise;
    }
  };
}

function providerHealth(health: CodexRuntimeHealth): ProviderHealthResult {
  const status = health.status === "ready"
    ? "available"
    : health.status === "starting" || health.status === "restarting"
      ? "probing"
      : health.transport === "exec-fallback"
        ? "degraded"
        : "unavailable";
  return {
    providerId: CODEX_PROVIDER_ID,
    status,
    message: health.fallbackReason ?? health.restartReason,
    checkedAt: new Date().toISOString(),
    transport: health.transport,
    version: health.version,
    manifestHash: health.manifestHash,
    generation: health.generation,
    restartCount: health.restartCount,
    restartReason: health.restartReason,
    fallbackReason: health.fallbackReason,
    processPhase: health.processPhase,
    threadId: null,
    turnId: null,
    timing: {
      startedAt: health.startedAt,
      initializedAt: health.initializedAt,
      initializationMs: health.initializationMs,
      lastExitAt: health.lastExitAt
    }
  };
}

import { randomUUID } from "node:crypto";

import {
  CodexAppServerRuntime,
  CodexCliAssistantProvider,
  CodexCliImageProvider,
  CodexCliVisionEvaluationProvider,
  createCodexAppServerProviderBundle,
  type CodexAppServerProviderBundle,
  type CodexAppServerRuntimeOptions,
  type CodexExecFallbackFacets,
  type CodexRuntimeHealth
} from "@ether/providers";

export type CodexRuntimeServiceOptions = {
  runtime?: CodexAppServerRuntime;
  runtimeOptions?: CodexAppServerRuntimeOptions;
  execFallback?: CodexExecFallbackFacets;
};

export type CodexRuntimeService = {
  readonly identity: string;
  readonly runtime: CodexAppServerRuntime;
  readonly bundle: CodexAppServerProviderBundle;
  start(): Promise<CodexRuntimeHealth>;
  health(): CodexRuntimeHealth;
  subscribe(listener: (health: CodexRuntimeHealth) => void): () => void;
  clearDocument(documentId: string): void;
  close(): Promise<void>;
};

export function createCodexRuntimeService(options: CodexRuntimeServiceOptions = {}): CodexRuntimeService {
  const runtimeOptions = options.runtimeOptions ?? {};
  const runtime = options.runtime ?? new CodexAppServerRuntime(runtimeOptions);
  const execFallback = options.execFallback ?? createExecFallback(runtimeOptions);
  const bundle = createCodexAppServerProviderBundle({ runtime, execFallback });
  const identity = randomUUID();
  return {
    identity,
    runtime,
    bundle,
    start: () => runtime.start(),
    health: () => runtime.health(),
    subscribe: (listener) => runtime.subscribe(listener),
    clearDocument: (documentId) => bundle.clearDocument(documentId),
    close: () => bundle.close()
  };
}

function createExecFallback(options: CodexAppServerRuntimeOptions): CodexExecFallbackFacets {
  const providerOptions = {
    codexCliPath: options.executablePath,
    env: options.env,
    fileExists: options.fileExists
  };
  return {
    generation: new CodexCliImageProvider(providerOptions),
    assistant: new CodexCliAssistantProvider(providerOptions),
    evaluation: new CodexCliVisionEvaluationProvider(providerOptions)
  };
}

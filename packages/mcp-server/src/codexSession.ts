import {
  CodexAppServerRuntime,
  CodexCliAssistantProvider,
  CodexCliImageProvider,
  CodexCliVisionEvaluationProvider,
  createCodexAppServerProviderBundle,
  type CodexAppServerProviderBundle
} from "@ether/providers";

export function createMcpCodexBundle(): CodexAppServerProviderBundle {
  const runtime = new CodexAppServerRuntime();
  return createCodexAppServerProviderBundle({
    runtime,
    execFallback: {
      generation: new CodexCliImageProvider(),
      assistant: new CodexCliAssistantProvider(),
      evaluation: new CodexCliVisionEvaluationProvider()
    }
  });
}

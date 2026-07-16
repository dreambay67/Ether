import { RefreshCw } from "lucide-react";
import type { ProviderDiagnostics, ProviderMatrixEntry } from "../ether-env";

type ProviderStatusPanelProps = {
  diagnostics: ProviderDiagnostics | null;
  message: string;
  isChecking: boolean;
  onHealthCheck: () => void;
};

export function ProviderStatusPanel({
  diagnostics,
  message,
  isChecking,
  onHealthCheck
}: ProviderStatusPanelProps) {
  const rows = providerRows(diagnostics);

  return (
    <section className="provider-status-panel" aria-label="Provider capability matrix" data-testid="provider-status-panel">
      <div className="provider-panel-header">
        <div>
          <p>Providers</p>
          <h2>Capability Matrix</h2>
        </div>
        <button
          type="button"
          onClick={onHealthCheck}
          disabled={isChecking}
          aria-label="Run provider health check"
          data-testid="provider-health-check"
        >
          <RefreshCw size={14} aria-hidden="true" />
          {isChecking ? "Checking" : "Health check"}
        </button>
      </div>

      <p className="provider-panel-summary" aria-live="polite">
        {message}
      </p>

      <div className="provider-matrix" data-testid="provider-capability-matrix">
        {rows.map((provider) => (
          <article
            className={`provider-matrix-row provider-${provider.mode} provider-${provider.status}`}
            data-testid={`provider-status-row-${provider.id}`}
            key={provider.id}
          >
            <div className="provider-row-topline">
              <strong>{provider.displayName}</strong>
              <span>{statusLabel(provider)}</span>
            </div>
            <div className="provider-row-meta">
              <code>{provider.id}</code>
              <span>{provider.mode}</span>
            </div>
            <p>{providerExplanation(provider)}</p>
            <div className="provider-capabilities" aria-label={`${provider.displayName} capabilities`}>
              {provider.capabilities.map((capability) => (
                <span key={capability}>{capability}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function providerRows(diagnostics: ProviderDiagnostics | null): ProviderMatrixEntry[] {
  if (diagnostics?.matrix?.length) {
    return diagnostics.matrix;
  }

  const imageCapabilities = ["image.generate", "image.edit", "image.reference-input"];

  return [
    {
      id: "codex-chatgpt-image-2",
      displayName: "ChatGPT Image 2 / Codex image",
      name: "Codex image",
      route: "codex-cli",
      availability: "unavailable",
      status: "unavailable",
      mode: "real",
      capabilities: imageCapabilities,
      messages: ["Run provider health check to inspect the local Codex CLI route."],
      unavailableReason: "Run provider health check to inspect the local Codex CLI route.",
      noApiPolicy: "openai-platform-api-blocked"
    },
    {
      id: "codex-vision-assistant",
      displayName: "Codex assistant",
      name: "Codex assistant",
      route: "codex-cli",
      availability: "unavailable",
      status: "unavailable",
      mode: "real",
      capabilities: ["assistant.text", "assistant.vision", "image.reference-input"],
      messages: ["Run provider health check to inspect the local Codex CLI route."],
      unavailableReason: "Run provider health check to inspect the local Codex CLI route.",
      noApiPolicy: "openai-platform-api-blocked"
    },
    {
      id: "codex-vision-evaluation",
      displayName: "Codex evaluation",
      name: "Codex evaluation",
      route: "codex-cli",
      availability: "unavailable",
      status: "unavailable",
      mode: "real",
      capabilities: ["evaluation.vision", "assistant.vision", "image.reference-input"],
      messages: ["Run provider health check to inspect the local Codex CLI route."],
      unavailableReason: "Run provider health check to inspect the local Codex CLI route.",
      noApiPolicy: "openai-platform-api-blocked"
    },
    {
      id: "ether-fake-local",
      displayName: "Simulation Mode fake provider",
      name: "Simulation Mode",
      route: "local-fake",
      availability: "available",
      status: "ready",
      mode: "simulation",
      capabilities: imageCapabilities,
      messages: ["Offline deterministic provider is available."],
      noApiPolicy: "openai-platform-api-blocked"
    },
    {
      id: "api-image-generation",
      displayName: "Optional API generation slot",
      name: "API Image Generation",
      route: "api-generation",
      availability: "unavailable",
      status: "experimental",
      mode: "experimental",
      capabilities: imageCapabilities,
      messages: ["Optional API infrastructure is disabled and never used as a hidden fallback."],
      unavailableReason: "Optional API infrastructure is disabled and never used as a hidden fallback.",
      readiness: "disabled",
      noHiddenFallback: true,
      noApiPolicy: "openai-platform-api-blocked"
    },
    {
      id: "api-assistant",
      displayName: "Optional API assistant slot",
      name: "API Assistant",
      route: "api-assistant",
      availability: "unavailable",
      status: "experimental",
      mode: "experimental",
      capabilities: ["assistant.text", "assistant.vision", "image.reference-input"],
      messages: ["Optional API infrastructure is disabled and never used as a hidden fallback."],
      unavailableReason: "Optional API infrastructure is disabled and never used as a hidden fallback.",
      readiness: "disabled",
      noHiddenFallback: true,
      noApiPolicy: "openai-platform-api-blocked"
    },
    {
      id: "google-nano-banana-pro",
      displayName: "Nano Banana Pro",
      name: "Nano Banana Pro",
      route: "unconfigured-clean-cli-or-mcp",
      availability: "unavailable",
      status: "experimental",
      mode: "experimental",
      capabilities: imageCapabilities,
      messages: ["Experimental slot is unavailable until a clean local route exists."],
      unavailableReason: "Experimental slot is unavailable until a clean local route exists.",
      noApiPolicy: "openai-platform-api-blocked"
    },
    {
      id: "google-nano-banana-2",
      displayName: "Nano Banana 2",
      name: "Nano Banana 2",
      route: "unconfigured-clean-cli-or-mcp",
      availability: "unavailable",
      status: "experimental",
      mode: "experimental",
      capabilities: imageCapabilities,
      messages: ["Experimental slot is unavailable until a clean local route exists."],
      unavailableReason: "Experimental slot is unavailable until a clean local route exists.",
      noApiPolicy: "openai-platform-api-blocked"
    }
  ];
}

function statusLabel(provider: ProviderMatrixEntry) {
  if (provider.status === "ready") {
    return "Ready";
  }

  if (provider.status === "experimental") {
    return provider.availability === "available" ? "Experimental" : "Experimental / unavailable";
  }

  return "Unavailable";
}

function providerExplanation(provider: ProviderMatrixEntry) {
  if (provider.noHiddenFallback) {
    return provider.readiness === "disabled"
      ? "Optional API infrastructure is disabled and never used as a hidden fallback."
      : "Optional API infrastructure requires explicit selection and never runs as fallback.";
  }

  if (provider.mode === "simulation") {
    return "Simulation Mode uses deterministic local output for offline workflow checks.";
  }

  if (provider.unavailableReason) {
    return provider.unavailableReason;
  }

  return provider.messages[0] ?? "Provider diagnostics are available.";
}

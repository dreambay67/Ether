import { describe, expect, it } from "vitest";
import {
  ApiAssistantProvider,
  ApiGenerationProvider,
  AssistantProviderRegistry,
  GenerationProviderRegistry,
  createDefaultApiAssistantProvider,
  createDefaultApiGenerationProvider,
  createDefaultProviderRegistry,
  diagnoseProviderRegistry,
  type AssistantProviderInput,
  type GenerationProviderInput
} from "@ether/providers";

function generationInput(): GenerationProviderInput {
  return {
    workspacePath: "C:\\Project",
    runId: "run-1",
    generationNodeId: "generation",
    iteration: 1,
    prompt: "studio product shot",
    negativePrompt: "",
    sections: [],
    references: [],
    edgeRoles: [],
    outputCount: 1,
    requestedAt: "2026-06-28T10:00:00.000Z"
  };
}

function assistantInput(): AssistantProviderInput {
  return {
    workspacePath: "C:\\Project",
    runId: "run-1",
    assistantNodeId: "assistant",
    assistantSubtype: "Brainstormer",
    prompt: "shape a campaign direction",
    instruction: "Suggest three visual territories.",
    notes: "",
    sections: [],
    references: [],
    edgeRoles: [],
    requestedAt: "2026-06-28T10:00:00.000Z"
  };
}

describe("optional API provider infrastructure", () => {
  it("registers API generation and assistant providers with explicit descriptors and capabilities", () => {
    const generationProvider = new ApiGenerationProvider({
      descriptor: {
        id: "custom-api-generation",
        name: "Custom API Generation",
        capabilities: ["image.generate", "image.edit", "image.reference-input"],
        model: "future-image-model"
      },
      activation: { state: "disabled" }
    });
    const assistantProvider = new ApiAssistantProvider({
      descriptor: {
        id: "custom-api-assistant",
        name: "Custom API Assistant",
        capabilities: ["assistant.text", "assistant.vision", "image.reference-input"],
        model: "future-assistant-model"
      },
      activation: { state: "disabled" }
    });
    const generationRegistry = new GenerationProviderRegistry([generationProvider]);
    const assistantRegistry = new AssistantProviderRegistry([assistantProvider]);

    expect(generationRegistry.listDescriptors()).toEqual([
      expect.objectContaining({
        id: "custom-api-generation",
        route: "api-generation",
        capabilities: ["image.generate", "image.edit", "image.reference-input"]
      })
    ]);
    expect(assistantRegistry.listDescriptors()).toEqual([
      expect.objectContaining({
        id: "custom-api-assistant",
        route: "api-assistant",
        capabilities: ["assistant.text", "assistant.vision", "image.reference-input"]
      })
    ]);
  });

  it("reports disabled readiness when an API provider is disabled", async () => {
    const provider = new ApiGenerationProvider({
      descriptor: {
        id: "disabled-api-generation",
        name: "Disabled API Generation",
        capabilities: ["image.generate"]
      },
      activation: { state: "disabled" }
    });

    expect(provider.diagnose()).toMatchObject({
      availability: "unavailable",
      readiness: "disabled",
      credentialStatus: {
        state: "not_checked"
      }
    });
  });

  it("never activates a disabled API slot from environment credentials alone", () => {
    const provider = new ApiGenerationProvider({
      descriptor: {
        id: "environment-only-api-generation",
        name: "Environment Only API Generation",
        capabilities: ["image.generate"]
      },
      activation: { state: "disabled" },
      env: { OPENAI_API_KEY: "present-but-not-selected" },
      adapter: {
        async generate() { throw new Error("must not dispatch"); },
        async edit() { throw new Error("must not dispatch"); }
      }
    });

    expect(provider.diagnose()).toMatchObject({ readiness: "disabled", availability: "unavailable" });
  });

  it("rejects an explicit selection for a different provider ID", () => {
    expect(() => new ApiAssistantProvider({
      descriptor: {
        id: "selected-api-assistant",
        name: "Selected API Assistant",
        capabilities: ["assistant.text"]
      },
      activation: {
        state: "explicit-user-selection",
        selectedProviderId: "another-provider",
        credentialReference: { source: "secure-store", id: "credential-1", validated: true }
      }
    })).toThrow(/selected provider/i);
  });

  it("reports missing_credentials readiness when explicitly selected without a resolvable credential", async () => {
    const provider = new ApiAssistantProvider({
      descriptor: {
        id: "enabled-api-assistant",
        name: "Enabled API Assistant",
        capabilities: ["assistant.text"]
      },
      activation: {
        state: "explicit-user-selection",
        selectedProviderId: "enabled-api-assistant",
        credentialReference: { source: "environment", id: "ETHER_ASSISTANT_API_KEY", validated: true }
      },
      env: {}
    });

    expect(provider.diagnose()).toMatchObject({
      availability: "unavailable",
      readiness: "missing_credentials",
      credentialStatus: {
        state: "missing",
        envKey: "ETHER_ASSISTANT_API_KEY"
      }
    });
  });

  it("reports missing_adapter readiness when generation credentials exist but no adapter is installed", async () => {
    const secret = "sk-super-secret-api-value";
    const provider = new ApiGenerationProvider({
      descriptor: {
        id: "generation-api-without-adapter",
        name: "Generation API Without Adapter",
        capabilities: ["image.generate"]
      },
      activation: {
        state: "explicit-user-selection",
        selectedProviderId: "generation-api-without-adapter",
        credentialReference: { source: "environment", id: "ETHER_GENERATION_API_KEY", validated: true }
      },
      env: {
        ETHER_GENERATION_API_KEY: secret
      }
    });

    const diagnostic = await provider.diagnose();
    const serialized = JSON.stringify(diagnostic);

    expect(diagnostic).toMatchObject({
      availability: "unavailable",
      readiness: "missing_adapter",
      credentialStatus: {
        state: "present",
        envKey: "ETHER_GENERATION_API_KEY"
      },
      messages: [expect.stringMatching(/no generation API adapter is installed/i)]
    });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("sk-super-secret");
  });

  it("reports missing_adapter readiness when assistant credentials exist but no adapter is installed", async () => {
    const secret = "assistant-secret-value";
    const provider = new ApiAssistantProvider({
      descriptor: {
        id: "assistant-api-without-adapter",
        name: "Assistant API Without Adapter",
        capabilities: ["assistant.text"]
      },
      activation: {
        state: "explicit-user-selection",
        selectedProviderId: "assistant-api-without-adapter",
        credentialReference: { source: "environment", id: "ETHER_ASSISTANT_API_KEY", validated: true }
      },
      env: {
        ETHER_ASSISTANT_API_KEY: secret
      }
    });

    const diagnostic = provider.diagnose();
    const serialized = JSON.stringify(diagnostic);

    expect(diagnostic).toMatchObject({
      availability: "unavailable",
      readiness: "missing_adapter",
      credentialStatus: {
        state: "present",
        envKey: "ETHER_ASSISTANT_API_KEY"
      },
      messages: [expect.stringMatching(/no assistant API adapter is installed/i)]
    });
    expect(serialized).not.toContain(secret);
  });

  it("reports configured readiness when generation credentials and adapter are installed", async () => {
    const provider = new ApiGenerationProvider({
      descriptor: {
        id: "configured-api-generation",
        name: "Configured API Generation",
        capabilities: ["image.generate", "image.edit"]
      },
      activation: {
        state: "explicit-user-selection",
        selectedProviderId: "configured-api-generation",
        credentialReference: { source: "explicit", id: "generation-credential", validated: true }
      },
      credential: "explicit-secret",
      adapter: {
        async generate() {
          return {
            providerId: "configured-api-generation",
            providerName: "Configured API Generation",
            capabilities: ["image.generate"],
            artifacts: []
          };
        },
        async edit() {
          return {
            providerId: "configured-api-generation",
            providerName: "Configured API Generation",
            capabilities: ["image.edit"],
            artifacts: []
          };
        }
      }
    });

    const diagnostic = provider.diagnose();
    const result = await provider.generate(generationInput());
    const serialized = JSON.stringify(diagnostic);

    expect(diagnostic).toMatchObject({
      availability: "available",
      readiness: "configured",
      credentialStatus: {
        state: "present",
        source: "explicit"
      }
    });
    expect(result.providerId).toBe("configured-api-generation");
    expect(serialized).not.toContain("explicit-secret");
  });

  it("rejects an API output count beyond the adapter capability before dispatch", async () => {
    let calls = 0;
    const provider = new ApiGenerationProvider({
      descriptor: {
        id: "single-output-api-generation",
        name: "Single Output API Generation",
        capabilities: ["image.generate"]
      },
      activation: {
        state: "explicit-user-selection",
        selectedProviderId: "single-output-api-generation",
        credentialReference: { source: "explicit", id: "generation-credential", validated: true }
      },
      credential: "explicit-secret",
      adapter: {
        maxOutputsPerCall: 1,
        async generate() {
          calls += 1;
          throw new Error("adapter must not be called");
        },
        async edit() {
          throw new Error("not used");
        }
      }
    });

    await expect(provider.generate({ ...generationInput(), outputCount: 2 })).rejects.toMatchObject({
      code: "PROVIDER_OUTPUT_COUNT_UNSUPPORTED",
      retryable: false
    });
    expect(calls).toBe(0);
  });

  it("reports configured readiness when assistant credentials and adapter are installed", async () => {
    const provider = new ApiAssistantProvider({
      descriptor: {
        id: "configured-api-assistant",
        name: "Configured API Assistant",
        capabilities: ["assistant.text"]
      },
      activation: {
        state: "explicit-user-selection",
        selectedProviderId: "configured-api-assistant",
        credentialReference: { source: "explicit", id: "assistant-credential", validated: true }
      },
      credential: "assistant-explicit-secret",
      adapter: {
        async run() {
          return {
            providerId: "configured-api-assistant",
            providerName: "Configured API Assistant",
            capabilities: ["assistant.text"],
            text: "adapter response"
          };
        }
      }
    });

    const diagnostic = provider.diagnose();
    const result = await provider.run(assistantInput());
    const serialized = JSON.stringify(diagnostic);

    expect(diagnostic).toMatchObject({
      availability: "available",
      readiness: "configured"
    });
    expect(result.text).toBe("adapter response");
    expect(serialized).not.toContain("assistant-explicit-secret");
  });

  it("does not allow API config to relax explicit selection policy", () => {
    const provider = new ApiGenerationProvider({
      descriptor: {
        id: "policy-api-generation",
        name: "Policy API Generation",
        capabilities: ["image.generate"]
      },
      activation: { state: "disabled" },
      requestPolicy: {
        requiresExplicitSelection: false,
        noHiddenFallback: true,
        allowNetworkRequests: true
      }
    });

    expect(provider.diagnose()).toMatchObject({
      requestPolicy: {
        requiresExplicitSelection: true,
        noHiddenFallback: true,
        allowNetworkRequests: true
      }
    });
  });

  it("keeps default generation API slots disabled and out of the automatic provider order", async () => {
    const registry = createDefaultProviderRegistry();
    const descriptors = registry.listDescriptors();
    const diagnostics = await diagnoseProviderRegistry(registry, { env: {} });

    expect(descriptors.map((provider) => provider.id)).toEqual([
      "ether-fake-local",
      "codex-chatgpt-image-2",
      "google-nano-banana-pro",
      "google-nano-banana-2",
      "google-nano-banana-2-lite"
    ]);
    expect(descriptors.some((provider) => provider.route === "api-generation")).toBe(false);
    expect(diagnostics.optionalApiProviders?.generation).toMatchObject({
      id: "api-image-generation",
      readiness: "disabled",
      availability: "unavailable",
      noHiddenFallback: true
    });
  });

  it("exposes default API generation and assistant providers as disabled optional slots", async () => {
    const generationProvider = createDefaultApiGenerationProvider();
    const assistantProvider = createDefaultApiAssistantProvider();

    expect(generationProvider.diagnose()).toMatchObject({
      id: "api-image-generation",
      readiness: "disabled",
      noHiddenFallback: true,
      requestPolicy: {
        noHiddenFallback: true,
        requiresExplicitSelection: true
      }
    });
    expect(assistantProvider.diagnose()).toMatchObject({
      id: "api-assistant",
      readiness: "disabled",
      noHiddenFallback: true,
      requestPolicy: {
        noHiddenFallback: true,
        requiresExplicitSelection: true
      }
    });
  });

  it("rejects default API generation and assistant executions with clear unavailable errors", async () => {
    const generationProvider = createDefaultApiGenerationProvider();
    const assistantProvider = createDefaultApiAssistantProvider();

    await expect(generationProvider.generate(generationInput())).rejects.toThrow(
      /API provider "api-image-generation" is disabled/i
    );
    await expect(generationProvider.edit({} as any)).rejects.toThrow(
      /API provider "api-image-generation" is disabled/i
    );
    await expect(assistantProvider.run(assistantInput())).rejects.toThrow(
      /API provider "api-assistant" is disabled/i
    );
  });

  it("redacts configured credentials from registry diagnostics", async () => {
    const secret = "ether-secret-value";
    const registry = new GenerationProviderRegistry([
      new ApiGenerationProvider({
        descriptor: {
          id: "configured-api-generation",
          name: "Configured API Generation",
          capabilities: ["image.generate"]
        },
        activation: {
          state: "explicit-user-selection",
          selectedProviderId: "configured-api-generation",
          credentialReference: { source: "environment", id: "ETHER_GENERATION_API_KEY", validated: true }
        },
        env: {
          ETHER_GENERATION_API_KEY: secret
        },
        adapter: {
          async generate() {
            return {
              providerId: "configured-api-generation",
              providerName: "Configured API Generation",
              capabilities: ["image.generate"],
              artifacts: []
            };
          },
          async edit() {
            return {
              providerId: "configured-api-generation",
              providerName: "Configured API Generation",
              capabilities: ["image.edit"],
              artifacts: []
            };
          }
        }
      })
    ]);

    const diagnostics = await diagnoseProviderRegistry(registry, {
      env: {
        ETHER_GENERATION_API_KEY: secret
      }
    });
    const serialized = JSON.stringify(diagnostics);

    expect(diagnostics.providers[0]).toMatchObject({
      readiness: "configured",
      credentialStatus: {
        state: "present",
        envKey: "ETHER_GENERATION_API_KEY"
      }
    });
    expect(serialized).not.toContain(secret);
  });

  it("uses assistant provider wording when assistant registration is missing", () => {
    const registry = new AssistantProviderRegistry([]);

    expect(() => registry.require("missing-assistant")).toThrow(
      /Assistant provider "missing-assistant" is not registered/i
    );
  });
});

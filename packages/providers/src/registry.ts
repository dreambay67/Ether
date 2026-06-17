import { CodexCliImageProvider, type CodexCliImageProviderOptions } from "./codex.js";
import { BLOCKED_OPENAI_ENV_KEYS, hasBlockedOpenAiEnvKey } from "./env.js";
import { ProviderNotFoundError } from "./errors.js";
import { FakeImageProvider } from "./fake.js";
import { createNanoBananaProviders } from "./unavailable.js";
import type {
  GenerationProvider,
  ProviderDescriptor,
  ProviderDiagnosticContext,
  ProviderRegistryDiagnostics
} from "./types.js";

export type DefaultProviderRegistryOptions = CodexCliImageProviderOptions;

export class GenerationProviderRegistry {
  private readonly providers = new Map<string, GenerationProvider>();

  constructor(providers: GenerationProvider[] = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  register(provider: GenerationProvider) {
    if (this.providers.has(provider.descriptor.id)) {
      throw new Error(`Generation provider "${provider.descriptor.id}" is already registered.`);
    }

    this.providers.set(provider.descriptor.id, provider);
  }

  get(providerId: string) {
    return this.providers.get(providerId) ?? null;
  }

  require(providerId: string) {
    const provider = this.get(providerId);

    if (!provider) {
      throw new ProviderNotFoundError(providerId, this.listDescriptors().map((entry) => entry.id));
    }

    return provider;
  }

  listDescriptors(): ProviderDescriptor[] {
    return [...this.providers.values()].map((provider) => ({
      ...provider.descriptor,
      capabilities: [...provider.descriptor.capabilities],
      notes: provider.descriptor.notes ? [...provider.descriptor.notes] : undefined
    }));
  }

  async diagnose(providerId: string, context: ProviderDiagnosticContext = {}) {
    return this.require(providerId).diagnose(context);
  }

  async diagnoseAll(context: ProviderDiagnosticContext = {}) {
    return Promise.all([...this.providers.values()].map((provider) => provider.diagnose(context)));
  }
}

export function createDefaultProviderRegistry(options: DefaultProviderRegistryOptions = {}) {
  return new GenerationProviderRegistry([
    new FakeImageProvider(),
    new CodexCliImageProvider(options),
    ...createNanoBananaProviders()
  ]);
}

export async function diagnoseProviderRegistry(
  registry: GenerationProviderRegistry,
  context: ProviderDiagnosticContext = {}
): Promise<ProviderRegistryDiagnostics> {
  const env = context.env ?? process.env;

  return {
    policy: {
      openAiPlatformApi: {
        status: "blocked",
        envKeyDetected: hasBlockedOpenAiEnvKey(env),
        blockedEnvKeys: [...BLOCKED_OPENAI_ENV_KEYS],
        message:
          "Ether blocks OpenAI Platform API fallback. API keys are ignored and stripped from provider child environments."
      }
    },
    providers: await registry.diagnoseAll(context)
  };
}

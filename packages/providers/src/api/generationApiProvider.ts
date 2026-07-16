import type {
  GenerationProvider,
  GenerationProviderInput,
  ImageEditProviderInput,
  ProviderDiagnosticContext,
  ProviderGenerationResult
} from "../types.js";
import { ApiProviderBase } from "./apiProviderBase.js";
import type {
  ApiGenerationAdapter,
  ApiProviderConfig,
  ApiProviderDiagnostic
} from "./types.js";

export const API_GENERATION_PROVIDER_ID = "api-image-generation";

export type ApiGenerationProviderConfig = ApiProviderConfig & {
  adapter?: ApiGenerationAdapter;
};

export class ApiGenerationProvider extends ApiProviderBase implements GenerationProvider {
  private readonly adapter: ApiGenerationAdapter | undefined;

  constructor(config: ApiGenerationProviderConfig) {
    super(config, "api-generation", "generation API adapter");
    this.adapter = config.adapter;
  }

  diagnose(context: ProviderDiagnosticContext = {}): ApiProviderDiagnostic {
    return super.diagnose(context);
  }

  async generate(input: GenerationProviderInput): Promise<ProviderGenerationResult> {
    await this.requireConfigured();

    if (!this.adapter) {
      return this.createUnavailableError(
        `API provider "${this.descriptor.id}" is configured, but no generation API adapter is installed.`
      );
    }

    return this.adapter.generate(input);
  }

  async edit(input: ImageEditProviderInput): Promise<ProviderGenerationResult> {
    await this.requireConfigured();

    if (!this.adapter) {
      return this.createUnavailableError(
        `API provider "${this.descriptor.id}" is configured, but no generation API adapter is installed.`
      );
    }

    return this.adapter.edit(input);
  }

  protected hasRunnableAdapter() {
    return Boolean(this.adapter);
  }
}

export function createDefaultApiGenerationProvider() {
  return new ApiGenerationProvider({
    descriptor: {
      id: API_GENERATION_PROVIDER_ID,
      name: "API Image Generation",
      capabilities: ["image.generate", "image.edit", "image.reference-input"],
      notes: ["Disabled by default. This slot is reserved for explicit future API adapters."]
    },
    enabled: false,
    credentialEnvKey: "ETHER_GENERATION_API_KEY"
  });
}

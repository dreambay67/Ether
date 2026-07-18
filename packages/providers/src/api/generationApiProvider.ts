import type {
  GenerationProvider,
  GenerationProviderInput,
  ImageEditProviderInput,
  ProviderDiagnosticContext,
  ProviderExecutionContext,
  ProviderGenerationResult
} from "../types.js";
import { ProviderOutputCountUnsupportedError } from "../errors.js";
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

  async generate(
    input: GenerationProviderInput,
    context?: ProviderExecutionContext
  ): Promise<ProviderGenerationResult> {
    await this.requireConfigured();

    if (!this.adapter) {
      return this.createUnavailableError(
        `API provider "${this.descriptor.id}" is configured, but no generation API adapter is installed.`
      );
    }

    const maximum = this.adapter.maxOutputsPerCall ?? 1;
    if (input.outputCount > maximum) {
      throw new ProviderOutputCountUnsupportedError(this.descriptor.id, input.outputCount, maximum);
    }

    const result = await this.adapter.generate(input, context);
    await context?.complete(result);
    return result;
  }

  async edit(
    input: ImageEditProviderInput,
    context?: ProviderExecutionContext
  ): Promise<ProviderGenerationResult> {
    await this.requireConfigured();

    if (!this.adapter) {
      return this.createUnavailableError(
        `API provider "${this.descriptor.id}" is configured, but no generation API adapter is installed.`
      );
    }

    const result = await this.adapter.edit(input, context);
    await context?.complete(result);
    return result;
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
    activation: { state: "disabled" }
  });
}

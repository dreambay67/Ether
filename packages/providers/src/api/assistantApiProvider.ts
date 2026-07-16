import type {
  AssistantProvider,
  AssistantProviderInput,
  ProviderDiagnosticContext,
  ProviderAssistantResult
} from "../types.js";
import { ApiProviderBase } from "./apiProviderBase.js";
import type {
  ApiAssistantAdapter,
  ApiProviderConfig,
  ApiProviderDiagnostic
} from "./types.js";

export const API_ASSISTANT_PROVIDER_ID = "api-assistant";

export type ApiAssistantProviderConfig = ApiProviderConfig & {
  adapter?: ApiAssistantAdapter;
};

export class ApiAssistantProvider extends ApiProviderBase implements AssistantProvider {
  private readonly adapter: ApiAssistantAdapter | undefined;

  constructor(config: ApiAssistantProviderConfig) {
    super(config, "api-assistant", "assistant API adapter");
    this.adapter = config.adapter;
  }

  diagnose(context: ProviderDiagnosticContext = {}): ApiProviderDiagnostic {
    return super.diagnose(context);
  }

  async run(input: AssistantProviderInput): Promise<ProviderAssistantResult> {
    await this.requireConfigured();

    if (!this.adapter) {
      return this.createUnavailableError(
        `API provider "${this.descriptor.id}" is configured, but no assistant API adapter is installed.`
      );
    }

    return this.adapter.run(input);
  }

  protected hasRunnableAdapter() {
    return Boolean(this.adapter);
  }
}

export function createDefaultApiAssistantProvider() {
  return new ApiAssistantProvider({
    descriptor: {
      id: API_ASSISTANT_PROVIDER_ID,
      name: "API Assistant",
      capabilities: ["assistant.text", "assistant.vision", "image.reference-input"],
      notes: ["Disabled by default. This slot is reserved for explicit future API adapters."]
    },
    enabled: false,
    credentialEnvKey: "ETHER_ASSISTANT_API_KEY"
  });
}

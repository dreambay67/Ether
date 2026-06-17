import type {
  GenerationProvider,
  GenerationProviderInput,
  ProviderDescriptor,
  ProviderDiagnostic
} from "./types.js";
import { ProviderUnavailableError } from "./errors.js";

export class UnavailableImageProvider implements GenerationProvider {
  readonly descriptor: ProviderDescriptor;

  constructor(descriptor: ProviderDescriptor, private readonly message: string) {
    this.descriptor = descriptor;
  }

  diagnose(): ProviderDiagnostic {
    return {
      ...this.descriptor,
      capabilities: [...this.descriptor.capabilities],
      availability: "unavailable",
      messages: [this.message]
    };
  }

  async generate(_input: GenerationProviderInput): Promise<never> {
    throw new ProviderUnavailableError(this.diagnose());
  }
}

export function createNanoBananaProviders() {
  const message =
    "No clean local CLI/MCP route is configured for this Nano Banana provider. Official routes are Gemini API, AI Studio, Vertex, or Gemini Enterprise; API, browser, and cloud routes are blocked by Ether policy.";

  return [
    new UnavailableImageProvider(
      {
        id: "google-nano-banana-pro",
        name: "Nano Banana Pro",
        route: "unconfigured-clean-cli-or-mcp",
        capabilities: ["image.generate", "image.edit", "image.reference-input"],
        model: "gemini-3-pro-image",
        notes: ["Tracked as unavailable until a clean local CLI/MCP route exists."]
      },
      message
    ),
    new UnavailableImageProvider(
      {
        id: "google-nano-banana-2",
        name: "Nano Banana 2",
        route: "unconfigured-clean-cli-or-mcp",
        capabilities: ["image.generate", "image.edit", "image.reference-input"],
        model: "gemini-3.1-flash-image",
        notes: ["Tracked as unavailable until a clean local CLI/MCP route exists."]
      },
      message
    )
  ];
}

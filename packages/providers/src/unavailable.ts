import type {
  GenerationProvider,
  GenerationProviderInput,
  ImageEditProviderInput,
  ProviderDescriptor,
  ProviderDiagnostic
} from "./types.js";
import { createAntigravityImageProviders } from "./antigravity/imageProvider.js";
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

  async edit(_input: ImageEditProviderInput): Promise<never> {
    throw new ProviderUnavailableError(this.diagnose());
  }
}

export function createNanoBananaProviders() {
  return createAntigravityImageProviders();
}

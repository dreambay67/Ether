import type { ProviderDiagnostic } from "./types.js";

export class ProviderNotFoundError extends Error {
  constructor(providerId: string, availableProviderIds: string[]) {
    super(
      `Generation provider "${providerId}" is not registered. Available providers: ${
        availableProviderIds.join(", ") || "none"
      }.`
    );
    this.name = "ProviderNotFoundError";
  }
}

export class ProviderUnavailableError extends Error {
  readonly diagnostic: ProviderDiagnostic;

  constructor(diagnostic: ProviderDiagnostic) {
    super(
      `Generation provider "${diagnostic.id}" is unavailable: ${diagnostic.messages.join("; ")}`
    );
    this.name = "ProviderUnavailableError";
    this.diagnostic = diagnostic;
  }
}

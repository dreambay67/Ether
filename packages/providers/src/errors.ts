import type { ApiProviderDiagnostic } from "./api/types.js";
import type { ProviderDiagnostic } from "./types.js";

export class ProviderNotFoundError extends Error {
  constructor(providerId: string, availableProviderIds: string[], providerKind = "Generation") {
    super(
      `${providerKind} provider "${providerId}" is not registered. Available providers: ${
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

export class ApiProviderUnavailableError extends Error {
  readonly diagnostic: ApiProviderDiagnostic;

  constructor(diagnostic: ApiProviderDiagnostic) {
    super(`API provider "${diagnostic.id}" is ${diagnostic.readiness}: ${diagnostic.messages.join("; ")}`);
    this.name = "ApiProviderUnavailableError";
    this.diagnostic = diagnostic;
  }
}

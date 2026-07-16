import { ApiProviderUnavailableError } from "../errors.js";
import type {
  ProviderDescriptor,
  ProviderDiagnosticContext,
  ProviderRoute
} from "../types.js";
import type {
  ApiCredentialStatus,
  ApiDataDisclosure,
  ApiProviderConfig,
  ApiProviderDiagnostic,
  ApiProviderReadiness,
  ApiRequestPolicy
} from "./types.js";

const defaultRequestPolicy: ApiRequestPolicy = {
  requiresExplicitSelection: true,
  noHiddenFallback: true,
  allowNetworkRequests: false,
  notes: ["API providers must be selected explicitly and are never used as hidden fallback."]
};

const defaultDataDisclosure: ApiDataDisclosure = {
  sendsPrompts: true,
  sendsImages: true,
  sendsProjectMetadata: false,
  notes: ["No API provider is active until credentials and an implementation adapter are configured."]
};

export abstract class ApiProviderBase {
  readonly descriptor: ProviderDescriptor;

  protected readonly enabled: boolean;
  protected readonly credentialEnvKey: string | undefined;
  protected readonly credential: string | undefined;
  protected readonly env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  private readonly requestPolicy: ApiRequestPolicy;
  private readonly dataDisclosure: ApiDataDisclosure;
  private readonly unavailableMessage: string | undefined;
  private readonly adapterKind: string;

  protected constructor(
    config: ApiProviderConfig,
    route: Extract<ProviderRoute, "api-generation" | "api-assistant">,
    adapterKind: string
  ) {
    this.descriptor = {
      ...config.descriptor,
      route,
      capabilities: [...config.descriptor.capabilities],
      notes: config.descriptor.notes ? [...config.descriptor.notes] : undefined
    };
    this.enabled = config.enabled ?? false;
    this.credentialEnvKey = config.credentialEnvKey;
    this.credential = config.credential;
    this.env = config.env ?? process.env;
    this.unavailableMessage = config.unavailableMessage;
    this.adapterKind = adapterKind;
    this.requestPolicy = {
      ...defaultRequestPolicy,
      ...config.requestPolicy,
      requiresExplicitSelection: true,
      noHiddenFallback: true
    };
    this.dataDisclosure = {
      ...defaultDataDisclosure,
      ...config.dataDisclosure
    };
  }

  diagnose(context: ProviderDiagnosticContext = {}): ApiProviderDiagnostic {
    const credentialStatus = this.getCredentialStatus(context.env);
    const readiness = this.getReadiness(credentialStatus);
    const availability = readiness === "configured" ? "available" : "unavailable";

    return {
      ...this.descriptor,
      capabilities: [...this.descriptor.capabilities],
      notes: this.descriptor.notes ? [...this.descriptor.notes] : undefined,
      availability,
      readiness,
      credentialStatus,
      requestPolicy: {
        ...this.requestPolicy,
        notes: this.requestPolicy.notes ? [...this.requestPolicy.notes] : undefined
      },
      dataDisclosure: {
        ...this.dataDisclosure,
        notes: this.dataDisclosure.notes ? [...this.dataDisclosure.notes] : undefined
      },
      noHiddenFallback: true,
      messages: [this.messageForReadiness(readiness)]
    };
  }

  protected async requireConfigured() {
    const diagnostic = this.diagnose();

    if (diagnostic.readiness !== "configured") {
      throw new ApiProviderUnavailableError(diagnostic);
    }

    return diagnostic;
  }

  protected createUnavailableError(message?: string): never {
    const diagnostic = this.diagnose();

    throw new ApiProviderUnavailableError({
      ...diagnostic,
      availability: "unavailable",
      messages: [message ?? this.unavailableMessage ?? this.messageForReadiness(diagnostic.readiness)]
    });
  }

  protected abstract hasRunnableAdapter(): boolean;

  private getCredentialStatus(contextEnv?: ProviderDiagnosticContext["env"]): ApiCredentialStatus {
    if (!this.enabled) {
      return {
        state: "not_checked",
        envKey: this.credentialEnvKey,
        source: "none"
      };
    }

    if (this.credential && this.credential.trim()) {
      return {
        state: "present",
        envKey: this.credentialEnvKey,
        source: "explicit"
      };
    }

    if (this.credentialEnvKey) {
      const env = contextEnv ?? this.env;
      const value = env[this.credentialEnvKey];

      return {
        state: value && value.trim() ? "present" : "missing",
        envKey: this.credentialEnvKey,
        source: "environment"
      };
    }

    return {
      state: "missing",
      source: "none"
    };
  }

  private getReadiness(credentialStatus: ApiCredentialStatus): ApiProviderReadiness {
    if (!this.enabled) {
      return "disabled";
    }

    if (credentialStatus.state !== "present") {
      return "missing_credentials";
    }

    if (!this.hasRunnableAdapter()) {
      return "missing_adapter";
    }

    return "configured";
  }

  private messageForReadiness(readiness: ApiProviderReadiness) {
    if (readiness === "disabled") {
      return `API provider "${this.descriptor.id}" is disabled. Enable it explicitly to use this slot.`;
    }

    if (readiness === "missing_credentials") {
      const suffix = this.credentialEnvKey ? ` Set ${this.credentialEnvKey} or pass a credential.` : "";

      return `API provider "${this.descriptor.id}" is enabled but credentials are missing.${suffix}`;
    }

    if (readiness === "missing_adapter") {
      return `API provider "${this.descriptor.id}" is enabled and credentialed, but no ${this.adapterKind} is installed.`;
    }

    return `API provider "${this.descriptor.id}" is configured for explicit use.`;
  }
}

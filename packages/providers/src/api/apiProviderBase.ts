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

  protected readonly activation: ApiProviderConfig["activation"];
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
    this.activation = config.activation;
    if (config.activation.state === "explicit-user-selection") {
      if (config.activation.selectedProviderId !== config.descriptor.id) {
        throw new Error(
          `API selected provider "${config.activation.selectedProviderId}" does not match descriptor "${config.descriptor.id}".`
        );
      }
      if (!config.activation.credentialReference.validated || !config.activation.credentialReference.id.trim()) {
        throw new Error("API explicit user selection requires a validated credential reference.");
      }
    }
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
    if (this.activation.state === "disabled") {
      return {
        state: "not_checked",
        source: "none"
      };
    }

    const reference = this.activation.credentialReference;

    if ((reference.source === "explicit" || reference.source === "secure-store") && this.credential?.trim()) {
      return {
        state: "present",
        referenceId: reference.id,
        source: reference.source
      };
    }

    if (reference.source === "environment") {
      const env = contextEnv ?? this.env;
      const value = env[reference.id];

      return {
        state: value && value.trim() ? "present" : "missing",
        envKey: reference.id,
        referenceId: reference.id,
        source: "environment"
      };
    }

    return {
      state: "missing",
      referenceId: reference.id,
      source: reference.source
    };
  }

  private getReadiness(credentialStatus: ApiCredentialStatus): ApiProviderReadiness {
    if (this.activation.state === "disabled") {
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
      const reference = this.activation.state === "explicit-user-selection"
        ? this.activation.credentialReference.id
        : "the selected credential reference";

      return `API provider "${this.descriptor.id}" was explicitly selected, but credential reference ${reference} is unresolved.`;
    }

    if (readiness === "missing_adapter") {
      return `API provider "${this.descriptor.id}" was explicitly selected and credentialed, but no ${this.adapterKind} is installed.`;
    }

    return `API provider "${this.descriptor.id}" is configured for explicit use.`;
  }
}

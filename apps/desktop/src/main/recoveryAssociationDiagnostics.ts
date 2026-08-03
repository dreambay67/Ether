import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import type { DiagnosticRecord } from "./diagnostics/localDiagnostics.js";
import type { RecoveryShellIdentity } from "./recoveryShellIdentity.js";
import type { OpenDocumentRequestOutcome } from "./services/applicationService.js";

type RecoveryWindowState = {
  isFocused(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
};

export type RecoveryAssociationOpenTrace = {
  correlationId: string;
  failed(error: unknown): void;
  focusAttempt(): void;
  handled(outcome: OpenDocumentRequestOutcome): void;
};

export function createRecoveryAssociationDiagnostics(input: {
  flushSync?: () => void;
  log: (record: DiagnosticRecord) => void;
  recoveryShell: RecoveryShellIdentity | null;
  schedulePostFocus?: (callback: () => void) => void;
  window: RecoveryWindowState;
}): { received(argv: readonly string[], candidate: string | null): RecoveryAssociationOpenTrace } | null {
  if (input.recoveryShell === null || input.recoveryShell.recentEnabled) return null;
  const recoveryTokenHash = safeDigest(input.recoveryShell.token);
  const schedulePostFocus = input.schedulePostFocus ?? ((callback) => { setTimeout(callback, 100); });
  const emit = (record: DiagnosticRecord) => {
    try {
      input.log(record);
      input.flushSync?.();
    } catch {
      // Diagnostics must never affect document activation.
    }
  };
  const describeCandidate = (candidate: string | null) => {
    try {
      return candidate === null
        ? { candidate: "absent", candidateBasenameHash: "absent", candidatePathHash: "absent" }
        : {
            candidate: "ether-argument",
            candidateBasenameHash: safeDigest(`${input.recoveryShell!.token}\0${path.basename(candidate)}`),
            candidatePathHash: safeDigest(`${input.recoveryShell!.token}\0${path.resolve(candidate).toLocaleLowerCase("en-US")}`)
          };
    } catch {
      return { candidate: "classification-failed", candidateBasenameHash: "unavailable", candidatePathHash: "unavailable" };
    }
  };
  return {
    received(argv, candidate) {
      const correlationId = safeCorrelationId();
      const details = describeRecoverySecondInstance(argv, candidate, describeCandidate, recoveryTokenHash);
      emit({
        correlationId,
        details,
        event: "desktop.recovery.association.second-instance.received",
        level: "info",
        message: "Recovery association received a second-instance request."
      });
      return {
        correlationId,
        failed(error) {
          try {
            const candidateError = error as { code?: unknown; name?: unknown } | null;
            emit({
              correlationId,
              details: {
                ...details,
                errorCode: safeErrorCode(candidateError?.code),
                errorName: safeErrorName(candidateError?.name)
              },
              event: "desktop.recovery.association.second-instance.failed",
              level: "error",
              message: "Recovery association second-instance handling failed."
            });
          } catch {
            // Diagnostics must never affect document activation.
          }
        },
        focusAttempt() {
          try {
            emit({
              correlationId,
              details,
              event: "desktop.recovery.association.second-instance.focus-attempt",
              level: "info",
              message: "Recovery association requested focus for an already open document."
            });
            schedulePostFocus(() => {
              let state: Record<string, unknown>;
              try {
                state = {
                  postSettleFocused: input.window.isFocused(),
                  postSettleMinimized: input.window.isMinimized(),
                  postSettleVisible: input.window.isVisible()
                };
              } catch {
                state = { postSettleState: "unavailable" };
              }
              emit({
                correlationId,
                details: { ...details, ...state },
                event: "desktop.recovery.association.second-instance.focus-state",
                level: "info",
                message: "Recovery association recorded post-settle focus state."
              });
            });
          } catch {
            // Diagnostics must never affect document activation.
          }
        },
        handled(outcome) {
          try {
            const handledDetails = outcome.kind === "handled"
              ? {
                  ...details,
                  canonicalBasenameHash: safeDigest(`${input.recoveryShell!.token}\0${path.basename(outcome.canonicalPath)}`),
                  canonicalPathHash: safeDigest(`${input.recoveryShell!.token}\0${outcome.canonicalPath.toLocaleLowerCase("en-US")}`),
                  disposition: outcome.disposition
                }
              : { ...details, disposition: "cancelled" };
            emit({
              correlationId,
              details: handledDetails,
              event: "desktop.recovery.association.second-instance.handled",
              level: "info",
              message: "Recovery association second-instance request was handled."
            });
          } catch {
            // Diagnostics must never affect document activation.
          }
        }
      };
    }
  };
}

function safeCorrelationId(): string {
  try {
    return randomUUID();
  } catch {
    return `recovery-association-${process.pid}-${Date.now()}`;
  }
}

function describeRecoverySecondInstance(
  argv: readonly string[],
  candidate: string | null,
  describeCandidate: (candidate: string | null) => Record<string, string>,
  recoveryTokenHash: string
): Record<string, string | number> {
  try {
    return {
      ...describeCandidate(candidate),
      etherArgumentCount: Math.min(8, argv.filter((argument) => path.extname(argument).toLocaleLowerCase() === ".ether").length),
      primaryProcessId: process.pid,
      recoveryTokenHash
    };
  } catch {
    return { candidate: "classification-failed", etherArgumentCount: 0, primaryProcessId: process.pid, recoveryTokenHash };
  }
}

function safeDigest(value: string): string {
  try { return createHash("sha256").update(value).digest("hex"); } catch { return "unavailable"; }
}

function safeErrorCode(value: unknown): string {
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/u.test(value) ? value : "UNKNOWN";
}

function safeErrorName(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/u.test(value) ? value : "UnknownError";
}

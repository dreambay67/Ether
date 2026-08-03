import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import type { DiagnosticRecord } from "./diagnostics/localDiagnostics.js";
import type { RecoveryShellIdentity } from "./recoveryShellIdentity.js";
import type { OpenDocumentHandled } from "./services/applicationService.js";

type RecoveryWindowState = {
  isFocused(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
};

export type RecoveryAssociationOpenTrace = {
  correlationId: string;
  failed(error: unknown): void;
  focusAttempt(): void;
  handled(handled: OpenDocumentHandled): void;
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
  const emitAndFlush = (records: readonly DiagnosticRecord[]) => {
    for (const record of records) {
      try { input.log(record); } catch {
        // Diagnostics must never affect document activation.
      }
    }
    try { input.flushSync?.(); } catch {
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
      const pending: DiagnosticRecord[] = [{
        correlationId,
        details,
        event: "desktop.recovery.association.second-instance.received",
        level: "info",
        message: "Recovery association received a second-instance request."
      }];
      let focusObserved = false;
      let postSettleRecorded = false;
      let postSettleRecord: DiagnosticRecord | null = null;
      let terminalCommitted = false;
      let postSettleCommitted = false;
      const commitPostSettle = () => {
        if (!terminalCommitted || postSettleCommitted || postSettleRecord === null) return;
        postSettleCommitted = true;
        emitAndFlush([postSettleRecord]);
      };
      const commitTerminal = (record: DiagnosticRecord) => {
        if (terminalCommitted) return;
        terminalCommitted = true;
        pending.push(record);
        emitAndFlush(pending);
        pending.length = 0;
        commitPostSettle();
      };
      return {
        correlationId,
        failed(error) {
          commitTerminal(createFailedRecord(correlationId, details, error));
        },
        focusAttempt() {
          if (focusObserved || terminalCommitted) return;
          focusObserved = true;
          pending.push({
            correlationId,
            details,
            event: "desktop.recovery.association.second-instance.focus-attempt",
            level: "info",
            message: "Recovery association requested focus for an already open document."
          });
          try {
            schedulePostFocus(() => {
              if (postSettleRecorded) return;
              postSettleRecorded = true;
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
              postSettleRecord = {
                correlationId,
                details: { ...details, ...state },
                event: "desktop.recovery.association.second-instance.focus-state",
                level: "info",
                message: "Recovery association recorded post-settle focus state."
              };
              commitPostSettle();
            });
          } catch {
            // Diagnostics must never affect document activation.
          }
        },
        handled(handled) {
          commitTerminal(createHandledRecord(correlationId, details, input.recoveryShell!.token, handled));
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

function createHandledRecord(
  correlationId: string,
  details: Record<string, string | number>,
  recoveryToken: string,
  handled: OpenDocumentHandled
): DiagnosticRecord {
  let handledDetails: Record<string, unknown>;
  try {
    handledDetails = {
      ...details,
      canonicalBasenameHash: safeDigest(`${recoveryToken}\0${path.basename(handled.canonicalPath)}`),
      canonicalPathHash: safeDigest(`${recoveryToken}\0${handled.canonicalPath.toLocaleLowerCase("en-US")}`),
      disposition: handled.disposition
    };
  } catch {
    handledDetails = {
      ...details,
      canonicalBasenameHash: "unavailable",
      canonicalPathHash: "unavailable",
      disposition: "unavailable"
    };
  }
  return {
    correlationId,
    details: handledDetails,
    event: "desktop.recovery.association.second-instance.handled",
    level: "info",
    message: "Recovery association second-instance request was handled."
  };
}

function createFailedRecord(
  correlationId: string,
  details: Record<string, string | number>,
  error: unknown
): DiagnosticRecord {
  let failureDetails: Record<string, unknown>;
  try {
    const candidateError = error as { code?: unknown; name?: unknown } | null;
    failureDetails = {
      ...details,
      errorCode: safeErrorCode(candidateError?.code),
      errorName: safeErrorName(candidateError?.name)
    };
  } catch {
    failureDetails = { ...details, errorCode: "UNKNOWN", errorName: "UnknownError" };
  }
  return {
    correlationId,
    details: failureDetails,
    event: "desktop.recovery.association.second-instance.failed",
    level: "error",
    message: "Recovery association second-instance handling failed."
  };
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

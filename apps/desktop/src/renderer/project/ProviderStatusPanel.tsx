import { Activity, CheckCircle2, RefreshCw, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApplicationQuery, ProviderCapability, ProviderHealthResult } from "@ether/schema";

type ProviderStatusPanelProps = {
  documentId: string;
  open: boolean;
  onClose(): void;
};

type ProviderSnapshot = {
  capabilities: ProviderCapability[];
  providers: ProviderHealthResult[];
  runtime: ProviderHealthResult;
  gemini: { state: "not-configured" | "configured" | "verified" | "error" | "encryption-unavailable"; verifiedAt: string | null };
};

export function ProviderStatusPanel({ open, onClose }: ProviderStatusPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [snapshot, setSnapshot] = useState<ProviderSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const [runtime, health, capabilities, gemini] = await Promise.all([
        window.ether.runtime.providerHealth(),
        window.ether.application.query(query("provider.health")),
        window.ether.application.query(query("provider.capabilities")),
        window.ether.runtime.geminiCredentialStatus()
      ]);
      setSnapshot({
        runtime,
        providers: (health.payload as { providers: ProviderHealthResult[] }).providers,
        capabilities: (capabilities.payload as { capabilities: ProviderCapability[] }).capabilities,
        gemini
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Provider health could not be read.");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("ether:provider-policy-changed", refresh);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("ether:provider-policy-changed", refresh);
    };
  }, [onClose, open, refresh]);

  if (!open) return null;
  const runtime = snapshot?.runtime ?? null;
  const capabilityCount = snapshot?.capabilities.length ?? 0;
  const providerRows = snapshot?.providers ?? [];

  return (
    <div className="release-dialog-backdrop" role="presentation" data-testid="provider-health-dialog">
      <section className="release-dialog provider-health-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-health-title">
        <header className="release-dialog-header">
          <div>
            <span className="eyebrow">Local runtime evidence</span>
            <h2 id="provider-health-title"><Activity size={19} aria-hidden="true" />Provider Health</h2>
            <p>Ether reports only routes and capabilities observed by this installed application. It never invents a fallback.</p>
          </div>
          <button ref={closeRef} type="button" className="icon-command" aria-label="Close Provider Health" onClick={onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="provider-health-summary" aria-live="polite">
          <StatusMetric label="Runtime" value={runtime ? statusLabel(runtime.status) : checking ? "Checking" : "Unknown"} tone={runtime?.status ?? "probing"} />
          <StatusMetric label="Transport" value={runtime?.transport ?? "Not reported"} />
          <StatusMetric label="Verified profiles" value={String(capabilityCount)} />
          <StatusMetric label="Checked" value={runtime ? new Date(runtime.checkedAt).toLocaleTimeString() : "Pending"} />
        </div>

        {error ? <p className="release-dialog-error" role="alert"><ShieldAlert size={16} />{error}</p> : null}

        <div className="provider-health-grid">
          <article className="provider-runtime-card">
            <div className="provider-card-title">
              <div><span>Application-owned runtime</span><strong>{runtime?.providerId ?? "Codex runtime"}</strong></div>
              <HealthBadge status={runtime?.status ?? "probing"} />
            </div>
            <dl className="evidence-list">
              <Evidence label="Version" value={runtime?.version ?? "Not available"} />
              <Evidence label="Process phase" value={runtime?.processPhase ?? "None"} />
              <Evidence label="Manifest evidence" value={runtime?.manifestHash ? runtime.manifestHash.slice(0, 18) : "Not available"} />
              <Evidence label="Restart count" value={String(runtime?.restartCount ?? 0)} />
            </dl>
            <p>{runtime?.message ?? runtime?.fallbackReason ?? "No runtime warning was reported."}</p>
          </article>

          <article className="provider-capability-card">
            <div className="provider-card-title">
              <div><span>Conformance evidence</span><strong>Capability profiles</strong></div>
              <CheckCircle2 size={18} aria-hidden="true" />
            </div>
            {snapshot === null && checking ? <p>Reading provider evidence…</p> : snapshot?.capabilities.length ? (
              <ul className="provider-profile-list">
                {snapshot.capabilities.map((capability) => (
                  <li key={`${capability.providerId}:${capability.profileId}:${capability.operation}`}>
                    <strong>{capability.profileId}</strong>
                    <span>{capability.operation}</span>
                    <small>{capability.provenance} · {capability.inputChannels.join(", ")} → {capability.outputChannels.join(", ")}</small>
                  </li>
                ))}
              </ul>
            ) : <p>No verified provider profile is available. Generation controls remain unavailable instead of guessing.</p>}
          </article>
          <article className="provider-capability-card" data-testid="gemini-provider-health">
            <div className="provider-card-title">
              <div><span>Default Nano Banana route</span><strong>Gemini Developer API</strong></div>
              <HealthBadge status={snapshot?.gemini.state === "verified" || snapshot?.gemini.state === "configured" ? "available" : "unavailable"} />
            </div>
            <dl className="evidence-list">
              <Evidence label="Connection" value={geminiConnectionLabel(snapshot?.gemini.state)} />
              <Evidence label="Models" value="Nano Banana 2, Pro, and 2 Lite" />
              <Evidence label="Grounding" value="Google Search and Image Search off" />
              <Evidence label="Fallback" value="None — Antigravity is explicit legacy CLI only" />
            </dl>
            <p>Credentials remain in protected Windows storage in the main process; this report never reads or displays them.</p>
          </article>
        </div>

        {providerRows.length > 0 ? (
          <section className="provider-report-list" aria-label="Document provider report">
            <h3>Document provider report</h3>
            {providerRows.map((provider) => (
              <article key={provider.providerId}>
                <HealthBadge status={provider.status} />
                <div><strong>{provider.providerId}</strong><p>{provider.message ?? "No additional provider message."}</p></div>
                <code>{provider.transport}</code>
              </article>
            ))}
          </section>
        ) : null}

        <footer className="release-dialog-actions">
          <p>No telemetry leaves this machine. Health checks inspect local process and conformance evidence.</p>
          <button type="button" disabled={checking} onClick={() => void refresh()}>
            <RefreshCw size={14} aria-hidden="true" />{checking ? "Checking…" : "Check again"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function query(name: "provider.health" | "provider.capabilities"): ApplicationQuery {
  return {
    kind: "query",
    id: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
    name,
    payload: {}
  } as ApplicationQuery;
}

function statusLabel(status: ProviderHealthResult["status"]) {
  return status === "available" ? "Available" : status === "degraded" ? "Degraded" : status === "probing" ? "Checking" : "Unavailable";
}

function HealthBadge({ status }: { status: ProviderHealthResult["status"] }) {
  return <span className="health-badge" data-status={status}>{statusLabel(status)}</span>;
}

function StatusMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone?: ProviderHealthResult["status"];
}) {
  return <div className="status-metric" data-status={tone}><span>{label}</span><strong>{value}</strong></div>;
}

function Evidence({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function geminiConnectionLabel(state: ProviderSnapshot["gemini"]["state"] | undefined) {
  if (state === "verified") return "Verified without generating an image";
  if (state === "configured") return "Configured — test recommended";
  if (state === "error") return "Needs replacement";
  if (state === "encryption-unavailable") return "Protected storage unavailable (fail-closed)";
  return "Not configured";
}

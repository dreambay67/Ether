import { Accessibility, Info, LayoutPanelTop, LockKeyhole, RotateCcw, Settings2, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type InterfacePreferences = {
  density: "comfortable" | "compact";
  motion: "system" | "reduced";
};

export const defaultInterfacePreferences: InterfacePreferences = {
  density: "comfortable",
  motion: "system"
};

export function normalizeInterfacePreferences(value: unknown): InterfacePreferences {
  const source = value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    density: source.density === "compact" ? "compact" : "comfortable",
    motion: source.motion === "reduced" ? "reduced" : "system"
  };
}

export function SettingsPanel({
  documentId,
  open,
  preferences,
  onPreferences,
  onClose
}: {
  documentId: string;
  open: boolean;
  preferences: InterfacePreferences;
  onPreferences(next: InterfacePreferences): void;
  onClose(): void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [versions, setVersions] = useState<{ app: string; electron: string; node: string } | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [layoutMessage, setLayoutMessage] = useState("");
  const [recovery, setRecovery] = useState<{ state: "healthy" | "attention" | "recovering"; reportId: string | null; message: string | null } | null>(null);
  const [antigravityConfirmed, setAntigravityConfirmed] = useState<boolean | null>(null);
  const [providerPolicySaving, setProviderPolicySaving] = useState(false);
  const [providerPolicyMessage, setProviderPolicyMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    setVersionError(null);
    void window.ether.runtime.versions().then(setVersions, (cause: unknown) => {
      setVersionError(cause instanceof Error ? cause.message : "Version information is unavailable.");
    });
    void window.ether.application.query({
      kind: "query",
      id: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      documentId,
      name: "recovery.status",
      payload: {}
    }).then((response) => {
      setRecovery(response.payload as typeof recovery);
    }, () => setRecovery(null));
    if (typeof window.ether.runtime.providerPolicy === "function") {
      void window.ether.runtime.providerPolicy().then(
        (policy) => setAntigravityConfirmed(policy.antigravityCreditOveragesConfirmed),
        () => {
          setAntigravityConfirmed(false);
          setProviderPolicyMessage("Antigravity billing protection could not be read; provider routes remain disabled.");
        }
      );
    } else {
      setAntigravityConfirmed(false);
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [documentId, onClose, open]);

  if (!open) return null;

  const resetLayouts = () => {
    const keys = Array.from({ length: window.localStorage.length }, (_value, index) => window.localStorage.key(index))
      .filter((key): key is string => key?.startsWith("ether.desktop.shell.v2:") === true);
    for (const key of keys) window.localStorage.removeItem(key);
    setLayoutMessage(keys.length === 0 ? "Panel layouts already use their defaults." : "Panel layouts will return to defaults when the document is reopened.");
  };

  const updateAntigravityPolicy = async (confirmed: boolean) => {
    setProviderPolicySaving(true);
    setProviderPolicyMessage("");
    try {
      const policy = await window.ether.runtime.setProviderPolicy(confirmed);
      setAntigravityConfirmed(policy.antigravityCreditOveragesConfirmed);
      setProviderPolicyMessage(policy.antigravityCreditOveragesConfirmed
        ? "Confirmation saved. Ether refreshed verified Antigravity profiles."
        : "Confirmation cleared. Ether disabled every Antigravity route.");
      window.dispatchEvent(new CustomEvent("ether:provider-policy-changed"));
    } catch (cause) {
      setProviderPolicyMessage(cause instanceof Error
        ? cause.message
        : "The Antigravity safety policy could not be changed.");
    } finally {
      setProviderPolicySaving(false);
    }
  };

  return (
    <div className="release-dialog-backdrop" role="presentation" data-testid="settings-dialog">
      <section className="release-dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="release-dialog-header">
          <div>
            <span className="eyebrow">Installed application</span>
            <h2 id="settings-title"><Settings2 size={19} aria-hidden="true" />Settings</h2>
            <p>These preferences affect this local Ether interface only. Project content remains inside the active `.ether` document.</p>
          </div>
          <button ref={closeRef} type="button" className="icon-command" aria-label="Close Settings" onClick={onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="settings-grid">
          <section aria-labelledby="appearance-settings">
            <div className="settings-section-title"><Accessibility size={17} /><div><h3 id="appearance-settings">Interface</h3><p>Readable, persistent renderer preferences.</p></div></div>
            <label>
              Control density
              <select
                aria-label="Control density"
                value={preferences.density}
                onChange={(event) => onPreferences({ ...preferences, density: event.target.value as InterfacePreferences["density"] })}
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
            <label>
              Interface motion
              <select
                aria-label="Interface motion"
                value={preferences.motion}
                onChange={(event) => onPreferences({ ...preferences, motion: event.target.value as InterfacePreferences["motion"] })}
              >
                <option value="system">Follow Windows</option>
                <option value="reduced">Reduce motion</option>
              </select>
            </label>
          </section>

          <section aria-labelledby="layout-settings">
            <div className="settings-section-title"><LayoutPanelTop size={17} /><div><h3 id="layout-settings">Workspace layout</h3><p>Pane sizes are stored locally per document.</p></div></div>
            <p>Build, Focus, Run, and Review keep independent pane positions. Reset removes only Ether renderer layout keys.</p>
            <button type="button" onClick={resetLayouts}><RotateCcw size={14} />Reset panel layouts</button>
            <small role="status">{layoutMessage}</small>
          </section>

          <section aria-labelledby="privacy-settings">
            <div className="settings-section-title"><LockKeyhole size={17} /><div><h3 id="privacy-settings">Privacy & diagnostics</h3><p>Release protections are fixed, not cosmetic toggles.</p></div></div>
            <dl className="settings-facts">
              <Fact label="Telemetry" value="Off in Ether 4.0" />
              <Fact label="Diagnostics" value="Local, bounded, rotating JSONL" />
              <Fact label="Redaction" value="Credentials, user paths, and personal identifiers" />
              <Fact label="Documents" value="Never stored in renderer preferences" />
            </dl>
          </section>

          <section aria-labelledby="provider-safety-settings">
            <div className="settings-section-title"><ShieldCheck size={17} /><div><h3 id="provider-safety-settings">Antigravity safety</h3><p>An explicit billing guard for every Antigravity image route.</p></div></div>
            <label className="settings-confirmation">
              <input
                aria-label="Confirm Antigravity AI Credit Overages is Never"
                type="checkbox"
                checked={antigravityConfirmed === true}
                disabled={antigravityConfirmed === null || providerPolicySaving}
                onChange={(event) => void updateAntigravityPolicy(event.target.checked)}
              />
              <span>
                <strong>I confirmed AI Credit Overages is set to Never in Antigravity.</strong>
                <small>Ether cannot change Google billing. Leave this unchecked until you verify the official Antigravity setting.</small>
              </span>
            </label>
            <p>{antigravityConfirmed
              ? "Verified CLI profiles may appear after their version-specific conformance evidence passes."
              : "All Antigravity profiles are disabled. Codex remains available independently."}</p>
            <small role="status">{providerPolicySaving ? "Refreshing provider capabilities…" : providerPolicyMessage}</small>
          </section>

          <section aria-labelledby="recovery-settings" data-testid="release-recovery-status">
            <div className="settings-section-title"><RotateCcw size={17} /><div><h3 id="recovery-settings">Recovery</h3><p>The active document's production recovery report.</p></div></div>
            <dl className="settings-facts">
              <Fact label="State" value={recovery?.state ?? "Reading..."} />
              <Fact label="Report" value={recovery?.reportId ?? "No report required"} />
              <Fact label="Action" value={recovery?.message ?? "No interrupted operation needs attention."} />
            </dl>
          </section>

          <section aria-labelledby="about-settings" data-testid="about-ether">
            <div className="settings-section-title"><Info size={17} /><div><h3 id="about-settings">About Ether</h3><p>One release identity across the app, document writer, diagnostics, and installer.</p></div></div>
            {versionError ? <p className="release-dialog-error" role="alert">{versionError}</p> : (
              <dl className="settings-facts">
                <Fact label="Ether" value={versions?.app ?? "Reading..."} />
                <Fact label="Electron" value={versions?.electron ?? "Reading..."} />
                <Fact label="Node.js" value={versions?.node ?? "Reading..."} />
                <Fact label="Publisher" value="DreamBay" />
              </dl>
            )}
          </section>
        </div>

        <footer className="release-dialog-actions">
          <p><strong>Local-first:</strong> renderer settings contain presentation preferences, never unrestricted paths or provider credentials.</p>
          <button type="button" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

import { Cloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type GeminiCredentialStatus = {
  state: "not-configured" | "configured" | "verified" | "error" | "encryption-unavailable";
  verifiedAt: string | null;
};

export function GeminiCredentialControls({ headingId = "gemini-api-settings" }: { headingId?: string }) {
  const keyRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<GeminiCredentialStatus>({
    state: "not-configured",
    verifiedAt: null
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void window.ether.runtime.geminiCredentialStatus().then(setStatus, () => {
      setStatus({ state: "error", verifiedAt: null });
      setMessage("The protected Gemini connection status could not be read.");
    });
  }, []);

  const update = async () => {
    const field = keyRef.current;
    const apiKey = field?.value ?? "";
    if (!apiKey.trim()) {
      setMessage("Enter a Gemini API key in the protected field first.");
      return;
    }
    // The entry is never placed in React state and is cleared before the IPC call.
    if (field) field.value = "";
    setBusy(true);
    setMessage("");
    try {
      setStatus(await window.ether.runtime.connectGeminiCredential(apiKey));
      setMessage("Stored with Windows protected encryption. Test checks account access without generating an image.");
      window.dispatchEvent(new CustomEvent("ether:provider-policy-changed"));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Ether could not protect the Gemini API key.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage("");
    try {
      setStatus(await window.ether.runtime.testGeminiCredential());
      setMessage("Connection verified without generating an image.");
      window.dispatchEvent(new CustomEvent("ether:provider-policy-changed"));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Ether could not verify the Gemini connection.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setMessage("");
    try {
      setStatus(await window.ether.runtime.removeGeminiCredential());
      setMessage("The protected Gemini credential was removed from this Windows profile.");
      window.dispatchEvent(new CustomEvent("ether:provider-policy-changed"));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Ether could not remove the Gemini credential.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={headingId} data-testid="gemini-api-settings">
      <div className="settings-section-title">
        <Cloud size={17} />
        <div>
          <h3 id={headingId}>Gemini API</h3>
          <p>Primary Nano Banana route — paid Google Gemini Developer API.</p>
        </div>
      </div>
      <p>Google Search and Google Image Search grounding are off. Ether never sends the key to a child process, document, or diagnostic.</p>
      <label>
        Gemini API key
        <input
          ref={keyRef}
          aria-label="Gemini API key"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          disabled={busy || status.state === "encryption-unavailable"}
          placeholder={status.state === "configured" || status.state === "verified" ? "Enter a replacement key" : "Paste key only here"}
        />
      </label>
      <div className="settings-inline-actions">
        <button type="button" disabled={busy || status.state === "encryption-unavailable"} onClick={() => void update()}>
          {status.state === "configured" || status.state === "verified" ? "Replace" : "Connect"}
        </button>
        <button type="button" disabled={busy || (status.state !== "configured" && status.state !== "verified")} onClick={() => void test()}>Test</button>
        <button type="button" disabled={busy || (status.state !== "configured" && status.state !== "verified" && status.state !== "error")} onClick={() => void remove()}>Remove</button>
      </div>
      <dl className="settings-facts">
        <Fact label="Connection" value={status.state === "verified" ? "Verified" : status.state === "configured" ? "Configured — test recommended" : status.state === "encryption-unavailable" ? "Protected storage unavailable" : status.state === "error" ? "Needs replacement" : "Not configured"} />
        <Fact label="Key visibility" value="Never displayed after entry" />
        <Fact label="Cost guidance" value="Estimates only; Google billing is authoritative" />
      </dl>
      <small role="status">{busy ? "Working with protected local storage…" : message}</small>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

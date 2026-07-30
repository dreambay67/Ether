import { LockKeyhole, X } from "lucide-react";
import { useEffect } from "react";

import { GeminiCredentialControls } from "./GeminiCredentialControls";
import { notifyRendererInteractive } from "../runtime/interactive";

export function GeminiCredentialSetup() {
  useEffect(() => notifyRendererInteractive(), []);

  return (
    <main className="gemini-credential-setup" aria-labelledby="gemini-credential-title">
      <header>
        <div className="gemini-credential-mark"><LockKeyhole size={20} aria-hidden="true" /></div>
        <div>
          <span className="eyebrow">Protected local connection</span>
          <h1 id="gemini-credential-title">Connect Gemini without opening a workspace</h1>
        </div>
        <button type="button" aria-label="Close Gemini connection window" onClick={() => window.close()}><X size={18} /></button>
      </header>
      <div className="gemini-credential-body">
        <p className="gemini-credential-intro">The key is accepted only in this password field, encrypted by Windows through Ether’s main process, and never shown again.</p>
        <GeminiCredentialControls headingId="gemini-credential-controls" />
      </div>
      <footer>Close this window when the connection is configured. Open Ether normally when you are ready to generate.</footer>
    </main>
  );
}

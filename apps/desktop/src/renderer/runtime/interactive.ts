let notified = false;

export function notifyRendererInteractive(): void {
  if (notified) return;
  const runtime = (window.ether as unknown as {
    runtime?: { rendererInteractive?: () => Promise<unknown> };
  }).runtime;
  if (typeof runtime !== "object" || typeof runtime.rendererInteractive !== "function") return;
  notified = true;
  void runtime.rendererInteractive().catch(() => {
    // The main process also has a bounded readiness fallback.
  });
}

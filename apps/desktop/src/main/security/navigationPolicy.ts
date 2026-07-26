import type { WebContents } from "electron";

export interface RendererSessionEgressPort {
  webRequest: {
    onBeforeRequest(
      filter: { urls: string[] },
      listener: (
        details: { url: string },
        callback: (response: { cancel: boolean }) => void
      ) => void
    ): void;
  };
}

export interface ChromiumCommandLinePort {
  appendSwitch(name: string, value?: string): void;
}

/**
 * WebRequest contains HTTP(S) and WebSocket traffic. This process policy also
 * denies direct UDP ICE/STUN so an untrusted renderer cannot bypass it through
 * an RTCPeerConnection data channel.
 */
export function installChromiumNetworkContainment(commandLine: ChromiumCommandLinePort): void {
  commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");
}

/** Ether has one renderer; every other navigation is untrusted. */
export function isAllowedRendererNavigation(targetUrl: string, rendererUrl: string): boolean {
  try {
    return new URL(targetUrl).href === new URL(rendererUrl).href;
  } catch {
    return false;
  }
}

export function isAllowedRendererEgress(
  targetUrl: string,
  rendererUrl: string,
  development: boolean
): boolean {
  if (!development) return false;
  try {
    const renderer = new URL(rendererUrl);
    const target = new URL(targetUrl);
    if (
      renderer.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(renderer.hostname)
    ) return false;
    const targetProtocol = target.protocol === "ws:" ? "http:"
      : target.protocol === "wss:" ? "https:"
        : target.protocol;
    return targetProtocol === renderer.protocol &&
      target.hostname === renderer.hostname &&
      target.port === renderer.port;
  } catch {
    return false;
  }
}

export function installSessionEgressPolicy(
  session: RendererSessionEgressPort,
  rendererUrl: string,
  development: boolean
): void {
  session.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (details, callback) => {
      callback({ cancel: !isAllowedRendererEgress(details.url, rendererUrl, development) });
    }
  );
}

export function installRestrictedNavigationPolicy(webContents: WebContents, rendererUrl: string): void {
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedRendererNavigation(targetUrl, rendererUrl)) event.preventDefault();
  });
  webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  webContents.session.setPermissionCheckHandler(() => false);
  installSessionEgressPolicy(
    webContents.session,
    rendererUrl,
    new URL(rendererUrl).protocol === "http:"
  );
}

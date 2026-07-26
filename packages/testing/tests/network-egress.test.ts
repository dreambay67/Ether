import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createEtherAssetProtocolHandler } from "../../../apps/desktop/src/main/protocol/etherAssetProtocol";
import {
  installChromiumNetworkContainment,
  installSessionEgressPolicy,
  isAllowedRendererEgress,
  isAllowedRendererNavigation
} from "../../../apps/desktop/src/main/security/navigationPolicy";
import { isLocalDevelopmentRendererUrl } from "../../../apps/desktop/src/main/rendererUrl";
import { installRendererNetworkContainment } from "../../../apps/desktop/src/preload/rendererNetworkContainment";

describe("network egress policy", () => {
  it("disables direct UDP WebRTC egress before Chromium starts", () => {
    const appendSwitch = vi.fn();
    installChromiumNetworkContainment({ appendSwitch });
    expect(appendSwitch).toHaveBeenCalledWith(
      "force-webrtc-ip-handling-policy",
      "disable_non_proxied_udp"
    );
  });

  it("removes the renderer WebRTC construction surface before page code runs", () => {
    const target: Record<string, unknown> = {
      RTCPeerConnection: class UnsafePeerConnection {},
      webkitRTCPeerConnection: class UnsafeWebkitPeerConnection {}
    };
    installRendererNetworkContainment(target);
    for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection"]) {
      const constructor = target[name] as new () => unknown;
      expect(() => new constructor()).toThrow(/blocks renderer WebRTC network egress/i);
      expect(Object.getOwnPropertyDescriptor(target, name)).toMatchObject({
        configurable: false,
        writable: false
      });
    }
  });

  it("refuses remote renderer origins in development and production", () => {
    expect(isLocalDevelopmentRendererUrl("https://example.com", true)).toBe(false);
    expect(isLocalDevelopmentRendererUrl("http://127.0.0.1:5173", false)).toBe(false);
    expect(isAllowedRendererNavigation("https://example.com", "file:///app/dist/index.html")).toBe(false);
  });

  it("installs a request-level policy that bounds dev HMR and blocks production network egress", () => {
    let listener: ((details: { url: string }, callback: (response: { cancel: boolean }) => void) => void) | undefined;
    let urls: string[] = [];
    const session = {
      webRequest: {
        onBeforeRequest: (
          filter: { urls: string[] },
          candidate: typeof listener
        ) => {
          urls = filter.urls;
          listener = candidate;
        }
      }
    };
    installSessionEgressPolicy(session, "http://127.0.0.1:5173/", true);
    expect(urls).toEqual(["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"]);
    const decision = (url: string) => {
      let result: { cancel: boolean } | undefined;
      listener?.({ url }, (response) => { result = response; });
      return result;
    };
    expect(decision("http://127.0.0.1:5173/@vite/client")).toEqual({ cancel: false });
    expect(decision("ws://127.0.0.1:5173/?token=hmr")).toEqual({ cancel: false });
    for (const remote of [
      "http://127.0.0.1:5174/",
      "http://localhost:5173/",
      "https://127.0.0.1:5173/",
      "https://example.com/",
      "wss://example.com/socket"
    ]) expect(decision(remote)).toEqual({ cancel: true });

    expect(isAllowedRendererEgress("https://example.com", "file:///app/dist/index.html", false)).toBe(false);
    installSessionEgressPolicy(session, "file:///app/dist/index.html", false);
    expect(decision("http://127.0.0.1:5173/")).toEqual({ cancel: true });
  });

  it("ships a CSP with no remote or wildcard-port connection allowance", () => {
    const html = readFileSync(
      path.resolve(import.meta.dirname, "../../../apps/desktop/index.html"),
      "utf8"
    );
    expect(html).toContain("connect-src 'self' ws://127.0.0.1:5173");
    expect(html).toContain("media-src 'self' ether-asset:");
    const connectSources = /connect-src ([^;]+)/.exec(html)?.[1] ?? "";
    expect(connectSources).not.toContain("https:");
    expect(connectSources).not.toContain("wss:");
    expect(connectSources).not.toContain(":*");
    expect(html).toContain("worker-src 'none'");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("frame-src 'none'");
  });

  it("serves embedded media without invoking browser network APIs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const handler = createEtherAssetProtocolHandler({
      authorize: async () => ({ byteLength: 8, contentHash: "content-hash", mediaType: "image/png" }),
      streamRange: async function* () { yield new Uint8Array(8); }
    });
    await expect(handler(new Request("ether-asset://document-1/artifact-1/original"))).resolves.toMatchObject({ status: 200 });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

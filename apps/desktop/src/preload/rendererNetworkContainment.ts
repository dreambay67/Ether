type RendererNetworkGlobal = Record<string, unknown>;

/**
 * Ether has no peer-to-peer media or data-channel feature. Install this in the
 * main world before renderer modules run so page code cannot use WebRTC as a
 * raw TCP/UDP egress path that bypasses Chromium's request interception.
 */
export function installRendererNetworkContainment(
  target: RendererNetworkGlobal = globalThis as unknown as RendererNetworkGlobal
): void {
  class EtherBlockedPeerConnection {
    constructor() {
      throw new Error("Ether blocks renderer WebRTC network egress.");
    }
  }

  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection"]) {
    Object.defineProperty(target, name, {
      configurable: false,
      enumerable: false,
      value: EtherBlockedPeerConnection,
      writable: false
    });
  }
}

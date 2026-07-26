export type RendererNetworkProbeName =
  | "event-source"
  | "fetch"
  | "web-rtc"
  | "web-socket"
  | "xml-http-request";

export type RendererNetworkProbeResult = Record<
  RendererNetworkProbeName,
  "blocked" | "unexpected-success" | "unavailable"
>;

function settleWithin(
  operation: (settle: (result: "blocked" | "unexpected-success") => void) => void,
  timeoutMs: number
): Promise<"blocked" | "unexpected-success"> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: "blocked" | "unexpected-success") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = window.setTimeout(() => finish("blocked"), timeoutMs);
    try {
      operation(finish);
    } catch {
      finish("blocked");
    }
  });
}

/**
 * Reusable by the packaged release probe. The sentinel server, rather than
 * browser error wording, is the authority for whether any bytes escaped.
 */
export async function runRendererNetworkEgressProbe(
  sentinelUrl: string,
  timeoutMs = 500
): Promise<RendererNetworkProbeResult> {
  const target = new URL(sentinelUrl);
  const websocketUrl = new URL(target);
  websocketUrl.protocol = target.protocol === "https:" ? "wss:" : "ws:";

  const fetchResult = await fetch(target, { cache: "no-store" })
    .then(() => "unexpected-success" as const)
    .catch(() => "blocked" as const);

  const xhrResult = await settleWithin((settle) => {
    const request = new XMLHttpRequest();
    request.open("GET", target);
    request.onload = () => settle("unexpected-success");
    request.onerror = () => settle("blocked");
    request.onabort = () => settle("blocked");
    request.ontimeout = () => settle("blocked");
    request.timeout = timeoutMs;
    request.send();
  }, timeoutMs);

  const eventSourceResult = typeof EventSource === "undefined"
    ? "unavailable"
    : await settleWithin((settle) => {
        const source = new EventSource(target);
        source.onopen = () => {
          source.close();
          settle("unexpected-success");
        };
        source.onerror = () => {
          source.close();
          settle("blocked");
        };
      }, timeoutMs);

  const webSocketResult = typeof WebSocket === "undefined"
    ? "unavailable"
    : await settleWithin((settle) => {
        const socket = new WebSocket(websocketUrl);
        socket.onopen = () => {
          socket.close();
          settle("unexpected-success");
        };
        socket.onerror = () => {
          socket.close();
          settle("blocked");
        };
      }, timeoutMs);

  const webRtcResult = typeof RTCPeerConnection === "undefined"
    ? "unavailable"
    : await settleWithin((settle) => {
        const peer = new RTCPeerConnection({
          iceServers: [{
            urls: `stun:${target.hostname}:${target.port || (target.protocol === "https:" ? "443" : "80")}`
          }]
        });
        peer.createDataChannel("ether-egress-probe");
        peer.onicecandidateerror = () => {
          peer.close();
          settle("blocked");
        };
        peer.onicegatheringstatechange = () => {
          if (peer.iceGatheringState !== "complete") return;
          peer.close();
          settle("blocked");
        };
        void peer.createOffer()
          .then((offer) => peer.setLocalDescription(offer))
          .catch(() => {
            peer.close();
            settle("blocked");
          });
      }, timeoutMs);

  return {
    "event-source": eventSourceResult,
    fetch: fetchResult,
    "web-rtc": webRtcResult,
    "web-socket": webSocketResult,
    "xml-http-request": xhrResult
  };
}
